/**
 * Vault Stats Route — Issue #287 + Issue #466 + Issue #310 (multi-tenant)
 *
 * GET /api/v1/vault/stats?vaultId=<id>
 *
 * Returns vault statistics with Redis caching.
 *  - 30-second TTL (configurable via VAULT_STATS_CACHE_TTL_SECS env var)
 *  - Cache-Control headers set on all responses
 *  - Cache invalidated on harvest events
 *  - Falls back to direct DB query on cache miss
 *  - Response shape: { totalAssets, sharePrice, depositorCount, apy7d, apy30d, lastHarvest }
 */

import { Router, Request, Response } from "express";
import { cacheGet, cacheSet, NS } from "../cache.js";
import {
  getVaultStats as getLegacyVaultStats,
  simulateDeposit,
  type VaultStatsData,
} from "../services/vaultStatsService.js";
import {
  getVaultStats,
  invalidateVaultStats,
  VAULT_STATS_CACHE_NS,
  VAULT_STATS_CACHE_TTL_SECS,
} from "../services/vaultStatsServiceV2.js";
// Re-export for consumers (e.g. tests) that import this constant from the route module
export { VAULT_STATS_CACHE_NS };
import { runCacheWarmup, getWarmupStatus } from "../services/cacheWarmup.js";
import { getDbMetrics, getSlowQueryLog, dbMetricsPrometheusText } from "../services/dbMonitor.js";
import { successResponse, errorResponse } from "../dto/index.js";
import { resolveVault } from "../services/vaultRegistryService.js";
import { ipRateLimiter } from "../middleware/rateLimitMiddleware.js";
import { logger } from "../logger.js";
import { depositSimulateSchema } from "../types/schemas.js";
import { getReadPool } from "../db.js";
import { authenticate } from "../middleware/authMiddleware.js";

// ── Simulate-deposit cache namespace ─────────────────────────────────────────
export const VAULT_SIMULATE_CACHE_NS = NS.VAULT_SIMULATE;
const VAULT_SIMULATE_CACHE_TTL_SECS = 15;

// ── Exported cache-entry type (consumed by tests) ────────────────────────────
export interface VaultStatsCacheEntry {
  data: VaultStatsData;
  cached_at: number; // Unix epoch ms
}

export const VAULT_STATS_CACHE_KEY = "current";

/** Cache TTL for per-user volume aggregation (5 minutes). */
export const USER_VOLUME_CACHE_TTL_SECS = 300;

export const vaultRouter = Router();

/** Public daily vault activity series for the analytics page. */
vaultRouter.get("/analytics/history", async (req: Request, res: Response): Promise<void> => {
  const periods: Record<string, number | null> = { "1D": 1, "7D": 7, "30D": 30, ALL: null };
  const period = typeof req.query.period === "string" ? req.query.period : "30D";
  if (!(period in periods)) {
    res.status(400).json(errorResponse("INVALID_PERIOD", "period must be 1D, 7D, 30D, or ALL"));
    return;
  }
  const days = periods[period];
  try {
    const pool = getReadPool();
    const [historyResult, baselineResult] = await Promise.all([pool.query<{
      day: Date; deposits: string; withdrawals: string; shares_minted: string;
      shares_burned: string; unique_depositors: string;
    }>(
      `SELECT date_trunc($2::text, timestamp) AS day,
              (COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) / 10000000)::text AS deposits,
              (COALESCE(SUM(amount) FILTER (WHERE type = 'withdraw'), 0) / 10000000)::text AS withdrawals,
              (COALESCE(SUM(shares) FILTER (WHERE type = 'deposit'), 0) / 10000000)::text AS shares_minted,
              (COALESCE(SUM(shares) FILTER (WHERE type = 'withdraw'), 0) / 10000000)::text AS shares_burned,
              COUNT(DISTINCT address) FILTER (WHERE type = 'deposit')::text AS unique_depositors
       FROM vault_events_history
       WHERE ($1::int IS NULL OR timestamp >= NOW() - ($1::int * INTERVAL '1 day'))
       GROUP BY 1 ORDER BY 1 ASC`,
      [days, days === 1 ? 'hour' : 'day'],
    ), days === null ? Promise.resolve({ rows: [{ tvl: '0', shares: '0' }] }) : pool.query<{ tvl: string; shares: string }>(
      `SELECT ((COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) -
                COALESCE(SUM(amount) FILTER (WHERE type = 'withdraw'), 0)) / 10000000)::text AS tvl,
              ((COALESCE(SUM(shares) FILTER (WHERE type = 'deposit'), 0) -
                COALESCE(SUM(shares) FILTER (WHERE type = 'withdraw'), 0)) / 10000000)::text AS shares
       FROM vault_events_history WHERE timestamp < NOW() - ($1::int * INTERVAL '1 day')`,
      [days],
    )]);
    let tvl = Number(baselineResult.rows[0]?.tvl ?? 0);
    let shares = Number(baselineResult.rows[0]?.shares ?? 0);
    const history = historyResult.rows.map((row) => {
      tvl = Math.max(0, tvl + Number(row.deposits) - Number(row.withdrawals));
      shares = Math.max(0, shares + Number(row.shares_minted) - Number(row.shares_burned));
      return {
        date: row.day.toISOString(),
        tvl,
        deposits: Number(row.deposits),
        withdrawals: Number(row.withdrawals),
        uniqueDepositors: Number(row.unique_depositors),
        sharePrice: shares > 0 ? tvl / shares : 0,
      };
    });
    res.set("Cache-Control", "public, max-age=60").json(successResponse({ history, period }));
  } catch (error) {
    logger.error({ error }, "[vault/analytics/history] failed to load event history");
    res.status(503).json(errorResponse("ANALYTICS_UNAVAILABLE", "Vault history is temporarily unavailable"));
  }
});

/** Dedicated per-IP rate limiter for the public volume endpoint (30 req/min). */
const volumeRateLimiter = ipRateLimiter({
  bucketKey: "rl:volume:ip",
  limit: 30,
  windowMs: 60_000,
});

/** Stellar account address: 56 chars, starting with G. */
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/**
 * GET /api/v1/users/:address/volume
 *
 * Public (no auth) aggregation of a wallet's deposit, withdrawal and yield
 * totals across all vaults and all time. Results are cached per address for
 * 5 minutes and rate limited to 30 req/min per IP.
 *
 * Response: { total_deposited, total_withdrawn, total_yield, net_position }
 */
vaultRouter.get(
  "/users/:address/volume",
  volumeRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const address = req.params.address;

    if (!STELLAR_ADDRESS_RE.test(address)) {
      res.status(400).json(
        errorResponse("INVALID_ADDRESS", "address must be a valid Stellar account address"),
      );
      return;
    }

    const cacheKey = address;

    try {
      const cached = await cacheGet<{
        total_deposited: string;
        total_withdrawn: string;
        total_yield: string;
        net_position: string;
      }>(NS.USER_VOLUME, cacheKey);

      if (cached) {
        res.set("Cache-Control", `public, max-age=${USER_VOLUME_CACHE_TTL_SECS}`);
        res.json(successResponse({ ...cached, cached: true }));
        return;
      }

      const volume = await getUserVolume(address);

      const payload = {
        total_deposited: volume.total_deposited,
        total_withdrawn: volume.total_withdrawn,
        total_yield: volume.total_yield,
        net_position: volume.net_position,
      };

      await cacheSet(NS.USER_VOLUME, cacheKey, payload, USER_VOLUME_CACHE_TTL_SECS);

      res.set("Cache-Control", `public, max-age=${USER_VOLUME_CACHE_TTL_SECS}`);
      res.json(successResponse({ ...payload, cached: false }));
    } catch (err) {
      logger.error({ err }, "[users/:address/volume] Failed to aggregate user volume");
      res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve user volume"));
    }
  },
);

/**
 * GET /api/v1/vault/decimals?vaultId=<id>
 * Returns the share decimals precision (e.g. 7 for Stellar standard).
 */
vaultRouter.get("/decimals", async (req: Request, res: Response): Promise<void> => {
  try {
    const vaultIdParam = req.query.vaultId as string | undefined;
    const vault = await resolveVault(vaultIdParam).catch(() => null);
    res.json(successResponse({
      decimals: 7,
      symbol: vault?.symbol ?? "AVS",
      name: vault?.name ?? "Aura Vault Share",
      ...(vault?.id && { vault_id: vault.id }),
      ...(vault?.contract_id && { contract_id: vault.contract_id }),
    }));
  } catch (err) {
    console.error("[vault/decimals]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve vault decimals"));
  }
});


/**
 * GET /api/v1/vault/stats?vaultId=<id>
 * Serves vault stats from Redis cache (30s TTL) or DB fallback.
 * Sets Cache-Control headers on every response.
 */
vaultRouter.get("/stats", async (req: Request, res: Response): Promise<void> => {
  const fetchedAt = new Date().toISOString();

  let vaultContractId: string | undefined;
  let vaultId: number | undefined;

  try {
    const vaultIdParam = req.query.vaultId as string | undefined;
    const vault = await resolveVault(vaultIdParam);
    if (vaultIdParam && !vault) {
      res.status(404).json(errorResponse("NOT_FOUND", "Vault not found"));
      return;
    }
    vaultContractId = vault?.contract_id;
    vaultId = vault?.id;
  } catch {
    // DB unavailable — continue without vault scoping
  }

  try {
    const { stats, cached, cacheAgeSecs, stale } = await getVaultStats(vaultContractId);

    if (stale) {
      res.set("X-Cache", "STALE");
    } else {
      res.set("X-Cache", cached ? "HIT" : "MISS");
    }

    // Set Cache-Control so CDN and browsers can cache for up to 30 seconds
    res.set(
      "Cache-Control",
      `public, max-age=${VAULT_STATS_CACHE_TTL_SECS}, s-maxage=${VAULT_STATS_CACHE_TTL_SECS}`,
    );
    res.set("X-Cache", cached ? "HIT" : "MISS");

    res.json(
      successResponse({
        ...stats,
        cached,
        ...(stale && { stale: true }),
        cache_age_secs: cacheAgeSecs,
        fetched_at: fetchedAt,
        ...(vaultId && { vault_id: vaultId }),
        ...(vaultContractId && { contract_id: vaultContractId }),
      }),
    );
  } catch (err) {
    logger.error({ err }, "[vault/stats] Failed to retrieve vault stats");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve vault stats"));
  }
});

/**
 * POST /api/v1/vault/stats/invalidate?vaultId=<id>
 * Purges the vault-stats cache for a specific vault (or default if omitted).
 */
vaultRouter.post("/stats/invalidate", async (req: Request, res: Response): Promise<void> => {
  try {
    const vaultIdParam = req.query.vaultId as string | undefined;
    let contractId: string | undefined;

    if (vaultIdParam) {
      const vault = await resolveVault(vaultIdParam).catch(() => null);
      contractId = vault?.contract_id;
    }

    await invalidateVaultStats(contractId);
    res.json(successResponse({ invalidated: true }));
  } catch (err) {
    logger.error({ err }, "[vault/stats/invalidate] Cache invalidation failed");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Cache invalidation failed"));
  }
});

/**
 * POST /api/v1/vault/stats/refresh
 * Runs the cache warm-up pipeline to refresh the vault stats, share price,
 * and top-depositor cache entries on demand.
 *
 * Intentionally protected behind authentication so it is only callable by
 * an authorized operator or admin workflow.
 */
vaultRouter.post("/stats/refresh", authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    await runCacheWarmup();
    res.json(successResponse({ refreshed: true, status: getWarmupStatus() }));
  } catch (err) {
    console.error("[vault/stats/refresh]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Vault stats cache refresh failed"));
  }
});

/** Programmatic cache invalidation — used by harvest event handlers. */
export async function invalidateVaultStatsCache(contractId?: string): Promise<void> {
  await invalidateVaultStats(contractId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Keeper Harvest Endpoints (permissionless — no auth required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/vault/harvest/estimated
 *
 * Returns an estimated yield amount since the last harvest, derived from
 * the current vault APY and total_assets. This value is suggested to
 * keepers as a default when triggering a harvest.
 *
 * Response:
 *   { estimatedYield: string, lastHarvestAt: string | null, totalAssets: number }
 */
vaultRouter.get("/harvest/estimated", async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = await getVaultStats();

    const lastHarvestAt = stats.last_harvest ? new Date(stats.last_harvest) : null;
    const nowMs = Date.now();
    const elapsedMs = lastHarvestAt ? nowMs - lastHarvestAt.getTime() : 0;

    // Yield estimate: totalAssets * APY * (elapsedTime / 1 year)
    // APY is stored as a decimal (e.g. 0.085 = 8.5%)
    const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
    const estimatedYield =
      stats.total_assets > 0 && elapsedMs > 0
        ? stats.total_assets * stats.apy * (elapsedMs / YEAR_MS)
        : 0;

    res.json(
      successResponse({
        estimatedYield: estimatedYield.toFixed(7),
        lastHarvestAt: stats.last_harvest,
        totalAssets: stats.total_assets,
        totalShares: stats.total_shares,
        elapsedMs,
      })
    );
  } catch (err) {
    logger.error("[vault/harvest/estimated]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to estimate yield"));
  }
});

/**
 * POST /api/v1/vault/harvest/keeper
 *
 * Permissionless keeper harvest endpoint. Any caller can trigger a harvest
 * by providing a yield amount. No authentication is required — this is by
 * design to enable trust-minimised keeper bots and dashboard users.
 *
 * Body: { yieldAmount: string }  (positive decimal, up to 7 decimal places)
 *
 * Returns the updated share price after the harvest is recorded.
 */
const keeperHarvestLimiter = (() => {
  // Simple in-memory rate limit: max 5 calls per IP per minute
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: () => void) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= 5) {
        res.status(429).json(errorResponse("RATE_LIMITED", "Too many harvest requests. Please wait before trying again."));
        return;
      }
      bucket.count += 1;
    } else {
      buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    }
    next();
  };
})();

vaultRouter.post(
  "/harvest/keeper",
  keeperHarvestLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const raw = req.body?.yieldAmount;

    // Validate yieldAmount: positive decimal string, up to 7 decimal places
    if (typeof raw !== "string" || !/^[0-9]+(\.[0-9]{1,7})?$/.test(raw) || parseFloat(raw) <= 0) {
      res.status(400).json(
        errorResponse("INVALID_YIELD_AMOUNT", "yieldAmount must be a positive number with up to 7 decimal places")
      );
      return;
    }

    const yieldAmount = parseFloat(raw);

    try {
      // Check that the vault has shares before attempting harvest.
      // The on-chain contract returns ZeroShares (error code 8) when total_shares == 0.
      const stats = await getVaultStats();
      if (stats.total_shares === 0) {
        res.status(422).json(
          errorResponse(
            "ZERO_SHARES",
            "Cannot harvest: vault has no depositors (total_shares = 0). Deposit into the vault first."
          )
        );
        return;
      }

      // In production, this would build and submit a Soroban transaction using
      // the server-side keeper keypair. Here we simulate the share price update
      // that a successful harvest produces:
      //   newSharePrice = (totalAssets + yieldAmount) / totalShares
      const newTotalAssets = stats.total_assets + yieldAmount;
      const newSharePrice = newTotalAssets / stats.total_shares;

      // Invalidate the stats cache so the next GET /stats reflects the harvest
      await invalidateVaultStatsCache();

      logger.info("[vault/harvest/keeper] Harvest triggered", {
        yieldAmount,
        totalSharesBefore: stats.total_shares,
        newSharePrice: newSharePrice.toFixed(7),
      });

      res.status(200).json(
        successResponse({
          operation: "harvest",
          yieldAmount: raw,
          newSharePrice: newSharePrice.toFixed(7),
          harvestedAt: new Date().toISOString(),
          totalShares: stats.total_shares,
        })
      );
    } catch (err) {
      logger.error("[vault/harvest/keeper]", err);
      res.status(500).json(errorResponse("INTERNAL_ERROR", "Harvest failed. Please try again."));
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Issue #933 — Deposit Simulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/vault/simulate/deposit
 *
 * Returns the estimated number of shares a user would receive for a given
 * deposit amount, without executing anything on-chain.
 *
 * Body: { amount: number }  (positive integer, stroops / base units)
 *
 * Response: { expectedShares, sharePrice, priceImpact }
 *
 * Caching:
 *  - Vault stats read from VAULT_STATS_CACHE_NS:current (15-second TTL fallback)
 *  - Simulation result cached under VAULT_SIMULATE_CACHE_NS with 15-second TTL,
 *    keyed by (totalAssets, totalShares, amount) so stale vault state won't
 *    serve incorrect results to a different deposit amount.
 *
 * Closes #933
 */
vaultRouter.post(
  "/simulate/deposit",
  async (req: Request, res: Response): Promise<void> => {
    // ── Input validation ────────────────────────────────────────────────────
    const parsed = depositSimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const firstField = issues[0]?.path.join(".") ?? "amount";
      const firstMessage = issues[0]?.message ?? "invalid";
      res
        .status(400)
        .json({ error: `Validation failed: ${firstField} — ${firstMessage}` });
      return;
    }
    const { amount } = parsed.data;

    // ── Fetch vault stats (cache-first) ─────────────────────────────────────
    let totalAssets: number;
    let totalShares: number;

    try {
      // Try reading the existing stats cache entry (same cache populated by
      // GET /stats). The entry shape matches VaultStatsCacheEntry defined above.
      let statsFromCache: VaultStatsCacheEntry | null = null;
      try {
        statsFromCache = await cacheGet<VaultStatsCacheEntry>(
          VAULT_STATS_CACHE_NS,
          VAULT_STATS_CACHE_KEY,
        );
      } catch {
        // Redis unavailable — fall through to live fetch
      }

      if (statsFromCache !== null) {
        totalAssets = statsFromCache.data.total_assets;
        totalShares = statsFromCache.data.total_shares;
      } else {
        // Cache miss — call the legacy service (same seam mocked in tests)
        const liveStats = await getLegacyVaultStats();
        totalAssets = liveStats.total_assets;
        totalShares = liveStats.total_shares;
      }
    } catch (err) {
      logger.error({ err }, "[vault/simulate/deposit] Failed to fetch vault state");
      res
        .status(500)
        .json({ error: "Failed to fetch vault state. Please try again." });
      return;
    }

    // ── Check simulation cache ──────────────────────────────────────────────
    const simulateCacheKey = `${totalAssets}:${totalShares}:${amount}`;
    try {
      const cached = await cacheGet<ReturnType<typeof simulateDeposit>>(
        VAULT_SIMULATE_CACHE_NS,
        simulateCacheKey,
      );
      if (cached !== null) {
        res.status(200).json(cached);
        return;
      }
    } catch {
      // Redis unavailable — compute and return without caching
    }

    // ── Compute simulation ──────────────────────────────────────────────────
    const result = simulateDeposit(amount, totalAssets, totalShares);

    // ── Write simulation cache (best-effort) ────────────────────────────────
    try {
      await cacheSet(
        VAULT_SIMULATE_CACHE_NS,
        simulateCacheKey,
        result,
        VAULT_SIMULATE_CACHE_TTL_SECS,
      );
    } catch {
      // Best-effort — do not fail the request if Redis is unavailable
    }

    res.status(200).json(result);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Issue #324 — DB Query Performance Monitoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/vault/metrics/db
 * Returns histogram metrics and p99 estimate for each query type.
 */
vaultRouter.get("/metrics/db", async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await getDbMetrics();
    res.json(successResponse({ metrics, generated_at: new Date().toISOString() }));
  } catch (err) {
    logger.error("[vault/metrics/db]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve DB metrics"));
  }
});

/**
 * GET /api/v1/vault/metrics/db/slow-log
 * Returns the slow query log (most recent first).
 */
vaultRouter.get("/metrics/db/slow-log", async (_req: Request, res: Response): Promise<void> => {
  try {
    const log = await getSlowQueryLog();
    res.json(successResponse({ slow_queries: log, count: log.length, generated_at: new Date().toISOString() }));
  } catch (err) {
    logger.error("[vault/metrics/db/slow-log]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve slow query log"));
  }
});

/**
 * GET /api/v1/vault/metrics/db/prometheus
 * Returns Prometheus text exposition for db_query_duration_seconds histogram.
 */
vaultRouter.get("/metrics/db/prometheus", async (_req: Request, res: Response): Promise<void> => {
  try {
    const text = await dbMetricsPrometheusText();
    res.set("Content-Type", "text/plain; version=0.0.4").send(text);
  } catch (err) {
    logger.error("[vault/metrics/db/prometheus]", err);
    res.status(500).send("# error generating metrics\n");
  }
});

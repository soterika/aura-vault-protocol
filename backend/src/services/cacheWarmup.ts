/**
 * Cache Warming Service — Issue #325
 *
 * Pre-populates Redis with vault stats, share price, and top depositors on
 * application startup so the first real requests are fast.
 *
 * Design:
 *   - warmupState tracks warming lifecycle: 'pending' | 'warming' | 'ready' | 'failed'
 *   - Health check endpoint returns { status: 'starting' } until warming completes
 *   - All warm-up failures are logged but do NOT block startup
 *   - Prometheus metrics: cache_warm_duration_seconds, cache_warm_items_total
 *   - Must complete within 5 seconds (WARM_TIMEOUT_MS)
 */

import { cacheGet, cacheSet, NS } from "../cache.js";
import { getReadPool } from "../db.js";
import { getVaultStats } from "./vaultStatsService.js";
import { logger } from "../logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Wall-clock budget for the entire warm-up (ms). */
export const WARM_TIMEOUT_MS = 5_000;

/** TTLs (seconds) for each warmed cache entry. */
const TTL = {
  VAULT_STATS: 60,
  SHARE_PRICE: 30,
  TOP_DEPOSITORS: 300,
} as const;

/** Cache namespaces for warmed data. */
export const WARM_NS = {
  VAULT_STATS: "vault:stats",
  SHARE_PRICE: "vault:share_price",
  TOP_DEPOSITORS: "vault:top_depositors",
} as const;

export const VAULT_STATS_KEY = "current";
export const SHARE_PRICE_KEY = "current";
export const TOP_DEPOSITORS_KEY = "current";

/** How many top depositors to cache. */
const TOP_DEPOSITORS_LIMIT = 100;

// ── State ─────────────────────────────────────────────────────────────────────

export type WarmupStatus = "pending" | "warming" | "ready" | "failed";

let _warmupStatus: WarmupStatus = "pending";
let _warmupStartedAt: number | null = null;
let _warmupFinishedAt: number | null = null;
let _itemsCached = 0;

// ── Prometheus metrics ────────────────────────────────────────────────────────

// Metrics are recorded as simple counters for Prometheus scraping via /metrics.
// In a full prom-client setup these would be Histogram/Gauge; here we store
// them in Redis so the /metrics endpoint can expose them without adding deps.

async function recordMetrics(
  durationMs: number,
  itemsCached: number
): Promise<void> {
  try {
    await cacheSet(
      "metrics:cache_warm",
      "latest",
      {
        duration_seconds: durationMs / 1000,
        items_cached: itemsCached,
        timestamp: new Date().toISOString(),
      },
      3600 // keep for 1 hour
    );
  } catch {
    // Metrics recording is best-effort
  }
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

/**
 * Fetch vault stats and cache them.
 * Returns 1 if successfully cached, 0 on failure.
 */
async function warmVaultStats(): Promise<number> {
  // Check if already cached to avoid redundant work
  const existing = await cacheGet(WARM_NS.VAULT_STATS, VAULT_STATS_KEY);
  if (existing !== null) {
    logger.debug("[cache-warm] vault stats already cached, skipping");
    return 1;
  }

  const stats = await getVaultStats();
  await cacheSet(
    WARM_NS.VAULT_STATS,
    VAULT_STATS_KEY,
    { data: stats, cached_at: Date.now() },
    TTL.VAULT_STATS
  );
  logger.info("[cache-warm] vault stats cached", { apy: stats.apy, total_assets: stats.total_assets });
  return 1;
}

export interface SharePriceData {
  price: number;          // assets per share (e.g. 1.085)
  total_assets: number;
  total_shares: number;
  computed_at: string;    // ISO-8601
}

/**
 * Derive share price from vault stats and cache it.
 * share_price = total_assets / total_shares (or 1.0 if vault is empty)
 */
async function warmSharePrice(): Promise<number> {
  const existing = await cacheGet(WARM_NS.SHARE_PRICE, SHARE_PRICE_KEY);
  if (existing !== null) {
    logger.debug("[cache-warm] share price already cached, skipping");
    return 1;
  }

  const stats = await getVaultStats();
  const price =
    stats.total_shares > 0
      ? stats.total_assets / stats.total_shares
      : 1.0;

  const payload: SharePriceData = {
    price,
    total_assets: stats.total_assets,
    total_shares: stats.total_shares,
    computed_at: new Date().toISOString(),
  };

  await cacheSet(WARM_NS.SHARE_PRICE, SHARE_PRICE_KEY, payload, TTL.SHARE_PRICE);
  logger.info("[cache-warm] share price cached", { price });
  return 1;
}

export interface TopDepositor {
  rank: number;
  user_id: string;
  share_balance: string;   // NUMERIC as string to preserve precision
  estimated_value: string; // NUMERIC as string
}

/**
 * Query the top depositors by aggregate share balance and cache the result.
 * Falls back gracefully if no DB rows are found (empty vault case).
 */
async function warmTopDepositors(): Promise<number> {
  const existing = await cacheGet(WARM_NS.TOP_DEPOSITORS, TOP_DEPOSITORS_KEY);
  if (existing !== null) {
    logger.debug("[cache-warm] top depositors already cached, skipping");
    return 1;
  }

  const pool = getReadPool();

  // Sum amount per user across active positions, ordered by total descending.
  // yield_earned is included in estimated_value to reflect accrued gains.
  const { rows } = await pool.query<{
    user_id: string;
    share_balance: string;
    estimated_value: string;
  }>(
    `
    SELECT
      user_id::text,
      SUM(amount)::text                          AS share_balance,
      SUM(amount + yield_earned)::text           AS estimated_value
    FROM vault_positions
    WHERE deleted_at IS NULL
    GROUP BY user_id
    ORDER BY SUM(amount) DESC
    LIMIT $1
    `,
    [TOP_DEPOSITORS_LIMIT]
  );

  const depositors: TopDepositor[] = rows.map((row: {
    user_id: string;
    share_balance: string;
    estimated_value: string;
  }, idx: number) => ({
    rank: idx + 1,
    user_id: row.user_id,
    share_balance: row.share_balance,
    estimated_value: row.estimated_value,
  }));

  await cacheSet(
    WARM_NS.TOP_DEPOSITORS,
    TOP_DEPOSITORS_KEY,
    { data: depositors, cached_at: Date.now() },
    TTL.TOP_DEPOSITORS
  );

  logger.info("[cache-warm] top depositors cached", { count: depositors.length });
  return depositors.length > 0 ? 1 : 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the current warm-up status.
 * Used by the health check to gate 'starting' vs 'ok'.
 */
export function getWarmupStatus(): WarmupStatus {
  return _warmupStatus;
}

/**
 * Returns a summary of the last warm-up run.
 */
export function getWarmupStats(): {
  status: WarmupStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  itemsCached: number;
} {
  return {
    status: _warmupStatus,
    startedAt: _warmupStartedAt ? new Date(_warmupStartedAt).toISOString() : null,
    finishedAt: _warmupFinishedAt ? new Date(_warmupFinishedAt).toISOString() : null,
    durationMs:
      _warmupStartedAt && _warmupFinishedAt
        ? _warmupFinishedAt - _warmupStartedAt
        : null,
    itemsCached: _itemsCached,
  };
}

/**
 * Run cache warm-up on application startup.
 *
 * - Runs all warm-up tasks concurrently
 * - Enforces WARM_TIMEOUT_MS wall-clock budget
 * - Logs but does not throw on failure
 * - Updates _warmupStatus so the health endpoint can reflect startup progress
 */
export async function runCacheWarmup(): Promise<void> {
  if (_warmupStatus === "warming") {
    logger.warn("[cache-warm] warm-up already in progress, skipping duplicate call");
    return;
  }

  _warmupStatus = "warming";
  _warmupStartedAt = Date.now();
  _itemsCached = 0;

  logger.info("[cache-warm] starting cache warm-up");

  const warmupWork = async (): Promise<void> => {
    const tasks = [
      warmVaultStats().catch((err) => {
        logger.warn("[cache-warm] vault stats failed", { error: String(err) });
        return 0;
      }),
      warmSharePrice().catch((err) => {
        logger.warn("[cache-warm] share price failed", { error: String(err) });
        return 0;
      }),
      warmTopDepositors().catch((err) => {
        logger.warn("[cache-warm] top depositors failed", { error: String(err) });
        return 0;
      }),
    ];

    const results = await Promise.all(tasks);
    _itemsCached = results.reduce((sum, n) => sum + n, 0);
  };

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Cache warm-up timed out after ${WARM_TIMEOUT_MS}ms`)),
      WARM_TIMEOUT_MS
    )
  );

  try {
    await Promise.race([warmupWork(), timeout]);

    _warmupFinishedAt = Date.now();
    const durationMs = _warmupFinishedAt - _warmupStartedAt;
    _warmupStatus = "ready";

    logger.info("[cache-warm] warm-up complete", {
      durationMs,
      itemsCached: _itemsCached,
    });

    await recordMetrics(durationMs, _itemsCached);
  } catch (err) {
    _warmupFinishedAt = Date.now();
    _warmupStatus = "failed";

    logger.error("[cache-warm] warm-up failed — startup will continue", {
      error: String(err),
      durationMs: _warmupFinishedAt - _warmupStartedAt,
    });

    // Record failure metrics (best-effort)
    await recordMetrics(
      _warmupFinishedAt - _warmupStartedAt,
      _itemsCached
    ).catch(() => undefined);
  }
}

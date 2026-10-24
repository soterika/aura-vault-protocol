/**
 * Vault Stats Route — Issue #466
 *
 * GET /api/v1/vault/stats
 *
 * Returns vault statistics with Redis caching. Cache misses fetch live data,
 * cache hits serve instantly (< 50 ms). Harvest events invalidate the cache.
 * Redis unavailability falls back gracefully to a direct contract call.
 */

import { Router, Request, Response } from "express";
import { cacheGet, cacheSet, cacheDel } from "../cache.js";
import { getVaultStats, VaultStatsData } from "../services/vaultStatsService.js";
import { runCacheWarmup, getWarmupStatus } from "../services/cacheWarmup.js";
import { getDbMetrics, getSlowQueryLog, dbMetricsPrometheusText } from "../services/dbMonitor.js";
import { successResponse, errorResponse } from "../dto/index.js";
import { authenticate } from "../middleware/authMiddleware.js";

export const VAULT_STATS_CACHE_NS = "vault:stats";
export const VAULT_STATS_CACHE_KEY = "current";
export const VAULT_STATS_TTL_SECS = 60; // 1-minute TTL

export interface VaultStatsCacheEntry {
  data: VaultStatsData;
  cached_at: number; // Unix epoch ms
}

export interface VaultStatsResponse extends VaultStatsData {
  cached: boolean;
  cache_age_secs: number | null;
  fetched_at: string;
}

export const vaultRouter = Router();

/**
 * GET /api/v1/vault/stats
 * Serves vault stats from cache when available, otherwise fetches live data.
 */
vaultRouter.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  const fetchedAt = new Date().toISOString();

  // --- Try cache first ---
  let cacheEntry: VaultStatsCacheEntry | null = null;
  try {
    cacheEntry = await cacheGet<VaultStatsCacheEntry>(
      VAULT_STATS_CACHE_NS,
      VAULT_STATS_CACHE_KEY,
    );
  } catch {
    // Redis unavailable — fall through to live fetch
  }

  if (cacheEntry !== null) {
    const ageMs = Date.now() - cacheEntry.cached_at;
    const payload: VaultStatsResponse = {
      ...cacheEntry.data,
      cached: true,
      cache_age_secs: Math.floor(ageMs / 1000),
      fetched_at: fetchedAt,
    };
    res.json(successResponse(payload));
    return;
  }

  // --- Cache miss: fetch live data ---
  try {
    const liveData = await getVaultStats();
    const entry: VaultStatsCacheEntry = { data: liveData, cached_at: Date.now() };

    // Populate cache (best-effort — ignore Redis errors)
    try {
      await cacheSet(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY, entry, VAULT_STATS_TTL_SECS);
    } catch {
      // Redis unavailable — serve without caching
    }

    const payload: VaultStatsResponse = {
      ...liveData,
      cached: false,
      cache_age_secs: null,
      fetched_at: fetchedAt,
    };
    res.json(successResponse(payload));
  } catch (err) {
    console.error("[vault/stats]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve vault stats"));
  }
});

/**
 * POST /api/v1/vault/stats/invalidate
 * Purges the vault-stats cache. Called when a harvest event is received.
 */
vaultRouter.post("/stats/invalidate", async (_req: Request, res: Response): Promise<void> => {
  try {
    await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
    res.json(successResponse({ invalidated: true }));
  } catch (err) {
    console.error("[vault/stats/invalidate]", err);
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
export async function invalidateVaultStatsCache(): Promise<void> {
  await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
}

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
    console.error("[vault/metrics/db]", err);
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
    console.error("[vault/metrics/db/slow-log]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve slow query log"));
  }
});

/**
 * GET /api/v1/vault/metrics/db/prometheus
 * Returns Prometheus text exposition for db_query_duration_seconds histogram.
 * Allows Prometheus to scrape this path directly if configured.
 */
vaultRouter.get("/metrics/db/prometheus", async (_req: Request, res: Response): Promise<void> => {
  try {
    const text = await dbMetricsPrometheusText();
    res.set("Content-Type", "text/plain; version=0.0.4").send(text);
  } catch (err) {
    console.error("[vault/metrics/db/prometheus]", err);
    res.status(500).send("# error generating metrics\n");
  }
});

/**
 * Vault Stats Route — Issue #466 + Issue #310 (multi-tenant)
 *
 * GET /api/v1/vault/stats?vaultId=<id>
 *
 * Returns vault statistics with Redis caching. When vaultId is provided the
 * cache is scoped to that vault's contract_id. Omitting vaultId falls back
 * to the default vault for backwards compatibility.
 */

import { Router, Request, Response } from "express";
import { cacheGet, cacheSet, cacheDel } from "../cache.js";
import { getVaultStats, VaultStatsData } from "../services/vaultStatsService.js";
import { getDbMetrics, getSlowQueryLog, dbMetricsPrometheusText } from "../services/dbMonitor.js";
import { successResponse, errorResponse } from "../dto/index.js";
import { resolveVault } from "../services/vaultRegistryService.js";

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
  vault_id?: number;
  contract_id?: string;
}

export const vaultRouter = Router();

/**
 * GET /api/v1/vault/stats?vaultId=<id>
 * Serves vault stats from cache when available, otherwise fetches live data.
 * When vaultId is omitted, the default vault is used (backwards compatible).
 */
vaultRouter.get("/stats", async (req: Request, res: Response): Promise<void> => {
  const fetchedAt = new Date().toISOString();

  // Resolve vault — backwards compatible: no vaultId → default vault
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
    // DB unavailable — continue without vault scoping (single-vault fallback)
  }

  // Scope cache key to vault contract_id when available
  const scopedCacheKey = vaultContractId
    ? `${VAULT_STATS_CACHE_KEY}:${vaultContractId}`
    : VAULT_STATS_CACHE_KEY;

  // --- Try cache first ---
  let cacheEntry: VaultStatsCacheEntry | null = null;
  try {
    cacheEntry = await cacheGet<VaultStatsCacheEntry>(VAULT_STATS_CACHE_NS, scopedCacheKey);
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
      ...(vaultId && { vault_id: vaultId }),
      ...(vaultContractId && { contract_id: vaultContractId }),
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
      await cacheSet(VAULT_STATS_CACHE_NS, scopedCacheKey, entry, VAULT_STATS_TTL_SECS);
    } catch {
      // Redis unavailable — serve without caching
    }

    const payload: VaultStatsResponse = {
      ...liveData,
      cached: false,
      cache_age_secs: null,
      fetched_at: fetchedAt,
      ...(vaultId && { vault_id: vaultId }),
      ...(vaultContractId && { contract_id: vaultContractId }),
    };
    res.json(successResponse(payload));
  } catch (err) {
    console.error("[vault/stats]", err);
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
    let scopedCacheKey = VAULT_STATS_CACHE_KEY;

    if (vaultIdParam) {
      const vault = await resolveVault(vaultIdParam).catch(() => null);
      if (vault?.contract_id) {
        scopedCacheKey = `${VAULT_STATS_CACHE_KEY}:${vault.contract_id}`;
      }
    }

    await cacheDel(VAULT_STATS_CACHE_NS, scopedCacheKey);
    res.json(successResponse({ invalidated: true }));
  } catch (err) {
    console.error("[vault/stats/invalidate]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Cache invalidation failed"));
  }
});

/** Programmatic cache invalidation — used by harvest event handlers. */
export async function invalidateVaultStatsCache(contractId?: string): Promise<void> {
  const key = contractId ? `${VAULT_STATS_CACHE_KEY}:${contractId}` : VAULT_STATS_CACHE_KEY;
  await cacheDel(VAULT_STATS_CACHE_NS, key);
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

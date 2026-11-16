/**
 * Vault Stats Service — Issue #287
 *
 * Exposes GET /api/v1/vault/stats returning:
 *   { totalAssets, sharePrice, depositorCount, apy7d, apy30d, lastHarvest }
 *
 * Caching strategy:
 *  - 30-second Redis TTL (VAULT_STATS_CACHE_TTL_SECS, default 30)
 *  - Cache key: vault:stats:v1[:<contractId>]
 *  - Cache invalidated programmatically on harvest events
 *  - Falls back to direct on-chain data on Redis miss or error
 *  - Cache-Control: public, max-age=30, s-maxage=30 set on cached responses
 *
 * APY calculation:
 *  - Derived from the apy_snapshots table (7-day and 30-day rolling windows)
 *  - Falls back to 0 if no snapshot data is available
 */

import { getReadPool } from "../db.js";
import { cacheGet, cacheSet, cacheDel } from "../cache.js";
import { getRedis } from "../redis.js";
import { logger } from "../logger.js";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const VAULT_STATS_CACHE_NS = "vault:stats:v1";
export const VAULT_STATS_CACHE_TTL_SECS =
  parseInt(process.env.VAULT_STATS_CACHE_TTL_SECS ?? "30", 10);
export const HORIZON_TIMEOUT_MS = Math.max(
  100,
  parseInt(process.env.HORIZON_TIMEOUT_MS ?? "5000", 10) || 5000,
);
const STALE_CACHE_TTL_SECS = 5 * 60;
const LOCK_TTL_MS = HORIZON_TIMEOUT_MS + 2_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultStats {
  /** Total underlying tokens held by the vault (string to avoid JS float precision loss) */
  totalAssets: string;
  /** Current share price = totalAssets / totalShares (or "1" when vault is empty) */
  sharePrice: string;
  /** Number of unique addresses with a non-zero vault position */
  depositorCount: number;
  /** 7-day annualised percentage yield (0.085 = 8.5%) */
  apy7d: number;
  /** 30-day annualised percentage yield */
  apy30d: number;
  /** ISO-8601 timestamp of the most recent harvest, or null if never harvested */
  lastHarvest: string | null;
}

export interface VaultStatsCacheEntry {
  data: VaultStats;
  cached_at: number; // Unix epoch ms
}

export interface VaultStatsResult {
  stats: VaultStats;
  cached: boolean;
  cacheAgeSecs: number | null;
  stale?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch live vault stats directly from the database.
 * This is the fallback used on cache miss or Redis failure.
 */
export async function fetchLiveVaultStats(contractId?: string): Promise<VaultStats> {
  const pool = getReadPool();

  // Build the WHERE clause for multi-vault support
  const contractFilter = contractId ? "WHERE contract_id = $1" : "";
  const params: string[] = contractId ? [contractId] : [];

  // Aggregate total_assets, share_price, depositor_count, and last harvest
  // from vault_positions and contract_events tables
  const [statsResult, apyResult] = await Promise.all([
    pool.query<{
      total_assets: string;
      total_shares: string;
      depositor_count: string;
      last_harvest: string | null;
    }>(
      `SELECT
         COALESCE(SUM(vp.underlying_balance), 0)::TEXT AS total_assets,
         COALESCE(SUM(vp.shares), 0)::TEXT             AS total_shares,
         COUNT(DISTINCT vp.wallet_address)::TEXT        AS depositor_count,
         (
           SELECT MAX(ce.ledger_timestamp)
           FROM vault_events ce
           WHERE ce.event_type = 'harvest'
             ${contractId ? "AND ce.contract_id = $1" : ""}
         ) AS last_harvest
       FROM vault_positions vp
       ${contractFilter}`,
      params,
    ),
    // APY from rolling snapshots (7d and 30d)
    pool.query<{ apy7d: string; apy30d: string }>(
      `SELECT
         COALESCE(
           AVG(apy) FILTER (
             WHERE snapshot_time >= NOW() - INTERVAL '7 days'
             ${contractId ? `AND contract_id = $1` : ""}
           ), 0
         )::TEXT AS apy7d,
         COALESCE(
           AVG(apy) FILTER (
             WHERE snapshot_time >= NOW() - INTERVAL '30 days'
             ${contractId ? `AND contract_id = $1` : ""}
           ), 0
         )::TEXT AS apy30d
       FROM apy_snapshots
       ${contractId ? "WHERE contract_id = $1" : ""}`,
      params,
    ),
  ]);

  const row = statsResult.rows[0];
  const apyRow = apyResult.rows[0];

  const totalAssets = row?.total_assets ?? "0";
  const totalShares = row?.total_shares ?? "0";

  const sharePriceNum =
    BigInt(totalShares) > 0n
      ? Number(totalAssets) / Number(totalShares)
      : 1;

  return {
    totalAssets,
    sharePrice: sharePriceNum.toFixed(7),
    depositorCount: parseInt(row?.depositor_count ?? "0", 10),
    apy7d: parseFloat(apyRow?.apy7d ?? "0"),
    apy30d: parseFloat(apyRow?.apy30d ?? "0"),
    lastHarvest: row?.last_harvest
      ? new Date(row.last_harvest).toISOString()
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache-aware public API
// ─────────────────────────────────────────────────────────────────────────────

function cacheKey(contractId?: string): string {
  return contractId ? `current:${contractId}` : "current";
}

function staleCacheKey(key: string): string {
  return `stale:${key}`;
}

function redisLockKey(key: string): string {
  // The hash tag keeps the lock and cache keys in one Redis Cluster slot.
  return `vault:stats:{${key}}:lock`;
}

async function getFreshEntry(key: string): Promise<VaultStatsCacheEntry | null> {
  try {
    return await cacheGet<VaultStatsCacheEntry>(VAULT_STATS_CACHE_NS, key);
  } catch (redisErr) {
    logger.warn({ redisErr }, "[vaultStats] Redis unavailable while reading cache");
    return null;
  }
}

async function getStaleEntry(key: string): Promise<VaultStatsCacheEntry | null> {
  try {
    return await cacheGet<VaultStatsCacheEntry>(VAULT_STATS_CACHE_NS, staleCacheKey(key));
  } catch {
    return null;
  }
}

function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Vault stats fetch exceeded ${HORIZON_TIMEOUT_MS}ms`)),
      HORIZON_TIMEOUT_MS,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function waitForFreshEntry(key: string): Promise<VaultStatsCacheEntry | null> {
  const deadline = Date.now() + HORIZON_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const entry = await getFreshEntry(key);
    if (entry) return entry;
  }
  return null;
}

/**
 * Fetch vault stats — Redis cache hit path (< 1ms) or DB fallback.
 * Returns { stats, cached, cacheAgeSecs }.
 */
export async function getVaultStats(contractId?: string): Promise<VaultStatsResult> {
  const key = cacheKey(contractId);

  // Cache hit path
  const cachedEntry = await getFreshEntry(key);
  if (cachedEntry) {
    return {
      stats: cachedEntry.data,
      cached: true,
      cacheAgeSecs: Math.max(0, Math.floor((Date.now() - cachedEntry.cached_at) / 1000)),
    };
  }

  const staleEntry = await getStaleEntry(key);
  const token = randomUUID();
  let ownsLock = false;
  try {
    ownsLock = (await getRedis().set(redisLockKey(key), token, "PX", LOCK_TTL_MS, "NX")) === "OK";
  } catch (redisErr) {
    logger.warn({ redisErr }, "[vaultStats] Redis lock unavailable; fetching without lock");
    ownsLock = true;
  }

  if (!ownsLock) {
    if (staleEntry) {
      return {
        stats: staleEntry.data,
        cached: true,
        cacheAgeSecs: Math.max(0, Math.floor((Date.now() - staleEntry.cached_at) / 1000)),
        stale: true,
      };
    }
    const freshAfterWait = await waitForFreshEntry(key);
    if (freshAfterWait) {
      return { stats: freshAfterWait.data, cached: true, cacheAgeSecs: 0 };
    }
    const lateStale = staleEntry ?? await getStaleEntry(key);
    if (lateStale) {
      return { stats: lateStale.data, cached: true, cacheAgeSecs: Math.max(0, Math.floor((Date.now() - lateStale.cached_at) / 1000)), stale: true };
    }
    // The lock owner may have failed. Try to become the fetcher once more.
    try {
      ownsLock = (await getRedis().set(redisLockKey(key), token, "PX", LOCK_TTL_MS, "NX")) === "OK";
    } catch {
      ownsLock = false;
    }
    if (!ownsLock) {
      // Redis outages should not turn a stats endpoint into a Redis dependency.
      ownsLock = true;
    }
  }

  try {
    const stats = await withinTimeout(fetchLiveVaultStats(contractId));
    const entry: VaultStatsCacheEntry = { data: stats, cached_at: Date.now() };
    try {
      await cacheSet(VAULT_STATS_CACHE_NS, key, entry, VAULT_STATS_CACHE_TTL_SECS);
      await cacheSet(VAULT_STATS_CACHE_NS, staleCacheKey(key), entry, STALE_CACHE_TTL_SECS);
    } catch {
      // Best-effort cache write — do not fail the request.
    }
    return { stats, cached: false, cacheAgeSecs: null };
  } catch (err) {
    const fallback = staleEntry ?? await getStaleEntry(key);
    if (fallback) {
      logger.warn({ err }, "[vaultStats] Live fetch failed; serving stale stats");
      return { stats: fallback.data, cached: true, cacheAgeSecs: Math.max(0, Math.floor((Date.now() - fallback.cached_at) / 1000)), stale: true };
    }
    throw err;
  } finally {
    if (ownsLock) {
      try {
        await getRedis().eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          redisLockKey(key),
          token,
        );
      } catch {
        // The lock expires automatically if Redis is unavailable.
      }
    }
  }
}

/**
 * Invalidate the vault stats cache.
 * Called by harvest event handlers to ensure the next request reflects
 * the new share price immediately.
 */
export async function invalidateVaultStats(contractId?: string): Promise<void> {
  const key = cacheKey(contractId);
  await Promise.all([
    cacheDel(VAULT_STATS_CACHE_NS, key),
    cacheDel(VAULT_STATS_CACHE_NS, staleCacheKey(key)),
  ]);
}

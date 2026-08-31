/**
 * Harvest Metrics — Issue #315
 *
 * Tracks harvest execution statistics and persists them to Redis for
 * monitoring dashboards and Prometheus scraping.
 *
 * Collected metrics:
 *   - Total harvests attempted / succeeded / failed
 *   - Harvests per day (rolling 24-hour count)
 *   - Average yield per harvest (rolling)
 *   - Last harvest timestamp
 *   - Cumulative yield injected
 */

import { getRedis } from "../redis.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Redis key constants
// ---------------------------------------------------------------------------

const KEY_PREFIX = "harvest:metrics";
const KEY_TOTAL_ATTEMPTED = `${KEY_PREFIX}:total_attempted`;
const KEY_TOTAL_SUCCEEDED = `${KEY_PREFIX}:total_succeeded`;
const KEY_TOTAL_FAILED = `${KEY_PREFIX}:total_failed`;
const KEY_LAST_HARVEST_AT = `${KEY_PREFIX}:last_harvest_at`;
const KEY_CUMULATIVE_YIELD = `${KEY_PREFIX}:cumulative_yield`;
/** Sorted set: member = JSON({ yieldAmount, harvestedAt }), score = timestamp */
const KEY_HISTORY = `${KEY_PREFIX}:history`;

const HISTORY_MAX_ENTRIES = 500; // keeps ~500 harvest records
const STATS_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ---------------------------------------------------------------------------
// In-process counters (fast path; flushed to Redis asynchronously)
// ---------------------------------------------------------------------------

export interface HarvestMetrics {
  /** Total harvest jobs attempted (enqueued). */
  totalAttempted: number;
  /** Harvest jobs that completed successfully. */
  totalSucceeded: number;
  /** Harvest jobs that failed (exhausted retries / DLQ). */
  totalFailed: number;
  /** Total yield amount injected across all successful harvests. */
  cumulativeYield: number;
  /** ISO timestamp of the most recent successful harvest, or empty string. */
  lastHarvestAt: string;
  /** Number of successful harvests in the last 24 hours. */
  harvestsLast24h: number;
  /** Average yield per successful harvest (lifetime). */
  averageYieldPerHarvest: number;
}

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

/** Record that a harvest job was enqueued. */
export async function recordHarvestAttempt(): Promise<void> {
  try {
    const redis = getRedis();
    await redis.incr(KEY_TOTAL_ATTEMPTED);
  } catch (err) {
    logger.error("[HarvestMetrics] Failed to record attempt", { err });
  }
}

/**
 * Record a successful harvest completion.
 *
 * @param yieldAmount  The yield amount that was injected into the vault.
 */
export async function recordHarvestSuccess(yieldAmount: number): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowTs = now.getTime();

  try {
    const redis = getRedis();

    await Promise.all([
      redis.incr(KEY_TOTAL_SUCCEEDED),
      redis.set(KEY_LAST_HARVEST_AT, nowIso, "EX", STATS_TTL_SECONDS),
      redis.incrbyfloat(KEY_CUMULATIVE_YIELD, yieldAmount),
      redis.zadd(
        KEY_HISTORY,
        nowTs,
        JSON.stringify({ yieldAmount, harvestedAt: nowIso })
      ),
    ]);

    // Trim history to avoid unbounded growth
    await redis.zremrangebyrank(KEY_HISTORY, 0, -(HISTORY_MAX_ENTRIES + 1));

    logger.info("[HarvestMetrics] Harvest success recorded", { yieldAmount, harvestedAt: nowIso });
  } catch (err) {
    logger.error("[HarvestMetrics] Failed to record success", { err });
  }
}

/** Record a harvest failure. */
export async function recordHarvestFailure(reason: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.incr(KEY_TOTAL_FAILED);
    logger.warn("[HarvestMetrics] Harvest failure recorded", { reason });
  } catch (err) {
    logger.error("[HarvestMetrics] Failed to record failure", { err });
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Returns a snapshot of all harvest metrics.
 * Reads from Redis, so safe to call from any process replica.
 */
export async function getHarvestMetrics(): Promise<HarvestMetrics> {
  try {
    const redis = getRedis();
    const windowStart = Date.now() - 24 * 60 * 60 * 1_000;

    const [
      totalAttempted,
      totalSucceeded,
      totalFailed,
      lastHarvestAt,
      cumulativeYieldRaw,
      recentEntries,
    ] = await Promise.all([
      redis.get(KEY_TOTAL_ATTEMPTED),
      redis.get(KEY_TOTAL_SUCCEEDED),
      redis.get(KEY_TOTAL_FAILED),
      redis.get(KEY_LAST_HARVEST_AT),
      redis.get(KEY_CUMULATIVE_YIELD),
      redis.zrangebyscore(KEY_HISTORY, windowStart, "+inf"),
    ]);

    const succeeded = parseInt(totalSucceeded ?? "0", 10);
    const cumulativeYield = parseFloat(cumulativeYieldRaw ?? "0");
    const averageYieldPerHarvest = succeeded > 0 ? cumulativeYield / succeeded : 0;

    return {
      totalAttempted: parseInt(totalAttempted ?? "0", 10),
      totalSucceeded: succeeded,
      totalFailed: parseInt(totalFailed ?? "0", 10),
      cumulativeYield,
      lastHarvestAt: lastHarvestAt ?? "",
      harvestsLast24h: recentEntries.length,
      averageYieldPerHarvest,
    };
  } catch (err) {
    logger.error("[HarvestMetrics] Failed to read metrics", { err });
    // Return safe zero-value snapshot on Redis failure
    return {
      totalAttempted: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      cumulativeYield: 0,
      lastHarvestAt: "",
      harvestsLast24h: 0,
      averageYieldPerHarvest: 0,
    };
  }
}

/**
 * Returns the last `limit` harvest history entries, newest first.
 */
export async function getHarvestHistory(limit = 24): Promise<{ yieldAmount: number; harvestedAt: string }[]> {
  try {
    const redis = getRedis();
    const raw = await redis.zrevrange(KEY_HISTORY, 0, limit - 1);
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as { yieldAmount: number; harvestedAt: string };
        } catch {
          return null;
        }
      })
      .filter((e): e is { yieldAmount: number; harvestedAt: string } => e !== null);
  } catch (err) {
    logger.error("[HarvestMetrics] Failed to read history", { err });
    return [];
  }
}

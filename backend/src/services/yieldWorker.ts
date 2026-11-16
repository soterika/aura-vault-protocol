/**
 * Yield Worker — Issue #43
 *
 * Runs an hourly scheduled job to calculate and persist yield for all active
 * vault positions. Supports:
 *   - Configurable positions/sources provider
 *   - Redis-cached run stats for monitoring
 *   - Alert callback on calculation failures
 *   - Graceful start/stop lifecycle
 */

import { getRedis } from "../redis.js";
import { NS } from "../cache.js";
import {
  createYieldService,
  type VaultPosition,
  type YieldSource,
  type BatchResult,
} from "./yieldService.js";
import { logger } from "../logger.js";

export interface YieldWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  getPositions?: () => Promise<VaultPosition[]>;
  getSources?: () => Promise<YieldSource[]>;
  onAlert?: (msg: string, meta?: unknown) => void;
  onRunComplete?: (result: BatchResult) => Promise<void>;
}

interface RunStats {
  lastRunAt: string;
  processed: number;
  failed: number;
  durationMs: number;
  errors: { positionId: string; error: string }[];
}

const HOUR_MS = 3_600_000;
const STATS_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

async function persistRunStats(stats: RunStats): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(
      `${NS.YIELD_STATS}:last`,
      JSON.stringify(stats),
      "EX",
      STATS_TTL_SECONDS
    );
    // Append to sorted-set history keyed by run timestamp for monitoring dashboards
    await redis.zadd(
      NS.YIELD_HISTORY,
      new Date(stats.lastRunAt).getTime(),
      JSON.stringify(stats)
    );
    // Trim to last 200 runs (~8 days of hourly runs)
    await redis.zremrangebyrank(NS.YIELD_HISTORY, 0, -201);
  } catch (err) {
    logger.error("[YieldWorker] Failed to persist run stats:", err);
  }
}

export async function getLastRunStats(): Promise<RunStats | null> {
  try {
    const raw = await getRedis().get(`${NS.YIELD_STATS}:last`);
    return raw ? (JSON.parse(raw) as RunStats) : null;
  } catch {
    return null;
  }
}

export async function getRunHistory(limit = 24): Promise<RunStats[]> {
  try {
    const raw = await getRedis().zrevrange(NS.YIELD_HISTORY, 0, limit - 1);
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as RunStats;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is RunStats => entry !== null);
  } catch {
    return [];
  }
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let runInProgress = false;

async function runOnce(opts: Required<YieldWorkerOptions>): Promise<void> {
  if (runInProgress) {
    logger.warn("[YieldWorker] Previous run still in progress, skipping tick");
    return;
  }

  runInProgress = true;
  const runAt = new Date().toISOString();

  try {
    const [positions, sources] = await Promise.all([
      opts.getPositions(),
      opts.getSources(),
    ]);

    if (positions.length === 0) {
      logger.info("[YieldWorker] No positions to process");
      return;
    }

    const service = createYieldService({
      batchSize: opts.batchSize,
      onAlert: opts.onAlert,
    });

    const result = await service.processBatch(positions, sources);

    const stats: RunStats = {
      lastRunAt: runAt,
      processed: result.processed,
      failed: result.failed,
      durationMs: result.durationMs,
      errors: result.errors,
    };

    await persistRunStats(stats);
    await opts.onRunComplete(result);

    logger.info(
      `[YieldWorker] Run complete — processed: ${result.processed}, ` +
        `failed: ${result.failed}, duration: ${result.durationMs}ms`
    );

    if (result.failed > 0) {
      opts.onAlert(
        `Yield run completed with ${result.failed} failure(s)`,
        { failureRate: `${((result.failed / (result.processed + result.failed)) * 100).toFixed(2)}%` }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onAlert("Yield worker run failed", { error: msg, runAt });
    logger.error("[YieldWorker] Run failed:", err);
  } finally {
    runInProgress = false;
  }
}

function buildOptions(opts: YieldWorkerOptions): Required<YieldWorkerOptions> {
  return {
    intervalMs: opts.intervalMs ?? HOUR_MS,
    batchSize: opts.batchSize ?? 500,
    getPositions: opts.getPositions ?? (async () => []),
    getSources: opts.getSources ?? (async () => []),
    onAlert:
      opts.onAlert ??
      ((msg, meta) => logger.error(`[YieldWorker] ALERT: ${msg}`, meta ?? "")),
    onRunComplete: opts.onRunComplete ?? (async () => {}),
  };
}

export function startYieldWorker(opts: YieldWorkerOptions = {}): void {
  if (workerTimer !== null) return;

  const resolvedOpts = buildOptions(opts);

  // Run immediately on start, then on interval
  void runOnce(resolvedOpts);

  workerTimer = setInterval(() => {
    void runOnce(resolvedOpts);
  }, resolvedOpts.intervalMs);

  logger.info(
    `[YieldWorker] Started — interval: ${resolvedOpts.intervalMs / 1000}s`
  );
}

export function stopYieldWorker(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info("[YieldWorker] Stopped");
  }
}

export function isYieldWorkerRunning(): boolean {
  return workerTimer !== null;
}

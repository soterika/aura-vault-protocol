/**
 * alertEvaluationJob.ts
 *
 * BullMQ-backed background job that evaluates alert subscriptions every
 * 5 minutes. On each tick the job:
 *   1. Fetches the current vault stats (share price, pause state, etc.)
 *   2. Compares against the previous snapshot to detect changes
 *   3. Calls evaluateSubscriptions() to dispatch matching notifications
 *
 * The job is designed to be started once in index.ts alongside other workers.
 *
 * Closes #946
 */

import { Queue, Worker, type Job } from 'bullmq';
import { getVaultStats } from './vaultStatsService.js';
import { evaluateSubscriptions, type VaultSnapshot } from './alertSubscriptionServiceV2.js';
import { getRedisConnection } from '../redis.js';
import { logger } from '../logger.js';

const QUEUE_NAME = 'alert-evaluation';
const JOB_NAME  = 'evaluate-thresholds';

/** Interval between evaluation ticks in milliseconds (5 minutes). */
const EVALUATION_INTERVAL_MS = 5 * 60 * 1000;

/** In-memory state retained between ticks to compute deltas. */
interface EvaluationState {
  previousSharePrice: number | null;
  wasVaultPaused: boolean;
  lastHarvestTimestamp: string | null;
}

const state: EvaluationState = {
  previousSharePrice: null,
  wasVaultPaused: false,
  lastHarvestTimestamp: null,
};

// ─── Queue & worker setup ─────────────────────────────────────────────────────

let alertQueue: Queue | null = null;
let alertWorker: Worker | null = null;

export async function startAlertEvaluationJob(): Promise<void> {
  const connection = getRedisConnection();

  alertQueue = new Queue(QUEUE_NAME, { connection });

  // Enqueue a repeating job with the exact 5-minute interval
  await alertQueue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: EVALUATION_INTERVAL_MS },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );

  alertWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== JOB_NAME) return;
      await runEvaluationTick();
    },
    {
      connection,
      concurrency: 1, // one tick at a time — never overlap
    },
  );

  alertWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Alert evaluation tick completed');
  });

  alertWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Alert evaluation tick failed');
  });

  logger.info({ intervalMs: EVALUATION_INTERVAL_MS }, 'Alert evaluation job started');
}

export async function stopAlertEvaluationJob(): Promise<void> {
  await alertWorker?.close();
  await alertQueue?.close();
  logger.info('Alert evaluation job stopped');
}

// ─── Evaluation tick ──────────────────────────────────────────────────────────

async function runEvaluationTick(): Promise<void> {
  const tickStart = Date.now();

  // Fetch current vault state
  const stats = await getVaultStats();

  const currentSharePrice =
    typeof stats.share_price === 'number'
      ? stats.share_price
      : stats.share_price != null
      ? parseFloat(String(stats.share_price))
      : null;

  const isPaused = stats.is_paused === true;

  const lastHarvest: string | null =
    (stats as Record<string, unknown>).last_harvest_at != null
      ? String((stats as Record<string, unknown>).last_harvest_at)
      : null;

  // Compute share price change percentage vs previous tick
  let sharePriceChangePercent: number | null = null;
  if (
    currentSharePrice !== null &&
    state.previousSharePrice !== null &&
    state.previousSharePrice > 0
  ) {
    sharePriceChangePercent =
      ((currentSharePrice - state.previousSharePrice) / state.previousSharePrice) * 100;
  }

  const harvestOccurredSinceLastCheck =
    lastHarvest !== null && lastHarvest !== state.lastHarvestTimestamp;

  const snapshot: VaultSnapshot = {
    sharePriceChangePercent,
    isPaused,
    lastHarvestCompletedAt: lastHarvest,
    harvestOccurredSinceLastCheck,
    recentDeposits: [], // populated by Horizon event listener in the full integration
    previousSharePrice: state.previousSharePrice ?? undefined,
    currentSharePrice: currentSharePrice ?? undefined,
  };

  const dispatched = await evaluateSubscriptions(snapshot);

  const durationMs = Date.now() - tickStart;
  logger.info(
    { dispatched, durationMs, sharePriceChangePercent, isPaused, harvestOccurredSinceLastCheck },
    'Alert evaluation tick finished',
  );

  // Update state for next tick
  state.previousSharePrice = currentSharePrice;
  state.wasVaultPaused = isPaused;
  state.lastHarvestTimestamp = lastHarvest;
}

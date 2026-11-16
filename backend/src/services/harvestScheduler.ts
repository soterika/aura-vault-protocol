/**
 * Harvest Scheduler Service — Issue #315
 *
 * Background service that monitors yield accumulation in the Aura Vault and
 * automatically triggers a harvest when the accumulated yield exceeds a
 * configurable threshold.
 *
 * Acceptance Criteria:
 *   ✅ Configurable threshold: minimum yield amount before harvesting
 *   ✅ Checks every 5 minutes (configurable); harvests when threshold met
 *   ✅ Uses a dedicated keeper keypair stored in Secrets Manager
 *   ✅ Prevents duplicate harvests (checks last harvest timestamp)
 *   ✅ Harvest triggered via job queue for durability
 *   ✅ Metrics: harvests per day, average yield per harvest
 *
 * Usage:
 *   import { createHarvestScheduler } from "./harvestScheduler.js";
 *
 *   const scheduler = createHarvestScheduler({
 *     getAccumulatedYield: () => fetchYieldFromHorizon(vaultContractId),
 *     executeHarvest: (keypair, amount) => submitHarvestTx(keypair, amount),
 *   });
 *
 *   scheduler.start();
 *   // ...
 *   scheduler.stop();
 */

import { logger } from "../logger.js";
import { type HarvestSchedulerConfig, loadHarvestConfig } from "./harvestSchedulerConfig.js";
import { getKeeperKeypair, type KeeperKeypair } from "./keeperKeypair.js";
import {
  enqueueHarvest,
  setHarvestProcessor,
  startHarvestWorker,
  stopHarvestWorker,
  type HarvestJob,
} from "./harvestQueue.js";
import {
  recordHarvestAttempt,
  recordHarvestSuccess,
  recordHarvestFailure,
  getHarvestMetrics,
  getHarvestHistory,
  type HarvestMetrics,
} from "./harvestMetrics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Async function that returns the current accumulated yield in the vault
 * (in the vault's underlying token units).
 */
export type YieldFetcher = () => Promise<number>;

/**
 * Async function that submits the harvest transaction to the Stellar network.
 *
 * @param keypair     The keeper keypair to sign the transaction.
 * @param yieldAmount The yield amount to inject.
 * @returns           A transaction hash or other confirmation string.
 */
export type HarvestExecutor = (keypair: KeeperKeypair, yieldAmount: number) => Promise<string>;

export interface HarvestSchedulerOptions {
  /** Injected function to read the current accumulated yield. */
  getAccumulatedYield: YieldFetcher;
  /** Injected function to submit the harvest transaction. */
  executeHarvest: HarvestExecutor;
  /** Override configuration (defaults to loadHarvestConfig()). */
  config?: Partial<HarvestSchedulerConfig>;
  /** Called after each scheduler tick (useful for tests). */
  onTick?: (result: TickResult) => void;
}

export type TickOutcome =
  | "below_threshold"   // yield < configured minimum
  | "too_soon"          // last harvest was too recent
  | "enqueued"          // harvest job successfully enqueued
  | "duplicate"         // a harvest was already in the queue
  | "error";            // unexpected error during tick

export interface TickResult {
  outcome: TickOutcome;
  accumulatedYield?: number;
  lastHarvestAt?: string;
  jobId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHarvestScheduler(opts: HarvestSchedulerOptions) {
  const config: HarvestSchedulerConfig = {
    ...loadHarvestConfig(),
    ...opts.config,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let tickRunning = false;
  let lastHarvestCompletedAt: number | null = null;

  // -------------------------------------------------------------------------
  // Processor wiring — tells the harvest queue how to actually execute a job
  // -------------------------------------------------------------------------

  setHarvestProcessor(async (job: HarvestJob): Promise<string> => {
    const keypair = await getKeeperKeypair(config.keeperSecretId);
    const txResult = await opts.executeHarvest(keypair, job.data.yieldAmount);

    lastHarvestCompletedAt = Date.now();
    await recordHarvestSuccess(job.data.yieldAmount);

    logger.info("[HarvestScheduler] Harvest executed on-chain", {
      jobId: job.id,
      vaultContractId: job.data.vaultContractId,
      yieldAmount: job.data.yieldAmount,
      txResult,
    });

    return txResult;
  });

  // -------------------------------------------------------------------------
  // Core tick
  // -------------------------------------------------------------------------

  async function runTick(): Promise<TickResult> {
    if (tickRunning) {
      logger.debug("[HarvestScheduler] Tick already running, skipping");
      return { outcome: "error", error: "Tick already running" };
    }

    tickRunning = true;

    try {
      // 1. Fetch current accumulated yield
      let accumulatedYield: number;
      try {
        accumulatedYield = await opts.getAccumulatedYield();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error("[HarvestScheduler] Failed to fetch accumulated yield", { error });
        return { outcome: "error", error };
      }

      logger.debug("[HarvestScheduler] Tick", {
        accumulatedYield,
        threshold: config.thresholdAmount,
      });

      // 2. Check threshold
      if (accumulatedYield < config.thresholdAmount) {
        logger.debug("[HarvestScheduler] Yield below threshold, skipping", {
          accumulatedYield,
          threshold: config.thresholdAmount,
        });
        return { outcome: "below_threshold", accumulatedYield };
      }

      // 3. Duplicate harvest guard — check last harvest timestamp
      const now = Date.now();
      if (lastHarvestCompletedAt !== null) {
        const msSinceLastHarvest = now - lastHarvestCompletedAt;
        if (msSinceLastHarvest < config.minHarvestGapMs) {
          const lastHarvestAt = new Date(lastHarvestCompletedAt).toISOString();
          logger.info("[HarvestScheduler] Last harvest too recent, skipping", {
            msSinceLastHarvest,
            minHarvestGapMs: config.minHarvestGapMs,
            lastHarvestAt,
          });
          return { outcome: "too_soon", accumulatedYield, lastHarvestAt };
        }
      }

      // 4. Load keeper keypair (validates secret is accessible before enqueueing)
      let keypair: KeeperKeypair;
      try {
        keypair = await getKeeperKeypair(config.keeperSecretId);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error("[HarvestScheduler] Failed to load keeper keypair", { error });
        await recordHarvestFailure(`keypair load error: ${error}`);
        return { outcome: "error", error };
      }

      // 5. Enqueue harvest job
      await recordHarvestAttempt();

      const job = enqueueHarvest({
        vaultContractId: config.vaultContractId,
        keeperPublicKey: keypair.publicKey,
        yieldAmount: accumulatedYield,
        triggeredAt: new Date().toISOString(),
      });

      if (job === null) {
        return { outcome: "duplicate", accumulatedYield };
      }

      logger.info("[HarvestScheduler] Harvest job enqueued", {
        jobId: job.id,
        vaultContractId: config.vaultContractId,
        yieldAmount: accumulatedYield,
        threshold: config.thresholdAmount,
      });

      return { outcome: "enqueued", accumulatedYield, jobId: job.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("[HarvestScheduler] Unexpected tick error", { error });
      return { outcome: "error", error };
    } finally {
      tickRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function start(): void {
    if (timer !== null) {
      logger.warn("[HarvestScheduler] Already running — ignoring start()");
      return;
    }

    // Start the queue worker alongside the scheduler
    startHarvestWorker();

    // Run once immediately, then on the configured interval
    void runTick().then((result) => opts.onTick?.(result));

    timer = setInterval(() => {
      void runTick().then((result) => opts.onTick?.(result));
    }, config.intervalMs);

    logger.info("[HarvestScheduler] Started", {
      intervalMs: config.intervalMs,
      thresholdAmount: config.thresholdAmount,
      minHarvestGapMs: config.minHarvestGapMs,
      vaultContractId: config.vaultContractId,
    });
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    stopHarvestWorker();
    logger.info("[HarvestScheduler] Stopped");
  }

  function isRunning(): boolean {
    return timer !== null;
  }

  /** Expose metrics for health-check / Prometheus endpoints. */
  async function metrics(): Promise<HarvestMetrics> {
    return getHarvestMetrics();
  }

  /** Expose harvest history for dashboards. */
  async function history(limit = 24) {
    return getHarvestHistory(limit);
  }

  /** Manually trigger one scheduler tick (useful for tests and admin endpoints). */
  async function triggerTick(): Promise<TickResult> {
    return runTick();
  }

  return { start, stop, isRunning, metrics, history, triggerTick };
}

export type HarvestScheduler = ReturnType<typeof createHarvestScheduler>;

// ---------------------------------------------------------------------------
// Module-level singleton for convenience (mirrors yieldWorker / yieldScheduler)
// ---------------------------------------------------------------------------

let _singleton: HarvestScheduler | null = null;

/**
 * Start the module-level singleton harvest scheduler.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function startHarvestScheduler(opts: HarvestSchedulerOptions): void {
  if (_singleton) return;
  _singleton = createHarvestScheduler(opts);
  _singleton.start();
}

/** Stop the module-level singleton scheduler. */
export function stopHarvestScheduler(): void {
  _singleton?.stop();
  _singleton = null;
}

/** Returns true if the singleton scheduler is currently running. */
export function isHarvestSchedulerRunning(): boolean {
  return _singleton?.isRunning() ?? false;
}

/** Returns harvest metrics from the singleton (or zero-value if not started). */
export function getSchedulerHarvestMetrics(): Promise<HarvestMetrics> {
  return _singleton?.metrics() ?? getHarvestMetrics();
}

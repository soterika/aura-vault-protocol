/**
 * Harvest Job Queue — Issue #315
 *
 * A thin specialisation of the generic transaction queue for harvest jobs.
 * Harvest jobs are enqueued by the scheduler and processed by a registered
 * harvest executor (e.g., the Stellar horizon client).
 *
 * Features:
 *   - Durability: jobs survive process restarts (via queueDb persistence)
 *   - Deduplication: prevents enqueueing a harvest when one is already waiting
 *     or active (avoids double-harvest)
 *   - Exponential backoff retry via the generic queue's MAX_ATTEMPTS logic
 *   - Exposes typed helpers for harvest-specific job data
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { saveJob } from "./queueDb.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HarvestJobData {
  /** Stellar contract ID of the vault. */
  vaultContractId: string;
  /** Keeper's Stellar public key (for tracing only — never log the secret key). */
  keeperPublicKey?: string;
  /** Yield amount at the time the job was enqueued. */
  yieldAmount: number;
  /** ISO timestamp when this harvest was triggered. */
  triggeredAt: string;
}

export type HarvestJobStatus = "waiting" | "active" | "completed" | "failed" | "dead";

export interface HarvestJob {
  id: string;
  data: HarvestJobData;
  status: HarvestJobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// In-memory stores (same approach as queue.ts)
// ---------------------------------------------------------------------------

const jobs = new Map<string, HarvestJob>();
const waitingQueue: string[] = [];
export const deadLetterQueue: string[] = [];

/** retrySchedule: jobId → earliest timestamp when it can be promoted back */
const retrySchedule = new Map<string, number>();

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export type HarvestProcessor = (job: HarvestJob) => Promise<string>;

let processor: HarvestProcessor = async () => {
  throw new Error("[HarvestQueue] No processor registered — call setHarvestProcessor() first");
};

export function setHarvestProcessor(fn: HarvestProcessor): void {
  processor = fn;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function retryDelayMs(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

function updateJob(job: HarvestJob, patch: Partial<HarvestJob>): void {
  Object.assign(job, patch, { updatedAt: Date.now() });
  saveJob({ ...job, type: "harvest" } as any).catch((err) => {
    logger.error("[HarvestQueue] Failed to persist job", { jobId: job.id, err });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a new harvest job.
 *
 * If a harvest job is already waiting or active for the same vault, this is a
 * no-op and returns `null` to signal the duplicate was suppressed.
 */
export function enqueueHarvest(data: HarvestJobData): HarvestJob | null {
  // Deduplication: reject if an identical vault already has a pending harvest
  const duplicate = Array.from(jobs.values()).find(
    (j) =>
      j.data.vaultContractId === data.vaultContractId &&
      (j.status === "waiting" || j.status === "active")
  );

  if (duplicate) {
    logger.warn("[HarvestQueue] Duplicate harvest suppressed — job already in flight", {
      existingJobId: duplicate.id,
      vaultContractId: data.vaultContractId,
    });
    return null;
  }

  const job: HarvestJob = {
    id: uuidv4(),
    data,
    status: "waiting",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(job.id, job);
  waitingQueue.push(job.id);

  saveJob({ ...job, type: "harvest" } as any).catch((err) => {
    logger.error("[HarvestQueue] Failed to persist new job", { jobId: job.id, err });
  });

  logger.info("[HarvestQueue] Harvest job enqueued", {
    jobId: job.id,
    vaultContractId: data.vaultContractId,
    yieldAmount: data.yieldAmount,
  });

  return job;
}

export function getHarvestJob(id: string): HarvestJob | undefined {
  return jobs.get(id);
}

export function listHarvestJobs(status?: HarvestJobStatus): HarvestJob[] {
  const all = Array.from(jobs.values());
  return status ? all.filter((j) => j.status === status) : all;
}

export function getHarvestDeadLetterJobs(): HarvestJob[] {
  return deadLetterQueue.map((id) => jobs.get(id)!).filter(Boolean);
}

/**
 * Process one job from the waiting queue (single tick).
 * Promotes any retries whose back-off window has elapsed first.
 */
export async function tickHarvest(): Promise<void> {
  const now = Date.now();

  // Promote scheduled retries back into waiting queue
  for (const [id, readyAt] of retrySchedule) {
    if (now >= readyAt) {
      retrySchedule.delete(id);
      waitingQueue.push(id);
    }
  }

  if (waitingQueue.length === 0) return;

  const id = waitingQueue.shift()!;
  const job = jobs.get(id);
  if (!job || job.status === "completed" || job.status === "dead") return;

  updateJob(job, { status: "active" });
  job.attempts += 1;

  try {
    const result = await processor(job);
    updateJob(job, { status: "completed", result });

    logger.info("[HarvestQueue] Harvest job completed", {
      jobId: job.id,
      vaultContractId: job.data.vaultContractId,
      result,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    if (job.attempts < MAX_ATTEMPTS) {
      updateJob(job, { status: "waiting", error });
      retrySchedule.set(job.id, Date.now() + retryDelayMs(job.attempts));
      logger.warn("[HarvestQueue] Harvest job failed, will retry", {
        jobId: job.id,
        attempt: job.attempts,
        nextRetryMs: retryDelayMs(job.attempts),
        error,
      });
    } else {
      updateJob(job, { status: "dead", error });
      deadLetterQueue.push(job.id);
      logger.error("[HarvestQueue] Harvest job exhausted retries — moved to DLQ", {
        jobId: job.id,
        vaultContractId: job.data.vaultContractId,
        error,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 1_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;

export function startHarvestWorker(): void {
  if (tickTimer !== null) return;
  tickTimer = setInterval(() => { void tickHarvest(); }, TICK_INTERVAL_MS);
  logger.info("[HarvestQueue] Worker started");
}

export function stopHarvestWorker(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info("[HarvestQueue] Worker stopped");
  }
}

export function isHarvestWorkerRunning(): boolean {
  return tickTimer !== null;
}

export function resetHarvestQueue(): void {
  stopHarvestWorker();
  jobs.clear();
  waitingQueue.length = 0;
  deadLetterQueue.length = 0;
  retrySchedule.clear();
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function harvestQueueMetrics() {
  const all = Array.from(jobs.values());
  return {
    waiting: all.filter((j) => j.status === "waiting").length,
    active: all.filter((j) => j.status === "active").length,
    completed: all.filter((j) => j.status === "completed").length,
    dead: all.filter((j) => j.status === "dead").length,
    total: all.length,
  };
}

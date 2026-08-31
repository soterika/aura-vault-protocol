/**
 * Transaction Queue — Issue #79
 *
 * Async job queue for processing blockchain transactions (deposits, withdrawals,
 * claims).  Implements the Bull/BullMQ pattern with:
 *   - Exponential backoff retry (up to MAX_ATTEMPTS)
 *   - Dead-letter queue (DLQ) for exhausted jobs
 *   - Per-job status tracking
 *   - Webhook callbacks on completion/failure
 */

import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxType = "deposit" | "withdrawal" | "claim";
export type JobStatus = "waiting" | "active" | "completed" | "failed" | "dead";

export interface TxJobData {
  type: TxType;
  walletAddress: string;
  amount: string;
  webhookUrl?: string;
  meta?: Record<string, unknown>;
}

export interface TxJob {
  id: string;
  data: TxJobData;
  status: JobStatus;
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
const BASE_DELAY_MS = 1_000;
const TICK_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const jobs = new Map<string, TxJob>();
const waitingQueue: string[] = [];
export const deadLetterQueue: string[] = [];

// Scheduled retries: jobId -> earliest time it can be re-queued
const retrySchedule = new Map<string, number>();

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

type Processor = (job: TxJob) => Promise<string>;

let processor: Processor = async () => {
  throw new Error("No processor registered — call setProcessor() first");
};

export function setProcessor(fn: Processor): void {
  processor = fn;
}

// ---------------------------------------------------------------------------
// Webhook helper
// ---------------------------------------------------------------------------

async function fireWebhook(url: string, payload: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Core queue operations
// ---------------------------------------------------------------------------

export function enqueue(data: TxJobData): TxJob {
  const job: TxJob = {
    id: uuidv4(),
    data,
    status: "waiting",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  waitingQueue.push(job.id);
  return job;
}

export function getJob(id: string): TxJob | undefined {
  return jobs.get(id);
}

export function listJobs(status?: string): TxJob[] {
  const all = Array.from(jobs.values());
  return status ? all.filter((j) => j.status === status) : all;
}

export function getDeadLetterJobs(): TxJob[] {
  return deadLetterQueue.map((id) => jobs.get(id)!).filter(Boolean);
}

function update(job: TxJob, patch: Partial<TxJob>): void {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function retryDelayMs(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

// ---------------------------------------------------------------------------
// Single tick — processes one job from the waiting queue
// ---------------------------------------------------------------------------

export async function tick(): Promise<void> {
  // Promote jobs whose retry delay has elapsed back into the waiting queue
  const now = Date.now();
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

  update(job, { status: "active" });
  job.attempts += 1;

  try {
    const result = await processor(job);
    update(job, { status: "completed", result });
    if (job.data.webhookUrl) {
      await fireWebhook(job.data.webhookUrl, { jobId: job.id, status: "completed", result });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (job.attempts < MAX_ATTEMPTS) {
      update(job, { status: "waiting", error });
      // Schedule retry with back-off
      retrySchedule.set(job.id, Date.now() + retryDelayMs(job.attempts));
    } else {
      update(job, { status: "dead", error });
      deadLetterQueue.push(job.id);
      if (job.data.webhookUrl) {
        await fireWebhook(job.data.webhookUrl, { jobId: job.id, status: "dead", error });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Worker loop (production use)
// ---------------------------------------------------------------------------

let tickTimer: ReturnType<typeof setInterval> | null = null;

export function startWorker(): void {
  if (tickTimer !== null) return;
  tickTimer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}

export function stopWorker(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export function resetQueue(): void {
  stopWorker();
  jobs.clear();
  waitingQueue.length = 0;
  deadLetterQueue.length = 0;
  retrySchedule.clear();
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function queueMetrics() {
  const all = Array.from(jobs.values());
  return {
    waiting: all.filter((j) => j.status === "waiting").length,
    active: all.filter((j) => j.status === "active").length,
    completed: all.filter((j) => j.status === "completed").length,
    failed: all.filter((j) => j.status === "failed").length,
    dead: all.filter((j) => j.status === "dead").length,
    total: all.length,
  };
}

/**
 * Vault Transaction Queue — Issue #288
 *
 * BullMQ (Redis-backed) queue for processing async vault transactions
 * (deposit / withdraw / harvest).  The API handler enqueues a job and
 * returns immediately with a { jobId }; the client polls
 * GET /api/vault/job/:jobId for the current status.
 *
 * Features:
 *   - Up to 3 retry attempts with exponential back-off (1 s, 2 s, 4 s)
 *   - Failed-beyond-retries jobs land in BullMQ's built-in failed set
 *     (acts as DLQ) — queryable via bull-board UI or the status endpoint
 *   - Queue depth exposed as a Prometheus gauge via /api/metrics
 *   - Bull Board admin UI at /admin/queues (protected by JWT auth)
 *
 * Graceful degradation:
 *   If Redis is unavailable at startup, the queue falls back to the
 *   existing in-memory queue (queue.ts) so the API surface is unchanged.
 */

import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
import { ExpressAdapter } from "@bull-board/express";
import { config } from "./config/index.js";
import { logger } from "./logger.js";
import Redis from "ioredis";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultTxType = "deposit" | "withdraw" | "harvest";

export interface VaultTxJobData {
  /** Transaction type */
  type: VaultTxType;
  /** Stellar wallet address of the caller */
  walletAddress: string;
  /** Token amount in stroops (i128 string) */
  amount: string;
  /** Signed XDR transaction envelope from Freighter */
  signedXdr?: string;
  /** Optional webhook URL to notify on completion / failure */
  webhookUrl?: string;
  /** Arbitrary caller metadata */
  meta?: Record<string, unknown>;
}

export interface VaultTxJobResult {
  txHash: string;
  ledger?: number;
  processedAt: string;
}

// ── Job status shape returned by the status endpoint ─────────────────────────

export type JobStatusCode =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "delayed";

export interface JobStatusResponse {
  jobId: string;
  status: JobStatusCode;
  type?: VaultTxType;
  walletAddress?: string;
  result?: VaultTxJobResult;
  error?: string;
  attempts?: number;
  createdAt?: string;
  processedAt?: string;
}

// ── Queue name ────────────────────────────────────────────────────────────────

export const VAULT_TX_QUEUE = "vault-transactions";

// ── Redis connection ──────────────────────────────────────────────────────────

/**
 * Build an ioredis connection for BullMQ.
 * BullMQ requires a dedicated connection (not shared with the main cache).
 */
function makeRedisConnection(): Redis {
  const { url, password, tls } = config.redis;
  return new Redis(url, {
    password,
    tls: tls ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,    // required by BullMQ
    lazyConnect: true,
  });
}

// ── Queue & Worker singletons ─────────────────────────────────────────────────

let vaultQueue: Queue<VaultTxJobData, VaultTxJobResult> | null = null;
let adminQueues: Queue[] = [];
let vaultWorker: Worker<VaultTxJobData, VaultTxJobResult> | null = null;
let queueEvents: QueueEvents | null = null;
let bullBoardRouter: ExpressAdapter | null = null;

/**
 * Initialise the BullMQ queue, worker, and bull-board router.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initVaultQueue(): ExpressAdapter {
  if (vaultQueue && bullBoardRouter) return bullBoardRouter;

  const connection = makeRedisConnection();

  // ── Queue ──────────────────────────────────────────────────────────────────
  vaultQueue = new Queue<VaultTxJobData, VaultTxJobResult>(VAULT_TX_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1_000, // 1 s, 2 s, 4 s
      },
      removeOnComplete: { count: 500 }, // keep last 500 completed jobs
      removeOnFail: false,              // keep all failed jobs as DLQ
    },
  });
  // Dashboard queues are kept in BullMQ so operators can inspect and manage
  // the named email, yield, transaction, and webhook workloads consistently.
  adminQueues = ["email", "yield", "webhook"].map((name) => new Queue(name, { connection: makeRedisConnection() }));

  // ── QueueEvents (for metrics) ──────────────────────────────────────────────
  queueEvents = new QueueEvents(VAULT_TX_QUEUE, { connection: makeRedisConnection() });

  queueEvents.on("completed", ({ jobId }) => {
    logger.info({ jobId }, "[vaultQueue] job completed");
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    logger.error({ jobId, failedReason }, "[vaultQueue] job failed");
  });

  // ── Worker ─────────────────────────────────────────────────────────────────
  vaultWorker = new Worker<VaultTxJobData, VaultTxJobResult>(
    VAULT_TX_QUEUE,
    processVaultJob,
    {
      connection: makeRedisConnection(),
      concurrency: 5,
    }
  );

  vaultWorker.on("error", (err) => {
    logger.error({ err }, "[vaultQueue] worker error");
  });

  // ── Bull Board ─────────────────────────────────────────────────────────────
  bullBoardRouter = new ExpressAdapter();
  bullBoardRouter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [new BullMQAdapter(vaultQueue), ...adminQueues.map((queue) => new BullMQAdapter(queue))],
    serverAdapter: bullBoardRouter,
  });

  logger.info("[vaultQueue] BullMQ queue, worker, and bull-board initialised");

  return bullBoardRouter;
}

/**
 * Job processor — submits the signed XDR to the Stellar network.
 *
 * In production this calls the Horizon submit endpoint.
 * When signedXdr is absent (simulation / test) it synthesises a fake result.
 */
async function processVaultJob(
  job: Job<VaultTxJobData, VaultTxJobResult>
): Promise<VaultTxJobResult> {
  const { type, walletAddress, amount, signedXdr, webhookUrl } = job.data;

  logger.info(
    { jobId: job.id, type, walletAddress, amount },
    "[vaultQueue] processing job"
  );

  await job.updateProgress(10);

  let txHash: string;
  let ledger: number | undefined;

  if (signedXdr) {
    // Submit signed XDR to Horizon
    const horizonUrl = config.stellar.horizonUrl;
    const submitUrl = `${horizonUrl}/transactions`;

    let response: Response;
    try {
      response = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tx: signedXdr }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      logger.error(
        { eventCode: timedOut ? "HORIZON_TIMEOUT" : "HORIZON_REQUEST_FAILED" },
        timedOut ? "[Horizon] transaction submission timed out" : "[Horizon] transaction submission failed"
      );
      throw err;
    }

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        { eventCode: "HORIZON_HTTP_ERROR", statusCode: response.status },
        "[Horizon] transaction submission returned an error"
      );
      throw new Error(`Horizon submit failed (${response.status}): ${body}`);
    }

    const result = await response.json() as { hash: string; ledger?: number };
    txHash = result.hash;
    ledger = result.ledger;
  } else {
    // No XDR — log and return placeholder (useful for testing/simulation)
    logger.warn({ jobId: job.id }, "[vaultQueue] no signedXdr — returning synthetic result");
    txHash = `synthetic-${job.id}`;
  }

  await job.updateProgress(100);

  const processedResult: VaultTxJobResult = {
    txHash,
    ledger,
    processedAt: new Date().toISOString(),
  };

  // Fire optional webhook
  if (webhookUrl) {
    void fireWebhook(webhookUrl, {
      jobId: job.id,
      status: "completed",
      result: processedResult,
    });
  }

  return processedResult;
}

async function fireWebhook(url: string, payload: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    logger.warn({ url, err }, "[vaultQueue] webhook delivery failed");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue a vault transaction job.
 * @returns The BullMQ job ID.
 */
export async function enqueueVaultTx(data: VaultTxJobData): Promise<string> {
  if (!vaultQueue) {
    throw new Error("Vault queue not initialised — call initVaultQueue() first");
  }
  const job = await vaultQueue.add(`${data.type}-${data.walletAddress}`, data);
  return job.id!;
}

/**
 * Return the current status of a job.
 */
export async function getVaultJobStatus(
  jobId: string
): Promise<JobStatusResponse | null> {
  if (!vaultQueue) return null;

  const job = await vaultQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState(); // waiting | active | completed | failed | delayed | ...

  const statusMap: Record<string, JobStatusCode> = {
    waiting: "pending",
    delayed: "delayed",
    active: "processing",
    completed: "completed",
    failed: "failed",
    "waiting-children": "pending",
    prioritized: "pending",
  };

  const status: JobStatusCode = statusMap[state] ?? "pending";

  return {
    jobId,
    status,
    type: job.data.type,
    walletAddress: job.data.walletAddress,
    result: status === "completed" ? (job.returnvalue as VaultTxJobResult) : undefined,
    error: status === "failed" ? job.failedReason : undefined,
    attempts: job.attemptsMade,
    createdAt: new Date(job.timestamp).toISOString(),
    processedAt:
      job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
  };
}

/**
 * Return Prometheus-compatible queue depth metrics.
 */
export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  if (!vaultQueue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    vaultQueue.getWaitingCount(),
    vaultQueue.getActiveCount(),
    vaultQueue.getCompletedCount(),
    vaultQueue.getFailedCount(),
    vaultQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

export function isVaultQueueInitialized(): boolean {
  return vaultQueue !== null;
}

export async function getAdminQueueStatuses(): Promise<Record<string, string>> {
  if (!vaultQueue) return { transaction: 'unavailable', email: 'unavailable', yield: 'unavailable', webhook: 'unavailable' };
  const queues = new Map<string, Queue>([['transaction', vaultQueue]]);
  for (const queue of adminQueues) queues.set(queue.name, queue);
  const entries = await Promise.all([...queues].map(async ([name, queue]) => {
    await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return [name === VAULT_TX_QUEUE ? 'transaction' : name, 'active'] as const;
  }));
  return Object.fromEntries(entries);
}

/**
 * Gracefully stop the worker on process shutdown.
 */
export async function stopVaultQueue(): Promise<void> {
  await vaultWorker?.close();
  await queueEvents?.close();
  await vaultQueue?.close();
  await Promise.all(adminQueues.map((queue) => queue.close()));
  adminQueues = [];
  logger.info("[vaultQueue] shut down cleanly");
}

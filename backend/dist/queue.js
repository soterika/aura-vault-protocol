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
// Config
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const TICK_INTERVAL_MS = 500;
// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
const jobs = new Map();
const waitingQueue = [];
export const deadLetterQueue = [];
// Scheduled retries: jobId -> earliest time it can be re-queued
const retrySchedule = new Map();
let processor = async () => {
    throw new Error("No processor registered — call setProcessor() first");
};
export function setProcessor(fn) {
    processor = fn;
}
// ---------------------------------------------------------------------------
// Webhook helper
// ---------------------------------------------------------------------------
async function fireWebhook(url, payload) {
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5_000),
        });
    }
    catch {
        // best-effort
    }
}
// ---------------------------------------------------------------------------
// Core queue operations
// ---------------------------------------------------------------------------
export function enqueue(data) {
    const job = {
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
export function getJob(id) {
    return jobs.get(id);
}
export function listJobs(status) {
    const all = Array.from(jobs.values());
    return status ? all.filter((j) => j.status === status) : all;
}
export function getDeadLetterJobs() {
    return deadLetterQueue.map((id) => jobs.get(id)).filter(Boolean);
}
function update(job, patch) {
    Object.assign(job, patch, { updatedAt: Date.now() });
}
function retryDelayMs(attempt) {
    return BASE_DELAY_MS * Math.pow(2, attempt - 1);
}
// ---------------------------------------------------------------------------
// Single tick — processes one job from the waiting queue
// ---------------------------------------------------------------------------
export async function tick() {
    // Promote jobs whose retry delay has elapsed back into the waiting queue
    const now = Date.now();
    for (const [id, readyAt] of retrySchedule) {
        if (now >= readyAt) {
            retrySchedule.delete(id);
            waitingQueue.push(id);
        }
    }
    if (waitingQueue.length === 0)
        return;
    const id = waitingQueue.shift();
    const job = jobs.get(id);
    if (!job || job.status === "completed" || job.status === "dead")
        return;
    update(job, { status: "active" });
    job.attempts += 1;
    try {
        const result = await processor(job);
        update(job, { status: "completed", result });
        if (job.data.webhookUrl) {
            await fireWebhook(job.data.webhookUrl, { jobId: job.id, status: "completed", result });
        }
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (job.attempts < MAX_ATTEMPTS) {
            update(job, { status: "waiting", error });
            // Schedule retry with back-off
            retrySchedule.set(job.id, Date.now() + retryDelayMs(job.attempts));
        }
        else {
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
let tickTimer = null;
export function startWorker() {
    if (tickTimer !== null)
        return;
    tickTimer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}
export function stopWorker() {
    if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
export function resetQueue() {
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

import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../redis.js';
import { NS } from '../cache.js';
import { sendEmail } from './emailService.js';
import { MAX_ATTACHMENT_BYTES } from '../types/email.js';
// ─── Priority → Redis key ─────────────────────────────────────────────────────
const QUEUE_KEY = {
    high: NS.EMAIL_QUEUE_HIGH,
    normal: NS.EMAIL_QUEUE_NORMAL,
    low: NS.EMAIL_QUEUE_LOW,
};
// Sorted set: score = next-attempt timestamp (ms)
const RETRY_KEY = NS.EMAIL_RETRY;
const DEAD_KEY = NS.EMAIL_DEAD;
// ─── Enqueue ──────────────────────────────────────────────────────────────────
export async function enqueueEmail(opts) {
    if (opts.attachments) {
        for (const att of opts.attachments) {
            if (att.size > MAX_ATTACHMENT_BYTES) {
                throw new Error(`Attachment "${att.filename}" exceeds 5 MB limit (${att.size} bytes)`);
            }
        }
    }
    const job = {
        id: uuidv4(),
        to: opts.to,
        subject: opts.subject ?? '',
        template: opts.template,
        data: opts.data,
        priority: opts.priority ?? 'normal',
        attempts: 0,
        maxAttempts: opts.maxAttempts ?? 3,
        scheduledAt: new Date().toISOString(),
        attachments: opts.attachments,
        trackingId: uuidv4(),
    };
    await getRedis().lpush(QUEUE_KEY[job.priority], JSON.stringify(job));
    return job.id;
}
export async function enqueueBulk(opts) {
    return Promise.all(opts.map(enqueueEmail));
}
// ─── Retry promotion ──────────────────────────────────────────────────────────
async function promoteRetryJobs() {
    const redis = getRedis();
    const now = Date.now();
    // ZRANGEBYSCORE: jobs whose next-attempt time has passed
    const due = await redis.zrangebyscore(RETRY_KEY, '-inf', now);
    if (due.length === 0)
        return;
    for (const jobJson of due) {
        const job = JSON.parse(jobJson);
        await redis.lpush(QUEUE_KEY[job.priority], jobJson);
        await redis.zrem(RETRY_KEY, jobJson);
    }
    console.log(`[EmailQueue] Promoted ${due.length} retry job(s)`);
}
// ─── Failure handler ──────────────────────────────────────────────────────────
// Exponential backoff: attempt 1 → 30s, 2 → 5m, 3+ → 30m
const BACKOFF_MS = [30_000, 300_000, 1_800_000];
async function handleFailure(job, err) {
    const redis = getRedis();
    await redis.del(`${NS.EMAIL_INFLIGHT}:${job.id}`);
    job.attempts++;
    if (job.attempts >= job.maxAttempts) {
        await redis.lpush(DEAD_KEY, JSON.stringify(job));
        console.error(`[EmailQueue] Job ${job.id} dead-lettered after ${job.attempts} attempt(s):`, err.message);
        return;
    }
    const delay = BACKOFF_MS[job.attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    const nextRetry = Date.now() + delay;
    await redis.zadd(RETRY_KEY, nextRetry, JSON.stringify(job));
    console.warn(`[EmailQueue] Job ${job.id} will retry in ${delay / 1000}s ` +
        `(attempt ${job.attempts}/${job.maxAttempts})`);
}
// ─── Worker ───────────────────────────────────────────────────────────────────
let running = false;
async function workerLoop() {
    const redis = getRedis();
    while (running) {
        // Move any due retry jobs back to their priority queues before polling
        await promoteRetryJobs();
        // BLPOP across priority queues with a 2-second timeout
        const result = await redis.blpop(NS.EMAIL_QUEUE_HIGH, NS.EMAIL_QUEUE_NORMAL, NS.EMAIL_QUEUE_LOW, 2 // seconds to wait before returning null
        );
        if (!result)
            continue;
        const [, jobJson] = result;
        let job;
        try {
            job = JSON.parse(jobJson);
        }
        catch {
            console.error('[EmailQueue] Failed to parse job JSON, skipping');
            continue;
        }
        // Mark in-flight so a crash-recovery sweep can re-enqueue stale jobs
        await redis.set(`${NS.EMAIL_INFLIGHT}:${job.id}`, jobJson, 'EX', 300);
        try {
            const result = await sendEmail(job);
            await redis.del(`${NS.EMAIL_INFLIGHT}:${job.id}`);
            if (result.success) {
                console.log(`[EmailQueue] Delivered job ${job.id} via ${result.provider} (msgId: ${result.messageId})`);
            }
            else {
                // Blocked (unsubscribed / hard-bounce) — not a failure worth retrying
                console.warn(`[EmailQueue] Job ${job.id} suppressed: ${result.error}`);
            }
        }
        catch (err) {
            await handleFailure(job, err);
        }
    }
}
export function startEmailWorker() {
    if (running)
        return;
    running = true;
    console.log('[EmailQueue] Worker started');
    workerLoop().catch((err) => {
        console.error('[EmailQueue] Worker crashed:', err);
        running = false;
    });
}
export function stopEmailWorker() {
    running = false;
    console.log('[EmailQueue] Worker stopping after current job');
}
// ─── Queue stats ──────────────────────────────────────────────────────────────
export async function getQueueStats() {
    const redis = getRedis();
    const [high, normal, low, retry, dead] = await Promise.all([
        redis.llen(NS.EMAIL_QUEUE_HIGH),
        redis.llen(NS.EMAIL_QUEUE_NORMAL),
        redis.llen(NS.EMAIL_QUEUE_LOW),
        redis.zcard(NS.EMAIL_RETRY),
        redis.llen(NS.EMAIL_DEAD),
    ]);
    return { high, normal, low, retry, dead };
}

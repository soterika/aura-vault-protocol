/**
 * Transaction Queue Tests — Issue #79
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { enqueue, getJob, listJobs, getDeadLetterJobs, queueMetrics, setProcessor, tick, resetQueue, deadLetterQueue, } from "./queue.js";
beforeEach(() => {
    resetQueue();
    setProcessor(async (job) => `tx_${job.id}_ok`);
});
afterEach(() => {
    vi.useRealTimers();
});
// ---------------------------------------------------------------------------
// Enqueue / status tracking
// ---------------------------------------------------------------------------
describe("enqueue", () => {
    it("returns a job with waiting status and unique id", () => {
        const job = enqueue({ type: "deposit", walletAddress: "GA123", amount: "100" });
        expect(job.id).toBeTruthy();
        expect(job.status).toBe("waiting");
        expect(job.attempts).toBe(0);
    });
    it("tracks job by id", () => {
        const job = enqueue({ type: "withdrawal", walletAddress: "GA456", amount: "50" });
        expect(getJob(job.id)).toEqual(job);
    });
    it("lists all waiting jobs", () => {
        enqueue({ type: "deposit", walletAddress: "GA1", amount: "1" });
        enqueue({ type: "withdrawal", walletAddress: "GA2", amount: "2" });
        expect(listJobs("waiting")).toHaveLength(2);
    });
    it("returns undefined for unknown job id", () => {
        expect(getJob("nonexistent")).toBeUndefined();
    });
});
// ---------------------------------------------------------------------------
// Processing — success path
// ---------------------------------------------------------------------------
describe("worker — success", () => {
    it("completes a job and stores result", async () => {
        const job = enqueue({ type: "claim", walletAddress: "GA789", amount: "10" });
        await tick();
        const updated = getJob(job.id);
        expect(updated.status).toBe("completed");
        expect(updated.result).toMatch(/^tx_/);
        expect(updated.attempts).toBe(1);
    });
    it("processes multiple jobs in FIFO order", async () => {
        const order = [];
        setProcessor(async (j) => { order.push(j.id); return "ok"; });
        const j1 = enqueue({ type: "deposit", walletAddress: "GA1", amount: "1" });
        const j2 = enqueue({ type: "deposit", walletAddress: "GA2", amount: "2" });
        await tick();
        await tick();
        expect(order[0]).toBe(j1.id);
        expect(order[1]).toBe(j2.id);
    });
});
// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------
describe("worker — retry with exponential backoff", () => {
    it("retries up to MAX_ATTEMPTS then moves to DLQ", async () => {
        setProcessor(async () => { throw new Error("rpc error"); });
        vi.useFakeTimers();
        const job = enqueue({ type: "withdrawal", walletAddress: "GA_FAIL", amount: "99" });
        // Attempt 1 — fails, schedules retry after 1s
        await tick();
        expect(getJob(job.id).attempts).toBe(1);
        // Advance past first retry delay (1s)
        vi.advanceTimersByTime(1_001);
        await tick(); // attempt 2 — fails, schedules retry after 2s
        expect(getJob(job.id).attempts).toBe(2);
        // Advance past second retry delay (2s)
        vi.advanceTimersByTime(2_001);
        await tick(); // attempt 3 — final, goes to DLQ
        expect(getJob(job.id).status).toBe("dead");
        expect(getJob(job.id).attempts).toBe(3);
        expect(getJob(job.id).error).toBe("rpc error");
    });
    it("succeeds on second attempt after one failure", async () => {
        let callCount = 0;
        setProcessor(async () => {
            callCount++;
            if (callCount === 1)
                throw new Error("transient");
            return "ok_on_retry";
        });
        vi.useFakeTimers();
        const job = enqueue({ type: "deposit", walletAddress: "GA_RETRY", amount: "500" });
        await tick(); // attempt 1 — fails
        expect(getJob(job.id).attempts).toBe(1);
        vi.advanceTimersByTime(1_001); // past 1s backoff
        await tick(); // attempt 2 — succeeds
        const updated = getJob(job.id);
        expect(updated.status).toBe("completed");
        expect(updated.attempts).toBe(2);
        expect(updated.result).toBe("ok_on_retry");
    });
});
// ---------------------------------------------------------------------------
// Dead-letter queue
// ---------------------------------------------------------------------------
describe("dead-letter queue", () => {
    it("adds exhausted jobs to DLQ", async () => {
        setProcessor(async () => { throw new Error("always fails"); });
        vi.useFakeTimers();
        enqueue({ type: "claim", walletAddress: "GA_DLQ", amount: "1" });
        await tick();
        vi.advanceTimersByTime(1_001);
        await tick();
        vi.advanceTimersByTime(2_001);
        await tick();
        expect(getDeadLetterJobs()).toHaveLength(1);
        expect(deadLetterQueue).toHaveLength(1);
    });
    it("does not put successful jobs in DLQ", async () => {
        enqueue({ type: "deposit", walletAddress: "GA_OK", amount: "200" });
        await tick();
        expect(getDeadLetterJobs()).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
describe("queueMetrics", () => {
    it("reflects correct counts after processing", async () => {
        enqueue({ type: "deposit", walletAddress: "GA1", amount: "1" });
        enqueue({ type: "withdrawal", walletAddress: "GA2", amount: "2" });
        await tick();
        await tick();
        const m = queueMetrics();
        expect(m.completed).toBe(2);
        expect(m.dead).toBe(0);
        expect(m.total).toBe(2);
    });
    it("counts dead jobs correctly", async () => {
        setProcessor(async () => { throw new Error("fail"); });
        vi.useFakeTimers();
        enqueue({ type: "claim", walletAddress: "GA_DEAD", amount: "5" });
        await tick();
        vi.advanceTimersByTime(1_001);
        await tick();
        vi.advanceTimersByTime(2_001);
        await tick();
        expect(queueMetrics().dead).toBe(1);
        expect(queueMetrics().completed).toBe(0);
    });
});
// ---------------------------------------------------------------------------
// Throughput smoke test (1000 jobs)
// ---------------------------------------------------------------------------
describe("throughput", () => {
    it("enqueues and completes 1000 jobs without error", async () => {
        for (let i = 0; i < 1000; i++) {
            enqueue({ type: "deposit", walletAddress: `GA${i}`, amount: `${i + 1}` });
        }
        for (let i = 0; i < 1000; i++)
            await tick();
        expect(queueMetrics().completed).toBe(1000);
        expect(queueMetrics().dead).toBe(0);
    });
});

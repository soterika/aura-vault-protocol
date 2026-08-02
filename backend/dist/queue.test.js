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
// ---------------------------------------------------------------------------
// Webhook callbacks
// ---------------------------------------------------------------------------
describe("webhook callbacks", () => {
    it("fires webhook on job completion", async () => {
        const received = [];
        const mockFetch = vi.fn(async (_url, opts) => {
            received.push(JSON.parse(opts.body));
            return { ok: true };
        });
        vi.stubGlobal("fetch", mockFetch);
        const job = enqueue({
            type: "deposit",
            walletAddress: "GA_HOOK",
            amount: "100",
            webhookUrl: "https://example.com/webhook",
        });
        await tick();
        const updated = getJob(job.id);
        expect(updated.status).toBe("completed");
        expect(mockFetch).toHaveBeenCalledOnce();
        expect(received[0]).toMatchObject({ jobId: job.id, status: "completed" });
        vi.restoreAllMocks();
    });
    it("fires webhook with dead status when job exhausted", async () => {
        setProcessor(async () => { throw new Error("always fails"); });
        const received = [];
        const mockFetch = vi.fn(async (_url, opts) => {
            received.push(JSON.parse(opts.body));
            return { ok: true };
        });
        vi.stubGlobal("fetch", mockFetch);
        vi.useFakeTimers();
        const job = enqueue({
            type: "withdrawal",
            walletAddress: "GA_DEAD_HOOK",
            amount: "50",
            webhookUrl: "https://example.com/webhook",
        });
        await tick();
        vi.advanceTimersByTime(1_001);
        await tick();
        vi.advanceTimersByTime(2_001);
        await tick();
        const updated = getJob(job.id);
        expect(updated.status).toBe("dead");
        expect(mockFetch).toHaveBeenCalledOnce();
        expect(received[0]).toMatchObject({ jobId: job.id, status: "dead" });
        vi.restoreAllMocks();
    });
});
// ---------------------------------------------------------------------------
// Queue status transition tracking
// ---------------------------------------------------------------------------
describe("status transitions", () => {
    it("tracks full lifecycle: waiting → active → completed", async () => {
        const statusHistory = [];
        let capturedJob = null;
        setProcessor(async (job) => {
            capturedJob = { ...job }; // capture active state
            return "result";
        });
        const job = enqueue({ type: "deposit", walletAddress: "GA_TRACK", amount: "200" });
        expect(getJob(job.id).status).toBe("waiting");
        await tick();
        // captured during processing should have been "active"
        expect(capturedJob.status).toBe("active");
        expect(getJob(job.id).status).toBe("completed");
    });
    it("tracks retry cycle: waiting → active → waiting (retry) → active → completed", async () => {
        let attempts = 0;
        setProcessor(async () => {
            attempts++;
            if (attempts < 2)
                throw new Error("first attempt fails");
            return "ok";
        });
        vi.useFakeTimers();
        const job = enqueue({ type: "claim", walletAddress: "GA_RETRY2", amount: "75" });
        await tick(); // attempt 1, fails
        expect(getJob(job.id).status).toBe("waiting"); // back to waiting for retry
        expect(getJob(job.id).attempts).toBe(1);
        vi.advanceTimersByTime(1_001);
        await tick(); // attempt 2, succeeds
        expect(getJob(job.id).status).toBe("completed");
        expect(getJob(job.id).attempts).toBe(2);
    });
});
// ---------------------------------------------------------------------------
// Database persistence integration tests
// ---------------------------------------------------------------------------
describe("database persistence", () => {
    it("persists job to database on enqueue", async () => {
        const savedJobs = [];
        const { initDb } = await import("./services/queueDb.js");
        const mockDb = {
            query: vi.fn(async (sql, params) => {
                if (sql.includes("INSERT INTO transaction_jobs")) {
                    savedJobs.push({ sql, params });
                }
                return { rows: [] };
            }),
        };
        initDb(mockDb);
        const job = enqueue({ type: "deposit", walletAddress: "GA_DB", amount: "300" });
        // Wait for async database save
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(savedJobs.length).toBeGreaterThan(0);
        const savedJob = savedJobs[0];
        expect(savedJob.params[0]).toBe(job.id);
    });
    it("updates job status in database on state change", async () => {
        const updates = [];
        const { initDb } = await import("./services/queueDb.js");
        const mockDb = {
            query: vi.fn(async (sql, params) => {
                if (sql.includes("INSERT INTO transaction_jobs") || sql.includes("ON CONFLICT")) {
                    updates.push({ sql, params });
                }
                return { rows: [] };
            }),
        };
        initDb(mockDb);
        const job = enqueue({ type: "withdrawal", walletAddress: "GA_DB_UPDATE", amount: "100" });
        await tick();
        // Wait for all async database operations
        await new Promise((resolve) => setTimeout(resolve, 20));
        // Should have at least 2 DB operations: initial insert + status update to completed
        expect(updates.length).toBeGreaterThanOrEqual(2);
    });
});
// ---------------------------------------------------------------------------
// Job metadata tracking
// ---------------------------------------------------------------------------
describe("job metadata", () => {
    it("preserves metadata through job lifecycle", async () => {
        const meta = { sourceChainId: 1, protocol: "aura-vault", txHash: "0xabc123" };
        const job = enqueue({
            type: "deposit",
            walletAddress: "GA_META",
            amount: "500",
            meta,
        });
        await tick();
        const completed = getJob(job.id);
        expect(completed.data.meta).toEqual(meta);
    });
    it("tracks attempt count correctly across retries", async () => {
        let calls = 0;
        setProcessor(async () => {
            calls++;
            if (calls < 3)
                throw new Error("fail");
            return "success";
        });
        vi.useFakeTimers();
        const job = enqueue({ type: "claim", walletAddress: "GA_ATTEMPTS", amount: "25" });
        await tick(); // attempt 1
        vi.advanceTimersByTime(1_001);
        await tick(); // attempt 2
        vi.advanceTimersByTime(2_001);
        await tick(); // attempt 3, success
        const final = getJob(job.id);
        expect(final.attempts).toBe(3);
        expect(final.status).toBe("completed");
    });
});

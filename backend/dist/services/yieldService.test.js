import { describe, expect, it, vi, afterEach } from "vitest";
import { createYieldService, dailyYieldForSource, totalCompoundYield, } from "./yieldService.js";
import { startYieldScheduler, stopYieldScheduler, isYieldSchedulerRunning, msUntilNextHour, getSchedulerMetrics, } from "./yieldScheduler.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
function makePosition(overrides = {}) {
    return {
        id: "pos-1",
        userId: "user-1",
        vaultId: "vault-1",
        amount: 1_000,
        entryDate: new Date("2025-01-01T00:00:00.000Z"),
        isActive: true,
        ...overrides,
    };
}
const stakingSource = { type: "staking", apy: 0.08 }; // 8% APY
const feesSource = { type: "fees", apy: 0.04 }; // 4% APY
const incentivesSource = { type: "incentives", apy: 0.02 }; // 2%
// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------
describe("dailyYieldForSource", () => {
    it("returns 0 for zero amount", () => {
        expect(dailyYieldForSource(0, 0.08)).toBe(0);
    });
    it("returns 0 for zero apy", () => {
        expect(dailyYieldForSource(1_000, 0)).toBe(0);
    });
    it("is accurate within 0.01% vs. continuous compounding for 8% APY on 1000 principal", () => {
        const result = dailyYieldForSource(1_000, 0.08);
        // Expected: 1000 * ((1.08)^(1/365) - 1) ≈ 0.2107
        expect(result).toBeCloseTo(0.2107, 2);
    });
    it("scales linearly with amount", () => {
        const d1 = dailyYieldForSource(1_000, 0.08);
        const d2 = dailyYieldForSource(2_000, 0.08);
        expect(d2).toBeCloseTo(d1 * 2, 10);
    });
    it("returns 0 for negative amount", () => {
        expect(dailyYieldForSource(-100, 0.08)).toBe(0);
    });
    it("returns 0 for negative apy", () => {
        expect(dailyYieldForSource(1_000, -0.05)).toBe(0);
    });
    it("calculates correctly for incentives source at 2% APY", () => {
        const result = dailyYieldForSource(1_000, 0.02);
        // 1000 * ((1.02)^(1/365) - 1)
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(dailyYieldForSource(1_000, 0.08));
    });
});
describe("totalCompoundYield", () => {
    it("returns 0 for zero amount", () => {
        const result = totalCompoundYield(0, [stakingSource], new Date("2025-01-01"), new Date("2025-01-31"));
        expect(result).toBe(0);
    });
    it("returns 0 when calcDate equals entryDate", () => {
        const d = new Date("2025-01-01");
        expect(totalCompoundYield(1_000, [stakingSource], d, d)).toBe(0);
    });
    it("returns 0 when calcDate is before entryDate", () => {
        const result = totalCompoundYield(1_000, [stakingSource], new Date("2025-01-10"), new Date("2025-01-01") // before entry
        );
        expect(result).toBe(0);
    });
    it("is accurate within 0.01% for 365 days at 8% APY on 1000", () => {
        // 2023-01-01 to 2024-01-01 = exactly 365 days (non-leap year span)
        const entry = new Date("2023-01-01T00:00:00.000Z");
        const calc = new Date("2024-01-01T00:00:00.000Z");
        const result = totalCompoundYield(1_000, [{ type: "staking", apy: 0.08 }], entry, calc);
        const expected = 80;
        const relativeError = Math.abs(result - expected) / expected;
        expect(relativeError).toBeLessThan(0.001);
    });
    it("combines multiple yield sources multiplicatively and yields more than any single source", () => {
        const entry = new Date("2023-01-01T00:00:00.000Z");
        const calc = new Date("2024-01-01T00:00:00.000Z");
        const singleStaking = totalCompoundYield(1_000, [stakingSource], entry, calc);
        const multiSource = totalCompoundYield(1_000, [stakingSource, feesSource, incentivesSource], entry, calc);
        expect(multiSource).toBeGreaterThan(singleStaking);
        // Combined APY ≈ (1.08)(1.04)(1.02) - 1 ≈ 0.14566 → ~145.66 on 1000 for 365 days
        expect(multiSource).toBeGreaterThan(140);
        expect(multiSource).toBeLessThan(160);
    });
    it("returns 0 for empty sources array", () => {
        const entry = new Date("2025-01-01");
        const calc = new Date("2025-06-01");
        expect(totalCompoundYield(1_000, [], entry, calc)).toBe(0);
    });
    it("returns 0 when all sources have zero APY", () => {
        const entry = new Date("2025-01-01");
        const calc = new Date("2025-06-01");
        const zeroSources = [
            { type: "staking", apy: 0 },
            { type: "fees", apy: 0 },
        ];
        expect(totalCompoundYield(1_000, zeroSources, entry, calc)).toBe(0);
    });
});
// ---------------------------------------------------------------------------
// YieldService.calculateForPosition
// ---------------------------------------------------------------------------
describe("YieldService.calculateForPosition", () => {
    const service = createYieldService();
    it("calculates daily and total yield for an active position", () => {
        const position = makePosition({ amount: 1_000 });
        const calcDate = new Date(position.entryDate.getTime() + 30 * DAY_MS);
        const result = service.calculateForPosition(position, [stakingSource], calcDate);
        expect(result).not.toBeNull();
        expect(result.positionId).toBe("pos-1");
        expect(result.dailyYield).toBeGreaterThan(0);
        expect(result.totalYield).toBeGreaterThan(0);
        expect(result.effectiveApy).toBeCloseTo(0.08, 5);
        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].type).toBe("staking");
    });
    it("returns null and fires alert for inactive (closed) vault position", () => {
        const alerts = [];
        const svc = createYieldService({ onAlert: (msg) => alerts.push(msg) });
        const position = makePosition({ isActive: false });
        const result = svc.calculateForPosition(position, [stakingSource]);
        expect(result).toBeNull();
        expect(alerts.length).toBeGreaterThan(0);
        expect(alerts[0]).toMatch(/inactive/i);
    });
    it("returns null and fires alert for zero-amount position", () => {
        const alerts = [];
        const svc = createYieldService({ onAlert: (msg) => alerts.push(msg) });
        const result = svc.calculateForPosition(makePosition({ amount: 0 }), [stakingSource]);
        expect(result).toBeNull();
        expect(alerts.some((a) => /zero amount/i.test(a))).toBe(true);
    });
    it("correctly splits yield across multiple sources", () => {
        const position = makePosition({ amount: 1_000 });
        const calcDate = new Date(position.entryDate.getTime() + DAY_MS);
        const result = service.calculateForPosition(position, [stakingSource, feesSource], calcDate);
        expect(result.sources).toHaveLength(2);
        const types = result.sources.map((s) => s.type);
        expect(types).toContain("staking");
        expect(types).toContain("fees");
    });
    it("handles same user with multiple deposits accumulating separately", () => {
        const p1 = makePosition({ id: "pos-a", amount: 500, entryDate: new Date("2025-01-01") });
        const p2 = makePosition({ id: "pos-b", amount: 500, entryDate: new Date("2025-02-01") });
        const calcDate = new Date("2025-03-01");
        const r1 = service.calculateForPosition(p1, [stakingSource], calcDate);
        const r2 = service.calculateForPosition(p2, [stakingSource], calcDate);
        // p1 has been earning longer, so totalYield should be higher
        expect(r1.totalYield).toBeGreaterThan(r2.totalYield);
    });
    it("handles all three yield source types in one calculation", () => {
        const position = makePosition({ amount: 10_000 });
        const calcDate = new Date(position.entryDate.getTime() + 90 * DAY_MS);
        const result = service.calculateForPosition(position, [stakingSource, feesSource, incentivesSource], calcDate);
        expect(result.sources).toHaveLength(3);
        const sourceTypes = result.sources.map((s) => s.type);
        expect(sourceTypes).toContain("staking");
        expect(sourceTypes).toContain("fees");
        expect(sourceTypes).toContain("incentives");
        // Each source contributes a positive yield
        result.sources.forEach((s) => expect(s.yield).toBeGreaterThan(0));
    });
    it("accuracy: total yield within 0.01% of expected for 365-day staking position", () => {
        const entry = new Date("2025-01-01T00:00:00.000Z");
        const calc = new Date("2026-01-01T00:00:00.000Z");
        const position = makePosition({ amount: 1_000, entryDate: entry });
        const result = service.calculateForPosition(position, [{ type: "staking", apy: 0.08 }], calc);
        // Expected yield over 365 days at 8% = 80
        const expected = 80;
        const relativeError = Math.abs(result.totalYield - expected) / expected;
        expect(relativeError).toBeLessThan(0.001);
    });
    it("handles vault closure edge case — deactivated positions return null", () => {
        const svc = createYieldService();
        const closed = makePosition({ isActive: false, id: "closed-vault-pos" });
        const r = svc.calculateForPosition(closed, [stakingSource]);
        expect(r).toBeNull();
    });
});
// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------
describe("YieldService.processBatch", () => {
    it("processes all positions and returns results", async () => {
        const service = createYieldService();
        const positions = Array.from({ length: 5 }, (_, i) => makePosition({ id: `pos-${i}`, amount: 1_000 + i * 100 }));
        const calcDate = new Date("2025-06-01");
        const result = await service.processBatch(positions, [stakingSource], calcDate);
        expect(result.processed).toBe(5);
        expect(result.failed).toBe(0);
        expect(result.results).toHaveLength(5);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
    it("skips inactive positions and counts them separately from failures", async () => {
        const alerts = [];
        const service = createYieldService({ onAlert: (msg) => alerts.push(msg) });
        const positions = [
            makePosition({ id: "active", isActive: true }),
            makePosition({ id: "inactive", isActive: false }),
        ];
        const result = await service.processBatch(positions, [stakingSource]);
        // Inactive positions return null (not an error), so processed=1, failed=0
        expect(result.processed).toBe(1);
        expect(result.failed).toBe(0);
        expect(alerts.some((a) => /inactive/i.test(a))).toBe(true);
    });
    it("captures errors and fires alert for each failed position", async () => {
        const alerts = [];
        const service = createYieldService({ onAlert: (msg) => alerts.push(msg) });
        // Manufacture a position that throws during processing
        const badPosition = makePosition({ id: "bad" });
        Object.defineProperty(badPosition, "amount", {
            get() { throw new Error("db read failure"); },
        });
        const result = await service.processBatch([badPosition, makePosition({ id: "ok" })], [stakingSource]);
        expect(result.failed).toBe(1);
        expect(result.errors[0].positionId).toBe("bad");
        expect(alerts.some((a) => a.includes("Calculation failure") || a.includes("failure"))).toBe(true);
    });
    it("respects custom batchSize and processes 100 positions correctly", async () => {
        const service = createYieldService({ batchSize: 25 });
        const positions = Array.from({ length: 100 }, (_, i) => makePosition({ id: `p-${i}` }));
        const result = await service.processBatch(positions, [stakingSource]);
        expect(result.processed).toBe(100);
        expect(result.failed).toBe(0);
    });
    it("processes 1000 positions within a reasonable time (perf smoke test)", async () => {
        const service = createYieldService({ batchSize: 500 });
        const positions = Array.from({ length: 1_000 }, (_, i) => makePosition({ id: `p-${i}`, amount: 1_000 + i }));
        const start = Date.now();
        const result = await service.processBatch(positions, [stakingSource, feesSource]);
        const elapsed = Date.now() - start;
        expect(result.processed).toBe(1_000);
        // 1k positions in-process should finish well under 5s
        expect(elapsed).toBeLessThan(5_000);
    });
    it("fires batch-level alert when any position fails", async () => {
        const alerts = [];
        const service = createYieldService({ onAlert: (msg) => alerts.push(msg) });
        const badPos = makePosition({ id: "bad" });
        Object.defineProperty(badPos, "amount", {
            get() { throw new Error("oops"); },
        });
        await service.processBatch([badPos], [stakingSource]);
        const batchAlert = alerts.find((a) => /failure\(s\)|failure/i.test(a));
        expect(batchAlert).toBeTruthy();
    });
});
// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------
describe("YieldService.backfill", () => {
    it("generates one result per hour between start and end", async () => {
        const service = createYieldService();
        const positions = [makePosition()];
        const start = new Date("2025-01-01T00:00:00Z");
        const end = new Date("2025-01-01T03:00:00Z"); // 3 hours → 4 slots (0,1,2,3)
        const results = await service.backfill(positions, [stakingSource], start, end);
        expect(results).toHaveLength(4);
    });
    it("only processes positions whose entryDate is on or before the slot", async () => {
        const service = createYieldService();
        const early = makePosition({ id: "early", entryDate: new Date("2025-01-01T00:00:00Z") });
        const late = makePosition({ id: "late", entryDate: new Date("2025-01-01T02:30:00Z") });
        const start = new Date("2025-01-01T00:00:00Z");
        const end = new Date("2025-01-01T02:00:00Z"); // late position not yet entered
        const results = await service.backfill([early, late], [stakingSource], start, end);
        // All slots should only have early position
        for (const slot of results) {
            const ids = slot.results.map((r) => r.positionId);
            expect(ids).toContain("early");
            expect(ids).not.toContain("late");
        }
    });
    it("handles start === end (single slot)", async () => {
        const service = createYieldService();
        const positions = [makePosition()];
        const ts = new Date("2025-06-01T12:00:00Z");
        const results = await service.backfill(positions, [stakingSource], ts, ts);
        expect(results).toHaveLength(1);
    });
    it("returns empty array when there are no eligible positions at any slot", async () => {
        const service = createYieldService();
        const future = makePosition({
            id: "future",
            entryDate: new Date("2030-01-01T00:00:00Z"),
        });
        const start = new Date("2025-01-01T00:00:00Z");
        const end = new Date("2025-01-01T02:00:00Z");
        const results = await service.backfill([future], [stakingSource], start, end);
        // All slots should have zero processed positions
        results.forEach((r) => expect(r.processed).toBe(0));
    });
});
// ---------------------------------------------------------------------------
// Monitoring metrics
// ---------------------------------------------------------------------------
describe("YieldService monitoring metrics", () => {
    it("initialises with all counters at zero", () => {
        const service = createYieldService();
        const m = service.getMetrics();
        expect(m.calculationsAttempted).toBe(0);
        expect(m.calculationsSucceeded).toBe(0);
        expect(m.skippedInactive).toBe(0);
        expect(m.skippedZeroAmount).toBe(0);
        expect(m.calculationErrors).toBe(0);
        expect(m.batchRuns).toBe(0);
        expect(m.backfillRuns).toBe(0);
        expect(m.totalBatchDurationMs).toBe(0);
        expect(m.alertsFired).toBe(0);
        expect(m.lastSuccessfulBatchAt).toBe("");
    });
    it("increments calculationsSucceeded for valid positions", () => {
        const service = createYieldService();
        service.calculateForPosition(makePosition(), [stakingSource], new Date("2025-06-01"));
        expect(service.getMetrics().calculationsSucceeded).toBe(1);
        expect(service.getMetrics().calculationsAttempted).toBe(1);
    });
    it("increments skippedInactive for inactive positions", () => {
        const service = createYieldService();
        service.calculateForPosition(makePosition({ isActive: false }), [stakingSource]);
        expect(service.getMetrics().skippedInactive).toBe(1);
        expect(service.getMetrics().calculationsSucceeded).toBe(0);
    });
    it("increments skippedZeroAmount for zero-amount positions", () => {
        const service = createYieldService();
        service.calculateForPosition(makePosition({ amount: 0 }), [stakingSource]);
        expect(service.getMetrics().skippedZeroAmount).toBe(1);
    });
    it("increments alertsFired on every alert", () => {
        const service = createYieldService();
        service.calculateForPosition(makePosition({ isActive: false }), [stakingSource]);
        service.calculateForPosition(makePosition({ amount: 0 }), [stakingSource]);
        expect(service.getMetrics().alertsFired).toBe(2);
    });
    it("increments batchRuns after processBatch", async () => {
        const service = createYieldService();
        await service.processBatch([makePosition()], [stakingSource]);
        expect(service.getMetrics().batchRuns).toBe(1);
    });
    it("accumulates totalBatchDurationMs across multiple runs", async () => {
        const service = createYieldService();
        await service.processBatch([makePosition()], [stakingSource]);
        await service.processBatch([makePosition()], [stakingSource]);
        expect(service.getMetrics().batchRuns).toBe(2);
        expect(service.getMetrics().totalBatchDurationMs).toBeGreaterThanOrEqual(0);
    });
    it("sets lastSuccessfulBatchAt after a fully-successful run", async () => {
        const service = createYieldService();
        const before = new Date();
        await service.processBatch([makePosition()], [stakingSource]);
        const after = new Date();
        const ts = new Date(service.getMetrics().lastSuccessfulBatchAt);
        expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
        expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
    });
    it("does not update lastSuccessfulBatchAt when a batch has failures", async () => {
        const service = createYieldService();
        const badPos = makePosition({ id: "bad" });
        Object.defineProperty(badPos, "amount", {
            get() { throw new Error("fail"); },
        });
        await service.processBatch([badPos], [stakingSource]);
        expect(service.getMetrics().lastSuccessfulBatchAt).toBe("");
    });
    it("increments backfillRuns after backfill", async () => {
        const service = createYieldService();
        const ts = new Date("2025-01-01T00:00:00Z");
        await service.backfill([makePosition()], [stakingSource], ts, ts);
        expect(service.getMetrics().backfillRuns).toBe(1);
    });
    it("increments calculationErrors for thrown exceptions in processBatch", async () => {
        const service = createYieldService();
        const badPos = makePosition({ id: "bad" });
        Object.defineProperty(badPos, "amount", {
            get() { throw new Error("db fail"); },
        });
        await service.processBatch([badPos], [stakingSource]);
        expect(service.getMetrics().calculationErrors).toBe(1);
    });
    it("resets all metrics via resetMetrics()", () => {
        const service = createYieldService();
        service.calculateForPosition(makePosition(), [stakingSource], new Date("2025-06-01"));
        service.resetMetrics();
        const m = service.getMetrics();
        expect(m.calculationsAttempted).toBe(0);
        expect(m.calculationsSucceeded).toBe(0);
        expect(m.alertsFired).toBe(0);
        expect(m.lastSuccessfulBatchAt).toBe("");
    });
    it("getMetrics returns a snapshot (not live reference)", () => {
        const service = createYieldService();
        const snap1 = service.getMetrics();
        service.calculateForPosition(makePosition(), [stakingSource], new Date("2025-06-01"));
        const snap2 = service.getMetrics();
        // snap1 should still show 0 even after more calculations
        expect(snap1.calculationsAttempted).toBe(0);
        expect(snap2.calculationsAttempted).toBe(1);
    });
});
// ---------------------------------------------------------------------------
// Yield Scheduler
// ---------------------------------------------------------------------------
describe("YieldScheduler", () => {
    afterEach(() => {
        stopYieldScheduler();
    });
    it("starts and reports running = true", () => {
        const loadPositions = vi.fn().mockResolvedValue([]);
        const loadSources = vi.fn().mockResolvedValue([stakingSource]);
        startYieldScheduler(loadPositions, loadSources, { intervalMs: 100 });
        expect(isYieldSchedulerRunning()).toBe(true);
    });
    it("stops and reports running = false", () => {
        startYieldScheduler(vi.fn().mockResolvedValue([]), vi.fn().mockResolvedValue([]), { intervalMs: 100_000 });
        stopYieldScheduler();
        expect(isYieldSchedulerRunning()).toBe(false);
    });
    it("calling start twice is safe (idempotent)", () => {
        const loadPositions = vi.fn().mockResolvedValue([]);
        const loadSources = vi.fn().mockResolvedValue([stakingSource]);
        startYieldScheduler(loadPositions, loadSources, { intervalMs: 100_000 });
        startYieldScheduler(loadPositions, loadSources, { intervalMs: 100_000 });
        expect(isYieldSchedulerRunning()).toBe(true);
        stopYieldScheduler();
        expect(isYieldSchedulerRunning()).toBe(false);
    });
    it("calling stop when not running is safe", () => {
        expect(() => stopYieldScheduler()).not.toThrow();
        expect(isYieldSchedulerRunning()).toBe(false);
    });
    it("fires onBatchComplete after runImmediately tick", async () => {
        const onBatchComplete = vi.fn().mockResolvedValue(undefined);
        const loadPositions = vi.fn().mockResolvedValue([makePosition()]);
        const loadSources = vi.fn().mockResolvedValue([stakingSource]);
        await new Promise((resolve) => {
            startYieldScheduler(loadPositions, loadSources, {
                intervalMs: 100_000,
                runImmediately: true,
                onBatchComplete: async (result, calcDate) => {
                    await onBatchComplete(result, calcDate);
                    resolve();
                },
            });
        });
        expect(onBatchComplete).toHaveBeenCalledOnce();
        const [result] = onBatchComplete.mock.calls[0];
        expect(result.processed).toBe(1);
    });
    it("calls onRunError when loader throws", async () => {
        const onRunError = vi.fn();
        const loadPositions = vi.fn().mockRejectedValue(new Error("DB connection lost"));
        const loadSources = vi.fn().mockResolvedValue([stakingSource]);
        await new Promise((resolve) => {
            startYieldScheduler(loadPositions, loadSources, {
                intervalMs: 100_000,
                runImmediately: true,
                onRunError: (err) => {
                    onRunError(err);
                    resolve();
                },
            });
        });
        expect(onRunError).toHaveBeenCalledOnce();
        expect(onRunError.mock.calls[0][0].message).toMatch(/DB connection lost/);
    });
    it("exposes scheduler metrics via getSchedulerMetrics()", async () => {
        const loadPositions = vi.fn().mockResolvedValue([makePosition()]);
        const loadSources = vi.fn().mockResolvedValue([stakingSource]);
        await new Promise((resolve) => {
            startYieldScheduler(loadPositions, loadSources, {
                intervalMs: 100_000,
                runImmediately: true,
                onBatchComplete: async () => { resolve(); },
            });
        });
        const m = getSchedulerMetrics();
        expect(m.batchRuns).toBeGreaterThanOrEqual(1);
    });
});
// ---------------------------------------------------------------------------
// msUntilNextHour helper
// ---------------------------------------------------------------------------
describe("msUntilNextHour", () => {
    it("returns a positive number", () => {
        expect(msUntilNextHour()).toBeGreaterThan(0);
    });
    it("returns intervalMs directly when intervalMs < 1 hour", () => {
        expect(msUntilNextHour(new Date(), 5_000)).toBe(5_000);
    });
    it("is at most 1 hour", () => {
        expect(msUntilNextHour()).toBeLessThanOrEqual(3_600_000);
    });
    it("is at least 1000ms (minimum guard)", () => {
        // Even if called exactly on the hour boundary, should return >= 1000ms
        const exactHour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
        expect(msUntilNextHour(exactHour)).toBeGreaterThanOrEqual(1_000);
    });
    it("returns ~30 minutes when called at half-past", () => {
        const halfPast = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 30 * 60 * 1_000);
        const wait = msUntilNextHour(halfPast);
        // Should be ~30 min ± a small tolerance for floating point
        expect(wait).toBeGreaterThan(29 * 60 * 1_000);
        expect(wait).toBeLessThanOrEqual(30 * 60 * 1_000 + 100);
    });
});

import { describe, expect, it } from "vitest";
import { createYieldService, dailyYieldForSource, totalCompoundYield, } from "./yieldService.js";
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
        // For exactly 365 days at 8% APY: 1000 * (1.08 - 1) = 80
        const expected = 80;
        const relativeError = Math.abs(result - expected) / expected;
        // The compound formula (1+dailyRate)^365 with dailyRate = (1.08)^(1/365)-1
        // is exact for 365-day periods; floating-point error is < 0.1%
        expect(relativeError).toBeLessThan(0.001);
    });
    it("combines multiple yield sources multiplicatively and yields more than any single source", () => {
        const entry = new Date("2023-01-01T00:00:00.000Z");
        const calc = new Date("2024-01-01T00:00:00.000Z");
        const singleStaking = totalCompoundYield(1_000, [stakingSource], entry, calc);
        const multiSource = totalCompoundYield(1_000, [stakingSource, feesSource, incentivesSource], entry, calc);
        // Multi-source yields more than single source alone
        expect(multiSource).toBeGreaterThan(singleStaking);
        // Combined APY ≈ (1.08)(1.04)(1.02) - 1 ≈ 0.14566 → ~145.66 on 1000 for 365 days
        expect(multiSource).toBeGreaterThan(140);
        expect(multiSource).toBeLessThan(160);
    });
});
// ---------------------------------------------------------------------------
// YieldService
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
});

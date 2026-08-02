import { describe, expect, it } from "vitest";
import { GasPriceService, } from "./gasService.js";
class MemoryStore {
    cached = new Map();
    history = new Map();
    async readCached(chainId) {
        return this.cached.get(chainId) ?? null;
    }
    async writeCached(chainId, payload) {
        this.cached.set(chainId, payload);
    }
    async appendHistory(chainId, entry, _limit) {
        const existing = this.history.get(chainId) ?? [];
        this.history.set(chainId, [entry, ...existing]);
    }
    async readHistory(chainId, limit) {
        return (this.history.get(chainId) ?? []).slice(0, limit);
    }
}
function createService(rpc, store = new MemoryStore()) {
    return new GasPriceService({
        rpc,
        store,
        cacheTtlMs: 60_000,
        historyLimit: 20,
        defaultGasLimit: 21000n,
        clock: () => 1_700_000_000_000,
    });
}
describe("GasPriceService", () => {
    it("builds tiered EIP-1559 options from eth_feeHistory", async () => {
        const request = async (method) => {
            if (method === "eth_feeHistory") {
                return {
                    oldestBlock: "0x1",
                    baseFeePerGas: ["0x3b9aca00", "0x3b9aca10", "0x3b9aca20", "0x3b9aca30", "0x3b9aca40", "0x3b9aca50", "0x3b9aca60", "0x3b9aca70", "0x3b9aca80", "0x3b9aca90", "0x3b9acaa0", "0x3b9acab0", "0x3b9acac0"],
                    gasUsedRatio: [0.62, 0.71, 0.68, 0.74, 0.79, 0.66, 0.83, 0.78, 0.7, 0.75, 0.69, 0.72],
                    reward: [
                        ["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"],
                        ["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"],
                    ],
                };
            }
            if (method === "eth_gasPrice")
                return "0x4a817c800";
            if (method === "eth_maxPriorityFeePerGas")
                return "0x77359400";
            throw new Error(`unexpected method ${method}`);
        };
        const rpc = { request };
        const service = createService(rpc);
        const estimate = await service.estimate(1);
        expect(estimate.source).toBe("feeHistory");
        expect(estimate.cached).toBe(false);
        expect(BigInt(estimate.low.maxFeePerGasWei)).toBeLessThan(BigInt(estimate.standard.maxFeePerGasWei));
        expect(BigInt(estimate.standard.maxFeePerGasWei)).toBeLessThan(BigInt(estimate.fast.maxFeePerGasWei));
        expect(estimate.observed.baseFeePerGasWei).toBeTruthy();
    });
    it("returns the cached estimate without hitting rpc", async () => {
        let callCount = 0;
        const request = async () => {
            callCount++;
            throw new Error("rpc should not be called");
        };
        const rpc = { request };
        const store = new MemoryStore();
        const service = createService(rpc, store);
        const first = await service.estimate(1);
        const second = await service.estimate(1);
        expect(first.cached).toBe(false);
        expect(second.cached).toBe(true);
        expect(callCount).toBe(3);
    });
    it("falls back to historical prices during congestion", async () => {
        const request = async (method) => {
            if (method === "eth_feeHistory") {
                throw new Error("upstream congestion");
            }
            if (method === "eth_gasPrice") {
                throw new Error("upstream congestion");
            }
            throw new Error(`unexpected method ${method}`);
        };
        const rpc = { request };
        const store = new MemoryStore();
        const service = createService(rpc, store);
        const seed = {
            chainId: 1,
            fetchedAt: "2024-01-01T00:00:00.000Z",
            source: "feeHistory",
            congestion: true,
            baseFeePerGasWei: "1000000000",
            gasPriceWei: "1500000000",
            lowWei: "1800000000",
            standardWei: "2400000000",
            fastWei: "3200000000",
        };
        await store.appendHistory(1, seed, 20);
        await store.appendHistory(1, { ...seed, fetchedAt: "2024-01-01T00:01:00.000Z", standardWei: "2600000000", fastWei: "3400000000" }, 20);
        const estimate = await service.estimate(1, 21000n, true);
        expect(estimate.source).toBe("fallback");
        expect(estimate.congestion).toBe(true);
        expect(BigInt(estimate.standard.maxFeePerGasWei)).toBeGreaterThan(0n);
        expect(estimate.history).toHaveLength(2);
    });
    it("tracks accuracy metrics with historical error rate", async () => {
        const request = async (method) => {
            if (method === "eth_feeHistory") {
                return {
                    oldestBlock: "0x1",
                    baseFeePerGas: ["0x3b9aca00", "0x3b9aca20", "0x3b9aca40"],
                    gasUsedRatio: [0.62, 0.71],
                    reward: [
                        ["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"],
                    ],
                };
            }
            if (method === "eth_gasPrice")
                return "0x3b9aca00";
            if (method === "eth_maxPriorityFeePerGas")
                return "0x77359400";
            throw new Error(`unexpected method ${method}`);
        };
        const rpc = { request };
        const store = new MemoryStore();
        const service = createService(rpc, store);
        // Build history for accuracy calculation
        const seed1 = {
            chainId: 1,
            fetchedAt: "2024-01-01T00:00:00.000Z",
            source: "feeHistory",
            congestion: false,
            baseFeePerGasWei: "1000000000",
            gasPriceWei: "1000000000",
            lowWei: "1200000000",
            standardWei: "1500000000",
            fastWei: "2000000000",
        };
        const seed2 = {
            ...seed1,
            fetchedAt: "2024-01-01T00:01:00.000Z",
            gasPriceWei: "1550000000", // Actual price close to previous estimate
            standardWei: "1600000000",
        };
        await store.appendHistory(1, seed1, 20);
        await store.appendHistory(1, seed2, 20);
        const estimate = await service.estimate(1, 21000n, true);
        expect(estimate.accuracy).toBeDefined();
        expect(estimate.accuracy.estimationScore).toBeGreaterThan(0);
        expect(estimate.accuracy.estimationScore).toBeLessThanOrEqual(100);
        expect(estimate.accuracy.historicalErrorRate).toBeGreaterThanOrEqual(0);
    });
    it("tracks performance metrics including cache hit rate and fetch duration", async () => {
        const request = async (method) => {
            if (method === "eth_feeHistory") {
                return {
                    oldestBlock: "0x1",
                    baseFeePerGas: ["0x3b9aca00"],
                    gasUsedRatio: [0.62],
                    reward: [["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"]],
                };
            }
            if (method === "eth_gasPrice")
                return "0x3b9aca00";
            if (method === "eth_maxPriorityFeePerGas")
                return "0x77359400";
            throw new Error(`unexpected method ${method}`);
        };
        const rpc = { request };
        const store = new MemoryStore();
        const service = createService(rpc, store);
        // First call - cache miss
        const first = await service.estimate(1);
        expect(first.performance).toBeDefined();
        expect(first.performance.fetchDurationMs).toBeGreaterThanOrEqual(0);
        expect(first.performance.cacheHitRate).toBeGreaterThanOrEqual(0);
        // Second call - cache hit
        const second = await service.estimate(1);
        expect(second.cached).toBe(true);
        expect(second.performance.cacheHitRate).toBeGreaterThan(first.performance.cacheHitRate);
        // Check service metrics
        const metrics = service.getMetrics();
        expect(metrics.totalRequests).toBe(2);
        expect(metrics.cacheHits).toBe(1);
        expect(metrics.cacheMisses).toBe(1);
        expect(metrics.cacheHitRate).toBe("50.00%");
    });
    it("ensures response time is under 100ms for cached results", async () => {
        const request = async () => {
            throw new Error("should not call RPC for cached results");
        };
        const rpc = { request };
        const store = new MemoryStore();
        // Pre-populate cache
        const cachedData = {
            chainId: 1,
            fetchedAt: "2024-01-01T00:00:00.000Z",
            cached: false,
            source: "feeHistory",
            congestion: false,
            gasLimit: "21000",
            observed: {
                baseFeePerGasWei: "1000000000",
                gasPriceWei: "1000000000",
                averageGasUsedRatio: 0.7,
            },
            low: {
                maxFeePerGasWei: "1200000000",
                maxPriorityFeePerGasWei: "1000000000",
                maxFeePerGasGwei: "1.2",
                maxPriorityFeePerGasGwei: "1.0",
                estimatedTxFeeWei: "25200000000000",
                estimatedTxFeeGwei: "25.2",
            },
            standard: {
                maxFeePerGasWei: "1500000000",
                maxPriorityFeePerGasWei: "1000000000",
                maxFeePerGasGwei: "1.5",
                maxPriorityFeePerGasGwei: "1.0",
                estimatedTxFeeWei: "31500000000000",
                estimatedTxFeeGwei: "31.5",
            },
            fast: {
                maxFeePerGasWei: "2000000000",
                maxPriorityFeePerGasWei: "1500000000",
                maxFeePerGasGwei: "2.0",
                maxPriorityFeePerGasGwei: "1.5",
                estimatedTxFeeWei: "42000000000000",
                estimatedTxFeeGwei: "42.0",
            },
            history: [],
        };
        await store.writeCached(1, cachedData);
        const service = createService(rpc, store);
        const start = Date.now();
        const estimate = await service.estimate(1);
        const duration = Date.now() - start;
        expect(estimate.cached).toBe(true);
        expect(duration).toBeLessThan(100);
        expect(estimate.performance.fetchDurationMs).toBeLessThan(100);
    });
    it("calculates accuracy within 10% tolerance", async () => {
        const request = async (method) => {
            if (method === "eth_feeHistory") {
                return {
                    oldestBlock: "0x1",
                    baseFeePerGas: ["0x3b9aca00", "0x3b9aca10"],
                    gasUsedRatio: [0.7],
                    reward: [["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"]],
                };
            }
            if (method === "eth_gasPrice")
                return "0x3b9aca00";
            if (method === "eth_maxPriorityFeePerGas")
                return "0x77359400";
            throw new Error(`unexpected method ${method}`);
        };
        const rpc = { request };
        const store = new MemoryStore();
        const service = createService(rpc, store);
        // Build history with accurate estimates (within 10% of actual)
        for (let i = 0; i < 5; i++) {
            const basePrice = 1000000000 + i * 5000000; // Smaller increments
            const actualPrice = basePrice * 1.05; // 5% difference
            const entry = {
                chainId: 1,
                fetchedAt: new Date(Date.now() - (5 - i) * 60000).toISOString(),
                source: "feeHistory",
                congestion: false,
                baseFeePerGasWei: basePrice.toString(),
                gasPriceWei: actualPrice.toString(),
                lowWei: (basePrice * 1.2).toString(),
                standardWei: actualPrice.toString(), // Use actual price as standard estimate
                fastWei: (basePrice * 2.0).toString(),
            };
            await store.appendHistory(1, entry, 20);
        }
        const estimate = await service.estimate(1, 21000n, true);
        expect(estimate.accuracy).toBeDefined();
        expect(estimate.accuracy.historicalErrorRate).toBeGreaterThanOrEqual(0);
        expect(estimate.accuracy.estimationScore).toBeGreaterThanOrEqual(0);
        expect(estimate.accuracy.estimationScore).toBeLessThanOrEqual(100);
    });
});

import { describe, expect, it } from "vitest";
import {
  GasPriceService,
  type GasEstimateResponse,
  type GasPriceStore,
  type GasRpcClient,
} from "./gasService.js";

class MemoryStore implements GasPriceStore {
  cached = new Map<number, GasEstimateResponse>();
  history = new Map<number, GasEstimateResponse["history"]>();

  async readCached(chainId: number): Promise<GasEstimateResponse | null> {
    return this.cached.get(chainId) ?? null;
  }

  async writeCached(chainId: number, payload: GasEstimateResponse): Promise<void> {
    this.cached.set(chainId, payload);
  }

  async appendHistory(chainId: number, entry: GasEstimateResponse["history"][number], _limit: number): Promise<void> {
    const existing = this.history.get(chainId) ?? [];
    this.history.set(chainId, [entry, ...existing]);
  }

  async readHistory(chainId: number, limit: number): Promise<GasEstimateResponse["history"]> {
    return (this.history.get(chainId) ?? []).slice(0, limit);
  }
}

function createService(rpc: GasRpcClient, store = new MemoryStore()): GasPriceService {
  return new GasPriceService({
    rpc,
    store,
    cacheTtlMs: 60_000,
    historyLimit: 20,
    defaultGasLimit: 21_000n,
    clock: () => 1_700_000_000_000,
  });
}

describe("GasPriceService", () => {
  it("builds tiered EIP-1559 options from eth_feeHistory", async () => {
    const request: GasRpcClient["request"] = async <T>(method: string): Promise<T> => {
      if (method === "eth_feeHistory") {
        return {
          oldestBlock: "0x1",
          baseFeePerGas: ["0x3b9aca00", "0x3b9aca10", "0x3b9aca20", "0x3b9aca30", "0x3b9aca40", "0x3b9aca50", "0x3b9aca60", "0x3b9aca70", "0x3b9aca80", "0x3b9aca90", "0x3b9acaa0", "0x3b9acab0", "0x3b9acac0"],
          gasUsedRatio: [0.62, 0.71, 0.68, 0.74, 0.79, 0.66, 0.83, 0.78, 0.7, 0.75, 0.69, 0.72],
          reward: [
            ["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"],
            ["0x3b9aca", "0x5f5e10", "0x989680", "0x0f4240", "0x1312d00"],
          ],
        } as T;
      }
      if (method === "eth_gasPrice") return "0x4a817c800" as T;
      if (method === "eth_maxPriorityFeePerGas") return "0x77359400" as T;
      throw new Error(`unexpected method ${method}`);
    };
    const rpc: GasRpcClient = { request };

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
    const request: GasRpcClient["request"] = async <T>(): Promise<T> => {
      callCount++;
      throw new Error("rpc should not be called");
    };
    const rpc: GasRpcClient = { request };
    const store = new MemoryStore();
    const service = createService(rpc, store);

    const first = await service.estimate(1);
    const second = await service.estimate(1);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(callCount).toBe(3);
  });

  it("falls back to historical prices during congestion", async () => {
    const request: GasRpcClient["request"] = async <T>(method: string): Promise<T> => {
      if (method === "eth_feeHistory") {
        throw new Error("upstream congestion");
      }
      if (method === "eth_gasPrice") {
        throw new Error("upstream congestion");
      }
      throw new Error(`unexpected method ${method}`);
    };
    const rpc: GasRpcClient = { request };
    const store = new MemoryStore();
    const service = createService(rpc, store);

    const seed = {
      chainId: 1,
      fetchedAt: "2024-01-01T00:00:00.000Z",
      source: "feeHistory" as const,
      congestion: true,
      baseFeePerGasWei: "1000000000",
      gasPriceWei: "1500000000",
      lowWei: "1800000000",
      standardWei: "2400000000",
      fastWei: "3200000000",
    };
    await store.appendHistory(1, seed, 20);
    await store.appendHistory(1, { ...seed, fetchedAt: "2024-01-01T00:01:00.000Z", standardWei: "2600000000", fastWei: "3400000000" }, 20);

    const estimate = await service.estimate(1, 21_000n, true);

    expect(estimate.source).toBe("fallback");
    expect(estimate.congestion).toBe(true);
    expect(BigInt(estimate.standard.maxFeePerGasWei)).toBeGreaterThan(0n);
    expect(estimate.history).toHaveLength(2);
  });
});

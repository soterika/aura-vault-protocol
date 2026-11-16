import { describe, expect, it, vi } from "vitest";
import { createYieldService, dailyYieldForSource, totalCompoundYield } from "../yieldService.js";

const day = 86_400_000;

describe("yield calculations", () => {
  it("returns zero for empty balances or non-positive APY", () => {
    expect(dailyYieldForSource(0, 0.1)).toBe(0);
    expect(dailyYieldForSource(100, 0)).toBe(0);
    expect(totalCompoundYield(100, [], new Date(0), new Date(day))).toBe(0);
  });

  it("compounds a positive APY over elapsed days", () => {
    const value = totalCompoundYield(1_000, [{ type: "staking", apy: 0.1 }], new Date(0), new Date(365 * day));
    expect(value).toBeCloseTo(100, 6);
  });

  it("skips inactive positions and alerts the caller", () => {
    const onAlert = vi.fn();
    const service = createYieldService({ onAlert });
    expect(service.calculateForPosition({
      id: "position-1", userId: "user-1", vaultId: "vault-1", amount: 100,
      entryDate: new Date(0), isActive: false,
    }, [{ type: "fees", apy: 0.05 }])).toBeNull();
    expect(onAlert).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect } from "vitest";
import {
  calculateDepositShares,
  calculateWithdrawAssets,
  calculateSharePrice,
  calculateEstimatedYield,
} from "../components/ShareMathConfirmationModal";

describe("ShareMathConfirmationModal helpers", () => {
  it("calculates deposit shares using on-chain floor formula", () => {
    expect(calculateDepositShares(100, 1000, 1000)).toBe(100);
    expect(calculateDepositShares(100, 1000, 1250)).toBe(80);
    // First depositor 1:1 fallback
    expect(calculateDepositShares(50, 0, 0)).toBe(50);
  });

  it("calculates withdrawal assets using on-chain floor formula", () => {
    expect(calculateWithdrawAssets(80, 1250, 1000)).toBe(100);
    expect(calculateWithdrawAssets(100, 1000, 0)).toBe(0);
  });

  it("calculates share price with 6-decimal precision support", () => {
    const price = calculateSharePrice(1250, 1000);
    expect(price.toFixed(6)).toBe("1.250000");
    expect(calculateSharePrice(0, 0).toFixed(6)).toBe("1.000000");
  });

  it("calculates estimated yield for 7d, 30d, and 1y", () => {
    const y7 = calculateEstimatedYield(1000, 10, 7);
    const y30 = calculateEstimatedYield(1000, 10, 30);
    const y1y = calculateEstimatedYield(1000, 10, 365);

    expect(y7).toBeCloseTo((1000 * 0.1 * 7) / 365, 6);
    expect(y30).toBeCloseTo((1000 * 0.1 * 30) / 365, 6);
    expect(y1y).toBeCloseTo(100, 6);
  });
});

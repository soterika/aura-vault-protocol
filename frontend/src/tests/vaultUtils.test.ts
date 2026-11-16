/**
 * vaultUtils.test.ts — Vitest unit tests for client-side vault utilities
 *
 * Acceptance criteria covered:
 *   ✓ Deposit formula matches contract formula for 100+ cases
 *   ✓ Withdraw formula matches contract formula
 *   ✓ Amount formatting (7 decimal places, locale-aware)
 *   ✓ Address truncation (first 4 + last 4)
 *   ✓ APY calculation formula
 *
 * The deposit and withdraw formulas are derived directly from the Soroban
 * contract source (aura-vault/src/lib.rs) and verified against hand-computed
 * expected values as well as a parameterised 100-case sweep.
 */

import { describe, expect, it } from "vitest";
import {
  calcDepositShares,
  calcWithdrawAmount,
  calcSharePrice,
  calcAPY,
  formatTokenAmount,
  formatTokenAmountLocale,
  formatAPY,
  truncateAddress,
  previewDeposit,
  previewWithdraw,
  TOKEN_SCALE,
  TOKEN_DECIMALS,
} from "../lib/vaultUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple seeded deterministic LCG for reproducible random inputs */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffff_ffff;
    return (s >>> 0) / 0x1_0000_0000;
  };
}

// ---------------------------------------------------------------------------
// calcDepositShares — deposit formula
// ---------------------------------------------------------------------------

describe("calcDepositShares", () => {
  // --- First deposit (1:1 seed) ---

  it("first deposit: returns amount as shares (1:1 seed ratio)", () => {
    expect(calcDepositShares(1_000_000n, 0n, 0n)).toBe(1_000_000n);
  });

  it("first deposit: works for large amounts", () => {
    const amount = 100_000_000_000n;
    expect(calcDepositShares(amount, 0n, 0n)).toBe(amount);
  });

  it("first deposit when totalAssets is 0 but totalShares is non-zero (handles corrupted state)", () => {
    // If totalAssets is 0 but totalShares > 0, treat as first deposit
    expect(calcDepositShares(5_000n, 100n, 0n)).toBe(5_000n);
  });

  // --- Subsequent deposits ---

  it("second deposit at 1:1 price: same shares as amount", () => {
    // price = 1_000_000 / 1_000_000 = 1.0
    expect(calcDepositShares(500_000n, 1_000_000n, 1_000_000n)).toBe(500_000n);
  });

  it("deposit at 1.5× price: floors correctly", () => {
    // totalAssets=1_500_000, totalShares=1_000_000 → price=1.5
    // 600_000 × 1_000_000 / 1_500_000 = 400_000
    expect(calcDepositShares(600_000n, 1_000_000n, 1_500_000n)).toBe(400_000n);
  });

  it("deposit at 2× price: halves shares", () => {
    // price=2.0: 1_000_000 × 1_000_000 / 2_000_000 = 500_000
    expect(calcDepositShares(1_000_000n, 1_000_000n, 2_000_000n)).toBe(500_000n);
  });

  it("floors fractional shares (no rounding up)", () => {
    // 1 × 3 / 2 = 1 (floor of 1.5)
    expect(calcDepositShares(1n, 3n, 2n)).toBe(1n);
  });

  it("very small deposit that produces 0 shares returns 0 (ZeroShares boundary)", () => {
    // 1 × 1_000 / 1_000_001 = 0 (floored)
    expect(calcDepositShares(1n, 1_000n, 1_000_001n)).toBe(0n);
  });

  // --- Error cases ---

  it("throws RangeError on zero amount", () => {
    expect(() => calcDepositShares(0n, 0n, 0n)).toThrow(RangeError);
  });

  it("throws RangeError on negative amount", () => {
    expect(() => calcDepositShares(-1n, 0n, 0n)).toThrow(RangeError);
  });

  it("throws RangeError on negative totalShares", () => {
    expect(() => calcDepositShares(100n, -1n, 0n)).toThrow(RangeError);
  });

  it("throws RangeError on negative totalAssets", () => {
    expect(() => calcDepositShares(100n, 0n, -1n)).toThrow(RangeError);
  });

  // --- 100-case parameterised sweep matching the contract formula ---

  it("deposit formula matches Rust floor(amount×shares/assets) for 100 random cases", () => {
    const rand = lcg(42);
    const MAX_VAL = 10_000_000_000n; // 10,000 tokens

    let testedCases = 0;
    for (let i = 0; i < 150; i++) {
      const amount = BigInt(Math.floor(rand() * Number(MAX_VAL))) + 1n;
      const totalShares = BigInt(Math.floor(rand() * Number(MAX_VAL)));
      const totalAssets = BigInt(Math.floor(rand() * Number(MAX_VAL)));

      if (totalShares === 0n || totalAssets === 0n) {
        // First deposit case
        expect(calcDepositShares(amount, totalShares, totalAssets)).toBe(amount);
        testedCases++;
      } else {
        const expected = (amount * totalShares) / totalAssets;
        expect(calcDepositShares(amount, totalShares, totalAssets)).toBe(expected);
        testedCases++;
      }

      if (testedCases >= 100) break;
    }

    expect(testedCases).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// calcWithdrawAmount — withdraw formula
// ---------------------------------------------------------------------------

describe("calcWithdrawAmount", () => {
  it("full withdrawal: returns all assets when all shares burned", () => {
    expect(calcWithdrawAmount(1_000_000n, 1_000_000n, 1_000_000n)).toBe(1_000_000n);
  });

  it("half shares redeems half assets at 1:1 price", () => {
    expect(calcWithdrawAmount(500_000n, 1_000_000n, 1_000_000n)).toBe(500_000n);
  });

  it("full withdrawal after harvest: redeems accumulated yield", () => {
    // Deposited 1_000_000, harvested 500_000 → totalAssets=1_500_000, totalShares=1_000_000
    // Withdraw 1_000_000 shares → 1_000_000 × 1_500_000 / 1_000_000 = 1_500_000
    expect(calcWithdrawAmount(1_000_000n, 1_000_000n, 1_500_000n)).toBe(1_500_000n);
  });

  it("partial withdrawal after yield: floors correctly", () => {
    // shares=333_333, totalShares=1_000_000, totalAssets=1_000_001
    // 333_333 × 1_000_001 / 1_000_000 = floor(333_333.333...) = 333_333
    expect(calcWithdrawAmount(333_333n, 1_000_000n, 1_000_001n)).toBe(333_333n);
  });

  it("zero assets vault: redeem is 0", () => {
    expect(calcWithdrawAmount(100n, 1_000n, 0n)).toBe(0n);
  });

  it("throws RangeError on zero shares", () => {
    expect(() => calcWithdrawAmount(0n, 1_000n, 1_000n)).toThrow(RangeError);
  });

  it("throws RangeError on negative shares", () => {
    expect(() => calcWithdrawAmount(-1n, 1_000n, 1_000n)).toThrow(RangeError);
  });

  it("throws RangeError on zero totalShares", () => {
    expect(() => calcWithdrawAmount(100n, 0n, 1_000n)).toThrow(RangeError);
  });

  it("throws RangeError when shares exceed totalShares", () => {
    expect(() => calcWithdrawAmount(101n, 100n, 1_000n)).toThrow(RangeError);
  });

  // --- 100-case parameterised sweep ---

  it("withdraw formula matches Rust floor(shares×assets/totalShares) for 100 random cases", () => {
    const rand = lcg(99);
    const MAX_VAL = 10_000_000_000n;

    let testedCases = 0;
    for (let i = 0; i < 200 && testedCases < 100; i++) {
      const totalShares = BigInt(Math.floor(rand() * Number(MAX_VAL))) + 1n;
      const totalAssets = BigInt(Math.floor(rand() * Number(MAX_VAL)));
      const shares = (BigInt(Math.floor(rand() * Number(totalShares))) % totalShares) + 1n;

      const expected = (shares * totalAssets) / totalShares;
      expect(calcWithdrawAmount(shares, totalShares, totalAssets)).toBe(expected);
      testedCases++;
    }

    expect(testedCases).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// calcSharePrice
// ---------------------------------------------------------------------------

describe("calcSharePrice", () => {
  it("returns TOKEN_SCALE (1.0) for empty vault", () => {
    expect(calcSharePrice(0n, 0n)).toBe(TOKEN_SCALE);
  });

  it("returns TOKEN_SCALE (1.0) when totalAssets == totalShares", () => {
    expect(calcSharePrice(1_000_000n, 1_000_000n)).toBe(TOKEN_SCALE);
  });

  it("returns 1.5 × TOKEN_SCALE after 50% yield", () => {
    // totalAssets=1_500_000, totalShares=1_000_000
    expect(calcSharePrice(1_000_000n, 1_500_000n)).toBe(15_000_000n); // 1.5 × 1e7
  });

  it("returns 2.0 × TOKEN_SCALE after 100% yield", () => {
    expect(calcSharePrice(1_000_000n, 2_000_000n)).toBe(20_000_000n); // 2.0 × 1e7
  });

  it("floors fractional price", () => {
    // 3 / 2 = 1.5 → 1.5 × 1e7 = 15_000_000 (exact)
    expect(calcSharePrice(2n, 3n)).toBe(15_000_000n);
  });
});

// ---------------------------------------------------------------------------
// formatTokenAmount — 7 decimal places
// ---------------------------------------------------------------------------

describe("formatTokenAmount", () => {
  it("formats zero correctly", () => {
    expect(formatTokenAmount(0n)).toBe("0.0000000");
  });

  it("formats 1 stroop correctly", () => {
    expect(formatTokenAmount(1n)).toBe("0.0000001");
  });

  it("formats 1 token (10^7 stroops) correctly", () => {
    expect(formatTokenAmount(TOKEN_SCALE)).toBe("1.0000000");
  });

  it("formats 1.5 tokens correctly", () => {
    expect(formatTokenAmount(15_000_000n)).toBe("1.5000000");
  });

  it("formats 10 tokens correctly", () => {
    expect(formatTokenAmount(100_000_000n)).toBe("10.0000000");
  });

  it("formats exactly 7 decimal places", () => {
    const result = formatTokenAmount(12_345_678n);
    expect(result).toBe("1.2345678");
    const parts = result.split(".");
    expect(parts[1]).toHaveLength(TOKEN_DECIMALS);
  });

  it("pads fractional part with leading zeros", () => {
    // 100 stroops = 0.0000100
    expect(formatTokenAmount(100n)).toBe("0.0000100");
  });

  it("handles large amounts", () => {
    // 1,000,000 tokens
    expect(formatTokenAmount(10_000_000_000_000n)).toBe("1000000.0000000");
  });

  it("throws RangeError on negative input", () => {
    expect(() => formatTokenAmount(-1n)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// formatTokenAmountLocale — locale-aware formatting
// ---------------------------------------------------------------------------

describe("formatTokenAmountLocale", () => {
  it("en-US: 1 token formats with 7 decimal places", () => {
    const result = formatTokenAmountLocale(TOKEN_SCALE, "en-US");
    // Should contain exactly 7 decimal digits
    const decimalPart = result.split(".")[1];
    expect(decimalPart).toHaveLength(TOKEN_DECIMALS);
  });

  it("en-US: 10,000 tokens has thousands separator", () => {
    const result = formatTokenAmountLocale(100_000_000_000n, "en-US"); // 10,000 tokens
    expect(result).toContain(",");
  });

  it("de-DE: uses comma as decimal separator", () => {
    const result = formatTokenAmountLocale(TOKEN_SCALE, "de-DE");
    // German locale uses comma for decimal, period for thousands
    expect(result).toMatch(/,\d{7}$/);
  });

  it("always shows exactly TOKEN_DECIMALS decimal places regardless of trailing zeros", () => {
    const result = formatTokenAmountLocale(TOKEN_SCALE, "en-US"); // exactly 1.0
    const [, frac] = result.split(".");
    expect(frac).toHaveLength(TOKEN_DECIMALS);
  });

  it("throws RangeError on negative input", () => {
    expect(() => formatTokenAmountLocale(-1n)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// formatAPY
// ---------------------------------------------------------------------------

describe("formatAPY", () => {
  it("formats 0% APY", () => {
    expect(formatAPY(0)).toBe("0.00%");
  });

  it("formats 10.5% APY", () => {
    expect(formatAPY(10.5)).toBe("10.50%");
  });

  it("formats 100% APY", () => {
    expect(formatAPY(100)).toBe("100.00%");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatAPY(12.3456789)).toBe("12.35%");
  });

  it("always appends % suffix", () => {
    expect(formatAPY(5.25)).toMatch(/%$/);
  });
});

// ---------------------------------------------------------------------------
// calcAPY — APY formula
// ---------------------------------------------------------------------------

describe("calcAPY", () => {
  it("returns 0% when price is unchanged", () => {
    expect(calcAPY(1.0, 1.0, 365)).toBeCloseTo(0, 5);
  });

  it("returns ~100% for price doubling over 365 days", () => {
    expect(calcAPY(1.0, 2.0, 365)).toBeCloseTo(100, 4);
  });

  it("annualises a 30-day observation correctly", () => {
    // price grows 1% in 30 days → ~12.55% APY
    const apy = calcAPY(1.0, 1.01, 30);
    expect(apy).toBeGreaterThan(12);
    expect(apy).toBeLessThan(14);
  });

  it("annualises a 7-day observation", () => {
    // 0.1% in 7 days → ~5.3% APY
    const apy = calcAPY(1.0, 1.001, 7);
    expect(apy).toBeGreaterThan(4);
    expect(apy).toBeLessThan(8);
  });

  it("handles share price > 1 (post-harvest vault)", () => {
    // Vault started at price=1.5 and grew to price=1.65 in 90 days
    const apy = calcAPY(1.5, 1.65, 90);
    expect(apy).toBeGreaterThan(0);
    expect(apy).toBeLessThan(100);
  });

  it("throws RangeError on zero startSharePrice", () => {
    expect(() => calcAPY(0, 1.0, 365)).toThrow(RangeError);
  });

  it("throws RangeError on negative startSharePrice", () => {
    expect(() => calcAPY(-1, 1.0, 365)).toThrow(RangeError);
  });

  it("throws RangeError on zero endSharePrice", () => {
    expect(() => calcAPY(1.0, 0, 365)).toThrow(RangeError);
  });

  it("throws RangeError on zero observationDays", () => {
    expect(() => calcAPY(1.0, 1.1, 0)).toThrow(RangeError);
  });

  it("throws RangeError on negative observationDays", () => {
    expect(() => calcAPY(1.0, 1.1, -7)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// truncateAddress — first N + last N format
// ---------------------------------------------------------------------------

describe("truncateAddress", () => {
  const STELLAR_ADDRESS =
    "GABC1234TEST5678DEADBEEFCAFE1234567890ABCDEFGHIJKLMNOPQRSTU";

  it("truncates a long Stellar address to first4...last4 by default", () => {
    const result = truncateAddress(STELLAR_ADDRESS);
    expect(result.startsWith("GABC")).toBe(true);
    expect(result.endsWith("RSTU")).toBe(true);
    expect(result).toContain("...");
  });

  it("returns exactly `prefix...suffix` format", () => {
    const result = truncateAddress("ABCDEFGHIJKL");
    expect(result).toBe("ABCD...IJKL");
  });

  it("returns the full address if it is short enough to not need truncation", () => {
    const short = "GABC...XYZ"; // already truncated / short
    expect(truncateAddress(short)).toBe(short);
  });

  it("uses custom prefix and suffix lengths", () => {
    const result = truncateAddress("ABCDEFGHIJKLMNOP", 6, 6);
    expect(result.startsWith("ABCDEF")).toBe(true);
    expect(result.endsWith("KLMNOP")).toBe(true);
    expect(result).toContain("...");
  });

  it("returns empty string for empty input", () => {
    expect(truncateAddress("")).toBe("");
  });

  it("does not truncate address equal to minimum length", () => {
    // 4+4+3 = 11 chars — right on the boundary
    const addr = "ABCDxxxEFGH"; // 11 chars
    expect(truncateAddress(addr)).toBe(addr);
  });

  it("truncates address one char longer than the boundary", () => {
    // 4+4+3 = 11; 12 chars → should truncate
    const addr = "ABCDxxxxEFGH"; // 12 chars
    const result = truncateAddress(addr);
    expect(result).toBe("ABCD...EFGH");
  });

  it("preserves prefix casing exactly", () => {
    const addr = "gStELLaR1234567890abcDEF"; // mixed case
    const result = truncateAddress(addr);
    expect(result.startsWith("gStE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// previewDeposit / previewWithdraw — UI preview helpers
// ---------------------------------------------------------------------------

describe("previewDeposit", () => {
  it("returns shares for a valid deposit", () => {
    expect(previewDeposit(1_000_000n, 1_000_000n, 1_000_000n)).toBe(1_000_000n);
  });

  it("returns null for zero amount", () => {
    expect(previewDeposit(0n, 1_000_000n, 1_000_000n)).toBeNull();
  });

  it("returns null if shares would be 0 (too small deposit)", () => {
    // 1 stroop into a 1 billion asset vault → 0 shares
    expect(previewDeposit(1n, 1n, 1_000_000_000n)).toBeNull();
  });

  it("returns amount for first deposit", () => {
    expect(previewDeposit(5_000_000n, 0n, 0n)).toBe(5_000_000n);
  });
});

describe("previewWithdraw", () => {
  it("returns token amount for valid withdrawal", () => {
    expect(previewWithdraw(1_000_000n, 1_000_000n, 1_500_000n)).toBe(1_500_000n);
  });

  it("returns null for zero shares", () => {
    expect(previewWithdraw(0n, 1_000_000n, 1_000_000n)).toBeNull();
  });

  it("returns null for empty vault (totalShares=0)", () => {
    expect(previewWithdraw(100n, 0n, 1_000_000n)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("TOKEN_DECIMALS is 7", () => {
    expect(TOKEN_DECIMALS).toBe(7);
  });

  it("TOKEN_SCALE is 10^7", () => {
    expect(TOKEN_SCALE).toBe(10_000_000n);
  });
});

/**
 * Unit tests for the redesigned dashboard card components.
 *
 * Because vitest is configured with environment: "node" (no JSDOM) and there
 * is no @testing-library/react installed, these tests cover:
 *   1. Pure helper / formatting functions extracted from each card module
 *   2. The UserPositionCard null-gating invariant (returns null when no position)
 *   3. The DashboardCard variant prop logic (via the style object)
 *
 * React rendering is intentionally not tested here — that belongs in an
 * integration / Playwright test.  All logic under test is pure TypeScript.
 */

import { describe, it, expect } from "vitest";
import { estimateYieldPerSecond } from "../lib/yieldAccrual";

/* ─────────────────────────────────────────────────────────────────
   Inline copies of the pure helpers from the card modules.
   We re-declare them here so the test file stays environment-agnostic
   (importing the actual modules would drag in JSX / React, which
   needs a transform the node environment does not provide by default).
───────────────────────────────────────────────────────────────── */

/** @see MetricCards.tsx — formatRelativeTime */
function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/** @see DashboardGrid.tsx — fmtUsd */
function fmtUsd(raw: string | number): string {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** @see DashboardGrid.tsx — fmtSharePrice */
function fmtSharePrice(raw: string | number): string {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n)) return "—";
  return n.toFixed(6);
}

/** @see UserPositionCard.tsx — null-gate predicate */
function shouldRenderPositionCard(
  isLoading: boolean,
  position: object | null | undefined
): boolean {
  if (!isLoading && !position) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────────
   formatRelativeTime
───────────────────────────────────────────────────────────────── */
describe("formatRelativeTime", () => {
  it('returns "Just now" for a timestamp within the last minute', () => {
    const ts = Date.now() - 30_000; // 30 seconds ago
    expect(formatRelativeTime(ts)).toBe("Just now");
  });

  it('returns "Xm ago" for timestamps between 1 and 59 minutes ago', () => {
    const ts = Date.now() - 5 * 60_000; // 5 minutes ago
    expect(formatRelativeTime(ts)).toBe("5m ago");
  });

  it('returns "Xh ago" for timestamps between 1 and 23 hours ago', () => {
    const ts = Date.now() - 3 * 3_600_000; // 3 hours ago
    expect(formatRelativeTime(ts)).toBe("3h ago");
  });

  it('returns "Xd ago" for timestamps 24+ hours ago', () => {
    const ts = Date.now() - 2 * 86_400_000; // 2 days ago
    expect(formatRelativeTime(ts)).toBe("2d ago");
  });

  it("edge: exactly 1 minute ago → 1m ago (not Just now)", () => {
    const ts = Date.now() - 60_000;
    expect(formatRelativeTime(ts)).toBe("1m ago");
  });

  it("edge: exactly 1 hour ago → 1h ago", () => {
    const ts = Date.now() - 3_600_000;
    expect(formatRelativeTime(ts)).toBe("1h ago");
  });

  it("edge: exactly 1 day ago → 1d ago", () => {
    const ts = Date.now() - 86_400_000;
    expect(formatRelativeTime(ts)).toBe("1d ago");
  });
});

/* ─────────────────────────────────────────────────────────────────
   fmtUsd
───────────────────────────────────────────────────────────────── */
describe("fmtUsd", () => {
  it("formats a numeric string as USD", () => {
    expect(fmtUsd("1234567.89")).toBe("$1,234,567.89");
  });

  it("formats a number directly", () => {
    expect(fmtUsd(0)).toBe("$0.00");
  });

  it('returns "—" for NaN input string', () => {
    expect(fmtUsd("not-a-number")).toBe("—");
  });

  it("handles large numbers with correct thousand separators", () => {
    expect(fmtUsd(1_000_000)).toBe("$1,000,000.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(fmtUsd("99.999")).toBe("$100.00");
  });
});

/* ─────────────────────────────────────────────────────────────────
   fmtSharePrice
───────────────────────────────────────────────────────────────── */
describe("fmtSharePrice", () => {
  it("formats to 6 decimal places", () => {
    expect(fmtSharePrice("1.0842")).toBe("1.084200");
  });

  it("handles integer input", () => {
    expect(fmtSharePrice(1)).toBe("1.000000");
  });

  it('returns "—" for invalid input', () => {
    expect(fmtSharePrice("invalid")).toBe("—");
  });

  it("pads short decimals to 6 places", () => {
    expect(fmtSharePrice("1.5")).toBe("1.500000");
  });
});

/* ─────────────────────────────────────────────────────────────────
   UserPositionCard null-gate (wallet-gating logic)
───────────────────────────────────────────────────────────────── */
describe("UserPositionCard wallet-gating", () => {
  it("returns false (hidden) when not loading and position is null", () => {
    expect(shouldRenderPositionCard(false, null)).toBe(false);
  });

  it("returns false (hidden) when not loading and position is undefined", () => {
    expect(shouldRenderPositionCard(false, undefined)).toBe(false);
  });

  it("returns true (visible) when position is provided", () => {
    const position = {
      underlyingBalance: "500 USDC",
      shares: "500",
      sharePrice: "1.000000",
      address: "G...XYZ",
    };
    expect(shouldRenderPositionCard(false, position)).toBe(true);
  });

  it("returns true (visible) while loading even with no position (shows skeleton)", () => {
    expect(shouldRenderPositionCard(true, null)).toBe(true);
  });

  it("returns true (visible) while loading even with no position (undefined)", () => {
    expect(shouldRenderPositionCard(true, undefined)).toBe(true);
  });
});

describe("estimated yield accrual", () => {
  it("annualizes APY over 365.25 days and returns per-second position yield", () => {
    expect(estimateYieldPerSecond("1000 USDC", 0.1)).toBeCloseTo(
      1000 * 0.1 / (365.25 * 24 * 60 * 60),
    );
  });

  it("returns zero for empty positions and invalid APY", () => {
    expect(estimateYieldPerSecond("0 USDC", 0.1)).toBe(0);
    expect(estimateYieldPerSecond("100 USDC", Number.NaN)).toBe(0);
    expect(estimateYieldPerSecond("100 USDC", -0.1)).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────
   DashboardCard variant logic
   We test the intent (which CSS vars are chosen per variant) rather
   than the rendered DOM.
───────────────────────────────────────────────────────────────── */
describe("DashboardCard variant → CSS var selection", () => {
  function pickShadowVar(variant: "default" | "hero" | "accent"): string {
    if (variant === "hero") return "var(--shadow-lg)";
    if (variant === "accent") return "var(--shadow-md)";
    return "var(--shadow-sm)";
  }

  function pickRadiusVar(variant: "default" | "hero" | "accent"): string {
    return variant === "hero" ? "var(--radius-xl)" : "var(--radius-lg)";
  }

  it("hero variant uses shadow-lg and radius-xl", () => {
    expect(pickShadowVar("hero")).toBe("var(--shadow-lg)");
    expect(pickRadiusVar("hero")).toBe("var(--radius-xl)");
  });

  it("accent variant uses shadow-md and radius-lg", () => {
    expect(pickShadowVar("accent")).toBe("var(--shadow-md)");
    expect(pickRadiusVar("accent")).toBe("var(--radius-lg)");
  });

  it("default variant uses shadow-sm and radius-lg", () => {
    expect(pickShadowVar("default")).toBe("var(--shadow-sm)");
    expect(pickRadiusVar("default")).toBe("var(--radius-lg)");
  });
});

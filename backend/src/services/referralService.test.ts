import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerReferral,
  getReferralStats,
  recordDeposit,
  claimRewards,
  clearReferralStore,
  ReferralError,
  REWARD_RATE,
  LOCK_PERIOD_MS,
} from "../services/referralService.js";

// Well-known valid Stellar G-addresses used as test fixtures
const ALICE = "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON";
const BOB   = "GAO7XM2CKPYLCSCBQOUQUP4OV67V6HBB7QITFJS473LW5ANTLPKFSON6";
const CAROL = "GAIOVAQ7XNNEDEJT5R3DRKFC3Y5H7M7Y3SUGJENFNBVZS4LZAGMYNCZK";
const DAVE  = "GBDM4NTFUQPX4SVPPZ5TWR62IACA3CGBOZDJCKTDYLX4JJKRYLOUGRQU";

beforeEach(() => {
  clearReferralStore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// registerReferral
// ---------------------------------------------------------------------------

describe("registerReferral", () => {
  it("creates a referral record with correct fields", () => {
    const record = registerReferral(ALICE, BOB);
    expect(record.referrerAddress).toBe(ALICE);
    expect(record.referredAddress).toBe(BOB);
    expect(record.depositVolume).toBe(0);
    expect(record.pendingReward).toBe(0);
    expect(record.claimedReward).toBe(0);
    expect(record.registeredAt).toBeGreaterThan(0);
  });

  it("throws SELF_REFERRAL when referrer and referred are the same address", () => {
    expect(() => registerReferral(ALICE, ALICE)).toThrow(ReferralError);
    try {
      registerReferral(ALICE, ALICE);
    } catch (err) {
      expect(err).toBeInstanceOf(ReferralError);
      expect((err as ReferralError).code).toBe("SELF_REFERRAL");
    }
  });

  it("throws ALREADY_REFERRED when referred address has already been referred", () => {
    registerReferral(ALICE, BOB);
    expect(() => registerReferral(CAROL, BOB)).toThrow(ReferralError);
    try {
      registerReferral(CAROL, BOB);
    } catch (err) {
      expect((err as ReferralError).code).toBe("ALREADY_REFERRED");
    }
  });

  it("throws DEPTH_EXCEEDED when referred address is already a referrer (MLM prevention)", () => {
    // ALICE refers BOB; BOB cannot then refer someone (chain depth > 1)
    registerReferral(ALICE, BOB);
    expect(() => registerReferral(BOB, CAROL)).toThrow(ReferralError);
    try {
      registerReferral(BOB, CAROL);
    } catch (err) {
      expect((err as ReferralError).code).toBe("DEPTH_EXCEEDED");
    }
  });

  it("allows the same referrer to refer multiple different addresses", () => {
    expect(() => {
      registerReferral(ALICE, BOB);
      registerReferral(ALICE, CAROL);
    }).not.toThrow();
  });

  it("allows different referrers to refer different addresses", () => {
    expect(() => {
      registerReferral(ALICE, BOB);
      registerReferral(CAROL, DAVE);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// recordDeposit
// ---------------------------------------------------------------------------

describe("recordDeposit", () => {
  beforeEach(() => {
    registerReferral(ALICE, BOB);
  });

  it("returns null when the address has no referral", () => {
    const result = recordDeposit(CAROL, 1000);
    expect(result).toBeNull();
  });

  it("returns null for zero or negative deposit amounts", () => {
    expect(recordDeposit(BOB, 0)).toBeNull();
    expect(recordDeposit(BOB, -100)).toBeNull();
  });

  it("updates depositVolume by the deposit amount", () => {
    const record = recordDeposit(BOB, 10_000);
    expect(record?.depositVolume).toBe(10_000);
  });

  it("calculates pending reward at 0.1% of deposit volume", () => {
    const record = recordDeposit(BOB, 10_000);
    expect(record?.pendingReward).toBeCloseTo(10_000 * REWARD_RATE, 8);
  });

  it("accumulates rewards across multiple deposits", () => {
    recordDeposit(BOB, 10_000);
    const record = recordDeposit(BOB, 5_000);
    expect(record?.depositVolume).toBe(15_000);
    expect(record?.pendingReward).toBeCloseTo(15_000 * REWARD_RATE, 8);
  });

  it("REWARD_RATE is 0.001 (0.1%)", () => {
    expect(REWARD_RATE).toBe(0.001);
  });
});

// ---------------------------------------------------------------------------
// getReferralStats
// ---------------------------------------------------------------------------

describe("getReferralStats", () => {
  it("returns empty stats for an address with no referrals", () => {
    const stats = getReferralStats(ALICE);
    expect(stats.referrals).toHaveLength(0);
    expect(stats.claimableReward).toBe(0);
    expect(stats.lockedReward).toBe(0);
    expect(stats.totalClaimed).toBe(0);
  });

  it("returns a referral entry for each referred address", () => {
    registerReferral(ALICE, BOB);
    registerReferral(ALICE, CAROL);
    const stats = getReferralStats(ALICE);
    expect(stats.referrals).toHaveLength(2);
    const addresses = stats.referrals.map((r) => r.referredAddress);
    expect(addresses).toContain(BOB);
    expect(addresses).toContain(CAROL);
  });

  it("marks reward as locked within the 30-day window", () => {
    registerReferral(ALICE, BOB);
    recordDeposit(BOB, 10_000);
    const stats = getReferralStats(ALICE);
    expect(stats.referrals[0]?.isClaimable).toBe(false);
    expect(stats.lockedReward).toBeCloseTo(10);
    expect(stats.claimableReward).toBe(0);
  });

  it("marks reward as claimable after 30 days", () => {
    vi.useFakeTimers();
    registerReferral(ALICE, BOB);
    recordDeposit(BOB, 10_000);

    // Advance time past the lock period
    vi.advanceTimersByTime(LOCK_PERIOD_MS + 1000);

    const stats = getReferralStats(ALICE);
    expect(stats.referrals[0]?.isClaimable).toBe(true);
    expect(stats.claimableReward).toBeCloseTo(10);
    expect(stats.lockedReward).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// claimRewards
// ---------------------------------------------------------------------------

describe("claimRewards", () => {
  it("returns 0 when nothing is claimable (within lock period)", () => {
    registerReferral(ALICE, BOB);
    recordDeposit(BOB, 10_000);
    const claimed = claimRewards(ALICE);
    expect(claimed).toBe(0);
  });

  it("claims and clears pending rewards after lock period", () => {
    vi.useFakeTimers();
    registerReferral(ALICE, BOB);
    recordDeposit(BOB, 10_000);

    vi.advanceTimersByTime(LOCK_PERIOD_MS + 1000);

    const claimed = claimRewards(ALICE);
    expect(claimed).toBeCloseTo(10); // 0.1% of 10,000

    // After claiming, pending should be 0
    const stats = getReferralStats(ALICE);
    expect(stats.claimableReward).toBe(0);
    expect(stats.totalClaimed).toBeCloseTo(10);
  });

  it("returns 0 for an address with no referrals", () => {
    expect(claimRewards(CAROL)).toBe(0);
  });

  it("does not double-claim already claimed rewards", () => {
    vi.useFakeTimers();
    registerReferral(ALICE, BOB);
    recordDeposit(BOB, 10_000);
    vi.advanceTimersByTime(LOCK_PERIOD_MS + 1000);

    const first = claimRewards(ALICE);
    const second = claimRewards(ALICE); // second claim should return 0
    expect(first).toBeCloseTo(10);
    expect(second).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Anti-fraud: self-referral
// ---------------------------------------------------------------------------

describe("Anti-fraud: self-referral prevention", () => {
  it("rejects self-referrals with a descriptive error message", () => {
    let caught: ReferralError | null = null;
    try {
      registerReferral(ALICE, ALICE);
    } catch (err) {
      caught = err as ReferralError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/self-referral/i);
    expect(caught!.code).toBe("SELF_REFERRAL");
  });
});

// ---------------------------------------------------------------------------
// MLM prevention: depth limited to 1
// ---------------------------------------------------------------------------

describe("MLM prevention: referral chain depth = 1", () => {
  it("prevents a referred user from becoming a referrer", () => {
    registerReferral(ALICE, BOB);
    let caught: ReferralError | null = null;
    try {
      registerReferral(BOB, CAROL);
    } catch (err) {
      caught = err as ReferralError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe("DEPTH_EXCEEDED");
  });

  it("allows a referrer to refer multiple addresses (star topology)", () => {
    registerReferral(ALICE, BOB);
    registerReferral(ALICE, CAROL);
    registerReferral(ALICE, DAVE);
    const stats = getReferralStats(ALICE);
    expect(stats.referrals).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Reward calculation accuracy
// ---------------------------------------------------------------------------

describe("Reward calculation", () => {
  it("calculates 0.1% reward accurately for large amounts", () => {
    registerReferral(ALICE, BOB);
    const deposit = 1_000_000; // 1 million tokens
    const record = recordDeposit(BOB, deposit);
    expect(record?.pendingReward).toBeCloseTo(deposit * 0.001, 5); // 1000 tokens
  });

  it("LOCK_PERIOD_MS is 30 days in milliseconds", () => {
    expect(LOCK_PERIOD_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

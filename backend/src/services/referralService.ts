/**
 * Referral Tracking Service
 *
 * Tracks referral relationships between Stellar wallet addresses and
 * calculates rewards for referrers based on referred deposit volume.
 *
 * Business rules:
 *  - 0.1% reward on referred deposit volume
 *  - Rewards claimable after 30-day lock period
 *  - Self-referrals are rejected
 *  - Referral chain depth is limited to 1 (no MLM structures)
 *  - Each address can only be referred once
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferralRecord {
  /** The referrer's Stellar address */
  referrerAddress: string;
  /** The referred user's Stellar address */
  referredAddress: string;
  /** Unix timestamp (ms) when the referral was registered */
  registeredAt: number;
  /**
   * Total deposit volume (in the vault's underlying token, represented as
   * a number with appropriate precision) attributed to this referred address.
   */
  depositVolume: number;
  /**
   * Accumulated reward for the referrer (0.1% of depositVolume).
   * Updated whenever a new deposit is recorded for the referred address.
   */
  pendingReward: number;
  /**
   * Total reward that has been claimed by the referrer.
   */
  claimedReward: number;
}

export interface ReferralStats {
  address: string;
  /** Addresses this user has referred */
  referrals: ReferredUserStats[];
  /** Total pending reward (sum across all referred users, past lock period) */
  claimableReward: number;
  /** Total pending reward still inside the lock period */
  lockedReward: number;
  /** Total reward claimed to date */
  totalClaimed: number;
}

export interface ReferredUserStats {
  referredAddress: string;
  registeredAt: number;
  depositVolume: number;
  pendingReward: number;
  claimedReward: number;
  /** True when the 30-day lock period has elapsed */
  isClaimable: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Reward rate: 0.1% of referred deposit volume. */
export const REWARD_RATE = 0.001;

/** Lock period in milliseconds (30 days). */
export const LOCK_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory store
// (In production this would be backed by a Postgres table — see migration.)
// ---------------------------------------------------------------------------

/**
 * referrals indexed by referredAddress (each address can only be referred once)
 */
const referralStore = new Map<string, ReferralRecord>();

/**
 * Index: referrerAddress → Set<referredAddress>
 * Allows O(1) lookup of all referrals made by a given address.
 */
const referrerIndex = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// Core service functions
// ---------------------------------------------------------------------------

/**
 * Registers a referral relationship between `referrerAddress` and
 * `referredAddress`.
 *
 * Throws if:
 *  - The addresses are the same (self-referral)
 *  - The referred address has already been referred by someone
 *  - The referred address is already a referrer (depth > 1)
 */
export function registerReferral(
  referrerAddress: string,
  referredAddress: string
): ReferralRecord {
  // Self-referral check
  if (
    referrerAddress.toLowerCase() === referredAddress.toLowerCase() ||
    referrerAddress === referredAddress
  ) {
    throw new ReferralError("SELF_REFERRAL", "Self-referrals are not allowed");
  }

  // Duplicate check: each address can only be referred once
  if (referralStore.has(referredAddress)) {
    throw new ReferralError(
      "ALREADY_REFERRED",
      "This address has already been referred"
    );
  }

  // Depth-1 check: the referrer must not itself be a referred address
  // This prevents MLM chains where A refers B, then B refers C.
  // Rule: if the referrerAddress appears in the referralStore as a
  // referredAddress, then they were referred by someone else, so
  // they cannot become a referrer themselves.
  if (referralStore.has(referrerAddress)) {
    throw new ReferralError(
      "DEPTH_EXCEEDED",
      "Referral chain depth is limited to 1. This address was referred by someone else and cannot act as a referrer."
    );
  }

  const record: ReferralRecord = {
    referrerAddress,
    referredAddress,
    registeredAt: Date.now(),
    depositVolume: 0,
    pendingReward: 0,
    claimedReward: 0,
  };

  referralStore.set(referredAddress, record);

  const existing = referrerIndex.get(referrerAddress) ?? new Set<string>();
  existing.add(referredAddress);
  referrerIndex.set(referrerAddress, existing);

  return record;
}

/**
 * Records a deposit made by a referred address and updates the referrer's reward.
 *
 * If `referredAddress` was not referred by anyone, this is a no-op.
 *
 * @param referredAddress  The address making the deposit
 * @param depositAmount    The deposit amount in the vault's underlying token
 * @returns The updated ReferralRecord, or null if no referral exists
 */
export function recordDeposit(
  referredAddress: string,
  depositAmount: number
): ReferralRecord | null {
  if (depositAmount <= 0) return null;

  const record = referralStore.get(referredAddress);
  if (!record) return null;

  record.depositVolume += depositAmount;
  record.pendingReward += depositAmount * REWARD_RATE;
  return record;
}

/**
 * Returns referral statistics for a given address (as a referrer).
 */
export function getReferralStats(address: string): ReferralStats {
  const referredAddresses = referrerIndex.get(address) ?? new Set<string>();
  const now = Date.now();

  const referrals: ReferredUserStats[] = [];
  let claimableReward = 0;
  let lockedReward = 0;
  let totalClaimed = 0;

  for (const referredAddress of referredAddresses) {
    const record = referralStore.get(referredAddress);
    if (!record) continue;

    const lockElapsed = now - record.registeredAt >= LOCK_PERIOD_MS;
    const isClaimable = lockElapsed;

    referrals.push({
      referredAddress,
      registeredAt: record.registeredAt,
      depositVolume: record.depositVolume,
      pendingReward: record.pendingReward,
      claimedReward: record.claimedReward,
      isClaimable,
    });

    if (isClaimable) {
      claimableReward += record.pendingReward;
    } else {
      lockedReward += record.pendingReward;
    }
    totalClaimed += record.claimedReward;
  }

  return {
    address,
    referrals,
    claimableReward,
    lockedReward,
    totalClaimed,
  };
}

/**
 * Claims all claimable rewards for a referrer.
 *
 * Moves pendingReward to claimedReward for all referred addresses whose
 * lock period has elapsed.
 *
 * @returns The total amount claimed in this operation
 */
export function claimRewards(referrerAddress: string): number {
  const referredAddresses = referrerIndex.get(referrerAddress) ?? new Set<string>();
  const now = Date.now();
  let claimed = 0;

  for (const referredAddress of referredAddresses) {
    const record = referralStore.get(referredAddress);
    if (!record) continue;

    const lockElapsed = now - record.registeredAt >= LOCK_PERIOD_MS;
    if (lockElapsed && record.pendingReward > 0) {
      claimed += record.pendingReward;
      record.claimedReward += record.pendingReward;
      record.pendingReward = 0;
    }
  }

  return claimed;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Clears all referral data (for use in tests only). */
export function clearReferralStore(): void {
  referralStore.clear();
  referrerIndex.clear();
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type ReferralErrorCode =
  | "SELF_REFERRAL"
  | "ALREADY_REFERRED"
  | "DEPTH_EXCEEDED"
  | "NOT_FOUND";

export class ReferralError extends Error {
  constructor(
    public readonly code: ReferralErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ReferralError";
  }
}

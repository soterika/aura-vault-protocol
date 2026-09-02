/**
 * Referral Tracking API routes
 *
 * POST /api/referrals/register   — links referrer to referred address
 * GET  /api/referrals/:address   — returns referral stats for an address
 * POST /api/referrals/:address/claim — claims claimable rewards
 * POST /api/referrals/deposit    — records a deposit (internal/webhook use)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  registerReferral,
  getReferralStats,
  recordDeposit,
  claimRewards,
  ReferralError,
} from "../services/referralService.js";
import {
  isValidStellarAddress,
  INVALID_STELLAR_ADDRESS_MESSAGE,
} from "../utils/stellarAddress.js";

export const referralRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** Zod schema for Stellar addresses used in referral routes. */
const stellarAddr = z
  .string()
  .min(1, "Stellar address is required")
  .refine(isValidStellarAddress, INVALID_STELLAR_ADDRESS_MESSAGE);

const registerSchema = z.object({
  referrerAddress: stellarAddr,
  referredAddress: stellarAddr,
});

const depositSchema = z.object({
  referredAddress: stellarAddr,
  depositAmount: z.number().positive("depositAmount must be a positive number"),
});

const addressParamSchema = z.object({
  address: stellarAddr,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleReferralError(err: unknown, res: Response): void {
  if (err instanceof ReferralError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "SELF_REFERRAL" || err.code === "ALREADY_REFERRED" || err.code === "DEPTH_EXCEEDED"
        ? 422
        : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
    });
    return;
  }
  console.error("[referral-route]", err);
  res.status(500).json({ error: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/referrals/register
 *
 * Links a referrer to a referred address.
 *
 * Body: { referrerAddress: string, referredAddress: string }
 *
 * Responses:
 *   201 — referral registered successfully
 *   400 — validation error
 *   422 — self-referral / already referred / depth exceeded
 */
referralRouter.post(
  "/register",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      handleReferralError(parsed.error, res);
      return;
    }

    const { referrerAddress, referredAddress } = parsed.data;

    try {
      const record = registerReferral(referrerAddress, referredAddress);
      res.status(201).json({
        message: "Referral registered",
        referrerAddress: record.referrerAddress,
        referredAddress: record.referredAddress,
        registeredAt: record.registeredAt,
      });
    } catch (err) {
      handleReferralError(err, res);
    }
  }
);

/**
 * GET /api/referrals/:address
 *
 * Returns referral stats for a given referrer address.
 *
 * Responses:
 *   200 — stats returned (empty referrals array if address has no referrals)
 *   400 — invalid address format
 */
referralRouter.get(
  "/:address",
  (req: Request, res: Response): void => {
    const parsed = addressParamSchema.safeParse({ address: req.params.address });
    if (!parsed.success) {
      handleReferralError(parsed.error, res);
      return;
    }

    const stats = getReferralStats(parsed.data.address);
    res.json(stats);
  }
);

/**
 * POST /api/referrals/:address/claim
 *
 * Claims all claimable rewards for the given referrer address.
 * Only rewards past the 30-day lock period are claimable.
 *
 * Responses:
 *   200 — claim processed (claimed may be 0 if nothing is claimable yet)
 *   400 — invalid address format
 */
referralRouter.post(
  "/:address/claim",
  (req: Request, res: Response): void => {
    const parsed = addressParamSchema.safeParse({ address: req.params.address });
    if (!parsed.success) {
      handleReferralError(parsed.error, res);
      return;
    }

    const claimed = claimRewards(parsed.data.address);
    res.json({ claimed, message: claimed > 0 ? "Rewards claimed" : "No claimable rewards at this time" });
  }
);

/**
 * POST /api/referrals/deposit
 *
 * Records a deposit by a referred address and updates the referrer's reward.
 * Intended to be called by the vault's deposit webhook or event indexer.
 *
 * Body: { referredAddress: string, depositAmount: number }
 *
 * Responses:
 *   200 — deposit recorded
 *   400 — validation error or no referral found
 */
referralRouter.post(
  "/deposit",
  (req: Request, res: Response): void => {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) {
      handleReferralError(parsed.error, res);
      return;
    }

    const { referredAddress, depositAmount } = parsed.data;
    const record = recordDeposit(referredAddress, depositAmount);

    if (!record) {
      res.status(200).json({
        message: "No referral found for this address — deposit recorded without referral reward",
        referredAddress,
      });
      return;
    }

    res.json({
      message: "Deposit recorded and referral reward updated",
      referredAddress,
      newDepositVolume: record.depositVolume,
      pendingReward: record.pendingReward,
      rewardRate: 0.001,
    });
  }
);

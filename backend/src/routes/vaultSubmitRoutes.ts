/**
 * vaultSubmitRoutes.ts
 *
 * POST /api/vault/transactions/submit
 *
 * Lightweight endpoint used by the frontend TransactionModal.
 * Accepts a deposit or withdraw request without requiring a pre-signed XDR
 * (the XDR is generated and submitted server-side for the UI flow).
 *
 * When a deposit includes a `referralCode`, this route:
 *   1. Decodes the code to the referrer's Stellar address.
 *   2. Registers the referral relationship (idempotent — no-op if already linked).
 *   3. Records the deposit volume against the referrer's reward balance.
 *
 * The route returns a mock tx hash for development. In production this would
 * be wired to the real Soroban RPC submission pipeline.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  registerReferral,
  recordDeposit,
  ReferralError,
} from "../services/referralService.js";
import { logger } from "../logger.js";

export const vaultSubmitRouter = Router();

// ---------------------------------------------------------------------------
// Base58 decode — mirrors the frontend referral.ts utility
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const char of input) {
    const charIdx = BASE58_ALPHABET.indexOf(char);
    if (charIdx === -1) return null;
    let carry = charIdx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  for (const char of input) {
    if (char !== "1") break;
    leadingZeros++;
  }

  const result = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[leadingZeros + i] = bytes[bytes.length - 1 - i]!;
  }
  return result;
}

/**
 * Decodes a base58 referral code back to a Stellar G-address.
 * Returns null when the code is invalid or doesn't decode to a G-address.
 */
function referralCodeToAddress(code: string): string | null {
  if (!code) return null;
  const bytes = base58Decode(code);
  if (!bytes) return null;
  try {
    const address = Buffer.from(bytes).toString("utf-8");
    if (address.startsWith("G") && address.length === 56) return address;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const submitSchema = z.object({
  type: z.enum(["deposit", "withdraw"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive number"),
  /** Optional base58-encoded referral code (deposit only) */
  referralCode: z.string().optional(),
  /** Optional: the caller's Stellar address (used for referral registration) */
  address: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/vault/transactions/submit
// ---------------------------------------------------------------------------

vaultSubmitRouter.post(
  "/submit",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          details: parsed.error.issues.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
      });
      return;
    }

    const { type, amount, referralCode, address } = parsed.data;

    // ── Handle referral on deposit ──────────────────────────────────────────
    if (type === "deposit" && referralCode) {
      const referrerAddress = referralCodeToAddress(referralCode);

      if (referrerAddress && address && referrerAddress !== address) {
        try {
          // Register referral relationship (idempotent — swallows ALREADY_REFERRED)
          try {
            registerReferral(referrerAddress, address);
          } catch (err) {
            if (
              err instanceof ReferralError &&
              (err.code === "ALREADY_REFERRED" || err.code === "DEPTH_EXCEEDED")
            ) {
              // Fine — the relationship already exists or cannot be created
            } else {
              throw err;
            }
          }

          // Record deposit volume for reward calculation
          recordDeposit(address, parseFloat(amount));
        } catch (err) {
          // Referral tracking failure must never block the main transaction
          logger.warn({ err, referralCode, address }, "[vault/submit] referral tracking failed");
        }
      }
    }

    // ── Return mock transaction result ──────────────────────────────────────
    // In production this would submit to the Soroban RPC and return the real hash.
    const mockHash = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    res.status(200).json({
      success: true,
      hash: mockHash,
      type,
      amount,
      ...(referralCode ? { referralApplied: !!referralCodeToAddress(referralCode) } : {}),
    });
  }
);

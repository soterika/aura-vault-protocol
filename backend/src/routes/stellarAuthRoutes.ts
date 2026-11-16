/**
 * Stellar Wallet JWT Authentication — Issue #286
 *
 * Challenge-Response authentication flow:
 *
 *   1. POST /api/auth/challenge  { address }
 *      → returns { challenge, expiresAt }
 *
 *   2. User signs challenge with Freighter (Ed25519 keypair)
 *
 *   3. POST /api/auth/verify  { address, signature, challenge }
 *      → returns { accessToken, refreshToken, expiresIn }
 *
 * Security:
 *   - Nonce stored in Redis with a 2-minute TTL (one-time use)
 *   - Ed25519 signature verified via stellar-base Keypair
 *   - Rate limit: 10 challenge requests per minute per IP (applied in index.ts)
 *   - JWT payload includes address, sessionId, issuedAt, expiry
 *     (15-min access token, 7-day refresh token)
 */

import { Router, Request, Response } from "express";
import { randomBytes, createHash } from "crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { cacheGet, cacheSet, cacheDel, NS } from "../cache.js";
import { generateTokens } from "../auth.js";
import { validate } from "../validation.js";
import { logger } from "../logger.js";
import { authRateLimiter } from "../middleware/rateLimitMiddleware.js";

export const stellarAuthRouter = Router();

// ── TTLs ──────────────────────────────────────────────────────────────────────

const CHALLENGE_TTL_SECS = 120; // 2 minutes

// ── Validation schemas ────────────────────────────────────────────────────────

const challengeSchema = z.object({
  address: z
    .string()
    .min(1, "address is required")
    .refine(
      (val) => {
        try {
          return StrKey.isValidEd25519PublicKey(val);
        } catch {
          return false;
        }
      },
      { message: "Invalid Stellar address — must be a valid Ed25519 public key (G…)" }
    ),
});

const verifySchema = z.object({
  address: z
    .string()
    .min(1, "address is required")
    .refine(
      (val) => {
        try {
          return StrKey.isValidEd25519PublicKey(val);
        } catch {
          return false;
        }
      },
      { message: "Invalid Stellar address" }
    ),
  /** The challenge string returned by POST /auth/challenge */
  challenge: z.string().min(1, "challenge is required"),
  /**
   * Ed25519 signature of the challenge, hex-encoded.
   * Freighter returns signatures as base64; clients MUST convert to hex
   * before submitting, or pass as base64 — we accept both.
   */
  signature: z
    .string()
    .min(1, "signature is required")
    .max(256, "signature too long"),
});

// ── Cache key helpers ─────────────────────────────────────────────────────────

/** Redis key for a challenge nonce tied to a Stellar address. */
function challengeKey(address: string): string {
  // Hash the address to keep the key length predictable regardless of format.
  return createHash("sha256").update(address).digest("hex").slice(0, 16);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/challenge
 *
 * Issues a one-time challenge string that the wallet must sign.
 * Rate-limited to 10 req/min per IP.
 *
 * Body: { address: string }   — Stellar G… public key
 * Response: { challenge: string, expiresAt: string }
 */
stellarAuthRouter.post(
  "/challenge",
  authRateLimiter(),
  validate(challengeSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.body as { address: string };

    // Generate a cryptographically secure nonce
    const nonce = randomBytes(32).toString("hex");
    const challenge = [
      "Sign this message to authenticate with Aura Vault Protocol.",
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued: ${new Date().toISOString()}`,
    ].join("\n");

    // Store in Redis with a 2-minute TTL (one-time use)
    await cacheSet(
      NS.AUTH_REFRESH, // reuse the auth namespace
      `challenge:${challengeKey(address)}`,
      { address, challenge },
      CHALLENGE_TTL_SECS
    );

    const expiresAt = new Date(
      Date.now() + CHALLENGE_TTL_SECS * 1_000
    ).toISOString();

    logger.info({ address }, "[stellarAuth] challenge issued");

    res.json({
      success: true,
      data: { challenge, expiresAt },
      meta: { timestamp: new Date().toISOString() },
    });
  }
);

/**
 * POST /api/auth/verify
 *
 * Validates the Ed25519 signature, issues JWT access + refresh tokens.
 * Rate-limited to 10 req/min per IP.
 *
 * Body: { address, challenge, signature }
 * Response: { accessToken, refreshToken, expiresIn }
 */
stellarAuthRouter.post(
  "/verify",
  authRateLimiter(),
  validate(verifySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { address, challenge, signature } = req.body as {
      address: string;
      challenge: string;
      signature: string;
    };

    // ── 1. Retrieve stored challenge ──────────────────────────────────────────
    const stored = await cacheGet<{ address: string; challenge: string }>(
      NS.AUTH_REFRESH,
      `challenge:${challengeKey(address)}`
    );

    if (!stored) {
      res.status(401).json({
        success: false,
        error: {
          code: "CHALLENGE_EXPIRED",
          message: "Challenge not found or expired. Request a new challenge.",
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    // ── 2. Ensure address matches ─────────────────────────────────────────────
    if (stored.address !== address) {
      res.status(401).json({
        success: false,
        error: {
          code: "ADDRESS_MISMATCH",
          message: "Address does not match challenge.",
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    // ── 3. Ensure challenge text matches ──────────────────────────────────────
    if (stored.challenge !== challenge) {
      res.status(401).json({
        success: false,
        error: {
          code: "CHALLENGE_MISMATCH",
          message: "Challenge text does not match stored challenge.",
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    // ── 4. Delete the nonce (one-time use) ────────────────────────────────────
    await cacheDel(NS.AUTH_REFRESH, `challenge:${challengeKey(address)}`);

    // ── 5. Verify Ed25519 signature ───────────────────────────────────────────
    try {
      // Normalise to Buffer — accept both hex and base64
      let sigBuffer: Buffer;
      try {
        // Try hex first (64-byte Ed25519 signature = 128 hex chars)
        const hex = signature.replace(/^0x/, "");
        if (/^[0-9a-fA-F]{128}$/.test(hex)) {
          sigBuffer = Buffer.from(hex, "hex");
        } else {
          // Fall back to base64
          sigBuffer = Buffer.from(signature, "base64");
        }
      } catch {
        throw new Error("Cannot decode signature");
      }

      const keypair = Keypair.fromPublicKey(address);
      const messageBuffer = Buffer.from(challenge, "utf8");
      const valid = keypair.verify(messageBuffer, sigBuffer);

      if (!valid) {
        throw new Error("Signature verification failed");
      }
    } catch (err) {
      logger.warn({ address, err }, "[stellarAuth] signature verification failed");
      res.status(401).json({
        success: false,
        error: {
          code: "INVALID_SIGNATURE",
          message: "Ed25519 signature is invalid.",
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    // ── 6. Issue JWT tokens ───────────────────────────────────────────────────
    const tokens = await generateTokens(address, undefined, "free");

    logger.info({ address }, "[stellarAuth] wallet authenticated, tokens issued");

    res.json({
      success: true,
      data: tokens,
      meta: { timestamp: new Date().toISOString() },
    });
  }
);

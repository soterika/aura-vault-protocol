/**
 * vaultRoutes.ts — REST endpoints for vault operations.
 *
 * POST /api/v1/vault/deposit  — submit a signed deposit XDR
 * POST /api/v1/vault/withdraw — submit a signed withdraw XDR
 * POST /api/v1/vault/harvest  — submit a signed harvest XDR
 *
 * All endpoints:
 *  - Require a valid JWT (authenticate middleware)
 *  - Apply per-user rate limiting (userRateLimiter)
 *  - Validate signedXdr before hitting the network (validateXdr)
 *  - Return Horizon response including tx hash on success
 *  - Return structured error objects on failure
 */

import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { userRateLimiter } from "../middleware/rateLimitMiddleware.js";
import { validateXdr } from "../middleware/validateXdrMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";
import {
  submitTransaction,
  XdrValidationError,
  TransactionFailedError,
} from "../services/vaultService.js";

export const vaultTransactionRouter = Router();

// ── Shared error handler ──────────────────────────────────────────────────────

function handleVaultError(err: unknown, res: Response): void {
  if (err instanceof XdrValidationError) {
    res.status(400).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  if (err instanceof TransactionFailedError) {
    res.status(422).json({
      error: err.message,
      code: err.code,
      ...(err.resultCodes ? { resultCodes: err.resultCodes } : {}),
    });
    return;
  }

  console.error("[vault]", err);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
}

// ── POST /deposit ─────────────────────────────────────────────────────────────

/**
 * Body: { signedXdr: string, address: string }
 *
 * `address` is the depositor's Stellar G-address. Validated to be a
 * non-empty string that starts with "G" and is 56 characters long
 * (StrKey-encoded public key format).
 */
vaultTransactionRouter.post(
  "/deposit",
  authenticate,
  userRateLimiter(),
  idempotency(),
  validateXdr(),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, address } = req.body as {
      signedXdr: string;
      address: unknown;
    };

    // Validate address field
    if (!address || typeof address !== "string") {
      res.status(400).json({ error: "address is required", code: "MISSING_FIELD" });
      return;
    }
    if (!isValidStellarAddress(address)) {
      res.status(400).json({
        error: "address must be a valid Stellar public key (G…)",
        code: "INVALID_ADDRESS",
      });
      return;
    }

    try {
      const result = await submitTransaction(signedXdr);
      res.status(200).json({
        success: true,
        operation: "deposit",
        address,
        hash:        result.hash,
        ledger:      result.ledger,
        envelopeXdr: result.envelopeXdr,
        resultXdr:   result.resultXdr,
      });
    } catch (err) {
      handleVaultError(err, res);
    }
  }
);

// ── POST /withdraw ────────────────────────────────────────────────────────────

/**
 * Body: { signedXdr: string, shares: string, address: string }
 *
 * `shares` is the amount of vault shares to burn, expressed as a decimal
 * string (e.g. "1000"). Validated to be a positive numeric string.
 */
vaultTransactionRouter.post(
  "/withdraw",
  authenticate,
  userRateLimiter(),
  idempotency(),
  validateXdr(),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, shares, address } = req.body as {
      signedXdr: string;
      shares: unknown;
      address: unknown;
    };

    // Validate address
    if (!address || typeof address !== "string") {
      res.status(400).json({ error: "address is required", code: "MISSING_FIELD" });
      return;
    }
    if (!isValidStellarAddress(address)) {
      res.status(400).json({
        error: "address must be a valid Stellar public key (G…)",
        code: "INVALID_ADDRESS",
      });
      return;
    }

    // Validate shares
    if (shares === undefined || shares === null) {
      res.status(400).json({ error: "shares is required", code: "MISSING_FIELD" });
      return;
    }
    if (!isPositiveNumericString(shares)) {
      res.status(400).json({
        error: "shares must be a positive numeric string (e.g. \"1000\")",
        code: "INVALID_SHARES",
      });
      return;
    }

    try {
      const result = await submitTransaction(signedXdr);
      res.status(200).json({
        success: true,
        operation: "withdraw",
        address,
        shares: String(shares),
        hash:        result.hash,
        ledger:      result.ledger,
        envelopeXdr: result.envelopeXdr,
        resultXdr:   result.resultXdr,
      });
    } catch (err) {
      handleVaultError(err, res);
    }
  }
);

// ── POST /harvest ─────────────────────────────────────────────────────────────

/**
 * Body: { signedXdr: string, yieldAmount: string }
 *
 * `yieldAmount` is the amount of yield to inject, expressed as a decimal
 * string. Any authenticated user can call harvest (permissionless keeper).
 */
vaultTransactionRouter.post(
  "/harvest",
  authenticate,
  userRateLimiter(),
  idempotency(),
  validateXdr(),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, yieldAmount } = req.body as {
      signedXdr: string;
      yieldAmount: unknown;
    };

    // Validate yieldAmount
    if (yieldAmount === undefined || yieldAmount === null) {
      res.status(400).json({ error: "yieldAmount is required", code: "MISSING_FIELD" });
      return;
    }
    if (!isPositiveNumericString(yieldAmount)) {
      res.status(400).json({
        error: "yieldAmount must be a positive numeric string (e.g. \"500\")",
        code: "INVALID_YIELD_AMOUNT",
      });
      return;
    }

    try {
      const result = await submitTransaction(signedXdr);
      res.status(200).json({
        success: true,
        operation: "harvest",
        yieldAmount: String(yieldAmount),
        hash:        result.hash,
        ledger:      result.ledger,
        envelopeXdr: result.envelopeXdr,
        resultXdr:   result.resultXdr,
      });
    } catch (err) {
      handleVaultError(err, res);
    }
  }
);

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Validates a Stellar public key (G-address).
 * A valid StrKey-encoded public key is 56 characters starting with "G".
 */
function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr);
}

/**
 * Returns true if the value is a string or number representing a positive
 * decimal number (integer or up to 7 decimal places, as Stellar supports
 * up to 7 decimal places for token amounts).
 */
function isPositiveNumericString(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const str = String(value).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(str)) return false;
  return parseFloat(str) > 0;
}

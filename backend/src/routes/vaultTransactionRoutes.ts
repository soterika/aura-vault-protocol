/**
 * vaultRoutes.ts — REST endpoints for vault operations — Issue #867
 *
 * POST /api/v1/vault/deposit  — submit a signed deposit XDR
 * POST /api/v1/vault/withdraw — submit a signed withdraw XDR
 * POST /api/v1/vault/harvest  — submit a signed harvest XDR
 *
 * All endpoints:
 *  - Require a valid JWT (authenticate middleware)
 *  - Apply per-user rate limiting (userRateLimiter)
 *  - Validate input using Zod schemas (vaultDepositSchema, etc.)
 *  - Validate signedXdr before hitting the network (validateXdr middleware)
 *  - Return Horizon response including tx hash on success
 *  - Return structured error objects on validation/failure
 *
 * Validation guarantees:
 *  - Stellar address validated with StrKey.isValidEd25519PublicKey
 *  - Amounts validated as positive decimal strings (up to 7 decimal places)
 *  - XDR structure validated before network submission
 */

import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { userRateLimiter } from "../middleware/rateLimitMiddleware.js";
import { validateXdr } from "../middleware/validateXdrMiddleware.js";
import { validate } from "../validation.js";
import {
  vaultDepositSchema,
  vaultWithdrawSchema,
  vaultHarvestSchema,
} from "../types/schemas.js";
import {
  submitTransaction,
  XdrValidationError,
  TransactionFailedError,
} from "../services/vaultService.js";
import { logger } from "../logger.js";

export const vaultTransactionRouter = Router();

// ── Shared error handler ──────────────────────────────────────────────────────

function handleVaultError(err: unknown, res: Response): void {
  if (err instanceof XdrValidationError) {
    res.status(400).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }

  if (err instanceof TransactionFailedError) {
    res.status(422).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.resultCodes ? { details: { resultCodes: err.resultCodes } } : {}),
      },
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }

  logger.error("[vault]", err);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
    meta: { timestamp: new Date().toISOString() },
  });
}

// ── POST /deposit ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/vault/deposit
 *
 * Body: { signedXdr: string, address: string }
 *
 * Validates:
 * - signedXdr: base64-encoded Stellar TransactionEnvelope
 * - address: valid Stellar G-address (56-char StrKey-encoded public key)
 */
vaultTransactionRouter.post(
  "/deposit",
  authenticate,
  userRateLimiter(),
  idempotency(),
  validateXdr(),
  validate(vaultDepositSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, address } = req.body;

    try {
      const result = await submitTransaction(signedXdr);
      res.status(200).json({
        success: true,
        data: {
          operation: "deposit",
          address,
          hash: result.hash,
          ledger: result.ledger,
          envelopeXdr: result.envelopeXdr,
          resultXdr: result.resultXdr,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      handleVaultError(err, res);
    }
  }
);

// ── POST /withdraw ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/vault/withdraw
 *
 * Body: { signedXdr: string, shares: string, address: string }
 *
 * Validates:
 * - signedXdr: base64-encoded Stellar TransactionEnvelope
 * - address: valid Stellar G-address
 * - shares: positive decimal amount (up to 7 decimal places)
 */
vaultTransactionRouter.post(
  "/withdraw",
  authenticate,
  userRateLimiter(),
  idempotency(),
  validateXdr(),
  validate(vaultWithdrawSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, shares, address } = req.body;

    try {
      const result = await submitTransaction(signedXdr);
      res.status(200).json({
        success: true,
        data: {
          operation: "withdraw",
          address,
          shares,
          hash: result.hash,
          ledger: result.ledger,
          envelopeXdr: result.envelopeXdr,
          resultXdr: result.resultXdr,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      handleVaultError(err, res);
    }
  }
);

// ── POST /harvest ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/vault/harvest
 *
 * Body: { signedXdr: string, yieldAmount: string }
 *
 * Validates:
 * - signedXdr: base64-encoded Stellar TransactionEnvelope
 * - yieldAmount: positive decimal amount (up to 7 decimal places)
 */
vaultTransactionRouter.post(
  "/harvest",
  authenticate,
  userRateLimiter(),
  idempotency(),
  validateXdr(),
  validate(vaultHarvestSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { signedXdr, yieldAmount } = req.body;

    try {
      const result = await submitTransaction(signedXdr);
      res.status(200).json({
        success: true,
        data: {
          operation: "harvest",
          yieldAmount,
          hash: result.hash,
          ledger: result.ledger,
          envelopeXdr: result.envelopeXdr,
          resultXdr: result.resultXdr,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      handleVaultError(err, res);
    }
  }
);

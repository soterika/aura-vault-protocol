/**
 * Vault Transaction Queue Routes — Issue #288
 *
 * Async vault transaction submission via BullMQ.
 *
 *   POST /api/vault/deposit      { walletAddress, amount, signedXdr? }
 *   POST /api/vault/withdraw     { walletAddress, amount, signedXdr? }
 *   POST /api/vault/harvest      { walletAddress, amount, signedXdr? }
 *   GET  /api/vault/job/:jobId   → { jobId, status, result?, error? }
 *   GET  /api/vault/metrics      → queue depth counters (Prometheus-friendly)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../validation.js";
import {
  enqueueVaultTx,
  getVaultJobStatus,
  getQueueMetrics,
  VaultTxType,
} from "../vaultQueue.js";
import { successResponse, errorResponse } from "../dto/ApiResponseDto.js";

export const vaultQueueRouter = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const txSchema = z.object({
  walletAddress: z
    .string()
    .min(1, "walletAddress is required")
    .max(64, "walletAddress too long"),
  /** Amount in stroops (i128 represented as string to avoid JS precision loss) */
  amount: z
    .string()
    .regex(/^\d+$/, "amount must be a positive integer string")
    .min(1),
  /** Base64-encoded signed XDR envelope from Freighter */
  signedXdr: z.string().optional(),
  /** Webhook URL to notify on completion / failure */
  webhookUrl: z.string().url().optional(),
  meta: z.record(z.unknown()).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTxHandler(txType: VaultTxType) {
  return async (req: Request, res: Response): Promise<void> => {
    const { walletAddress, amount, signedXdr, webhookUrl, meta } = req.body as z.infer<
      typeof txSchema
    >;

    const jobId = await enqueueVaultTx({
      type: txType,
      walletAddress,
      amount,
      signedXdr,
      webhookUrl,
      meta,
    });

    res.status(202).json(
      successResponse({ jobId, status: "pending" })
    );
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/vault/deposit
 * Enqueue a deposit transaction.  Returns 202 with { jobId }.
 */
vaultQueueRouter.post(
  "/deposit",
  validate(txSchema),
  makeTxHandler("deposit")
);

/**
 * POST /api/vault/withdraw
 * Enqueue a withdrawal transaction.
 */
vaultQueueRouter.post(
  "/withdraw",
  validate(txSchema),
  makeTxHandler("withdraw")
);

/**
 * POST /api/vault/harvest
 * Enqueue a harvest transaction.
 */
vaultQueueRouter.post(
  "/harvest",
  validate(txSchema),
  makeTxHandler("harvest")
);

/**
 * GET /api/vault/job/:jobId
 * Poll the status of an enqueued transaction.
 *
 * Returns:
 *   200  { jobId, status: "pending"|"processing"|"completed"|"failed"|"delayed" }
 *   404  Job not found
 */
vaultQueueRouter.get("/job/:jobId", async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;
  const job = await getVaultJobStatus(jobId);

  if (!job) {
    res.status(404).json(
      errorResponse("JOB_NOT_FOUND", `Job ${jobId} not found`)
    );
    return;
  }

  res.json(successResponse(job));
});

/**
 * GET /api/vault/queue/metrics
 * Returns queue depth by status for Prometheus scraping.
 *
 * Example response:
 *   { waiting: 3, active: 1, completed: 142, failed: 0, delayed: 0 }
 */
vaultQueueRouter.get("/queue/metrics", async (_req: Request, res: Response): Promise<void> => {
  const metrics = await getQueueMetrics();
  res.json(successResponse(metrics));
});

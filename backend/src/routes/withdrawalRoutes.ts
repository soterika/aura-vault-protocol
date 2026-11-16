import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { userRateLimiter } from "../middleware/rateLimitMiddleware.js";
import {
  enqueueWithdrawal,
  getWithdrawalJob,
  getQueueStats,
} from "../services/withdrawalQueue.js";

export const withdrawalRouter = Router();

/** Shares above this threshold are queued to prevent flash-loan abuse. */
const LARGE_WITHDRAWAL_THRESHOLD = 100_000;

/**
 * POST /api/v1/withdraw
 * Body: { walletAddress, shares, contractId }
 */
withdrawalRouter.post(
  "/",
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress, shares, contractId } = req.body;

    if (!walletAddress || shares === undefined || shares === null) {
      res.status(400).json({ error: "walletAddress and shares are required" });
      return;
    }

    const sharesNum = Number(shares);
    if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
      res.status(400).json({ error: "shares must be a positive number" });
      return;
    }

    if (sharesNum > LARGE_WITHDRAWAL_THRESHOLD) {
      const job = enqueueWithdrawal(
        walletAddress,
        String(shares),
        contractId ?? process.env.VAULT_CONTRACT_ID ?? ""
      );
      res.status(202).json({ queued: true, jobId: job.id });
      return;
    }

    // Small withdrawal: return unsigned Soroban tx params for client to sign
    res.json({
      immediate: true,
      txParams: {
        contractId: contractId ?? process.env.VAULT_CONTRACT_ID ?? "",
        method: "withdraw",
        args: { caller: walletAddress, shares: String(shares) },
        network: process.env.STELLAR_NETWORK ?? "testnet",
      },
    });
  }
);

/**
 * GET /api/v1/withdraw/queue/stats
 */
withdrawalRouter.get(
  "/queue/stats",
  authenticate,
  async (_req: Request, res: Response): Promise<void> => {
    res.json(getQueueStats());
  }
);

/**
 * GET /api/v1/withdraw/:jobId
 */
withdrawalRouter.get(
  "/:jobId",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const jobId = req.params.jobId;
    if (typeof jobId !== "string") {
      res.status(400).json({ error: "Invalid job ID" });
      return;
    }
    const job = getWithdrawalJob(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  }
);

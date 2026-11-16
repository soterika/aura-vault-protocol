/**
 * Stellar Routes — Issue #249
 *
 * GET /api/v1/stellar/fee-stats
 *   Returns Stellar network fee statistics fetched from Horizon /fee_stats.
 *   Used by the pre-sign transaction breakdown screen to show estimated fees.
 */

import { Router, Request, Response } from "express";
import { getStellarFeeStats } from "../services/stellarFeeService.js";
import { successResponse, errorResponse } from "../dto/index.js";
import { INTERNAL_ERROR } from "../middleware/errorCodes.js";
import { logger } from "../logger.js";

export const stellarRouter = Router();

/**
 * GET /api/v1/stellar/fee-stats
 *
 * Returns fee statistics from Horizon for pre-sign transaction breakdown.
 *
 * Response shape:
 * {
 *   "success": true,
 *   "data": {
 *     "lastLedger": 123456,
 *     "lastLedgerBaseFee": 100,
 *     "ledgerCapacityUsage": 0.12,
 *     "congested": false,
 *     "fee": {
 *       "base":     { "stroops": 100,  "xlm": "0.0000100" },
 *       "low":      { "stroops": 100,  "xlm": "0.0000100" },
 *       "standard": { "stroops": 200,  "xlm": "0.0000200" },
 *       "high":     { "stroops": 500,  "xlm": "0.0000500" }
 *     },
 *     "fetchedAt": "2026-01-01T00:00:00.000Z",
 *     "cached": false
 *   }
 * }
 */
stellarRouter.get("/fee-stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = await getStellarFeeStats();
    res.json(successResponse(stats));
  } catch (err) {
    logger.error("[stellar/fee-stats]", err);
    res.status(500).json(errorResponse(INTERNAL_ERROR, "Failed to retrieve Stellar fee statistics"));
  }
});

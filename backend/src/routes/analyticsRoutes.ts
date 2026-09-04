import express, { Request, Response } from 'express';
import { getPortfolioAnalytics, type TxEvent } from '../services/analyticsService.js';
import { INVALID_ADDRESS, INTERNAL_ERROR } from '../middleware/errorCodes.js';
import { logger } from "../logger.js";

const router = express.Router();

async function loadEventsForAddress(address: string): Promise<TxEvent[]> {
  void address;
  return [];
}

router.get('/:address/analytics', async (req: Request, res: Response) => {
  const address = Array.isArray(req.params.address) ? req.params.address[0] : req.params.address;

  if (!address || !/^[A-Z2-7]{56}$/.test(address)) {
    res.failure(INVALID_ADDRESS, 'Invalid Stellar address format', 400);
    return;
  }

  try {
    const analytics = await getPortfolioAnalytics(address, loadEventsForAddress);
    res.success(analytics);
  } catch (err) {
    logger.error('[analyticsRoute] error computing analytics:', err);
    res.failure(INTERNAL_ERROR, 'Internal server error', 500);
  }
});

export { router as analyticsRouter };

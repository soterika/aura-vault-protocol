import { Router, Request, Response } from 'express';
import { createYieldService, YieldSource, VaultPosition } from '../services/yieldService.js';
import { getLastRunStats, getRunHistory, isYieldWorkerRunning } from '../services/yieldWorker.js';
import { parsePagination, paginateArray } from '../middleware/paginationMiddleware.js';
import { INVALID_INPUT, INTERNAL_ERROR } from '../middleware/errorCodes.js';
import { logger } from "../logger.js";

const yieldService = createYieldService();

export const yieldRouter = Router();

yieldRouter.post('/calculate', async (req: Request, res: Response): Promise<void> => {
  const { positions, sources, calcDate } = req.body as {
    positions: VaultPosition[];
    sources: YieldSource[];
    calcDate?: string;
  };

  if (!Array.isArray(positions) || !Array.isArray(sources)) {
    res.failure(INVALID_INPUT, 'positions and sources arrays are required', 400);
    return;
  }

  try {
    const date = calcDate ? new Date(calcDate) : new Date();
    const result = await yieldService.processBatch(positions, sources, date);
    res.success(result);
  } catch (err) {
    logger.error('[yield/calculate]', err);
    res.failure(INTERNAL_ERROR, 'Yield calculation failed', 500);
  }
});

yieldRouter.post('/backfill', async (req: Request, res: Response): Promise<void> => {
  const { positions, sources, startDate, endDate } = req.body as {
    positions: VaultPosition[];
    sources: YieldSource[];
    startDate: string;
    endDate: string;
  };

  if (!Array.isArray(positions) || !Array.isArray(sources) || !startDate || !endDate) {
    res.failure(INVALID_INPUT, 'positions, sources, startDate, and endDate are required', 400);
    return;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    res.failure(INVALID_INPUT, 'Invalid date range', 400);
    return;
  }

  try {
    const results = await yieldService.backfill(positions, sources, start, end);
    res.success({ slots: results.length, results });
  } catch (err) {
    logger.error('[yield/backfill]', err);
    res.failure(INTERNAL_ERROR, 'Backfill failed', 500);
  }
});

yieldRouter.get('/stats', async (req: Request, res: Response): Promise<void> => {
  const { limit, cursor } = parsePagination(req);

  try {
    const [lastRun, allHistory] = await Promise.all([
      getLastRunStats(),
      getRunHistory(100),
    ]);

    const { data, nextCursor } = paginateArray(
      allHistory,
      (item, index) => ({
        id: String(index),
        timestamp: typeof item.lastRunAt === 'string' ? item.lastRunAt : '0',
      }),
      limit,
      cursor,
    );

    res.success({
      workerRunning: isYieldWorkerRunning(),
      lastRun,
      data,
      nextCursor,
    });
  } catch (err) {
    logger.error('[yield/stats]', err);
    res.failure(INTERNAL_ERROR, 'Failed to retrieve yield stats', 500);
  }
});

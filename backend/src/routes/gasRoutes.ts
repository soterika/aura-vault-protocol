import { Router, Request, Response } from 'express';
import { createGasPriceService } from '../services/gasService.js';
import { parsePagination, paginateArray, MAX_LIMIT } from '../middleware/paginationMiddleware.js';
import { INTERNAL_ERROR } from '../middleware/errorCodes.js';

const gasService = createGasPriceService();

function parseChainId(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.parseInt(process.env.EVM_CHAIN_ID ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseGasLimit(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

export const gasRouter = Router();

gasRouter.get('/prices', async (req: Request, res: Response): Promise<void> => {
  const chainId = parseChainId(req.query.chainId as string | undefined);
  const gasLimit = parseGasLimit(req.query.gasLimit as string | undefined);
  const forceRefresh = String(req.query.forceRefresh ?? 'false') === 'true';

  try {
    const estimate = await gasService.estimate(chainId, gasLimit, forceRefresh);
    res.success(estimate);
  } catch (err) {
    console.error('[gas]', err);
    res.failure(INTERNAL_ERROR, 'Unable to estimate gas prices', 500);
  }
});

gasRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  const chainId = parseChainId(req.query.chainId as string | undefined);
  const { limit, cursor } = parsePagination(req);

  try {
    const allHistory = await gasService.history(chainId, MAX_LIMIT);
    const { data, nextCursor } = paginateArray(
      allHistory,
      (item, index) => ({
        id: String(index),
        timestamp: typeof item.fetchedAt === 'string' ? item.fetchedAt : String(index),
      }),
      limit,
      cursor,
    );
    res.success({ chainId, data, nextCursor });
  } catch (err) {
    console.error('[gas-history]', err);
    res.failure(INTERNAL_ERROR, 'Unable to load gas history', 500);
  }
});

gasRouter.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = gasService.getMetrics();
    res.success(metrics);
  } catch (err) {
    console.error('[gas-metrics]', err);
    res.failure(INTERNAL_ERROR, 'Unable to load metrics', 500);
  }
});

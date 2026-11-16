import { Router, Request, Response } from 'express';
import { createGasPriceService } from '../services/gasService.js';
import { parsePagination, paginateArray, MAX_LIMIT } from '../middleware/paginationMiddleware.js';
import { INTERNAL_ERROR } from '../middleware/errorCodes.js';
import { logger } from "../logger.js";

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

const usdPriceCache = new Map<string, { price: number; fetchedAt: number }>();
const COINGECKO_IDS: Record<string, string> = { USDC: 'usd-coin', XLM: 'stellar' };

gasRouter.get('/usd-price', async (req: Request, res: Response): Promise<void> => {
  const asset = String(req.query.asset ?? 'USDC').toUpperCase();
  const coinId = COINGECKO_IDS[asset];
  if (!coinId) {
    res.status(400).json({ success: false, error: { message: 'Unsupported asset. Use USDC or XLM.' } });
    return;
  }
  const cached = usdPriceCache.get(asset);
  if (cached && Date.now() - cached.fetchedAt < 30_000) {
    res.set('Cache-Control', 'public, max-age=30').json({ success: true, data: { asset, priceUSD: cached.price, fetchedAt: new Date(cached.fetchedAt).toISOString() } });
    return;
  }
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new Error(`Price provider returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, { usd?: unknown }>;
    const price = Number(body[coinId]?.usd);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Price provider returned an invalid USD price');
    const fetchedAt = Date.now();
    usdPriceCache.set(asset, { price, fetchedAt });
    res.set('Cache-Control', 'public, max-age=30').json({ success: true, data: { asset, priceUSD: price, fetchedAt: new Date(fetchedAt).toISOString() } });
  } catch (error) {
    logger.warn({ asset, error: error instanceof Error ? error.message : String(error) }, '[gas/usd-price] Price lookup failed');
    res.status(503).json({ success: false, error: { message: 'USD price is temporarily unavailable.' } });
  }
});

gasRouter.get('/prices', async (req: Request, res: Response): Promise<void> => {
  const chainId = parseChainId(req.query.chainId as string | undefined);
  const gasLimit = parseGasLimit(req.query.gasLimit as string | undefined);
  const forceRefresh = String(req.query.forceRefresh ?? 'false') === 'true';

  try {
    const estimate = await gasService.estimate(chainId, gasLimit, forceRefresh);
    res.success(estimate);
  } catch (err) {
    logger.error('[gas]', err);
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
    logger.error('[gas-history]', err);
    res.failure(INTERNAL_ERROR, 'Unable to load gas history', 500);
  }
});

gasRouter.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = gasService.getMetrics();
    res.success(metrics);
  } catch (err) {
    logger.error('[gas-metrics]', err);
    res.failure(INTERNAL_ERROR, 'Unable to load metrics', 500);
  }
});

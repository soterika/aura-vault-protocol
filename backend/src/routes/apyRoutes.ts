import { Router, Request, Response } from 'express';
import { getApyHistory, isValidPeriod } from '../services/apyHistoryService.js';
import { INVALID_INPUT, INTERNAL_ERROR } from '../middleware/errorCodes.js';

export const apyRouter = Router();

const DEFAULT_VAULT_ID = process.env.DEFAULT_VAULT_ID ?? '00000000-0000-0000-0000-000000000001';

apyRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  const rawPeriod = req.query.period ?? '30d';
  const vaultId = String(req.query.vaultId ?? DEFAULT_VAULT_ID).trim();

  if (!isValidPeriod(rawPeriod)) {
    res.failure(INVALID_INPUT, 'Invalid period. Allowed values: 7d, 30d, 90d, 1y', 400);
    return;
  }

  if (!vaultId) {
    res.failure(INVALID_INPUT, 'vaultId is required.', 400);
    return;
  }

  try {
    const history = await getApyHistory(vaultId, rawPeriod);
    res.set('Cache-Control', 'public, max-age=300');
    res.success(history);
  } catch (err) {
    console.error('[APY] GET /history error:', err);
    res.failure(INTERNAL_ERROR, 'Failed to retrieve APY history.', 500);
  }
});

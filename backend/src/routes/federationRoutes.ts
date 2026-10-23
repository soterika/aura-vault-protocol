import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ipRateLimiter } from '../middleware/rateLimitMiddleware.js';

export const federationRouter = Router();
const addressSchema = z.string().regex(/^G[A-Z2-7]{55}$/);
const resolveRateLimiter = ipRateLimiter({ bucketKey: 'rl:federation:ip', limit: 30, windowMs: 60_000 });
const aliasCache = new Map<string, { alias: string | null; expiresAt: number }>();

federationRouter.get('/resolve', resolveRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = addressSchema.safeParse(req.query.address);
  if (!parsed.success) {
    res.status(400).json({ error: 'address must be a valid Stellar account ID' });
    return;
  }
  const address = parsed.data;
  const cached = aliasCache.get(address);
  if (cached && cached.expiresAt > Date.now()) {
    res.set('Cache-Control', 'public, max-age=3600').json({ alias: cached.alias });
    return;
  }
  const serverText = process.env.STELLAR_FEDERATION_SERVER;
  if (!serverText) {
    res.set('Cache-Control', 'public, max-age=3600').json({ alias: null });
    return;
  }
  try {
    const server = new URL(serverText);
    if (server.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      res.status(503).json({ error: 'Federation service must use HTTPS' });
      return;
    }
    const lookup = new URL(server);
    lookup.searchParams.set('q', address);
    lookup.searchParams.set('type', 'id');
    const response = await fetch(lookup, { signal: AbortSignal.timeout(2_500), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Federation server returned ${response.status}`);
    const payload = await response.json() as { stellar_address?: unknown };
    const alias = typeof payload.stellar_address === 'string' && /^[^\s*@]{1,64}\*[^\s@]{1,253}$/.test(payload.stellar_address)
      ? payload.stellar_address
      : null;
    aliasCache.set(address, { alias, expiresAt: Date.now() + 60 * 60_000 });
    res.set('Cache-Control', 'public, max-age=3600').json({ alias });
  } catch {
    res.set('Cache-Control', 'public, max-age=60').json({ alias: null, unavailable: true });
  }
});

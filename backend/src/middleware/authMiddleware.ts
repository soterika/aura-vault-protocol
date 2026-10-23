import { Request, Response, NextFunction } from 'express';
import { validateAccessToken } from '../auth.js';
import { authenticateApiKey } from '../services/apiKeyService.js';
import { getRedis } from '../redis.js';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.header('X-API-Key');
  if (apiKey) {
    try {
      const identity = await authenticateApiKey(apiKey);
      if (!identity) {
        res.status(401).json({ error: 'Invalid or revoked API key' });
        return;
      }
      const redis = getRedis();
      const bucket = `api-key-rate:${identity.id}:${Math.floor(Date.now() / 3_600_000)}`;
      const count = await redis.incr(bucket);
      if (count === 1) await redis.expire(bucket, 3_600);
      if (count > 1_000) {
        res.setHeader('Retry-After', String(3_600 - (Math.floor(Date.now() / 1_000) % 3_600)));
        res.status(429).json({ error: 'API key hourly request limit exceeded' });
        return;
      }
      (req as any).user = { sub: identity.userId, sessionId: `api-key:${identity.id}`, scope: identity.scopes.join(' '), apiKeyId: identity.id };
      next();
    } catch {
      res.status(503).json({ error: 'API key authentication is temporarily unavailable' });
    }
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  const payload = await validateAccessToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  (req as any).user = payload;
  next();
}

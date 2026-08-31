import { Request, Response, NextFunction } from 'express';
import { validateAccessToken } from '../auth.js';

/**
 * Admin authentication middleware.
 * Verifies the Bearer token AND confirms the JWT payload carries
 * scope: 'admin' or tier: 'admin'. All other callers receive 403.
 */
export async function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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

  // Check for admin scope or tier (cast through unknown to avoid TS overlap error)
  const p = payload as unknown as Record<string, unknown>;
  const isAdmin = p['scope'] === 'admin' || p['tier'] === 'admin';
  if (!isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  (req as any).user = payload;
  next();
}

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { createApiKey, revokeApiKey } from '../services/apiKeyService.js';

export const apiKeyRouter = Router();
apiKeyRouter.use(authenticate);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string().regex(/^[a-z][a-z:._-]{0,63}$/)).min(1).max(20).default(['read']),
});

apiKeyRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  if (req.header('X-API-Key')) {
    res.status(403).json({ error: 'API keys cannot create or manage other API keys' });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid API key name or scopes' });
    return;
  }
  try {
    const user = (req as any).user as { sub: string };
    // The cleartext key is returned only on creation; only its bcrypt hash is persisted.
    res.status(201).json(await createApiKey(user.sub, parsed.data.name, parsed.data.scopes));
  } catch {
    res.status(503).json({ error: 'Unable to create API key' });
  }
});

apiKeyRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  if (req.header('X-API-Key')) {
    res.status(403).json({ error: 'API keys cannot create or manage other API keys' });
    return;
  }
  if (!z.string().uuid().safeParse(req.params.id).success) {
    res.status(400).json({ error: 'Invalid API key id' });
    return;
  }
  try {
    const user = (req as any).user as { sub: string };
    const revoked = await revokeApiKey(user.sub, req.params.id);
    res.status(revoked ? 204 : 404).end();
  } catch {
    res.status(503).json({ error: 'Unable to revoke API key' });
  }
});

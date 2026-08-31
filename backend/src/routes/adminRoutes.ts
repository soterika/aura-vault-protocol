/**
 * Admin API Routes — Issue #854
 *
 * GET  /api/admin/status   — vault state, total assets, depositor count
 * POST /api/admin/pause    — pause vault (admin only)
 * POST /api/admin/unpause  — unpause vault (admin only)
 * GET  /api/admin/queue    — job queue stats
 *
 * All write actions are audit-logged to admin_audit_log.
 * Requires authenticateAdmin middleware (admin JWT scope).
 */

import { Router, Request, Response } from 'express';
import { getWritePool, getReadPool } from '../db.js';
import { queueMetrics } from '../queue.js';
import { getVaultStats } from '../services/vaultStatsService.js';
import { logger } from '../logger.js';

export const adminRouter = Router();

// In-memory pause state.
// In production, persist this to DB or the on-chain contract.
let vaultPaused = false;

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

async function auditLog(
  action: string,
  performedBy: string,
  ipAddress: string | undefined,
  payload: Record<string, unknown>,
  result: 'success' | 'failure' = 'success'
): Promise<void> {
  try {
    const pool = getWritePool();
    await pool.query(
      `INSERT INTO admin_audit_log (action, performed_by, ip_address, payload, result)
       VALUES ($1, $2, $3, $4, $5)`,
      [action, performedBy, ipAddress ?? null, JSON.stringify(payload), result]
    );
  } catch (err) {
    // Never crash on audit failure — log and continue
    logger.error('[admin audit] Failed to write audit log', { action, err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/status
// ---------------------------------------------------------------------------

adminRouter.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const [vaultStats, depositorResult] = await Promise.all([
      getVaultStats(),
      getReadPool()
        .query<{ count: string }>(
          `SELECT COUNT(DISTINCT wallet_address)::text AS count
           FROM vault_positions
           WHERE shares > 0`
        )
        .catch(() => ({ rows: [{ count: '0' }] })),
    ]);

    const depositorCount = parseInt(depositorResult.rows[0]?.count ?? '0', 10);

    res.json({
      vault: {
        paused: vaultPaused,
        total_assets: vaultStats.total_assets,
        total_shares: vaultStats.total_shares,
        apy: vaultStats.apy,
        last_harvest: vaultStats.last_harvest,
        depositor_count: depositorCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[admin/status] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to fetch vault status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/pause
// ---------------------------------------------------------------------------

adminRouter.post('/pause', async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as { sub?: string } | undefined;
  const performedBy = user?.sub ?? 'unknown';

  try {
    if (vaultPaused) {
      res.status(409).json({ error: 'Vault is already paused' });
      return;
    }

    vaultPaused = true;
    logger.warn('[admin] Vault PAUSED', { by: performedBy });

    await auditLog(
      'vault.pause',
      performedBy,
      req.ip,
      { reason: req.body?.reason ?? null }
    );

    res.json({ paused: true, timestamp: new Date().toISOString() });
  } catch (err) {
    await auditLog('vault.pause', performedBy, req.ip, {}, 'failure');
    logger.error('[admin/pause] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to pause vault' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/unpause
// ---------------------------------------------------------------------------

adminRouter.post('/unpause', async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as { sub?: string } | undefined;
  const performedBy = user?.sub ?? 'unknown';

  try {
    if (!vaultPaused) {
      res.status(409).json({ error: 'Vault is not paused' });
      return;
    }

    vaultPaused = false;
    logger.info('[admin] Vault UNPAUSED', { by: performedBy });

    await auditLog(
      'vault.unpause',
      performedBy,
      req.ip,
      { reason: req.body?.reason ?? null }
    );

    res.json({ paused: false, timestamp: new Date().toISOString() });
  } catch (err) {
    await auditLog('vault.unpause', performedBy, req.ip, {}, 'failure');
    logger.error('[admin/unpause] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to unpause vault' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/queue
// ---------------------------------------------------------------------------

adminRouter.get('/queue', async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = queueMetrics();
    res.json({
      queue: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[admin/queue] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to fetch queue stats' });
  }
});

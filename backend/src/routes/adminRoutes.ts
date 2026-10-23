/**
 * Admin API Routes — Issue #854 / #263
 *
 * GET  /api/admin/status            — vault state, total assets, depositor count
 * POST /api/admin/pause             — pause vault (admin only)
 * POST /api/admin/unpause           — unpause vault (admin only)
 * GET  /api/admin/queue             — job queue stats
 * GET  /api/admin/audit-logs        — paginated audit trail (Issue #263)
 * GET  /api/admin/upgrade/info      — current wasm hash + contract version (Issue #263)
 * POST /api/admin/upgrade           — trigger contract upgrade via multi-sig proposal (Issue #263)
 * GET  /api/admin/multisig/ops      — list pending multi-sig operations (Issue #263)
 * POST /api/admin/multisig/sign     — add signature to a pending operation (Issue #263)
 *
 * All write actions are audit-logged to admin_audit_log.
 * Requires authenticateAdmin middleware (admin JWT scope).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getWritePool, getReadPool } from '../db.js';
import { queueMetrics } from '../queue.js';
import { getVaultStats } from '../services/vaultStatsService.js';
import { auditRepository } from '../modules/audit/audit.repository.js';
import { logger } from '../logger.js';
import { paginatedResponse } from '../dto/ApiResponseDto.js';

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

// ---------------------------------------------------------------------------
// GET /api/admin/audit-logs   — Issue #263
// Query params: action, userId, from, to, page, pageSize
// ---------------------------------------------------------------------------

const auditLogsQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  userId: z.string().trim().min(1).max(255).optional(),
  actor: z.string().trim().min(1).max(255).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  // Backward-compatible pagination parameters.
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function redactAuditIp(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && /ip/i.test(key)) {
    return `${value.split('.').slice(0, 3).join('.')}.0`;
  }
  if (typeof value === 'string' && value.includes(':') && /ip/i.test(key)) {
    return `${value.split(':').slice(0, 2).join(':')}::`;
  }
  if (Array.isArray(value)) return value.map((item) => redactAuditIp(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactAuditIp(child, childKey)]));
  }
  return value;
}

adminRouter.get('/audit-logs', async (req: Request, res: Response): Promise<void> => {
  const parsed = auditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    return;
  }

  const { action, userId, actor, from, to, page, pageSize } = parsed.data;
  const effectivePageSize = parsed.data.limit ?? pageSize;
  const effectiveOffset = parsed.data.offset ?? (page - 1) * effectivePageSize;
  const effectivePage = Math.floor(effectiveOffset / effectivePageSize) + 1;

  try {
    const result = await auditRepository.query({
      actor: userId ?? actor,
      action,
      from:   from  ? new Date(from)  : undefined,
      to:     to    ? new Date(to)    : undefined,
      limit: effectivePageSize,
      offset: effectiveOffset,
    });

    const user = (req as any).user as { sub?: string } | undefined;
    await auditRepository.create({
      actor: user?.sub ?? 'unknown',
      entityType: 'audit_logs',
      entityId: '*',
      action: 'AUDIT_LOG_ACCESS',
      metadata: { filters: { action, userId: userId ?? actor, from, to }, page: effectivePage, pageSize: effectivePageSize },
    }).catch((error) => logger.error('[admin/audit-logs] failed to record access audit', { error: String(error) }));

    res.json(paginatedResponse(result.logs.map((log) => ({
        ...log,
        id: String(log.id),
        entityId: redactAuditIp(log.entityId, 'ipAddress') as string,
        metadata: redactAuditIp(log.metadata) as Record<string, unknown>,
      })), effectivePage, effectivePageSize, result.total));
  } catch (err) {
    logger.error('[admin/audit-logs] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/upgrade/info   — Issue #263
// Returns current contract version and wasm hash from DB/env
// ---------------------------------------------------------------------------

adminRouter.get('/upgrade/info', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getReadPool();

    // Try to fetch the latest recorded upgrade from the audit log
    const { rows } = await pool.query<{ payload: Record<string, unknown>; created_at: string }>(
      `SELECT payload, created_at
       FROM admin_audit_log
       WHERE action = 'vault.upgrade'
         AND result = 'success'
       ORDER BY created_at DESC
       LIMIT 1`
    );

    const lastUpgrade = rows[0] ?? null;

    res.json({
      contract_id:      process.env.VAULT_CONTRACT_ID ?? null,
      current_wasm_hash: lastUpgrade?.payload?.new_wasm_hash ?? null,
      current_version:   lastUpgrade?.payload?.new_version   ?? null,
      last_upgraded_at:  lastUpgrade?.created_at             ?? null,
      // Multi-sig governance threshold from env (informational)
      governance_threshold: process.env.VAULT_GOVERNANCE_THRESHOLD
        ? Number(process.env.VAULT_GOVERNANCE_THRESHOLD)
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[admin/upgrade/info] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to fetch upgrade info' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/upgrade   — Issue #263
// Body: { new_wasm_hash: string (64-char hex), reason?: string }
// Initiates a multi-sig upgrade proposal (or direct upgrade if threshold = 1)
// ---------------------------------------------------------------------------

const upgradeBodySchema = z.object({
  new_wasm_hash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'Must be a 64-character hex string (32 bytes)'),
  reason: z.string().max(500).optional(),
});

adminRouter.post('/upgrade', async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as { sub?: string } | undefined;
  const performedBy = user?.sub ?? 'unknown';

  const parsed = upgradeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
    return;
  }

  const { new_wasm_hash, reason } = parsed.data;
  const threshold = process.env.VAULT_GOVERNANCE_THRESHOLD
    ? Number(process.env.VAULT_GOVERNANCE_THRESHOLD)
    : 1;

  try {
    if (threshold > 1) {
      // Multi-sig path: create a pending proposal; signers must co-sign via
      // POST /api/admin/multisig/sign before the upgrade executes.
      const pool = getWritePool();
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO admin_multisig_proposals
           (op_type, params, proposed_by, signatures, threshold, status)
         VALUES ('Upgrade', $1, $2, ARRAY[$2], $3, 'pending')
         RETURNING id`,
        [JSON.stringify({ new_wasm_hash, reason }), performedBy, threshold]
      );

      const proposalId = rows[0]?.id;

      await auditLog('vault.upgrade.proposed', performedBy, req.ip, {
        proposal_id: proposalId,
        new_wasm_hash,
        reason: reason ?? null,
        threshold,
      });

      logger.info('[admin] Upgrade proposal created', { proposalId, by: performedBy });

      res.status(202).json({
        status: 'pending_signatures',
        proposal_id: proposalId,
        signatures_required: threshold,
        signatures_collected: 1,
        new_wasm_hash,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Single-admin path: record the upgrade intent; the client must submit
      // the actual Soroban tx with their wallet (backend cannot sign for the
      // admin address — that requires the wallet's private key on the client).
      await auditLog('vault.upgrade', performedBy, req.ip, {
        new_wasm_hash,
        reason: reason ?? null,
      });

      logger.warn('[admin] Upgrade authorised (single-admin)', {
        new_wasm_hash,
        by: performedBy,
      });

      res.json({
        status: 'authorised',
        new_wasm_hash,
        // Return unsigned XDR parameters the client wallet will sign and submit
        message: 'Upgrade authorised. Submit the Soroban transaction from your wallet.',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    await auditLog('vault.upgrade', performedBy, req.ip, { new_wasm_hash }, 'failure');
    logger.error('[admin/upgrade] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to initiate upgrade' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/multisig/ops   — Issue #263
// List pending multi-sig proposals
// ---------------------------------------------------------------------------

adminRouter.get('/multisig/ops', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getReadPool();
    const { rows } = await pool.query(
      `SELECT id, op_type, params, proposed_by, signatures,
              threshold, status, created_at, expires_at
       FROM admin_multisig_proposals
       WHERE status IN ('pending', 'ready')
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ proposals: rows, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[admin/multisig/ops] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to fetch multi-sig proposals' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/multisig/sign   — Issue #263
// Body: { proposal_id: number }
// Adds the calling admin's signature to a pending proposal
// ---------------------------------------------------------------------------

const signBodySchema = z.object({
  proposal_id: z.number().int().positive(),
});

adminRouter.post('/multisig/sign', async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as { sub?: string } | undefined;
  const signer = user?.sub ?? 'unknown';

  const parsed = signBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
    return;
  }

  const { proposal_id } = parsed.data;

  try {
    const pool = getWritePool();

    // Fetch proposal
    const { rows } = await pool.query(
      `SELECT * FROM admin_multisig_proposals WHERE id = $1`,
      [proposal_id]
    );

    const proposal = rows[0];
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }
    if (proposal.status !== 'pending') {
      res.status(409).json({ error: `Proposal is ${proposal.status as string}, not pending` });
      return;
    }

    const sigs: string[] = proposal.signatures ?? [];
    if (sigs.includes(signer)) {
      res.status(409).json({ error: 'Already signed by this address' });
      return;
    }

    const newSigs = [...sigs, signer];
    const newStatus = newSigs.length >= (proposal.threshold as number) ? 'ready' : 'pending';

    await pool.query(
      `UPDATE admin_multisig_proposals
       SET signatures = $1, status = $2
       WHERE id = $3`,
      [newSigs, newStatus, proposal_id]
    );

    await auditLog('vault.multisig.sign', signer, req.ip, {
      proposal_id,
      sig_count: newSigs.length,
      threshold: proposal.threshold,
      new_status: newStatus,
    });

    logger.info('[admin] Multi-sig signed', { proposal_id, signer, newStatus });

    res.json({
      proposal_id,
      signatures_collected: newSigs.length,
      signatures_required:  proposal.threshold as number,
      status: newStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[admin/multisig/sign] error', { err: String(err) });
    res.status(500).json({ error: 'Failed to sign proposal' });
  }
});

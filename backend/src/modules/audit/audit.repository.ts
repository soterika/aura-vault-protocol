/**
 * Audit Repository
 *
 * Persistent, indexed replacement for the former in-memory audit store.
 * All three hot-path query shapes now execute O(log n) index scans instead
 * of O(n) full-table scans:
 *
 *   findUnanchored  — partial index on (created_at) WHERE anchor_hash IS NULL
 *   findAllInRange  — B-tree index on (created_at)
 *   query           — composite indexes on (actor, created_at),
 *                     (entity_type, created_at), (entity_id, created_at),
 *                     (actor, entity_type, entity_id, created_at)
 *
 * Write path uses the primary pool; read path uses the read-replica pool so
 * bulk audit list/export requests don't saturate the primary.
 */

import { getWritePool, getReadPool } from "../../db.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface AuditLog {
  id: bigint;
  actor: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown>;
  anchorHash: string | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  actor: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

/** Filters accepted by `query()`.  All fields are optional and ANDed together. */
export interface AuditQueryFilter {
  actor?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Inclusive upper bound on `created_at`. */
  to?: Date;
  /** Maximum rows to return.  Defaults to 100; capped at 1 000. */
  limit?: number;
  /** Zero-based row offset for cursor/page-based pagination. */
  offset?: number;
}

export interface AuditQueryResult {
  logs: AuditLog[];
  /** Total matching rows (ignoring limit/offset). */
  total: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Map a raw Postgres row (snake_case) to the public AuditLog shape.
 * `id` is returned as bigint to avoid JS precision loss on BIGSERIAL values.
 */
function rowToAuditLog(row: Record<string, unknown>): AuditLog {
  return {
    id: BigInt(row.id as string),
    actor: row.actor as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    action: row.action as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    anchorHash: (row.anchor_hash as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class AuditRepository {
  /**
   * Insert a new audit log entry and return the persisted record.
   *
   * Uses the write pool (primary DB) to guarantee read-your-writes consistency
   * within the same request lifecycle.
   */
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const pool = getWritePool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `INSERT INTO audit_logs (actor, entity_type, entity_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.actor,
        input.entityType,
        input.entityId,
        input.action,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    return rowToAuditLog(rows[0]);
  }

  /**
   * Return all log entries that have not yet been anchored (anchor_hash IS NULL),
   * ordered oldest-first so the anchoring scheduler processes them in
   * insertion order.
   *
   * Uses the partial index `idx_audit_logs_unanchored`  — O(log n) where n is
   * the number of *unanchored* rows, not the total table size.
   *
   * Uses the write pool so the scheduler always sees freshly-inserted rows
   * without replica lag.
   */
  async findUnanchored(): Promise<AuditLog[]> {
    const pool = getWritePool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT *
       FROM audit_logs
       WHERE anchor_hash IS NULL
       ORDER BY created_at ASC`
    );
    return rows.map(rowToAuditLog);
  }

  /**
   * Return all log entries created within [from, to] inclusive, ordered
   * oldest-first.  Used by compliance export and the anchoring range queries.
   *
   * Uses the `idx_audit_logs_created_at` B-tree index — O(log n + k) where
   * k is the number of matching rows.
   *
   * Routes to the read-replica pool to keep export traffic off the primary.
   */
  async findAllInRange(from: Date, to: Date): Promise<AuditLog[]> {
    const pool = getReadPool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT *
       FROM audit_logs
       WHERE created_at >= $1
         AND created_at <= $2
       ORDER BY created_at ASC`,
      [from, to]
    );
    return rows.map(rowToAuditLog);
  }

  /**
   * Flexible paginated query with optional filters on actor, entity_type,
   * entity_id, and a time range.
   *
   * The query planner picks from several multi-column indexes depending on
   * which filters are present:
   *   - actor only              → idx_audit_logs_actor_created
   *   - entity_type only        → idx_audit_logs_entity_type_created
   *   - entity_id only          → idx_audit_logs_entity_id_created
   *   - actor + entity_type/id  → idx_audit_logs_actor_entity
   *
   * Both the filtered rows and the total count are returned in a single
   * round-trip using a window function so callers can render pagination UI
   * without a second COUNT(*) query.
   *
   * Routes to the read-replica pool (audit list/export is read-only).
   */
  async query(filter: AuditQueryFilter = {}): Promise<AuditQueryResult> {
    const pool = getReadPool();

    const MAX_LIMIT = 1_000;
    const limit = Math.min(filter.limit ?? 100, MAX_LIMIT);
    const offset = filter.offset ?? 0;

    // Build the WHERE clause dynamically to ensure the query planner sees only
    // the predicates that are actually provided, allowing index selection based
    // on the real filter set.
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.actor !== undefined) {
      conditions.push(`actor = $${paramIdx++}`);
      params.push(filter.actor);
    }
    if (filter.entityType !== undefined) {
      conditions.push(`entity_type = $${paramIdx++}`);
      params.push(filter.entityType);
    }
    if (filter.entityId !== undefined) {
      conditions.push(`entity_id = $${paramIdx++}`);
      params.push(filter.entityId);
    }
    if (filter.action !== undefined) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(filter.action);
    }
    if (filter.from !== undefined) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(filter.to);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Window function returns total count alongside each data row so we avoid
    // a second round-trip for pagination metadata.
    const sql = `
      SELECT *, COUNT(*) OVER () AS total_count
      FROM   audit_logs
      ${where}
      ORDER  BY created_at DESC
      LIMIT  $${paramIdx++}
      OFFSET $${paramIdx++}
    `;
    params.push(limit, offset);

    const { rows } = await pool.query<Record<string, unknown>>(sql, params);

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const logs = rows.map(rowToAuditLog);

    return { logs, total };
  }

  /**
   * Stamp a batch of log entries with their anchor hash.
   * Called by the anchoring scheduler after computing the chain hash for a
   * batch of unanchored logs.
   *
   * Uses the write pool and returns the number of rows actually updated.
   */
  async setAnchorHash(ids: bigint[], anchorHash: string): Promise<number> {
    if (ids.length === 0) return 0;

    const pool = getWritePool();

    // ANY($1::bigint[]) maps to the primary-key index — O(k log n) for k ids.
    const { rowCount } = await pool.query(
      `UPDATE audit_logs
       SET    anchor_hash = $1
       WHERE  id = ANY($2::bigint[])
         AND  anchor_hash IS NULL`,
      [anchorHash, ids.map(String)]
    );

    return rowCount ?? 0;
  }

  /**
   * Fetch a single audit log entry by its surrogate key.
   * Useful for anchoring scheduler idempotency checks.
   */
  async findById(id: bigint): Promise<AuditLog | null> {
    const pool = getReadPool();
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM audit_logs WHERE id = $1`,
      [String(id)]
    );
    return rows.length > 0 ? rowToAuditLog(rows[0]) : null;
  }
}

// Singleton export for use across the application (consistent pool reuse).
export const auditRepository = new AuditRepository();

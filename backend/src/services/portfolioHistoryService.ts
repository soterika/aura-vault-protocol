/**
 * Portfolio History Service — Issue #290
 *
 * Persists vault events (deposit / withdraw / harvest) to `vault_events_history`
 * and exposes paginated, filtered reads for the portfolio history endpoint.
 *
 * All queries use parameterized placeholders to prevent SQL injection.
 */

import { getWritePool, getReadPool } from "../db.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VaultEventType = "deposit" | "withdraw" | "harvest";

export interface VaultEventRecord {
  id: number;
  address: string;
  type: VaultEventType;
  amount: string;
  shares: string;
  tx_hash: string;
  timestamp: string; // ISO-8601
}

export interface PortfolioHistoryQuery {
  page?: number;
  pageSize?: number;
  type?: VaultEventType;
  dateFrom?: string; // ISO-8601
  dateTo?: string;   // ISO-8601
}

export interface PortfolioHistoryResult {
  items: VaultEventRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** Lifetime deposits and withdrawals for a wallet, in the ledger's base units. */
export async function getPortfolioTotals(address: string): Promise<{ totalDeposited: string; totalWithdrawn: string }> {
  const pool = getReadPool();
  const result = await pool.query<{ total_deposited: string; total_withdrawn: string }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)::TEXT AS total_deposited,
       COALESCE(SUM(amount) FILTER (WHERE type = 'withdraw'), 0)::TEXT AS total_withdrawn
     FROM vault_events_history
     WHERE address = $1`,
    [address],
  );
  return {
    totalDeposited: result.rows[0]?.total_deposited ?? "0",
    totalWithdrawn: result.rows[0]?.total_withdrawn ?? "0",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write — called by the Horizon event stream listener
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a single vault event to `vault_events_history`.
 * Called by the Horizon event listener whenever a confirmed on-chain event
 * for a deposit, withdraw, or harvest is received.
 */
export async function persistVaultEvent(
  address: string,
  type: VaultEventType,
  amount: string | bigint,
  shares: string | bigint,
  txHash: string,
  timestamp: Date,
): Promise<void> {
  const pool = getWritePool();
  await pool.query(
    `INSERT INTO vault_events_history (address, type, amount, shares, tx_hash, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [address, type, amount.toString(), shares.toString(), txHash, timestamp.toISOString()],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Read — paginated, filtered history for GET /api/portfolio/:address/history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch paginated history for a wallet address.
 *
 * Supports:
 *  - page / pageSize (1-based, max pageSize = 100)
 *  - type filter: "deposit" | "withdraw" | "harvest"
 *  - dateFrom / dateTo: ISO-8601 timestamp range (inclusive)
 *
 * All user-supplied values are passed as parameterized query arguments —
 * no string interpolation of external input.
 */
export async function getPortfolioHistory(
  address: string,
  query: PortfolioHistoryQuery,
): Promise<PortfolioHistoryResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  // Build the WHERE clause dynamically with parameterized placeholders
  const conditions: string[] = ["address = $1"];
  const params: unknown[] = [address];
  let paramIdx = 2;

  if (query.type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(query.type);
  }
  if (query.dateFrom) {
    conditions.push(`timestamp >= $${paramIdx++}`);
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    conditions.push(`timestamp <= $${paramIdx++}`);
    params.push(query.dateTo);
  }

  const whereClause = conditions.join(" AND ");

  const pool = getReadPool();

  // Execute data query and count query in parallel
  const dataParams = [...params, pageSize, offset];
  const [dataResult, countResult] = await Promise.all([
    pool.query<VaultEventRecord>(
      `SELECT id, address, type, amount::TEXT, shares::TEXT, tx_hash, timestamp
       FROM vault_events_history
       WHERE ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      dataParams,
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM vault_events_history
       WHERE ${whereClause}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  const items: VaultEventRecord[] = dataResult.rows.map((row) => ({
    id: row.id,
    address: row.address,
    type: row.type,
    amount: row.amount,
    shares: row.shares,
    tx_hash: row.tx_hash,
    timestamp:
      row.timestamp instanceof Date
        ? row.timestamp.toISOString()
        : String(row.timestamp),
  }));

  return { items, total, page, pageSize };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — used by the Horizon listener integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch-persist an array of vault events in a single transaction.
 * Silently skips rows whose tx_hash already exists (idempotent replay).
 */
export async function batchPersistVaultEvents(
  events: Array<{
    address: string;
    type: VaultEventType;
    amount: string | bigint;
    shares: string | bigint;
    txHash: string;
    timestamp: Date;
  }>,
): Promise<number> {
  if (events.length === 0) return 0;

  const pool = getWritePool();
  const client = await pool.connect();
  let inserted = 0;

  try {
    await client.query("BEGIN");
    for (const ev of events) {
      const result = await client.query(
        `INSERT INTO vault_events_history (address, type, amount, shares, tx_hash, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [ev.address, ev.type, ev.amount.toString(), ev.shares.toString(), ev.txHash, ev.timestamp.toISOString()],
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "[portfolioHistoryService] batchPersistVaultEvents failed");
    throw err;
  } finally {
    client.release();
  }

  return inserted;
}

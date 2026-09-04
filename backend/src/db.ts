/**
 * Database connection pools — Issue #856
 *
 * Production-grade pg pool configuration:
 * - Configurable pool sizing via env vars (PG_POOL_MIN, PG_POOL_MAX)
 * - 30-second idle timeout (PG_IDLE_TIMEOUT_MS)
 * - Auto-reconnect on connection loss (pg Pool handles internally)
 * - Pool stats for GET /health/db endpoint via getPoolStats()
 * - Prometheus-compatible text metrics via getPoolPrometheusMetrics()
 * - Graceful shutdown drains pool before exit via closePools()
 *
 * - getWritePool() → primary RDS instance (INSERT / UPDATE / DELETE)
 * - getReadPool()  → read replica (SELECT analytics queries)
 *
 * If DATABASE_REPLICA_URL is not set, getReadPool() falls back to the
 * primary so the app works in environments without a replica (e.g. dev).
 */

import pg from 'pg';
import { logger } from './logger.js';

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────────

const PG_POOL_MIN = parseInt(process.env.PG_POOL_MIN ?? '2', 10);
const PG_POOL_MAX = parseInt(process.env.PG_POOL_MAX ?? '10', 10);
const PG_IDLE_TIMEOUT_MS = parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? '30000', 10);
const PG_CONNECTION_TIMEOUT_MS = parseInt(process.env.PG_CONNECTION_TIMEOUT_MS ?? '5000', 10);

// ── Types ───────────────────────────────────────────────────────────────────

export interface PoolStats {
  label: string;
  total: number;
  idle: number;
  waiting: number;
  maxSize: number;
  minSize: number;
  utilization: number; // 0–1 fraction of max in use
}

// ── Error counters for Prometheus ───────────────────────────────────────────

const poolErrorCounts: Record<string, number> = {};

// ── Pool instances ──────────────────────────────────────────────────────────

let writePool: pg.Pool | null = null;
let readPool: pg.Pool | null = null;

// ── Pool factory ────────────────────────────────────────────────────────────

function createPool(connectionString: string, label: string): pg.Pool {
  poolErrorCounts[label] = 0;

  const pool = new Pool({
    connectionString,
    min: PG_POOL_MIN,
    max: PG_POOL_MAX,
    idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false,
  });

  pool.on('error', (err: Error) => {
    poolErrorCounts[label] = (poolErrorCounts[label] ?? 0) + 1;
    // Auto-reconnect: pg Pool retries on next query automatically.
    // Log with safe metadata only (no connection string).
    logger.error(
      {
        label,
        errorCount: poolErrorCounts[label],
        message: err.message,
        code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN',
      },
      `[db:${label}] Pool error #${poolErrorCounts[label]}`
    );
  });

  logger.info(
    {
      label,
      min: PG_POOL_MIN,
      max: PG_POOL_MAX,
      idleTimeoutMs: PG_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: PG_CONNECTION_TIMEOUT_MS,
    },
    `[db:${label}] Pool created`
  );

  return pool;
}

// ── Public getters ──────────────────────────────────────────────────────────

/**
 * Returns the write (primary) pool. Lazily initialised on first call.
 */
export function getWritePool(): pg.Pool {
  if (!writePool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL environment variable is not set');
    writePool = createPool(url, 'write');
  }
  return writePool;
}

/**
 * Returns the read (replica) pool.
 * Falls back to the primary if DATABASE_REPLICA_URL is not configured.
 * Lazily initialised on first call.
 */
export function getReadPool(): pg.Pool {
  if (!readPool) {
    const replicaUrl =
      process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL;
    if (!replicaUrl) {
      throw new Error(
        'Neither DATABASE_REPLICA_URL nor DATABASE_URL environment variable is set'
      );
    }
    const isReplica = !!process.env.DATABASE_REPLICA_URL;
    readPool = createPool(
      replicaUrl,
      isReplica ? 'read-replica' : 'read-fallback-primary'
    );
  }
  return readPool;
}

// ── Health check ────────────────────────────────────────────────────────────

/**
 * Pings both pools. Resolves to { write: boolean, read: boolean }.
 * Used by GET /health/db.
 */
export async function dbHealthCheck(): Promise<{ write: boolean; read: boolean }> {
  const check = async (pool: pg.Pool): Promise<boolean> => {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch {
      return false;
    }
  };

  const [write, read] = await Promise.all([
    check(getWritePool()),
    check(getReadPool()),
  ]);

  return { write, read };
}

// ── Pool stats ──────────────────────────────────────────────────────────────

/**
 * Returns live pool stats for all active pools.
 * Used by GET /health/db to report total, idle, and waiting counts.
 */
export function getPoolStats(): PoolStats[] {
  const stats: PoolStats[] = [];

  if (writePool) {
    const total = writePool.totalCount;
    stats.push({
      label: 'write',
      total,
      idle: writePool.idleCount,
      waiting: writePool.waitingCount,
      maxSize: PG_POOL_MAX,
      minSize: PG_POOL_MIN,
      utilization: PG_POOL_MAX > 0 ? total / PG_POOL_MAX : 0,
    });
  }

  if (readPool) {
    const label = process.env.DATABASE_REPLICA_URL
      ? 'read-replica'
      : 'read-fallback-primary';
    const total = readPool.totalCount;
    stats.push({
      label,
      total,
      idle: readPool.idleCount,
      waiting: readPool.waitingCount,
      maxSize: PG_POOL_MAX,
      minSize: PG_POOL_MIN,
      utilization: PG_POOL_MAX > 0 ? total / PG_POOL_MAX : 0,
    });
  }

  return stats;
}

// ── Prometheus metrics ──────────────────────────────────────────────────────

/**
 * Returns Prometheus text-format metrics for pool utilisation.
 * Exposed at GET /metrics.
 */
export function getPoolPrometheusMetrics(): string {
  const lines: string[] = [
    '# HELP pg_pool_total_connections Total connections currently in the pool',
    '# TYPE pg_pool_total_connections gauge',
    '# HELP pg_pool_idle_connections Idle connections in the pool',
    '# TYPE pg_pool_idle_connections gauge',
    '# HELP pg_pool_waiting_requests Client requests waiting for a connection',
    '# TYPE pg_pool_waiting_requests gauge',
    '# HELP pg_pool_utilization Pool utilization as a fraction of max size (0-1)',
    '# TYPE pg_pool_utilization gauge',
    '# HELP pg_pool_errors_total Total pool errors since startup',
    '# TYPE pg_pool_errors_total counter',
  ];

  if (writePool) {
    const total = writePool.totalCount;
    lines.push(`pg_pool_total_connections{pool="write"} ${total}`);
    lines.push(`pg_pool_idle_connections{pool="write"} ${writePool.idleCount}`);
    lines.push(`pg_pool_waiting_requests{pool="write"} ${writePool.waitingCount}`);
    lines.push(
      `pg_pool_utilization{pool="write"} ${PG_POOL_MAX > 0 ? (total / PG_POOL_MAX).toFixed(4) : 0}`
    );
    lines.push(`pg_pool_errors_total{pool="write"} ${poolErrorCounts['write'] ?? 0}`);
  }

  if (readPool) {
    const label = process.env.DATABASE_REPLICA_URL
      ? 'read-replica'
      : 'read-fallback-primary';
    const total = readPool.totalCount;
    lines.push(`pg_pool_total_connections{pool="${label}"} ${total}`);
    lines.push(`pg_pool_idle_connections{pool="${label}"} ${readPool.idleCount}`);
    lines.push(`pg_pool_waiting_requests{pool="${label}"} ${readPool.waitingCount}`);
    lines.push(
      `pg_pool_utilization{pool="${label}"} ${PG_POOL_MAX > 0 ? (total / PG_POOL_MAX).toFixed(4) : 0}`
    );
    lines.push(`pg_pool_errors_total{pool="${label}"} ${poolErrorCounts[label] ?? 0}`);
  }

  return lines.join('\n') + '\n';
}

// ── Graceful shutdown ───────────────────────────────────────────────────────

/**
 * Gracefully drain and close all pools.
 * Waits for in-flight queries to finish before closing.
 * Call this during server shutdown, after stopping new connections.
 */
export async function closePools(): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (writePool) {
    logger.info('[db:write] Draining connection pool before shutdown...');
    tasks.push(
      writePool.end().then(() => {
        logger.info('[db:write] Pool drained and closed');
      })
    );
  }

  if (readPool) {
    logger.info('[db:read] Draining connection pool before shutdown...');
    tasks.push(
      readPool.end().then(() => {
        logger.info('[db:read] Pool drained and closed');
      })
    );
  }

  await Promise.all(tasks);
  writePool = null;
  readPool = null;
}

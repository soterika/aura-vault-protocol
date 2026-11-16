/**
 * runner.ts — Database migration engine for Aura Vault Protocol (Issue #293).
 *
 * Features:
 *   - Versioned SQL migration files (.sql in backend/migrations/)
 *   - Reversible migrations with up and down sections
 *   - schema_migrations tracking table
 *   - schema_migrations_lock table to prevent concurrent migration execution
 *   - Up, Down, Status, and Check operations
 *   - Auto-run on application startup
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getWritePool } from "../db.js";
import { logger } from "../logger.js";

export interface MigrationFile {
  name: string;
  filename: string;
  upSql: string;
  downSql: string;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  all: string[];
}

export class MigrationLockError extends Error {
  constructor(message = "Migration lock is currently held by another process") {
    super(message);
    this.name = "MigrationLockError";
  }
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

function getDefaultMigrationsDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate1 = path.resolve(currentDir, "../../migrations");
  const candidate2 = path.resolve(process.cwd(), "migrations");
  const candidate3 = path.resolve(process.cwd(), "backend/migrations");

  if (fs.existsSync(candidate1)) return candidate1;
  if (fs.existsSync(candidate2)) return candidate2;
  if (fs.existsSync(candidate3)) return candidate3;
  return candidate1;
}

// ---------------------------------------------------------------------------
// File parser
// ---------------------------------------------------------------------------

export function parseMigrationSql(content: string, filename: string): MigrationFile {
  const name = filename.replace(/\.sql$/, "");
  const downMarkerRegex = /^--\s*(?:Down Migration|down|>>> DOWN >>>).*$/im;
  const match = content.match(downMarkerRegex);

  if (match && match.index !== undefined) {
    const upSql = content.slice(0, match.index).trim();
    const downSql = content.slice(match.index + match[0].length).trim();
    return { name, filename, upSql, downSql };
  }

  return {
    name,
    filename,
    upSql: content.trim(),
    downSql: `-- No explicit down migration defined for ${name}`,
  };
}

export function loadMigrationFiles(dir: string = getDefaultMigrationsDir()): MigrationFile[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  return files.map((file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    return parseMigrationSql(content, file);
  });
}

// ---------------------------------------------------------------------------
// Schema & Lock setup
// ---------------------------------------------------------------------------

async function ensureMigrationTables(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS schema_migrations_lock (
      id INT PRIMARY KEY,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      locked_at TIMESTAMPTZ NULL,
      locked_by VARCHAR(255) NULL
    );

    INSERT INTO schema_migrations_lock (id, is_locked)
    VALUES (1, FALSE)
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function acquireLock(client: pg.PoolClient, processId = `process-${process.pid}`): Promise<void> {
  const result = await client.query(
    `
    UPDATE schema_migrations_lock
    SET is_locked = TRUE, locked_at = NOW(), locked_by = $1
    WHERE id = 1 AND is_locked = FALSE
    RETURNING *;
    `,
    [processId]
  );

  if (result.rowCount === 0) {
    throw new MigrationLockError();
  }
}

async function releaseLock(client: pg.PoolClient): Promise<void> {
  await client.query(`
    UPDATE schema_migrations_lock
    SET is_locked = FALSE, locked_at = NULL, locked_by = NULL
    WHERE id = 1;
  `);
}

// ---------------------------------------------------------------------------
// Migration Operations
// ---------------------------------------------------------------------------

export async function getMigrationStatus(options?: {
  pool?: pg.Pool;
  migrationsDir?: string;
}): Promise<MigrationStatus> {
  const pool = options?.pool ?? getWritePool();
  const dir = options?.migrationsDir ?? getDefaultMigrationsDir();
  const allFiles = loadMigrationFiles(dir);
  const allNames = allFiles.map((f) => f.name);

  const client = await pool.connect();
  try {
    await ensureMigrationTables(client);
    const res = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY id ASC;"
    );
    const applied = res.rows.map((r) => r.name);
    const appliedSet = new Set(applied);
    const pending = allNames.filter((name) => !appliedSet.has(name));

    return { applied, pending, all: allNames };
  } finally {
    client.release();
  }
}

export async function runMigrationsUp(options?: {
  pool?: pg.Pool;
  target?: string;
  migrationsDir?: string;
}): Promise<string[]> {
  const pool = options?.pool ?? getWritePool();
  const dir = options?.migrationsDir ?? getDefaultMigrationsDir();
  const allFiles = loadMigrationFiles(dir);

  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await ensureMigrationTables(client);
    await acquireLock(client);

    try {
      const res = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY id ASC;"
      );
      const appliedSet = new Set(res.rows.map((r) => r.name));

      for (const migration of allFiles) {
        if (appliedSet.has(migration.name)) {
          continue;
        }

        logger.info(`[migrations] Running UP: ${migration.filename}`);
        await client.query("BEGIN;");
        try {
          if (migration.upSql) {
            await client.query(migration.upSql);
          }
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1);",
            [migration.name]
          );
          await client.query("COMMIT;");
          appliedNow.push(migration.name);
          logger.info(`[migrations] Applied: ${migration.name}`);
        } catch (err) {
          await client.query("ROLLBACK;");
          logger.error(`[migrations] Failed running migration ${migration.name}:`, err);
          throw err;
        }

        if (options?.target && migration.name === options.target) {
          break;
        }
      }
    } finally {
      await releaseLock(client);
    }
  } finally {
    client.release();
  }

  return appliedNow;
}

export async function runMigrationsDown(options?: {
  pool?: pg.Pool;
  steps?: number;
  target?: string;
  migrationsDir?: string;
}): Promise<string[]> {
  const pool = options?.pool ?? getWritePool();
  const dir = options?.migrationsDir ?? getDefaultMigrationsDir();
  const allFiles = loadMigrationFiles(dir);
  const fileMap = new Map(allFiles.map((f) => [f.name, f]));

  const client = await pool.connect();
  const rolledBack: string[] = [];
  const steps = options?.steps ?? (options?.target ? Number.MAX_SAFE_INTEGER : 1);

  try {
    await ensureMigrationTables(client);
    await acquireLock(client);

    try {
      const res = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY id DESC;"
      );
      const appliedMigrations = res.rows.map((r) => r.name);

      let executed = 0;
      for (const name of appliedMigrations) {
        if (executed >= steps) break;

        const migration = fileMap.get(name);
        if (!migration) {
          logger.warn(`[migrations] Migration file for ${name} not found locally, removing record`);
          await client.query("DELETE FROM schema_migrations WHERE name = $1;", [name]);
          rolledBack.push(name);
          executed++;
          continue;
        }

        logger.info(`[migrations] Running DOWN: ${migration.filename}`);
        await client.query("BEGIN;");
        try {
          if (migration.downSql) {
            await client.query(migration.downSql);
          }
          await client.query("DELETE FROM schema_migrations WHERE name = $1;", [name]);
          await client.query("COMMIT;");
          rolledBack.push(name);
          executed++;
          logger.info(`[migrations] Rolled back: ${name}`);
        } catch (err) {
          await client.query("ROLLBACK;");
          logger.error(`[migrations] Failed rolling back ${name}:`, err);
          throw err;
        }

        if (options?.target && name === options.target) {
          break;
        }
      }
    } finally {
      await releaseLock(client);
    }
  } finally {
    client.release();
  }

  return rolledBack;
}

export async function checkPendingMigrations(options?: {
  pool?: pg.Pool;
  migrationsDir?: string;
  throwOnPending?: boolean;
}): Promise<{ hasPending: boolean; pending: string[] }> {
  const status = await getMigrationStatus(options);
  const hasPending = status.pending.length > 0;

  if (hasPending && options?.throwOnPending) {
    throw new Error(
      `Pending database migrations detected (${status.pending.length}):\n  - ${status.pending.join("\n  - ")}`
    );
  }

  return { hasPending, pending: status.pending };
}

// ---------------------------------------------------------------------------
// Auto-migrate on startup
// ---------------------------------------------------------------------------

export async function autoMigrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.info("[migrations] DATABASE_URL not configured, skipping auto-migration");
    return;
  }

  try {
    logger.info("[migrations] Checking database schema status...");
    const applied = await runMigrationsUp();
    if (applied.length > 0) {
      logger.info(`[migrations] Successfully applied ${applied.length} pending migration(s) on startup`);
    } else {
      logger.info("[migrations] Database schema is up to date");
    }
  } catch (err) {
    logger.error("[migrations] Error during auto-migration on startup:", err);
  }
}

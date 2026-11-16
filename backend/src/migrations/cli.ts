#!/usr/bin/env tsx
/**
 * cli.ts — Command-line interface for Aura Vault database migrations.
 *
 * Usage:
 *   npx tsx src/migrations/cli.ts up
 *   npx tsx src/migrations/cli.ts down [steps]
 *   npx tsx src/migrations/cli.ts status
 *   npx tsx src/migrations/cli.ts check
 */

import {
  runMigrationsUp,
  runMigrationsDown,
  getMigrationStatus,
  checkPendingMigrations,
} from "./runner.js";
import { closePools } from "../db.js";
import { logger } from "../logger.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "status";

  try {
    switch (command) {
      case "up": {
        const target = args[1];
        logger.info(`[migrate] Running migrations UP${target ? ` up to ${target}` : ""}...`);
        const applied = await runMigrationsUp({ target });
        logger.info(`[migrate] Successfully applied ${applied.length} migration(s).`);
        break;
      }

      case "down": {
        const stepsArg = args[1];
        const steps = stepsArg ? parseInt(stepsArg, 10) : 1;
        logger.info(`[migrate] Running migrations DOWN (${steps} step(s))...`);
        const rolledBack = await runMigrationsDown({ steps });
        logger.info(`[migrate] Successfully rolled back ${rolledBack.length} migration(s).`);
        break;
      }

      case "status": {
        const status = await getMigrationStatus();
        logger.info("\n=== Migration Status ===");
        logger.info(`Total migrations:   ${status.all.length}`);
        logger.info(`Applied:            ${status.applied.length}`);
        logger.info(`Pending:            ${status.pending.length}\n`);

        if (status.applied.length > 0) {
          logger.info("Applied Migrations:");
          status.applied.forEach((m) => logger.info(`  ✓ ${m}`));
        }

        if (status.pending.length > 0) {
          logger.info("\nPending Migrations:");
          status.pending.forEach((m) => logger.info(`  ✗ ${m}`));
        }
        logger.info("");
        break;
      }

      case "check": {
        const { hasPending, pending } = await checkPendingMigrations({ throwOnPending: false });
        if (hasPending) {
          logger.error(`\n[migrate:check] FAILED: ${pending.length} pending migration(s) found against database:`);
          pending.forEach((m) => logger.error(`  - ${m}`));
          logger.error("\nRun 'npm run migrate:up' to apply pending migrations.\n");
          process.exit(1);
        } else {
          logger.info("[migrate:check] OK: All database migrations are applied.");
        }
        break;
      }

      default:
        logger.error(`Unknown command: ${command}`);
        logger.info("Available commands: up, down [steps], status, check");
        process.exit(1);
    }
  } catch (err) {
    logger.error("[migrate] Error executing command:", err);
    process.exit(1);
  } finally {
    await closePools().catch(() => {});
  }
}

void main();

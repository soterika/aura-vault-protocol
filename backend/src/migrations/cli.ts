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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "status";

  try {
    switch (command) {
      case "up": {
        const target = args[1];
        console.info(`[migrate] Running migrations UP${target ? ` up to ${target}` : ""}...`);
        const applied = await runMigrationsUp({ target });
        console.info(`[migrate] Successfully applied ${applied.length} migration(s).`);
        break;
      }

      case "down": {
        const stepsArg = args[1];
        const steps = stepsArg ? parseInt(stepsArg, 10) : 1;
        console.info(`[migrate] Running migrations DOWN (${steps} step(s))...`);
        const rolledBack = await runMigrationsDown({ steps });
        console.info(`[migrate] Successfully rolled back ${rolledBack.length} migration(s).`);
        break;
      }

      case "status": {
        const status = await getMigrationStatus();
        console.info("\n=== Migration Status ===");
        console.info(`Total migrations:   ${status.all.length}`);
        console.info(`Applied:            ${status.applied.length}`);
        console.info(`Pending:            ${status.pending.length}\n`);

        if (status.applied.length > 0) {
          console.info("Applied Migrations:");
          status.applied.forEach((m) => console.info(`  ✓ ${m}`));
        }

        if (status.pending.length > 0) {
          console.info("\nPending Migrations:");
          status.pending.forEach((m) => console.info(`  ✗ ${m}`));
        }
        console.info("");
        break;
      }

      case "check": {
        const { hasPending, pending } = await checkPendingMigrations({ throwOnPending: false });
        if (hasPending) {
          console.error(`\n[migrate:check] FAILED: ${pending.length} pending migration(s) found against database:`);
          pending.forEach((m) => console.error(`  - ${m}`));
          console.error("\nRun 'npm run migrate:up' to apply pending migrations.\n");
          process.exit(1);
        } else {
          console.info("[migrate:check] OK: All database migrations are applied.");
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.info("Available commands: up, down [steps], status, check");
        process.exit(1);
    }
  } catch (err) {
    console.error("[migrate] Error executing command:", err);
    process.exit(1);
  } finally {
    await closePools().catch(() => {});
  }
}

void main();

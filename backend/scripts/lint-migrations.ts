#!/usr/bin/env ts-node
/**
 * lint-migrations.ts
 *
 * Pre-deployment migration safety check (Issue #962).
 *
 * Validates that every pending SQL migration file is backwards-compatible
 * and non-destructive, so that a rollback can be performed without data loss
 * if the deployment must be reverted.
 *
 * Checks performed:
 *   1. No DROP TABLE statements
 *   2. No DROP COLUMN statements
 *   3. No NOT NULL additions to existing tables without a DEFAULT value
 *   4. No column renames (ALTER TABLE … RENAME COLUMN)
 *
 * Override:
 *   Any of the above violations can be suppressed for a specific file by
 *   including a structured justification comment at the top of the migration:
 *
 *     -- lint-migrations: allow DROP TABLE   reason: removing legacy foo table after 2-sprint deprecation window
 *     -- lint-migrations: allow DROP COLUMN  reason: column migrated to new table in 020
 *     -- lint-migrations: allow NOT NULL     reason: backfill script in deploy runbook step 4
 *     -- lint-migrations: allow RENAME       reason: coordinated dual-read window in place
 *
 * Usage:
 *   ts-node backend/scripts/lint-migrations.ts [--dir <path>] [--verbose]
 *
 * Exit codes:
 *   0  All checks passed (or all violations are properly overridden)
 *   1  One or more violations found without a valid override comment
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MIGRATIONS_DIR = path.resolve(
  __dirname,
  "..",
  "migrations"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  rule: RuleKey;
  text: string;
}

type RuleKey = "DROP TABLE" | "DROP COLUMN" | "NOT NULL" | "RENAME";

interface RuleDefinition {
  key: RuleKey;
  /** Pattern that flags a potential violation */
  pattern: RegExp;
  /** Pattern that confirms the statement is NOT a violation (e.g. safe forms) */
  safePattern?: RegExp;
  description: string;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const RULES: RuleDefinition[] = [
  {
    key: "DROP TABLE",
    // Matches: DROP TABLE, DROP TABLE IF EXISTS
    pattern: /\bDROP\s+TABLE\b/i,
    description: "DROP TABLE is destructive and blocks rollback",
  },
  {
    key: "DROP COLUMN",
    // Matches: ALTER TABLE … DROP COLUMN
    pattern: /\bDROP\s+COLUMN\b/i,
    description: "DROP COLUMN removes data and blocks rollback",
  },
  {
    key: "NOT NULL",
    // Matches: ADD COLUMN … NOT NULL  or  ALTER COLUMN … SET NOT NULL
    // without a DEFAULT clause on the same logical statement
    pattern:
      /\b(ADD\s+COLUMN|ALTER\s+COLUMN)\b[^;]*\bNOT\s+NULL\b(?![^;]*\bDEFAULT\b)/i,
    description:
      "Adding NOT NULL without DEFAULT fails for tables with existing rows",
  },
  {
    key: "RENAME",
    // Matches: ALTER TABLE … RENAME COLUMN
    pattern: /\bRENAME\s+COLUMN\b/i,
    description:
      "Renaming a column is a breaking change for code still reading the old name",
  },
];

// ---------------------------------------------------------------------------
// Override comment parsing
// ---------------------------------------------------------------------------

/**
 * Parses the migration file for override directives.
 *
 * A valid override looks like:
 *   -- lint-migrations: allow <RULE KEY>   reason: <free text>
 *
 * The "reason:" portion is required; without it the override is invalid and
 * the violation is still reported.
 */
function parseOverrides(content: string): Set<RuleKey> {
  const allowed = new Set<RuleKey>();
  const overrideRe =
    /--\s*lint-migrations:\s*allow\s+(DROP TABLE|DROP COLUMN|NOT NULL|RENAME)\s+reason:\s*\S/gi;

  let match: RegExpExecArray | null;
  while ((match = overrideRe.exec(content)) !== null) {
    allowed.add(match[1].toUpperCase() as RuleKey);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Per-file linting
// ---------------------------------------------------------------------------

function lintFile(filePath: string, verbose: boolean): Violation[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const overrides = parseOverrides(content);
  const violations: Violation[] = [];
  const lines = content.split("\n");
  const fileName = path.basename(filePath);

  for (const rule of RULES) {
    if (overrides.has(rule.key)) {
      if (verbose) {
        console.log(
          `  [OVERRIDE] ${fileName}: rule "${rule.key}" suppressed with justification`
        );
      }
      continue;
    }

    lines.forEach((line, idx) => {
      // Skip pure SQL comments
      const trimmed = line.trim();
      if (trimmed.startsWith("--")) return;

      if (rule.pattern.test(line)) {
        violations.push({
          file: fileName,
          line: idx + 1,
          rule: rule.key,
          text: trimmed,
        });
      }
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");
  const dirFlagIdx = args.findIndex((a) => a === "--dir" || a === "-d");
  const migrationsDir =
    dirFlagIdx !== -1 && args[dirFlagIdx + 1]
      ? path.resolve(args[dirFlagIdx + 1])
      : DEFAULT_MIGRATIONS_DIR;

  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌  Migrations directory not found: ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(migrationsDir, f));

  if (files.length === 0) {
    console.log("ℹ️  No migration files found. Nothing to lint.");
    process.exit(0);
  }

  console.log(`🔍  Linting ${files.length} migration file(s) in ${migrationsDir}\n`);

  const allViolations: Violation[] = [];

  for (const file of files) {
    const violations = lintFile(file, verbose);
    if (verbose || violations.length > 0) {
      console.log(`  📄  ${path.basename(file)}`);
    }
    for (const v of violations) {
      console.log(
        `       ❌  Line ${v.line} [${v.rule}]: ${v.text.slice(0, 120)}`
      );
      console.log(
        `           ${getRuleDescription(v.rule)}`
      );
    }
    allViolations.push(...violations);
  }

  console.log("");

  if (allViolations.length === 0) {
    console.log(
      "✅  All migration files passed the safety check. Deployment may proceed."
    );
    process.exit(0);
  } else {
    console.error(
      `❌  Found ${allViolations.length} violation(s) in migration files.`
    );
    console.error(
      "    Fix the violations or add an override comment with a required justification:"
    );
    console.error(
      "    -- lint-migrations: allow <RULE>  reason: <explanation>"
    );
    console.error("    Deployment is BLOCKED.");
    process.exit(1);
  }
}

function getRuleDescription(key: RuleKey): string {
  const rule = RULES.find((r) => r.key === key);
  return rule ? rule.description : "";
}

main();

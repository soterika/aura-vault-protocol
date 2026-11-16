#!/usr/bin/env node
/**
 * scripts/check-gas-regression.js
 *
 * Compares measured gas usage (gas-measurements.json) against the established
 * baseline (gas-baselines.json) and fails if any function exceeds:
 *
 *   baseline_value × 1.05  (i.e. a 5% increase threshold)
 *
 * Outputs a Markdown table with baseline, measured, delta %, and pass/fail
 * columns — suitable for posting as a GitHub PR comment.
 *
 * Usage:
 *   node scripts/check-gas-regression.js \
 *     --baseline gas-baselines.json \
 *     --measured  gas-measurements.json \
 *     [--output   gas-report.md]
 *
 * Exit codes:
 *   0 — all functions within threshold
 *   1 — one or more functions exceed threshold (CI failure)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { baseline: null, measured: null, output: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) result.baseline = args[++i];
    else if (args[i] === "--measured"  && args[i + 1]) result.measured  = args[++i];
    else if (args[i] === "--output"    && args[i + 1]) result.output    = args[++i];
  }
  if (!result.baseline || !result.measured) {
    console.error("Usage: node check-gas-regression.js --baseline <file> --measured <file> [--output <file>]");
    process.exit(1);
  }
  return result;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const { baseline: baselineFile, measured: measuredFile, output: outputFile } = parseArgs();

  const baselineData = JSON.parse(fs.readFileSync(path.resolve(baselineFile), "utf8"));
  const measuredData = JSON.parse(fs.readFileSync(path.resolve(measuredFile), "utf8"));

  const baselines  = baselineData.baselines  || baselineData;
  const measured   = measuredData.measurements || measuredData;

  const THRESHOLD_PCT = 5; // percent
  const THRESHOLD_MULT = 1 + THRESHOLD_PCT / 100;

  const rows    = [];
  let   anyFail = false;

  for (const [fn, baseline] of Object.entries(baselines)) {
    if (!(fn in measured)) {
      console.warn(`⚠  No measurement found for function "${fn}" — skipping.`);
      rows.push({ fn, baseline, actual: "—", delta: "—", status: "⚠ MISSING" });
      continue;
    }

    const actual  = measured[fn];
    const delta   = ((actual - baseline) / baseline) * 100;
    const exceeds = actual > baseline * THRESHOLD_MULT;

    if (exceeds) anyFail = true;

    rows.push({
      fn,
      baseline,
      actual,
      delta:  delta.toFixed(2),
      status: exceeds ? `❌ FAIL (+${delta.toFixed(2)}%)` : `✅ PASS`,
    });
  }

  // ── Build Markdown report ────────────────────────────────────────────────

  const header = `## ⛽ Gas Usage Report\n\nThreshold: baseline **+${THRESHOLD_PCT}%**\n`;
  const tableHeader = `
| Function     | Baseline (CPU) | Measured (CPU) | Delta      | Status        |
|:-------------|---------------:|---------------:|:----------:|:--------------|`;

  const tableRows = rows.map(({ fn, baseline, actual, delta, status }) =>
    `| \`${fn}\` | ${typeof baseline === "number" ? baseline.toLocaleString() : baseline} | ${typeof actual === "number" ? actual.toLocaleString() : actual} | ${delta === "—" ? "—" : `${delta}%`} | ${status} |`
  ).join("\n");

  const summary = anyFail
    ? "\n\n> ❌ **One or more functions exceeded the gas regression threshold.** Review the delta column and optimise before merging.\n"
    : "\n\n> ✅ **All functions are within the 5% gas regression threshold.**\n";

  const report = `${header}${tableHeader}\n${tableRows}${summary}`;

  // ── Output ───────────────────────────────────────────────────────────────

  console.log(report);

  if (outputFile) {
    fs.writeFileSync(path.resolve(outputFile), report, "utf8");
    console.log(`\nReport written to ${outputFile}`);
  }

  if (anyFail) {
    console.error("\n❌ Gas regression check FAILED — see table above.");
    process.exit(1);
  } else {
    console.log("\n✅ Gas regression check PASSED.");
    process.exit(0);
  }
}

main();

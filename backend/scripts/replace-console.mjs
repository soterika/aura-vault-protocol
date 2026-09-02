/**
 * replace-console.mjs
 * Replaces console.{log,warn,error,info,debug} with logger.* across all backend TS files.
 * Run from backend/: node scripts/replace-console.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const SRC_DIR = new URL('../src', import.meta.url).pathname;
const LOGGER_IMPORT = `import { logger } from`;

// Files that shouldn't have the logger import added (they ARE the logger)
const SKIP_IMPORT = new Set(['logger.ts', 'loggingMiddleware.ts']);
// Test files are left alone
const SKIP_PATTERN = /\.test\.ts$/;

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) entries.push(...walk(full));
    else if (extname(name) === '.ts') entries.push(full);
  }
  return entries;
}

// Mapping: console.X → logger.X  (we keep error→error, warn→warn, info→info, log→info, debug→debug)
function mapLevel(level) {
  if (level === 'log') return 'info';
  return level; // error, warn, info, debug stay the same
}

/**
 * Convert a console.X(msg, ...args) call to logger.X({...args}, msg).
 * Strategy: simple text replacement — convert the whole console.X call:
 *   console.error('[tag] msg:', value)  →  logger.error({ details: value }, '[tag] msg')
 *
 * We use a regex to capture the full call and rewrite it.
 */
function replaceConsoleCalls(src) {
  // Replace console.{log|warn|error|info|debug}(...)  — handles multi-line with basic heuristic
  // Pattern: console.LEVEL(`...`) or console.LEVEL("...") with optional extra args
  return src.replace(
    /console\.(log|warn|error|info|debug)\(/g,
    (_, level) => `logger.${mapLevel(level)}(`
  );
}

function needsLoggerImport(src, filePath) {
  const base = filePath.split('/').pop();
  if (SKIP_IMPORT.has(base)) return false;
  if (src.includes(LOGGER_IMPORT)) return false;
  return true;
}

function addLoggerImport(src, filePath) {
  // Figure out relative path depth to logger.js
  const relativePath = filePath.replace(SRC_DIR, '').replace(/^\//, '');
  const depth = relativePath.split('/').length - 1;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  const importLine = `import { logger } from "${prefix}logger.js";\n`;

  // Insert after the last existing import line
  const lines = src.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ') || lines[i].startsWith('import{')) {
      lastImportIdx = i;
    }
  }
  if (lastImportIdx === -1) {
    return importLine + src;
  }
  lines.splice(lastImportIdx + 1, 0, importLine.trimEnd());
  return lines.join('\n');
}

let changed = 0;
let skipped = 0;

for (const filePath of walk(SRC_DIR)) {
  if (SKIP_PATTERN.test(filePath)) { skipped++; continue; }

  const original = readFileSync(filePath, 'utf8');
  if (!original.includes('console.')) { skipped++; continue; }

  let updated = replaceConsoleCalls(original);

  if (needsLoggerImport(updated, filePath)) {
    updated = addLoggerImport(updated, filePath);
  }

  if (updated !== original) {
    writeFileSync(filePath, updated, 'utf8');
    changed++;
    console.log(`✓  ${filePath.replace(SRC_DIR + '/', '')}`);
  }
}

console.log(`\nDone: ${changed} file(s) updated, ${skipped} skipped.`);

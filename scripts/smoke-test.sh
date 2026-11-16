#!/usr/bin/env bash
# scripts/smoke-test.sh
#
# Thin shell wrapper invoked by blue-green-deploy.yml after each traffic switch.
# Delegates to backend/scripts/smoke-test.ts for the actual test logic.
#
# Usage:
#   BASE_URL=https://staging.aura-vault.xyz bash scripts/smoke-test.sh
#
# Environment variables:
#   BASE_URL          Backend base URL (required)
#   SMOKE_TIMEOUT_MS  Per-request timeout in milliseconds (default 5000)
#   TEST_WALLET       Stellar wallet address for auth smoke test
#   MAX_STATS_AGE_MS  Maximum stats freshness window in ms (default 120000)
#
# The script enforces a 55-second hard wall-clock limit via the `timeout`
# command. Any non-zero exit from the TypeScript runner is propagated verbatim
# so the CI/CD pipeline can detect and roll back a failed deployment.
#
# Closes #947

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:3001}"
SMOKE_TIMEOUT_MS="${SMOKE_TIMEOUT_MS:-5000}"
MAX_STATS_AGE_MS="${MAX_STATS_AGE_MS:-120000}"
HARD_TIMEOUT_SECS=55

# ── Locate Node / npx ────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[smoke-test] ERROR: node is not available on PATH" >&2
  exit 1
fi

NODE_VERSION=$(node --version)
echo "[smoke-test] Node: ${NODE_VERSION}"
echo "[smoke-test] Target: ${BASE_URL}"
echo "[smoke-test] Hard timeout: ${HARD_TIMEOUT_SECS}s"
echo ""

# ── Run the TypeScript smoke test suite ──────────────────────────────────────
export BASE_URL SMOKE_TIMEOUT_MS MAX_STATS_AGE_MS

# Use `timeout` to enforce the 30-second wall-clock limit.
# `timeout` is available on Linux (GNU coreutils) and macOS (via brew coreutils).
if command -v timeout &>/dev/null; then
  exec timeout "${HARD_TIMEOUT_SECS}" \
    npx --yes tsx "${REPO_ROOT}/backend/scripts/smoke-test.ts"
else
  # Fallback: no timeout command (CI should always have it)
  echo "[smoke-test] WARNING: timeout(1) not found; running without hard limit" >&2
  exec npx --yes tsx "${REPO_ROOT}/backend/scripts/smoke-test.ts"
fi

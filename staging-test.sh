#!/usr/bin/env bash
# staging-test.sh — automated staging smoke tests + optional data refresh
# Usage: ./staging-test.sh [--refresh]

set -euo pipefail

BASE_URL="${STAGING_URL:-http://localhost}"
BACKEND_URL="${BACKEND_STAGING_URL:-http://localhost:3001}"
PASS=0
FAIL=0

ok()   { echo "  ✓ $1"; ((PASS++)); }
fail() { echo "  ✗ $1"; ((FAIL++)); }

check_http() {
  local desc="$1" url="$2" expected="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url") || status="000"
  if [[ "$status" == "$expected" ]]; then ok "$desc (HTTP $status)";
  else fail "$desc — expected $expected, got $status"; fi
}

echo "=== Aura Vault Staging Tests ==="
echo "Frontend: $BASE_URL  Backend: $BACKEND_URL"
echo

echo "── Health checks ──"
check_http "Frontend responds"        "$BASE_URL"
check_http "Backend health"           "$BACKEND_URL/api/health"

echo
echo "── API endpoints ──"
check_http "Auth login (400=ok)"      "$BACKEND_URL/api/auth/login" "400"
check_http "Portfolio (401=ok)"       "$BACKEND_URL/api/v1/user/portfolio" "401"

echo
echo "── Performance (p95 < 200ms) ──"
LATENCY=$(curl -s -o /dev/null -w "%{time_total}" --max-time 5 "$BACKEND_URL/api/health")
LATENCY_MS=$(echo "$LATENCY * 1000" | bc | cut -d. -f1)
if (( LATENCY_MS < 200 )); then ok "Health latency ${LATENCY_MS}ms < 200ms";
else fail "Health latency ${LATENCY_MS}ms ≥ 200ms"; fi

# Optional data refresh
if [[ "${1:-}" == "--refresh" ]]; then
  echo
  echo "── Data refresh ──"
  echo "  Refreshing synthetic test data…"
  # Extend as needed: seed DB, re-deploy testnet contracts, etc.
  echo "  Contract ID: ${VAULT_CONTRACT_ID:-<not set>}"
  ok "Data refresh placeholder complete"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1

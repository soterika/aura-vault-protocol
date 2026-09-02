#!/usr/bin/env bash
# scripts/verify-testnet-deployment.sh
# Post-deployment verification for Aura Vault on Stellar Testnet

set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}  ✓${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; ((FAIL_COUNT++)); }
title() { echo -e "\n${BLUE}$1${NC}"; }

NETWORK="${1:-testnet}"
CONTRACT_ID="${2:-}"

if [ -z "$CONTRACT_ID" ]; then
  echo "Usage: $0 [network] <contract-id>"
  echo "Example: $0 testnet CAFNFVB3IS37BBMUHQNHW4QSJVDSW5UUI4P4RQGLUWUOAQK5W7VCXZ7Y"
  exit 1
fi

FAIL_COUNT=0

echo "Aura Vault Deployment Verification"
echo "=================================="
echo "Network:     $NETWORK"
echo "Contract ID: $CONTRACT_ID"

# Test 1: Contract exists on-chain
title "Test 1: On-Chain Existence"
HORIZON_RESPONSE=$(curl -s "https://horizon-${NETWORK}.stellar.org/accounts/$CONTRACT_ID")
if echo "$HORIZON_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
  BALANCE=$(echo "$HORIZON_RESPONSE" | jq -r '.balances[0].balance // "0"')
  pass "Contract exists on Horizon (balance: $BALANCE XLM)"
else
  fail "Contract not found on Horizon"
  echo "  Response: $(echo "$HORIZON_RESPONSE" | jq -r '.detail // .error // "unknown"')"
fi

# Test 2: total_assets()
title "Test 2: Read-Only Function: total_assets()"
TOTAL_ASSETS=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- total_assets 2>&1 || echo "ERROR")

if [ "$TOTAL_ASSETS" = "0" ]; then
  pass "total_assets() = 0 (newly initialized)"
elif [ "$TOTAL_ASSETS" != "ERROR" ]; then
  pass "total_assets() = $TOTAL_ASSETS"
else
  fail "total_assets() call failed"
fi

# Test 3: is_paused()
title "Test 3: Read-Only Function: is_paused()"
IS_PAUSED=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_paused 2>&1 || echo "ERROR")

if [ "$IS_PAUSED" = "false" ]; then
  pass "is_paused() = false"
elif [ "$IS_PAUSED" = "true" ]; then
  fail "Contract is paused (unexpected for new deployment)"
else
  fail "is_paused() call failed"
fi

# Test 4: Soroban RPC Health
title "Test 4: Soroban RPC Availability"
SOROBAN_RPC="https://soroban-${NETWORK}.stellar.org"
RPC_STATUS=$(curl -s -X POST "$SOROBAN_RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"getStatus","params":[]}' | \
  jq -r '.result.status // .error.message // "unknown"')

if [ "$RPC_STATUS" = "ok" ]; then
  pass "Soroban RPC is healthy"
else
  fail "Soroban RPC status: $RPC_STATUS"
fi

# Test 5: Horizon API Health
title "Test 5: Horizon API Availability"
HORIZON_STATUS=$(curl -s "https://horizon-${NETWORK}.stellar.org" | jq -r '.status_page.indicator // .error // "unknown"')
if [ -n "$HORIZON_STATUS" ] && [ "$HORIZON_STATUS" != "unknown" ]; then
  pass "Horizon API is responding"
else
  fail "Horizon API not responding properly"
fi

# Summary
title "Verification Results"
if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  echo ""
  echo "Deployment Summary:"
  echo "  Network:        $NETWORK"
  echo "  Contract ID:    $CONTRACT_ID"
  echo "  Total Assets:   $TOTAL_ASSETS"
  echo "  Is Paused:      $IS_PAUSED"
  echo "  Status:         ✓ Ready for use"
  exit 0
else
  echo -e "${RED}✗ $FAIL_COUNT test(s) failed${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Wait a few seconds and retry (ledger may not have settled)"
  echo "  2. Verify contract ID is correct: $CONTRACT_ID"
  echo "  3. Check Soroban RPC status: https://soroban-${NETWORK}.stellar.org"
  echo "  4. Check Horizon status: https://horizon-${NETWORK}.stellar.org"
  exit 1
fi

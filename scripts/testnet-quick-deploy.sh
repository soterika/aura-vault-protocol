#!/usr/bin/env bash
# scripts/testnet-quick-deploy.sh
# One-command Stellar Testnet deployment for Aura Vault

set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()     { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓ $1${NC}"; }
error()   { echo -e "${RED}[$(date +%H:%M:%S)] ✗ $1${NC}"; exit 1; }
warn()    { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠ $1${NC}"; }

# Configuration
NETWORK="testnet"
DEPLOYER_KEY="testnet-deployer-$(date +%s | tail -c 7)"
TEMP_FILE="/tmp/aura-testnet-deployment-$DEPLOYER_KEY.json"

log "Aura Vault Stellar Testnet Quick Deploy"
log "Network: $NETWORK | Deployer: $DEPLOYER_KEY"

# 1. Verify environment
log "Verifying environment..."
if ! command -v stellar &> /dev/null; then
  error "Stellar CLI not found. Install from https://github.com/stellar/stellar-cli"
fi
if ! command -v cargo &> /dev/null; then
  error "Cargo not found. Install from https://rustup.rs"
fi
if ! command -v jq &> /dev/null; then
  error "jq not found. Install via: apt-get install jq or brew install jq"
fi
success "Environment verified"

# 2. Build contract
log "Building contract..."
cd aura-vault

if [ "$1" = "--skip-tests" ]; then
  warn "Skipping tests (use --skip-tests flag)"
else
  log "Running tests..."
  cargo test > /dev/null 2>&1 || error "Tests failed"
fi

log "Building release Wasm..."
cargo build --target wasm32-unknown-unknown --release > /dev/null 2>&1 || error "Build failed"
WASM_PATH="target/wasm32-unknown-unknown/release/aura_vault.wasm"

if [ ! -f "$WASM_PATH" ]; then
  error "Wasm file not found at $WASM_PATH"
fi

WASM_SIZE=$(ls -lh "$WASM_PATH" | awk '{print $5}')
WASM_SHA=$(sha256sum "$WASM_PATH" | awk '{print $1}')
success "Built Wasm: $WASM_SIZE (SHA-256: ${WASM_SHA:0:16}...)"
cd ..

# 3. Setup keypairs
log "Setting up Testnet keypairs..."
stellar keys generate --global "$DEPLOYER_KEY" --network "$NETWORK" || true

DEPLOYER_ADDR=$(stellar keys address "$DEPLOYER_KEY")
if [ -z "$DEPLOYER_ADDR" ]; then
  error "Failed to get deployer address"
fi
log "Deployer address: $DEPLOYER_ADDR"

# 4. Fund account
log "Funding account via Friendbot..."
FRIENDBOT_RESPONSE=$(curl -s "https://friendbot.stellar.org?addr=$DEPLOYER_ADDR")
if echo "$FRIENDBOT_RESPONSE" | jq -e '.hash' > /dev/null 2>&1; then
  success "Account funded (tx: $(echo "$FRIENDBOT_RESPONSE" | jq -r '.hash' | cut -c1-16)...)"
else
  warn "Friendbot may be unavailable. Trying again in 5 seconds..."
  sleep 5
  curl -s "https://friendbot.stellar.org?addr=$DEPLOYER_ADDR" > /dev/null || warn "Friendbot not responding"
fi

# Wait for funding to settle
sleep 3
BALANCE=$(curl -s "https://horizon-testnet.stellar.org/accounts/$DEPLOYER_ADDR" | jq -r '.balances[0].balance // "0"')
log "Account balance: $BALANCE XLM"

# 5. Upload Wasm
log "Uploading Wasm to $NETWORK..."
UPLOAD_OUTPUT=$(stellar contract upload \
  --wasm "aura-vault/$WASM_PATH" \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK" \
  --output json)

WASM_HASH=$(echo "$UPLOAD_OUTPUT" | jq -r '.wasm_id // .hash')
if [ -z "$WASM_HASH" ] || [ "$WASM_HASH" = "null" ]; then
  error "Failed to upload Wasm. Response: $UPLOAD_OUTPUT"
fi
success "Wasm uploaded: ${WASM_HASH:0:16}..."

# 6. Deploy contract
log "Deploying contract instance..."
DEPLOY_OUTPUT=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK" \
  --output json)

CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | jq -r '.contract_id')
if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" = "null" ]; then
  error "Failed to deploy contract. Response: $DEPLOY_OUTPUT"
fi
success "Contract deployed: ${CONTRACT_ID:0:16}..."

# 7. Initialize vault
log "Initializing contract..."

# For Testnet, use the deployer as all 5 signers (not secure, only for testing)
SIGNERS="[\"$DEPLOYER_ADDR\", \"$DEPLOYER_ADDR\", \"$DEPLOYER_ADDR\", \"$DEPLOYER_ADDR\", \"$DEPLOYER_ADDR\"]"

# Use testnet USDC or a test token
# This is a placeholder - in production, use the real token contract ID
TOKEN_CONTRACT="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"

INIT_OUTPUT=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK" \
  --output json \
  -- initialize \
  --admin "$DEPLOYER_ADDR" \
  --underlying_token "$TOKEN_CONTRACT" \
  --signers "$SIGNERS")

INIT_HASH=$(echo "$INIT_OUTPUT" | jq -r '.transaction_hash // .hash')
if [ -z "$INIT_HASH" ] || [ "$INIT_HASH" = "null" ]; then
  warn "Initialize output: $INIT_OUTPUT"
else
  success "Contract initialized: ${INIT_HASH:0:16}..."
fi

# 8. Verify deployment
log "Verifying deployment..."

TOTAL_ASSETS=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- total_assets)

IS_PAUSED=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_paused)

# Save deployment info
cat > "$TEMP_FILE" << EOF
{
  "network": "$NETWORK",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$DEPLOYER_ADDR",
  "deployer_key": "$DEPLOYER_KEY",
  "wasm_hash": "$WASM_HASH",
  "wasm_sha256": "$WASM_SHA",
  "contract_id": "$CONTRACT_ID",
  "token_contract": "$TOKEN_CONTRACT",
  "total_assets": "$TOTAL_ASSETS",
  "is_paused": "$IS_PAUSED",
  "explorer_url": "https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
}
EOF

# Display summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✓ Testnet Deployment Complete"
echo "═══════════════════════════════════════════════════════════════"
echo "Network:            $NETWORK"
echo "Timestamp:          $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""
echo "Deployer Address:   $DEPLOYER_ADDR"
echo "Deployer Key:       $DEPLOYER_KEY"
echo ""
echo "Wasm Hash:          $WASM_HASH"
echo "Wasm SHA-256:       $WASM_SHA"
echo ""
echo "Contract ID:        $CONTRACT_ID"
echo "Token Contract:     $TOKEN_CONTRACT"
echo ""
echo "Verification:"
echo "  total_assets():   $TOTAL_ASSETS"
echo "  is_paused():      $IS_PAUSED"
echo ""
echo "Explorer Link:      https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Deployment info saved to: $TEMP_FILE"
echo ""
success "Ready for backend and frontend deployment!"

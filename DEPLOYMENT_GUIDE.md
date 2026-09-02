# Aura Vault Protocol — Deployment Guide

> Last updated: 2026-08-30 | Contract version: v1 | SDK: soroban-sdk 27

This guide covers the full deployment lifecycle: building the Soroban smart contract, deploying to Stellar Testnet and Mainnet, configuring and deploying the backend API and frontend, and rolling back if something goes wrong.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Network Reference](#2-network-reference)
3. [Contract Deployment — Step by Step](#3-contract-deployment--step-by-step)
   - 3.1 [Build the Wasm](#31-build-the-wasm)
   - 3.2 [Upload the Wasm](#32-upload-the-wasm)
   - 3.3 [Deploy a Contract Instance](#33-deploy-a-contract-instance)
   - 3.4 [Initialize the Vault](#34-initialize-the-vault)
   - 3.5 [Verify the Deployment](#35-verify-the-deployment)
4. [Backend Deployment](#4-backend-deployment)
   - 4.1 [Docker Compose (local / staging)](#41-docker-compose-local--staging)
   - 4.2 [Kubernetes (production)](#42-kubernetes-production)
   - 4.3 [Blue-Green Release Process](#43-blue-green-release-process)
5. [Frontend Deployment](#5-frontend-deployment)
6. [Environment Variable Reference](#6-environment-variable-reference)
   - 6.1 [Frontend](#61-frontend)
   - 6.2 [Backend](#62-backend)
7. [Testnet vs Mainnet Differences](#7-testnet-vs-mainnet-differences)
8. [Rollback Procedures](#8-rollback-procedures)
   - 8.1 [Contract Rollback (Upgrade to Previous Wasm)](#81-contract-rollback-upgrade-to-previous-wasm)
   - 8.2 [Backend Rollback (Blue-Green)](#82-backend-rollback-blue-green)
   - 8.3 [Frontend Rollback](#83-frontend-rollback)
9. [Post-Deployment Verification](#9-post-deployment-verification)
10. [Deployment Checklist](#10-deployment-checklist)

---

## 1. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| Rust | 1.79 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI (`stellar`) | Latest stable | `cargo install stellar-cli --features opt` |
| Node.js | 20 LTS | https://nodejs.org |
| Docker + Docker Compose | 24+ | https://docs.docker.com/get-docker |
| `jq` | 1.6+ | `apt-get install jq` / `brew install jq` |
| `openssl` | Any | Standard on most systems |

Verify your setup:

```bash
rustc --version              # should be >= 1.79
rustup target list --installed | grep wasm32
stellar --version
node --version               # should be >= 20
docker --version
```

### Funded Keypairs

Every Stellar transaction, including contract upload and deployment, requires the signing keypair to hold enough XLM to cover fees.

**Testnet:** Fund instantly with Friendbot:
```bash
# Generate a new keypair
stellar keys generate --global deployer --network testnet

# Check the public key
stellar keys address deployer

# Fund via Friendbot (testnet only)
curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

**Mainnet:** The deployer account must hold real XLM. A typical full deployment (upload + deploy + initialize) costs roughly 1–5 XLM in fees. Have at least 10 XLM available.

> **Security:** Never commit secret keys to source control. Store mainnet keys in a hardware wallet or HSM. The Stellar CLI supports named keys stored in `~/.config/stellar/identity/`.

---

## 2. Network Reference

| Parameter | Testnet | Mainnet |
|---|---|---|
| Network name flag | `--network testnet` | `--network mainnet` |
| Network passphrase | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| Soroban RPC URL | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` |
| Horizon URL | `https://horizon-testnet.stellar.org` | `https://horizon-mainnet.stellar.org` |
| Explorer | https://stellar.expert/explorer/testnet | https://stellar.expert/explorer/public |
| Friendbot | https://friendbot.stellar.org | Not available |
| XLM cost | Free (Friendbot) | Real XLM required |
| Ledger close time | ~5 seconds | ~5 seconds |
| State archival TTL (default) | 30 days | 30 days |

### Configuring the Stellar CLI

Add the networks to your CLI config once:

```bash
# Testnet (usually pre-configured)
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Mainnet
stellar network add mainnet \
  --rpc-url https://soroban-mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"
```

---

## 3. Contract Deployment — Step by Step

Work from the repository root throughout this section.

### 3.1 Build the Wasm

```bash
# Run all tests first — do not deploy a failing contract
cd aura-vault
cargo test

# Build the release Wasm
cargo build --target wasm32-unknown-unknown --release
```

Output artifact:
```
aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm
```

Verify the binary exists and check its size (must be under 1 MB):
```bash
ls -lh target/wasm32-unknown-unknown/release/aura_vault.wasm
```

Record the SHA-256 hash for auditability:
```bash
sha256sum target/wasm32-unknown-unknown/release/aura_vault.wasm
```

**Mainnet requirement:** Do not build the Mainnet Wasm on a developer laptop. Use the reproducible Docker builder instead:
```bash
# From repo root
docker compose run contract-builder
docker cp aura-contract-builder:/app/aura_vault.wasm ./aura_vault.wasm
sha256sum aura_vault.wasm
```

### 3.2 Upload the Wasm

Uploading stores the compiled Wasm on-chain and returns a 32-byte hash that uniquely identifies this bytecode. The hash is what you deploy — not the file itself.

```bash
# Set the network (testnet or mainnet)
NETWORK=testnet   # change to "mainnet" for production
DEPLOYER_KEY=deployer   # named key from: stellar keys generate

WASM_HASH=$(stellar contract upload \
  --wasm aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK" \
  --output json | jq -r '.wasm_id // .hash')

echo "Wasm hash: $WASM_HASH"
```

> **Save this hash.** You will need it to deploy instances and to re-deploy later without re-uploading the same bytecode.

If the same Wasm has already been uploaded, the CLI returns the existing hash without creating a new transaction — it is idempotent.

### 3.3 Deploy a Contract Instance

This creates a new contract instance from the uploaded Wasm and returns a contract ID (a `C…` address).

```bash
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK" \
  --output json | jq -r '.contract_id')

echo "Contract ID: $CONTRACT_ID"
```

Record `CONTRACT_ID` — it is the on-chain address users and the backend will interact with. It cannot be changed after initialization.

### 3.4 Initialize the Vault

`initialize` is a **one-time** call that configures the vault. It must be called before any deposit, withdraw, or harvest operations. Calling it a second time returns `AlreadyInitialized` (error 2).

**Parameters required:**

| Parameter | Description |
|---|---|
| `--admin` | Admin `G…` address. Controls pause, fees, treasury, upgrade, and harvest. |
| `--underlying_token` | Contract ID (`C…`) of the SEP-41-compatible token the vault will hold. |
| `--signers` | Comma-separated list of `G…` addresses for the 3-of-5 governance multi-sig. |

```bash
ADMIN_ADDRESS=$(stellar keys address deployer)

# Set these to real values for your deployment
TOKEN_CONTRACT_ID="C..."    # SEP-41 token contract
SIGNER_1="G..."
SIGNER_2="G..."
SIGNER_3="G..."
SIGNER_4="G..."
SIGNER_5="G..."

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --underlying_token "$TOKEN_CONTRACT_ID" \
  --signers "[ \"$SIGNER_1\", \"$SIGNER_2\", \"$SIGNER_3\", \"$SIGNER_4\", \"$SIGNER_5\" ]"
```

On success the CLI prints the transaction hash and returns `null` (the function has no return value on success). Record the transaction hash.

### 3.5 Verify the Deployment

Run these read-only checks immediately after initialization:

```bash
# 1. total_assets() should return 0 (empty vault)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- total_assets

# 2. is_paused() should return false
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- is_paused

# 3. Test a small deposit (testnet only — use a funded test account)
TEST_KEY=testuser   # stellar keys generate --global testuser --network testnet
TEST_ADDR=$(stellar keys address testuser)

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source testuser \
  --network testnet \
  -- deposit \
  --caller "$TEST_ADDR" \
  --amount 1000000     # 1 token with 7 decimals

# Verify shares received
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- balance_of \
  --address "$TEST_ADDR"

# 4. total_assets() should now return 1000000
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- total_assets
```

All four checks passing confirms the vault is live and functioning.

---

## 4. Backend Deployment

### 4.1 Docker Compose (local / staging)

Copy and configure the environment file:
```bash
cp backend/.env.example backend/.env
```

At minimum, fill in:
```
DATABASE_URL=postgres://aura:changeme@localhost:5432/auravault
JWT_SECRET=$(openssl rand -hex 32)
HORIZON_URL=https://horizon-testnet.stellar.org
VAULT_CONTRACT_ID=<your contract ID from section 3.3>
```

Start all services:
```bash
docker compose up -d
```

This starts:
- Redis 7 on port 6379
- Backend API on port 3001
- Frontend on port 3000
- Contract builder (one-shot artifact builder)

Run database migrations:
```bash
docker compose exec backend node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// apply migrations in order
"
```

Or apply migrations directly:
```bash
for f in backend/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Health check:
```bash
curl -s http://localhost:3001/api/health | jq .
```

Expected response:
```json
{
  "success": true,
  "data": { "status": "ok", "redis": "connected", "uptime": 12 },
  "meta": { "timestamp": "2026-08-30T10:00:00.000Z" }
}
```

### 4.2 Kubernetes (production)

Apply all manifests from the repo root:
```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Secrets (fill in real values first)
kubectl apply -f k8s/backend/secret.yaml

# Config
kubectl apply -f k8s/backend/configmap.yaml

# Workloads
kubectl apply -f k8s/backend/deployment.yaml
kubectl apply -f k8s/backend/service.yaml
kubectl apply -f k8s/backend/hpa.yaml
kubectl apply -f k8s/backend/pdb.yaml

# Frontend
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml

# Network policies
kubectl apply -f k8s/network-policies/

# Wait for rollout
kubectl rollout status deployment/backend -n aura-vault
kubectl rollout status deployment/frontend -n aura-vault
```

The backend runs 3 replicas with a rolling update strategy (`maxSurge: 1`, `maxUnavailable: 0`), meaning at least 3 pods are always healthy during updates.

### 4.3 Blue-Green Release Process

For production backend releases, use the blue-green deployment script for zero-downtime updates:

```bash
export IMAGE_TAG="sha-$(git rev-parse --short HEAD)"
export K8S_NAMESPACE="aura-vault"

# Dry run first — preview all actions without executing
./scripts/blue-green-deploy.sh --image-tag "$IMAGE_TAG" --dry-run

# Execute deployment
./scripts/blue-green-deploy.sh --image-tag "$IMAGE_TAG"
```

**What the script does:**
1. Detects the active slot (`blue` or `green`)
2. Deploys the new image to the standby slot
3. Routes internal preview traffic to the standby
4. Runs smoke tests against the preview URL
5. If tests pass: atomically switches stable traffic to the new slot
6. Runs a quick post-switch smoke test on the production URL
7. If post-switch tests fail: auto-rolls back within seconds
8. Keeps the old slot warm for 30 minutes (manual rollback window)
9. Scales the old slot to 0 after the rollback window expires

---

## 5. Frontend Deployment

The Next.js frontend produces a fully static export (`output: "export"` in `next.config.ts`).

### Build

```bash
cd frontend

# Testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
NEXT_PUBLIC_CONTRACT_ID="$CONTRACT_ID" \
npm run build

# The /out directory contains the static site
ls -lh out/
```

### Docker

```bash
# Build the image
docker build -f Dockerfile.frontend -t aura-frontend:latest .

# Run
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  -e NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  -e NEXT_PUBLIC_CONTRACT_ID="$CONTRACT_ID" \
  aura-frontend:latest
```

### Static Hosting (Vercel / Netlify / S3+CloudFront)

The `out/` directory can be deployed directly to any static host:

```bash
# Vercel
npx vercel --prod ./frontend/out

# Netlify
npx netlify deploy --prod --dir ./frontend/out

# S3 + CloudFront
aws s3 sync ./frontend/out s3://your-bucket/ --delete
aws cloudfront create-invalidation --distribution-id EXXX --paths "/*"
```

Set these environment variables in your hosting provider's dashboard before the build:
- `NEXT_PUBLIC_SOROBAN_RPC_URL`
- `NEXT_PUBLIC_NETWORK_PASSPHRASE`
- `NEXT_PUBLIC_CONTRACT_ID`

---

## 6. Environment Variable Reference

### 6.1 Frontend

These are baked into the static build at compile time. All must be set before running `npm run build`.

| Variable | Required | Testnet Value | Mainnet Value | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | ✅ | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` | Soroban RPC endpoint for contract calls |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` | Stellar network identifier; included in all transaction envelopes |
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Your testnet contract ID | Your mainnet contract ID | The deployed vault contract address (`C…`) |

### 6.2 Backend

All variables are validated by Zod at startup. Missing required variables cause the process to exit immediately with a descriptive error.

#### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | — | `3001` | TCP port the Express server listens on |
| `NODE_ENV` | — | `development` | `development` / `test` / `production`. Affects logging, Swagger UI, CORS defaults |
| `LOG_LEVEL` | — | `info` | Winston log level: `error`, `warn`, `info`, `http`, `debug` |
| `CORS_ORIGIN` | ✅ prod | `""` | Comma-separated list of allowed CORS origins. Empty = deny-all in production, localhost-only in dev |

#### Secrets

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | ✅ non-test | — | 32+ character random string for JWT HMAC-SHA256 signing. Generate: `openssl rand -hex 32` |
| `UNSUBSCRIBE_SECRET` | — | — | Signing key for email unsubscribe tokens |
| `SECRETS_PROVIDER` | — | `env` | `env` reads from process.env; `aws` uses AWS Secrets Manager |
| `APP_SECRETS_ID` | ✅ if `SECRETS_PROVIDER=aws` | — | AWS Secrets Manager secret name |
| `SECRETS_CACHE_TTL_MS` | — | `300000` | How long (ms) to cache secrets fetched from AWS |
| `AWS_REGION` | — | `us-east-1` | AWS region for Secrets Manager and other services |

#### Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL primary (write) connection string. Format: `postgres://user:pass@host:5432/dbname` |
| `DATABASE_REPLICA_URL` | — | Falls back to `DATABASE_URL` | Read-replica for analytics queries |

#### Redis

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | — | `redis://localhost:6379` | Redis connection URL (single-node) |
| `REDIS_PASSWORD` | — | — | Redis AUTH password |
| `REDIS_TLS` | — | `false` | Set `true` to enable TLS for Redis connections |
| `REDIS_CLUSTER` | — | — | Comma-separated `host:port` pairs for Redis Cluster mode. Overrides `REDIS_URL` when set |

#### Cache TTLs

| Variable | Required | Default | Description |
|---|---|---|---|
| `CACHE_API_TTL` | — | `60` | General API response cache lifetime (seconds) |
| `CACHE_DEFI_PRICE_TTL` | — | `30` | DeFi token price cache lifetime (seconds) |
| `CACHE_DEFI_POOL_TTL` | — | `60` | DeFi liquidity pool data cache lifetime (seconds) |

#### Stellar / Horizon

| Variable | Required | Default | Description |
|---|---|---|---|
| `HORIZON_URL` | — | `https://horizon-testnet.stellar.org` | Horizon REST API base URL. Change to mainnet URL for production |
| `VAULT_CONTRACT_ID` | — | — | Deployed vault contract address for event streaming and stats queries |

#### Email

| Variable | Required | Default | Description |
|---|---|---|---|
| `SENDGRID_API_KEY` | — | — | SendGrid API key for transactional email |
| `MAILGUN_DOMAIN` | — | — | Mailgun sending domain (e.g. `mail.aura-vault.xyz`) |
| `MAILGUN_API_KEY` | — | — | Mailgun API key |

#### EVM / Gas

| Variable | Required | Default | Description |
|---|---|---|---|
| `GAS_RPC_URL` | — | `https://cloudflare-eth.com` | EVM JSON-RPC endpoint for gas price estimation |
| `EVM_CHAIN_ID` | — | `1` | EVM chain ID (1 = Ethereum mainnet) |

---

## 7. Testnet vs Mainnet Differences

| Aspect | Testnet | Mainnet |
|---|---|---|
| **Network flag** | `--network testnet` | `--network mainnet` |
| **Network passphrase** | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Soroban RPC** | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` |
| **Horizon** | `https://horizon-testnet.stellar.org` | `https://horizon-mainnet.stellar.org` |
| **XLM funding** | Free via Friendbot | Real XLM; purchase on an exchange |
| **Friendbot** | Available | Not available |
| **Transaction fees** | Negligible (free XLM) | Real cost; ~0.00001 XLM per operation |
| **Token contract** | Use a testnet test token | Use the production SEP-41 token |
| **Admin keypair** | Any keypair is fine | Use a hardware wallet or multi-sig; never a hot key |
| **Governance signers** | Can be test keys you control | Real addresses of trusted signers |
| **Contract redeployability** | Redeploy freely for testing | Upgrades require admin auth + governance vote |
| **State persistence** | May be reset if network is refreshed | Permanent |
| **Audit requirement** | Not required | Strongly recommended before real funds |
| **Monitoring** | Optional | Required (Prometheus + Grafana + alerting) |
| **`SECRETS_PROVIDER`** | `env` (local .env file is fine) | `aws` (use AWS Secrets Manager) |
| **`NODE_ENV`** | `development` or `test` | `production` |
| **CORS** | `*` or localhost acceptable | Explicit domain allowlist required |
| **TLS** | Not required locally | Required (enforce at ALB / CloudFront) |

### Testnet-only shortcuts

```bash
# Instant XLM funding
curl "https://friendbot.stellar.org?addr=<public-key>"

# Quick deploy-and-init in one script
NETWORK=testnet
ADMIN_KEY=deployer
TOKEN="C..."
SIGNERS="[\"G...\",\"G...\",\"G...\",\"G...\",\"G...\"]"

WASM_HASH=$(stellar contract upload \
  --wasm aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source $ADMIN_KEY --network $NETWORK --output json | jq -r '.wasm_id // .hash')

CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source $ADMIN_KEY --network $NETWORK --output json | jq -r '.contract_id')

stellar contract invoke \
  --id "$CONTRACT_ID" --source $ADMIN_KEY --network $NETWORK \
  -- initialize \
  --admin "$(stellar keys address $ADMIN_KEY)" \
  --underlying_token "$TOKEN" \
  --signers "$SIGNERS"

echo "Done. Contract: $CONTRACT_ID"
```

### Mainnet-only requirements

Before deploying to Mainnet:
- [ ] Smart contract has passed a formal third-party security audit
- [ ] Testnet has been running for ≥7 days without issues
- [ ] Admin keypair is held in hardware wallet or HSM
- [ ] All 5 governance signers have confirmed their addresses and key custody
- [ ] Production token contract ID confirmed with the token issuer
- [ ] `SECRETS_PROVIDER=aws` and all secrets loaded into AWS Secrets Manager
- [ ] Monitoring stack live with alerting configured
- [ ] Incident response runbook reviewed and on-call rotation established

---

## 8. Rollback Procedures

### 8.1 Contract Rollback (Upgrade to Previous Wasm)

Soroban contracts cannot be "undeployed" — the contract ID is permanent. Rollback means upgrading to a previous known-good Wasm hash.

**Prerequisite:** Previous Wasm hashes must be recorded in your deployment log. The upgrade also requires the contract to not be paused.

#### Step 1 — Pause the vault (optional but recommended for critical rollbacks)

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- pause
```

#### Step 2 — Upload the previous Wasm (if not already on-chain)

```bash
PREV_WASM_HASH=$(stellar contract upload \
  --wasm path/to/previous/aura_vault.wasm \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  --output json | jq -r '.wasm_id // .hash')
```

If the previous Wasm was already uploaded, its hash is already on-chain and you can skip this step.

#### Step 3 — Execute the upgrade

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- upgrade \
  --new_wasm_hash "$PREV_WASM_HASH"
```

The upgrade verifies that the `LayoutVersion` in storage matches `CURRENT_LAYOUT_VERSION` in the new Wasm. If they differ, the upgrade returns `StorageLayoutMismatch` (error 10) and the vault remains on the current version.

#### Step 4 — Unpause and verify

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- unpause

# Verify version and state
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- total_assets
```

#### Governance-controlled rollback (mainnet)

On mainnet, `upgrade` is admin-only. If the admin key itself needs to be rotated before the rollback (e.g., suspected compromise), the governance process must be used first:

1. Any governance signer creates a `propose_update_admin` proposal
2. Three of five signers vote to approve
3. Wait 24 hours for the timelock to expire
4. Any address calls `execute` to apply the new admin
5. New admin calls `upgrade` with the previous Wasm hash

### 8.2 Backend Rollback (Blue-Green)

The blue-green deployment keeps the previous slot warm for **30 minutes** after a successful switch. During that window, a single command rolls back instantly:

```bash
# Immediate rollback — switches traffic back to the previous slot
./scripts/blue-green-deploy.sh --rollback
```

Or manually patch the Kubernetes service selector:

```bash
# If current active is green, roll back to blue
kubectl patch service aura-vault-stable \
  -n aura-vault \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/selector/slot","value":"blue"}]'

# Verify traffic
kubectl get endpoints aura-vault-stable -n aura-vault
```

After 30 minutes, the previous slot is scaled to 0. To roll back after this window, you must re-deploy the previous image tag:

```bash
./scripts/blue-green-deploy.sh --image-tag "<previous-sha-tag>"
```

Find previous image tags in the GitHub Actions workflow run history or the GHCR registry.

### 8.3 Frontend Rollback

The frontend is a static build. Rollback means redeploying the previous build artifact.

**Vercel:**
```bash
# List deployments
vercel ls

# Promote a previous deployment to production
vercel promote <deployment-url>
```

**Docker / Kubernetes:**
```bash
# Roll back to the previous image
kubectl rollout undo deployment/frontend -n aura-vault

# Or pin to a specific image tag
kubectl set image deployment/frontend \
  frontend=aura-vault-frontend:<previous-tag> \
  -n aura-vault
```

**S3 + CloudFront:**
Keep the previous build in a versioned S3 bucket. Re-sync and invalidate:
```bash
aws s3 sync s3://your-bucket/releases/<previous-build>/ s3://your-bucket/ --delete
aws cloudfront create-invalidation --distribution-id EXXX --paths "/*"
```

---

## 9. Post-Deployment Verification

Run this checklist after every deployment to any environment.

### Contract

```bash
CONTRACT_ID="C..."
NETWORK=testnet   # or mainnet

# 1. Contract is responsive
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- total_assets

# 2. Not paused
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- is_paused
# Expected: false

# 3. Check from Horizon that the contract account exists
curl -s "https://horizon-${NETWORK}.stellar.org/accounts/$CONTRACT_ID" | jq '.id'
```

### Backend

```bash
BACKEND_URL=http://localhost:3001   # or your staging/prod URL

# 1. Health check
curl -s "$BACKEND_URL/api/health" | jq '.data.status'
# Expected: "ok"

# 2. Vault stats endpoint
curl -s "$BACKEND_URL/api/v1/vault/stats" | jq '.success'
# Expected: true

# 3. Leaderboard (public endpoint)
curl -s "$BACKEND_URL/api/vault/leaderboard" | jq '.success'
# Expected: true

# 4. Auth login smoke test
curl -s -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"address":"GABC1234..."}' | jq '.success'
```

### Frontend

```bash
FRONTEND_URL=http://localhost:3000

# 1. Responds with HTML
curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL"
# Expected: 200

# 2. Security headers present
curl -sI "$FRONTEND_URL" | grep -E "X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security"
```

---

## 10. Deployment Checklist

Use this checklist for every production deployment. Copy to a GitHub issue or Notion doc and check off items as you go.

### Pre-deployment

- [ ] All contract tests pass: `cd aura-vault && cargo test`
- [ ] Cargo audit clean: `cargo audit`
- [ ] Clippy passes with security denials: `cargo clippy -- -D clippy::unwrap_used`
- [ ] Backend tests pass: `cd backend && npm test`
- [ ] Frontend builds without errors: `cd frontend && npm run build`
- [ ] Wasm built from clean state, SHA-256 recorded
- [ ] (Mainnet) Wasm built via Docker builder for reproducibility
- [ ] (Mainnet) Wasm SHA-256 matches the audited artifact
- [ ] Environment variables confirmed for target environment
- [ ] Database migrations reviewed and ready
- [ ] Deployment notes document prepared (contract ID, Wasm hash, deploy time)

### Contract deployment

- [ ] Deployer keypair funded (testnet: Friendbot; mainnet: real XLM)
- [ ] Wasm uploaded, hash recorded: `WASM_HASH=...`
- [ ] Contract instance deployed, ID recorded: `CONTRACT_ID=...`
- [ ] `initialize` called with correct `--admin`, `--underlying_token`, `--signers`
- [ ] `total_assets()` returns `0`
- [ ] `is_paused()` returns `false`
- [ ] Test deposit/withdraw confirms shares math is correct
- [ ] (Mainnet) Transaction hashes for upload, deploy, initialize recorded

### Backend deployment

- [ ] New Docker image built and pushed to registry
- [ ] Image digest recorded
- [ ] (Staging) `docker compose up -d` successful
- [ ] (Production) Blue-green deploy script dry-run reviewed
- [ ] (Production) Blue-green deploy executed and smoke tests passed
- [ ] `GET /api/health` returns `200 { status: "ok" }`
- [ ] Database migrations applied
- [ ] `VAULT_CONTRACT_ID` and `HORIZON_URL` point to correct values

### Frontend deployment

- [ ] Built with correct `NEXT_PUBLIC_*` environment variables
- [ ] Deployed to hosting provider
- [ ] (Production) CloudFront/CDN invalidation triggered
- [ ] Frontend loads without console errors
- [ ] Contract ID visible in browser network tab on page load

### Post-deployment

- [ ] All verification checks from Section 9 pass
- [ ] Monitoring dashboards show healthy metrics (Grafana)
- [ ] No new alerts firing (Prometheus / Alertmanager)
- [ ] Deployment entry added to the changelog
- [ ] On-call engineer notified / handoff complete
- [ ] Rollback procedure confirmed and rollback assets available (previous Wasm hash, previous image tag)

---

## Related Documents

| Document | Description |
|---|---|
| [`DEPLOYMENT_VERIFICATION.md`](./DEPLOYMENT_VERIFICATION.md) | Testnet deployment walkthrough, verification tests, common issues, and automated scripts |
| [`DEPLOYMENT_IMPLEMENTATION_SUMMARY.md`](./DEPLOYMENT_IMPLEMENTATION_SUMMARY.md) | Issue #388 implementation status and quick-start guide |
| [`BLUE_GREEN_DEPLOYMENT.md`](./BLUE_GREEN_DEPLOYMENT.md) | Full blue-green deployment runbook and script reference |
| [`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md) | Day-to-day operational procedures and health checks |
| [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) | Incident response procedures |
| [`GOVERNANCE.md`](./GOVERNANCE.md) | Multi-sig governance for admin key rotation and upgrades |
| [`SECURITY.md`](./SECURITY.md) | Security model, threat analysis, and vulnerability disclosure |
| [`docs/secrets-management.md`](./docs/secrets-management.md) | AWS Secrets Manager configuration and rotation |
| [`docs/wallet-integration.md`](./docs/wallet-integration.md) | Frontend wallet connection and transaction signing flows |

### Deployment Scripts

| Script | Purpose |
|--------|---------|
| [`scripts/verify-deployment-env.sh`](./scripts/verify-deployment-env.sh) | Verify all required tools are installed and compatible |
| [`scripts/testnet-quick-deploy.sh`](./scripts/testnet-quick-deploy.sh) | One-command Testnet deployment (build, upload, deploy, initialize) |
| [`scripts/verify-testnet-deployment.sh`](./scripts/verify-testnet-deployment.sh) | Post-deployment verification and health checks |

---

*This document is the primary deployment reference for Aura Vault Protocol. For Testnet deployment verification and automated scripts, see [`DEPLOYMENT_VERIFICATION.md`](./DEPLOYMENT_VERIFICATION.md). File issues or PRs for corrections.*

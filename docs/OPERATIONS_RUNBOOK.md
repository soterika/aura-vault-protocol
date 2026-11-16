# Aura Vault Protocol — Operations Runbook

> **Audience**: Engineers deploying, operating, or on-call for Aura Vault.  
> **Goal**: A new developer should be able to deploy locally in under 30 minutes and confidently handle production incidents.

---

## Table of Contents

1. [Local Development Setup](#1-local-development-setup)
2. [Environment Configuration](#2-environment-configuration)
3. [Testnet Deployment](#3-testnet-deployment)
4. [Mainnet Deployment Checklist](#4-mainnet-deployment-checklist)
5. [Monitoring & Alerting](#5-monitoring--alerting)
6. [Common Issues Runbook](#6-common-issues-runbook)
7. [Incident Response Procedures](#7-incident-response-procedures)
8. [Emergency Procedures](#8-emergency-procedures)

---

## 1. Local Development Setup

**Estimated time: ~20 minutes**

### 1.1 Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust + Cargo | stable | `rustup default stable` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | latest | `cargo install --locked stellar-cli` |
| Node.js | 20+ | https://nodejs.org |
| Docker + Compose | 24+ | https://docs.docker.com |
| Redis (optional) | 7+ | via Docker (step below) |

### 1.2 Clone & Bootstrap

```bash
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol

# Install root-level JS tooling
npm install
```

### 1.3 Smart Contract

```bash
cd aura-vault

# Run all 22 unit + integration tests
cargo test

# Build deployable Wasm binary
cargo build --target wasm32-unknown-unknown --release
# → aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm
```

Expected output: `test result: ok. 22 passed; 0 failed`.

### 1.4 Backend

```bash
cd backend

# Copy env template
cp .env.example .env
# Edit .env — see Section 2 for required values

# Install dependencies
npm install

# Start Redis via Docker (if not running locally)
docker run -d --name aura-redis -p 6379:6379 redis:7-alpine

# Start backend in watch mode
npm run dev
# → Listening on http://localhost:3001
```

Verify: `curl http://localhost:3001/api/health` → `{"status":"ok",...}`

### 1.5 Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### 1.6 Full Stack with Docker Compose

```bash
# From repo root — starts Redis + Backend + Frontend
cp .env.example .env   # or create .env with values from Section 2
docker compose up --build
```

Services:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Redis: localhost:6379

### 1.7 UI Component Library

```bash
cd ui
npm install
npm run dev       # Vite dev server
npm run storybook # Component explorer
npm test          # Vitest unit tests
```

---

## 2. Environment Configuration

### 2.1 Backend `.env` Reference

```dotenv
# ── Server ───────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development          # development | production

# ── Auth ─────────────────────────────────────────────────────────
JWT_SECRET=change-me-in-production   # min 32 random chars in prod

# ── Redis ────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379     # single-node
REDIS_PASSWORD=                       # leave blank for dev
# REDIS_CLUSTER=node1:6379,node2:6379 # cluster mode (overrides REDIS_URL)
REDIS_TLS=false                       # true for TLS-enabled clusters

# ── Cache TTLs (seconds) ─────────────────────────────────────────
CACHE_API_TTL=60
CACHE_DEFI_PRICE_TTL=30
CACHE_DEFI_POOL_TTL=60

# ── Gas Estimation ───────────────────────────────────────────────
GAS_RPC_URL=https://cloudflare-eth.com
EVM_CHAIN_ID=1
GAS_CACHE_TTL_MS=60000
GAS_HISTORY_LIMIT=20
GAS_DEFAULT_LIMIT=21000

# ── Stellar / Soroban ────────────────────────────────────────────
VAULT_CONTRACT_ID=C...               # Deployed vault contract ID
STELLAR_NETWORK=testnet              # testnet | mainnet

# ── Email (optional) ─────────────────────────────────────────────
SENDGRID_API_KEY=SG....
SENDGRID_WEBHOOK_KEY=...
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=mg.auravault.io
```

### 2.2 Production Secrets Checklist

Before any production deployment verify:

- [ ] `JWT_SECRET` is ≥32 chars, randomly generated (`openssl rand -hex 32`)
- [ ] `REDIS_PASSWORD` is set and strong
- [ ] `REDIS_TLS=true` in cloud environments
- [ ] Email API keys stored in secrets manager, not committed
- [ ] `VAULT_CONTRACT_ID` points to audited, initialized contract
- [ ] `NODE_ENV=production`

### 2.3 Stellar Network Passphrases

| Network | Passphrase |
|---|---|
| Testnet | `Test SDF Network ; September 2015` |
| Mainnet | `Public Global Stellar Network ; September 2015` |

---

## 3. Testnet Deployment

### 3.1 Build Artifacts

```bash
cd aura-vault

# Confirm tests pass
cargo test

# Build release Wasm
cargo build --target wasm32-unknown-unknown --release

# Record SHA256 for audit trail
sha256sum target/wasm32-unknown-unknown/release/aura_vault.wasm
```

### 3.2 Fund Admin Account on Testnet

```bash
# Create or import keypair
stellar keys generate admin-testnet
ADMIN_ADDRESS=$(stellar keys address admin-testnet)

# Fund via Friendbot
curl "https://friendbot.stellar.org?addr=$ADMIN_ADDRESS"
```

### 3.3 Upload Wasm

```bash
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source admin-testnet \
  --network testnet \
  --output json | jq -r '.wasm_id')

echo "WASM Hash: $WASM_HASH"
```

- [ ] Hash recorded in deployment notes

### 3.4 Deploy Contract Instance

```bash
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source admin-testnet \
  --network testnet \
  --output json | jq -r '.contract_id')

echo "Contract ID: $CONTRACT_ID"
```

- [ ] Contract ID starts with `C`
- [ ] Recorded in `DEPLOYMENT_NOTES.md`

### 3.5 Initialize Vault

```bash
TOKEN_CONTRACT_ID="C..."   # SEP-41 token on testnet

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin-testnet \
  --network testnet \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --underlying_token "$TOKEN_CONTRACT_ID"
```

- [ ] TX succeeds (no error code returned)
- [ ] TX hash recorded

### 3.6 Smoke Tests

```bash
# total_assets should be 0
stellar contract invoke --id "$CONTRACT_ID" --network testnet -- total_assets

# is_paused should be false
stellar contract invoke --id "$CONTRACT_ID" --network testnet -- is_paused

# version should be 1
stellar contract invoke --id "$CONTRACT_ID" --network testnet -- version
```

### 3.7 Configure Backend for Testnet

```bash
# In backend/.env
VAULT_CONTRACT_ID="$CONTRACT_ID"
STELLAR_NETWORK=testnet
```

Restart backend and verify: `GET /api/v1/user/portfolio` returns expected structure.

---

## 4. Mainnet Deployment Checklist

Work through every item before and during mainnet launch. Do not skip steps.

### 4.1 Pre-Deployment (T-7 days)

**Code Quality**
- [ ] All 22 contract tests pass on the exact commit to be deployed
- [ ] No `unwrap()` / `expect()` in non-test code (`grep -r 'unwrap\|expect' aura-vault/src/*.rs`)
- [ ] `overflow-checks = true` confirmed in `Cargo.toml` release profile
- [ ] Code reviewed by ≥2 developers

**Security**
- [ ] Internal security review completed; all findings resolved
- [ ] External audit completed or waived with documented risk acceptance
- [ ] Flash-loan guard tested (`BalanceMismatch` error path verified)
- [ ] Pause/unpause tested on testnet

**Testnet Soak**
- [ ] Contract running on testnet for ≥7 consecutive days
- [ ] Deposit → harvest → withdraw cycle tested end-to-end
- [ ] No state corruption detected
- [ ] Upgrade path tested (if applicable)

**Infrastructure**
- [ ] Redis cluster provisioned with TLS + auth
- [ ] Backend deployed behind load balancer with health checks
- [ ] SSL/TLS certificates valid and auto-renewing
- [ ] Secrets stored in secrets manager (not `.env` files in repo)
- [ ] Monitoring stack up (Prometheus + Grafana + Alertmanager)

**Documentation**
- [ ] This runbook reviewed and up to date
- [ ] On-call rotation populated for launch week
- [ ] Support team briefed on common user issues

### 4.2 Deployment Day (T-0)

```bash
# Step 1 — Build from pinned commit
git checkout <release-tag>
cd aura-vault
cargo build --target wasm32-unknown-unknown --release

# Step 2 — Record + sign artifact
WASM_SHA=$(sha256sum target/wasm32-unknown-unknown/release/aura_vault.wasm | cut -d' ' -f1)
echo "SHA256: $WASM_SHA"
gpg --sign --detach-sign target/wasm32-unknown-unknown/release/aura_vault.wasm

# Step 3 — Upload to mainnet
WASM_ID=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source admin-mainnet \
  --network mainnet \
  --output json | jq -r '.wasm_id')

# Step 4 — Deploy
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_ID" \
  --source admin-mainnet \
  --network mainnet \
  --output json | jq -r '.contract_id')

# Step 5 — Initialize
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin-mainnet \
  --network mainnet \
  -- initialize \
  --admin "$ADMIN_MAINNET_ADDRESS" \
  --underlying_token "$PRODUCTION_TOKEN_ID"

# Step 6 — Verify
stellar contract invoke --id "$CONTRACT_ID" --network mainnet -- total_assets
stellar contract invoke --id "$CONTRACT_ID" --network mainnet -- is_paused
stellar contract invoke --id "$CONTRACT_ID" --network mainnet -- version
```

- [ ] `total_assets` = 0
- [ ] `is_paused` = false
- [ ] `version` = 1
- [ ] Contract ID published in frontend config and docs

### 4.3 Post-Launch (T+1 hour)

- [ ] Backend `VAULT_CONTRACT_ID` updated and deployed
- [ ] Frontend shows correct contract ID
- [ ] First deposit tested by team member
- [ ] Monitoring dashboards show live metrics
- [ ] Alertmanager firing test alert succeeded
- [ ] Support channel open and team online

---

## 5. Monitoring & Alerting

### 5.1 Stack Overview

| Component | Role | Default Port |
|---|---|---|
| Prometheus | Metrics scraping + storage | 9090 |
| Grafana | Dashboards | 3100 |
| Alertmanager | Alert routing (PagerDuty / Slack) | 9093 |
| Loki | Log aggregation | 3200 |
| Promtail | Log shipping to Loki | — |

Start monitoring stack:

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

### 5.2 Key Metrics to Watch

**Contract Health**
- `total_assets` — should only increase (deposits + harvest) or decrease (withdrawals)
- Exchange rate (`total_assets / total_shares`) — should be ≥ 1.0 and monotonically non-decreasing
- `suspicious` event count — any non-zero value is an immediate alert

**Backend**
- `http_request_duration_seconds` p99 — alert if >2s
- `http_requests_total{status=~"5.."}` — alert if error rate >1%
- Redis `connected_clients` and memory usage
- Job queue depth (`/api/email/stats`, withdrawal queue)

**Infrastructure**
- CPU / memory on EC2/ECS instances
- Redis eviction rate (should be 0)
- Disk I/O on database

### 5.3 Grafana Dashboard

The system-health dashboard is provisioned automatically from `monitoring/grafana/dashboards/system-health.json`.

To import manually:
1. Navigate to Grafana → Dashboards → Import
2. Upload `monitoring/grafana/dashboards/system-health.json`

### 5.4 Alert Rules

Alert rules live in `monitoring/prometheus/alert.rules.yml`. Key alerts:

| Alert | Condition | Severity |
|---|---|---|
| `BackendDown` | No scrape for 2m | critical |
| `HighErrorRate` | HTTP 5xx rate >5% | warning |
| `RedisDown` | Redis unreachable | critical |
| `HighLatency` | p99 latency >2s | warning |
| `SuspiciousEvent` | `suspicious` contract event detected | critical |

### 5.5 Alertmanager Configuration

Edit `monitoring/alertmanager/alertmanager.yml` to set your receiver:

```yaml
receivers:
  - name: pagerduty
    pagerduty_configs:
      - service_key: <your-pd-key>
  - name: slack
    slack_configs:
      - api_url: <your-webhook-url>
        channel: '#aura-alerts'
```

### 5.6 Health Endpoint

```bash
curl https://api.auravault.io/api/health
# {"status":"ok","redis":true,"timestamp":"..."}
# status "degraded" = Redis unreachable; backend still serves cached data
```

### 5.7 Request Tracing with Correlation IDs

Every HTTP request receives a correlation ID that is attached to the logger context and echoed back to the client in the `X-Correlation-ID` response header.

- Incoming requests may include `X-Correlation-ID`; if absent, the backend generates a UUID v4.
- The same value is attached to `req.correlationId`, `res.locals.correlationId`, and the structured log metadata as `correlationId`.
- This allows a single user request to be traced across backend logs, HTTP access logs, and downstream Horizon/Soroban event processing.

Example request:

```bash
curl -H 'X-Correlation-ID: abc123' https://api.auravault.io/api/health
```

Example Loki query:

```logql
{job="aura-backend"} |= `"correlationId":"abc123"`
```

To trace a single request end-to-end in Grafana Loki:

1. Capture the client-supplied or generated ID from the response header.
2. Search for the same value in all backend log streams.
3. Correlate request-log events, auth failures, worker jobs, and Horizon listener output using the same `correlationId`.

This is the primary key for debugging multi-step failures without manually stitching together lines from separate requests.

---

## 6. Common Issues Runbook

### 6.1 Backend Returns 503 / Health Check Fails

**Symptoms**: `/api/health` returns `{"status":"degraded"}` or times out.

**Steps**:
1. Check Redis: `redis-cli -u $REDIS_URL ping` — should return `PONG`
2. If Redis down: check container logs `docker logs aura-redis`
3. Restart Redis if crashed: `docker restart aura-redis`
4. If backend OOM: check `docker stats aura-backend`, scale up or restart
5. Check backend logs: `docker logs aura-backend --tail 100`

### 6.2 Authentication Errors (401)

**Symptoms**: API calls return `401 Unauthorized`.

**Steps**:
1. Verify `JWT_SECRET` matches between token issuer and verifier (same env var)
2. Check token expiry — access tokens expire in 15 min; refresh with `/api/auth/refresh`
3. Check if token is blacklisted: search Redis `AUTH:BLACKLIST:<token>`
4. If Redis was wiped, all sessions are invalidated — users must re-login

### 6.3 Rate Limit Errors (429)

**Symptoms**: API returns `429 Too Many Requests`.

**Resolution**:
- Global IP limit applies to all unauthenticated endpoints
- Auth endpoints have stricter limits to prevent brute-force
- Inform affected users to reduce request frequency
- For legitimate high-volume use cases, upgrade to `paid` tier

### 6.4 Gas Estimation Endpoint Returns 500

**Symptoms**: `GET /api/v1/gas/prices` returns 500.

**Steps**:
1. Check `GAS_RPC_URL` env var points to a live RPC endpoint
2. Try the RPC directly: `curl -X POST $GAS_RPC_URL -d '{"jsonrpc":"2.0","method":"eth_gasPrice","id":1}'`
3. If RPC is down, the service falls back to cached historical data automatically
4. To use a different RPC: update `GAS_RPC_URL` and restart backend

### 6.5 Yield Calculation Returns Unexpected Values

**Symptoms**: `/api/v1/yield/calculate` returns 0 or wrong yields.

**Common causes**:
- `isActive: false` on position — inactive positions are skipped (by design)
- `amount <= 0` — zero-amount positions yield 0
- `apy <= 0` on all sources — check source configuration
- Date range issue in backfill: ensure `startDate < endDate`

### 6.6 Withdrawal Queued Unexpectedly

**Symptoms**: Small withdrawal returns `{"queued":true}` instead of immediate `txParams`.

**Cause**: `shares > 100_000` triggers the queue as flash-loan protection.

**Resolution**: This is expected behavior. Poll `GET /api/v1/withdraw/:jobId` for status.

### 6.7 Contract `BalanceMismatch` Error

**Symptoms**: Deposit/withdraw/harvest returns error code 12.

**Cause**: Vault's tracked `total_deposited` differs from actual on-chain token balance — potential flash-loan or direct transfer attack.

**Immediate actions**:
1. Check recent contract events for `suspicious` emissions
2. Do NOT call `unpause` — the vault is protecting itself
3. Investigate on-chain activity via Stellar block explorer
4. Escalate to security incident (see Section 7)

### 6.8 Contract `VaultPaused` Error

**Symptoms**: Users cannot deposit/withdraw; error code 11 returned.

**Steps**:
1. Verify pause is intentional: check incident log
2. If unintentional (bug): admin calls `unpause()`:
   ```bash
   stellar contract invoke --id "$CONTRACT_ID" --source admin-key --network mainnet -- unpause
   ```
3. If intentional emergency pause: follow Section 8 procedures

### 6.9 Database Migration Failures

**Symptoms**: Backend starts but portfolio queries fail.

**Steps**:
1. Connect to DB and check if `vault_positions` table exists
2. Re-run migration:
   ```bash
   psql $DATABASE_URL < backend/migrations/001_create_vault_positions.sql
   ```
3. Check for partial migration: look for missing indexes or triggers

---

## 7. Incident Response Procedures

### 7.1 Severity Levels

| Level | Description | Response Time | Example |
|---|---|---|---|
| P1 - Critical | User funds at risk or service fully down | 15 min | BalanceMismatch, backend 100% down |
| P2 - High | Degraded service, no fund risk | 30 min | Redis down, auth broken |
| P3 - Medium | Partial feature unavailability | 2 hours | Gas API down, email queue stalled |
| P4 - Low | Minor issue, no user impact | Next business day | Logging gaps, stale cache |

### 7.2 Incident Lifecycle

```
Detected → Acknowledged → Investigated → Mitigated → Resolved → Post-mortem
```

1. **Detected**: Alert fires or user report received
2. **Acknowledged**: On-call engineer claims the incident within SLA
3. **Investigated**: Root cause identified (use runbook Section 6)
4. **Mitigated**: Temporary fix applied to restore service
5. **Resolved**: Permanent fix deployed; monitoring confirms normal
6. **Post-mortem**: Written within 48 hours for P1/P2

### 7.3 Communication Template

**Initial (within 15 min of P1/P2)**:
```
INCIDENT DECLARED - [Severity] - [Short description]
Time: <timestamp>
Impact: <what users cannot do>
Status: Investigating
Next update: <time>
```

**Update (every 30 min)**:
```
INCIDENT UPDATE
Status: <Investigating|Mitigating|Monitoring>
Finding: <what was found>
Action taken: <what was done>
Next update: <time>
```

**Resolution**:
```
INCIDENT RESOLVED
Duration: <start> → <end>
Root cause: <summary>
Fix applied: <summary>
Post-mortem scheduled: <date>
```

### 7.4 Escalation Path

| Who | Contact | When to Escalate |
|---|---|---|
| On-call engineer | PagerDuty rotation | Auto-paged on P1/P2 |
| Tech Lead | Slack `#oncall` | Not resolved in 1 hour |
| Security Lead | Direct message | Any fund-safety concern |
| Engineering Manager | Phone | Service down >2 hours |

---

## 8. Emergency Procedures

### 8.1 Emergency Vault Pause

If a security threat is detected (e.g., exploit attempt, `suspicious` event, abnormal drain):

```bash
# Pause immediately — halts all deposit/withdraw/harvest
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin-mainnet \
  --network mainnet \
  -- pause

# Verify paused
stellar contract invoke --id "$CONTRACT_ID" --network mainnet -- is_paused
# → true
```

**After pausing**:
1. Declare P1 incident immediately
2. Notify team via incident channel
3. Investigate root cause before unpausing
4. Do not unpause without security lead approval

### 8.2 Emergency Backend Shutdown

If the backend must be taken offline immediately:

```bash
# Graceful shutdown (drains connections, stops job workers)
docker compose stop backend

# Or force-kill if hung
docker compose kill backend
```

Users will see connection errors. Post status page update.

### 8.3 Key Rotation

If `JWT_SECRET` is compromised:

1. Generate new secret: `openssl rand -hex 32`
2. Update secret in secrets manager
3. Deploy backend with new `JWT_SECRET` — **all existing sessions are instantly invalidated**
4. Notify users to re-authenticate
5. Monitor for abuse with old tokens (already invalidated by new secret)

If admin keypair is compromised (Stellar):
1. Immediately pause the vault (if not already)
2. Deploy upgraded contract with new admin address via `upgrade`
3. Revoke old keypair everywhere it is stored

### 8.4 Disaster Recovery

Full infrastructure recovery procedures are documented in:
- `docs/disaster-recovery/runbook.md` — step-by-step recovery
- `docs/disaster-recovery/incident-response-playbook.md` — decision tree
- `docs/backup-recovery.md` — backup schedules and restore procedures

**RTO target**: 4 hours for P1  
**RPO target**: 1 hour (Redis AOF + RDB snapshots)

### 8.5 Contract Upgrade (Emergency Patch)

Only use for critical security fixes. Requires admin key.

```bash
# 1. Build patched Wasm
cargo build --target wasm32-unknown-unknown --release

# 2. Upload to mainnet
NEW_WASM_ID=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source admin-mainnet \
  --network mainnet \
  --output json | jq -r '.wasm_id')

# 3. Test upgrade on testnet first (mandatory)
stellar contract invoke \
  --id "$TESTNET_CONTRACT_ID" \
  --source admin-testnet \
  --network testnet \
  -- upgrade \
  --new_wasm_hash "$NEW_WASM_ID"

stellar contract invoke --id "$TESTNET_CONTRACT_ID" --network testnet -- version
# Version should increment

# 4. Only after testnet validation — upgrade mainnet
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source admin-mainnet \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash "$NEW_WASM_ID"

# 5. Verify
stellar contract invoke --id "$CONTRACT_ID" --network mainnet -- version
```

**Post-upgrade**:
- [ ] Record new WASM hash and version in `CHANGELOG.md`
- [ ] Verify `total_assets` and share balances unchanged
- [ ] Unpause vault if it was paused for the upgrade
- [ ] Write post-mortem

---

## Appendix: Quick Reference

### Useful Commands

```bash
# Check vault state
stellar contract invoke --id $CONTRACT_ID --network mainnet -- total_assets
stellar contract invoke --id $CONTRACT_ID --network mainnet -- is_paused
stellar contract invoke --id $CONTRACT_ID --network mainnet -- version

# Backend health
curl https://api.auravault.io/api/health

# Redis health
redis-cli -u $REDIS_URL ping

# View backend logs
docker logs aura-backend --tail 200 -f

# View all container status
docker compose ps
```

### Key File Locations

| File | Purpose |
|---|---|
| `backend/.env.example` | All backend env vars with defaults |
| `docker-compose.yml` | Local full-stack setup |
| `docker-compose.monitoring.yml` | Prometheus + Grafana stack |
| `monitoring/prometheus/alert.rules.yml` | Alert definitions |
| `monitoring/alertmanager/alertmanager.yml` | Alert routing config |
| `docs/disaster-recovery/runbook.md` | Full DR procedures |
| `terraform/` | Infrastructure as code (AWS) |
| `aura-vault/src/lib.rs` | Contract source |

### Support Contacts

| Role | Contact |
|---|---|
| On-call | PagerDuty rotation (see `docs/disaster-recovery/on-call-rotation.md`) |
| Deployment issues | deployment-support@aura-vault.dev |
| Security emergencies | emergency@aura-vault.dev (24/7) |
| General | support@aura-vault.dev |

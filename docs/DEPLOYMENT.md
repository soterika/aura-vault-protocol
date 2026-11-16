# Aura Vault Protocol — Deployment & Operations Guide

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Testnet Deployment](#testnet-deployment)
3. [Mainnet Deployment Checklist](#mainnet-deployment-checklist)
4. [Environment Configuration](#environment-configuration)
5. [Monitoring & Alerting](#monitoring--alerting)
6. [Incident Response](#incident-response)
7. [Common Issues Runbook](#common-issues-runbook)

---

## Local Development Setup

**Goal:** New developer can deploy locally in < 30 minutes.

### Prerequisites

- [Rust](https://rustup.rs/) (1.79+)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup) (`stellar` or `soroban`)
- [Node.js](https://nodejs.org/) (20+)
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- A Stellar testnet account ([Friendbot](https://friendbot.stellar.org/))

### Step 1: Clone & Install

```bash
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol
```

### Step 2: Build the Contract

```bash
cd aura-vault
cargo build --release --target wasm32-unknown-unknown
```

The compiled WASM is at `target/wasm32-unknown-unknown/release/aura_vault.wasm`.

### Step 3: Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend available at `http://localhost:3000`.

### Step 4: Start with Docker (alternative)

```bash
docker compose up -d                    # Frontend + contract builder
docker compose -f docker-compose.monitoring.yml up -d  # Monitoring stack
```

### Step 5: Verify

- Frontend: http://localhost:3000
- Grafana: http://localhost:3001 (admin / aura-vault-admin)
- Prometheus: http://localhost:9090
- Jaeger: http://localhost:16686

---

## Testnet Deployment

### 1. Fund a Deployer Account

```bash
curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
```

### 2. Deploy the Contract

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source YOUR_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

Save the returned contract ID.

### 3. Initialize the Contract

```bash
stellar contract invoke \
  --id YOUR_CONTRACT_ID \
  --source YOUR_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- initialize --admin YOUR_PUBLIC_KEY
```

### 4. Configure Frontend

Set in `.env.local`:

```env
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_CONTRACT_ID=YOUR_CONTRACT_ID
```

### 5. Deploy Frontend

```bash
cd frontend
npm run build
# Deploy to Vercel, Netlify, or your hosting provider
```

---

## Mainnet Deployment Checklist

- [ ] **Audit:** Smart contract has been audited by an independent security firm
- [ ] **Test coverage:** All critical paths have passing tests
- [ ] **Multi-sig:** Deployer account uses multi-signature authorization
- [ ] **Contract WASM:** Built with reproducible Docker build (`docker compose run contract-builder`)
- [ ] **WASM hash:** Verified against audited hash
- [ ] **Environment variables:** Production values set (RPC URL, network passphrase)
- [ ] **Rate limiting:** API rate limits configured
- [ ] **Monitoring:** All dashboards and alerts verified (`docker compose -f docker-compose.monitoring.yml up -d`)
- [ ] **Backup:** State export procedure tested
- [ ] **Rollback plan:** Previous contract version documented for emergency revert
- [ ] **DNS & TLS:** Production domain with valid TLS certificate
- [ ] **Incident contacts:** On-call roster established

---

## Environment Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Stellar network passphrase | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed contract address | — |
| `NODE_ENV` | Runtime environment | `development` |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana admin password | `aura-vault-admin` |

### Environment Files

- `.env.development` — Local development defaults
- `.env.staging` — Testnet configuration
- `.env.production` — Mainnet configuration (never commit secrets)

---

## Monitoring & Alerting

### Stack

| Service | Port | Purpose |
|---------|------|---------|
| Prometheus | 9090 | Metrics collection |
| Grafana | 3001 | Dashboards & visualization |
| Loki | 3100 | Log aggregation |
| Promtail | 9080 | Log shipping |
| Jaeger | 16686 | Distributed tracing |
| Alertmanager | 9093 | Alert routing |

### Start Monitoring

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

### Alert Rules

| Alert | Condition | Severity |
|-------|-----------|----------|
| ServiceDown | Target unreachable for 1 min | Critical |
| HighErrorRate | >5% 5xx responses for 5 min | Critical |
| HighLatency | p95 >2 seconds for 5 min | Warning |
| HighMemoryUsage | >512MB for 10 min | Warning |
| SLA Availability | <99.9% over 1 hour | Critical |
| SLA Latency | p99 >5 seconds over 1 hour | Warning |
| TransactionFailureRate | >10% failures for 5 min | Critical |
| VaultBalanceLow | <100 XLM for 5 min | Warning |

### Viewing Logs

1. Open Grafana → Explore → Select "Loki" datasource
2. Query: `{job="aura-vault"} |= "error"`
3. Filter by level: `{job="aura-vault"} | json | level="error"`

---

## Incident Response

### Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **P0** | Service completely down | 15 minutes | All transactions failing |
| **P1** | Major feature broken | 1 hour | Deposits not processing |
| **P2** | Minor feature broken | 4 hours | Dashboard not loading |
| **P3** | Cosmetic / non-urgent | Next business day | Typo in UI |

### Emergency Procedures

#### Service Down (P0)

1. Check Grafana dashboard for the failing service
2. Check Prometheus alerts at http://localhost:9090/alerts
3. Review logs: `docker compose -f docker-compose.monitoring.yml logs -f`
4. If frontend: `docker compose restart frontend`
5. If contract issue: verify on [Stellar Expert](https://stellar.expert/)
6. Notify stakeholders via the on-call channel

#### High Error Rate

1. Check Grafana → System Health → Error Rate panel
2. Review recent deployments for regressions
3. Check Loki logs for error patterns
4. If RPC related: verify Soroban RPC endpoint health
5. If contract related: check transaction simulation errors

#### Vault Balance Low

1. Check current balance on Stellar Explorer
2. Verify no unauthorized withdrawals in transaction history
3. If legitimate: fund the vault with additional XLM
4. If suspicious: freeze operations and investigate

---

## Common Issues Runbook

### Contract deployment fails with "insufficient balance"

```bash
# Fund the deployer account
curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
```

### Frontend build fails with "module not found"

```bash
cd frontend
rm -rf node_modules .next
npm install
npm run build
```

### Prometheus targets show "DOWN"

1. Verify the application is running and exposing `/metrics`
2. Check that `host.docker.internal` resolves (Docker Desktop required)
3. On Linux, use `--network=host` or the container's IP

### Grafana dashboard shows "No data"

1. Verify Prometheus datasource is connected (Grafana → Settings → Data Sources)
2. Check that metrics are being scraped: visit http://localhost:9090/targets
3. Ensure the application is emitting the expected metric names

### Docker build fails on M1/M2 Mac

```bash
# Use platform flag
docker compose build --build-arg TARGETPLATFORM=linux/arm64
```

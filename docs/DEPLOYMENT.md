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

Create `frontend/.env.local` to point the frontend to your backend and target Stellar network:

```env
# Target Stellar Network (testnet, mainnet, or futurenet)
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# Backend REST API and WebSocket services
NEXT_PUBLIC_API_URL=https://<api-testnet-host>
NEXT_PUBLIC_WS_URL=wss://<api-testnet-host>/api/ws/vault

# Stellar Explorer link configuration (optional override)
NEXT_PUBLIC_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet/tx

# Admin pause controls authorization (optional)
NEXT_PUBLIC_ADMIN_ADDRESS=<TESTNET_ADMIN_PUBLIC_KEY_G...>

# Application canonical origin (for referral links)
NEXT_PUBLIC_APP_URL=https://<app-testnet-host>

# Sentry error monitoring (optional)
NEXT_PUBLIC_SENTRY_DSN=https://<public_key>@<org>.ingest.sentry.io/<project_id>
```

> **Note on Build-Time vs. Runtime Inlining:** Frontend settings prefixed with `NEXT_PUBLIC_` are statically inlined into client JavaScript bundles at build time (`npm run build`). When deploying across staging or production environments, the frontend must be compiled with the environment's specific configuration. For full details, see the [Frontend Public Configuration Reference](#frontend-public-configuration-reference) and [`frontend/CLAUDE.md`](../frontend/CLAUDE.md).

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

Configuration is split between backend services / contracts and the public web frontend.

### Backend & Infrastructure Services

| Variable | Description | Default |
|----------|-------------|---------|
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NETWORK_PASSPHRASE` | Stellar network passphrase | `Test SDF Network ; September 2015` |
| `CONTRACT_ID` | Deployed vault contract address | — |
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://aura:aura@localhost:5432/aura_vault` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `JWT_SECRET` | Secret key for signing authentication tokens | — |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana admin password | `aura-vault-admin` |

---

### Frontend Public Configuration Reference

The web application (`frontend/`) reads configuration via Next.js environment variables. Public variables must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser.

> **Build-Time vs. Runtime Behavior:**
> - In all client components (`"use client"`), hooks, and utilities, `NEXT_PUBLIC_*` values are statically replaced and inlined at **build time** (`npm run build`). Modifying environment files after building will not update client behavior without recompilation.
> - In server components (`src/app/layout.tsx`), route handlers, and server-side configs, values are evaluated from the active Node.js/Edge process environment at runtime.
> - Authoritative frontend reference: [`frontend/CLAUDE.md`](../frontend/CLAUDE.md) and [`frontend/.env.example`](../frontend/.env.example).

#### Public Variable Inventory & Active Code Mappings

| Setting | Required | Default Value | Active Code References | Build vs. Runtime | Purpose & Allowed Values |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Recommended | `"testnet"` | `frontend/src/app/layout.tsx#L31`<br>`frontend/src/components/FreighterNetworkBanner.tsx#L73`<br>`frontend/src/lib/explorerLinks.ts#L40`<br>`frontend/src/components/ExplorerMenu.tsx#L14`<br>`frontend/src/app/status/page.tsx#L92` | Build & Runtime | Selects target Stellar network (`testnet`, `mainnet`, `futurenet`). Drives the network status banner, Freighter wallet network mismatch check, and block explorer links. |
| `NEXT_PUBLIC_API_URL` | Optional | `""` (relative root) / `"http://localhost:3001"` in hooks | `frontend/src/app/status/page.tsx#L18`<br>`frontend/src/app/tx/[hash]/page.tsx#L49`<br>`frontend/src/app/transactions/page.tsx#L7`<br>`frontend/src/lib/useVaultQueries.ts#L35`<br>`frontend/src/lib/useContractEvents.ts#L157`<br>`frontend/src/lib/useVaultEventInvalidation.ts#L29`<br>`frontend/src/components/AdminPauseControls.tsx#L68` | Build & Runtime | Base URL for backend HTTP REST API calls and SSE event streaming. Local: `http://localhost:3001`; Staging/Testnet: `https://<api-testnet-host>`. |
| `NEXT_PUBLIC_WS_URL` | Optional | `ws://${window.location.host}/api/ws/vault` | `frontend/src/lib/useVaultPause.ts#L134`<br>`frontend/src/components/VaultDashboard.tsx#L275`<br>`frontend/src/components/dashboard/SortableDashboardGrid.tsx#L370`<br>`frontend/src/components/dashboard/DashboardGrid.tsx#L125`<br>`frontend/src/components/SharePriceTicker.tsx#L81` | Build-time | WebSocket endpoint for real-time vault pause toggles, share prices, and dashboard metrics. Local: `ws://localhost:3001/api/ws/vault`; Non-production: `wss://<api-testnet-host>/api/ws/vault`. |
| `NEXT_PUBLIC_STELLAR_EXPLORER_URL` | Optional | `'https://stellar.expert/explorer/testnet/tx'` | `frontend/src/app/tx/[hash]/page.tsx#L46` | Build-time | Custom base URL override for external Stellar transaction links on transaction details pages (`/tx/[hash]`). Testnet: `https://stellar.expert/explorer/testnet/tx`; Mainnet: `https://stellar.expert/explorer/public/tx`. |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | Optional | `undefined` | `frontend/src/components/AdminPauseControls.tsx#L58`<br>`frontend/src/components/dashboard/SortableDashboardGrid.tsx#L424` | Build-time | Stellar public G-address of the authorized vault admin. When connected wallet matches this address, emergency pause/unpause controls render in the UI. |
| `NEXT_PUBLIC_APP_URL` | Optional | `""` (falls back to `window.location.origin`) | `frontend/src/lib/referral.ts#L148` | Build & Runtime | Canonical origin URL of the web frontend, used when generating shareable referral URLs during SSR. Non-production: `https://<app-testnet-host>`. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | `undefined` (telemetry disabled) | `frontend/src/lib/sentry.ts#L17`<br>`frontend/sentry.client.config.ts#L9`<br>`frontend/sentry.server.config.ts#L7`<br>`frontend/sentry.edge.config.ts#L7` | Build & Runtime | Sentry DSN for error reporting and performance tracing. Unset disables tracking without errors. |

#### Non-Production Network Configuration Example

To deploy or run the frontend against Stellar Testnet, create `frontend/.env.local`:

```env
# Target Stellar Network (testnet, mainnet, or futurenet)
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# Backend REST API and WebSocket services
NEXT_PUBLIC_API_URL=https://<api-testnet-host>
NEXT_PUBLIC_WS_URL=wss://<api-testnet-host>/api/ws/vault

# Stellar Explorer link configuration (optional override)
NEXT_PUBLIC_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet/tx

# Admin pause controls authorization (optional)
NEXT_PUBLIC_ADMIN_ADDRESS=<TESTNET_ADMIN_PUBLIC_KEY_G...>

# Application canonical origin (for referral links)
NEXT_PUBLIC_APP_URL=https://<app-testnet-host>

# Sentry error monitoring (optional)
NEXT_PUBLIC_SENTRY_DSN=https://<public_key>@<org>.ingest.sentry.io/<project_id>
```

#### How to Render and Verify Against Testnet

1. Write `frontend/.env.local` using the template above with your non-production endpoint placeholders.
2. Run `npm run dev` (or `npm run build && npm run start`).
3. Verify the non-production behavior:
   - **Network Warning Banner:** An amber banner displays across the top: *"You are on Stellar Testnet. Tokens have no real value."* (`NetworkStatusBanner.tsx`).
   - **Wallet Mismatch Protection:** If Freighter is set to Mainnet, a banner prompts to switch networks and disables transaction submission (`FreighterNetworkBanner.tsx`).
   - **Explorer Redirection:** Explorer links on `/tx/[hash]` and via `ExplorerMenu.tsx` route to `https://stellar.expert/explorer/testnet/...`.
   - **Admin Controls:** If `NEXT_PUBLIC_ADMIN_ADDRESS` is set and matches your wallet address, emergency pause controls render on the dashboard (`AdminPauseControls.tsx`).

### Environment Files

- `backend/.env.example` — Backend local defaults
- `frontend/.env.example` — Frontend configuration template
- `.env.development` / `frontend/.env.local` — Local development overrides
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

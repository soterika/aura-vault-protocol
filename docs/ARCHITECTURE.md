# Aura Vault Protocol — Architecture

## System Overview

## Event-Driven Data Flow

This sequence shows how contract events become live frontend updates. The
contract emits events on Soroban; the backend listener reads them from Horizon,
persists indexed events in PostgreSQL, invalidates cached aggregates in Redis,
and broadcasts updates to subscribed clients over SSE.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Contract as Soroban vault
    participant Horizon
    participant Listener as Backend event listener
    participant Redis
    participant PG as PostgreSQL
    participant SSE as SSE endpoint
    participant UI as Frontend

    User->>Contract: deposit() / withdraw() / harvest() / governance call
    Contract-->>Horizon: Emit typed contract event
    Listener->>Horizon: Stream events from last ledger cursor
    alt Horizon available
        Horizon-->>Listener: Event payload and ledger sequence
        Listener->>PG: Insert event (idempotent by ledger and event index)
        Listener->>Redis: Invalidate affected vault stats
        alt Cache invalidation succeeds
            Redis-->>Listener: Cache miss on next read
        else Redis unavailable
            Listener->>Listener: Log failure; retry invalidation with backoff
        end
        Listener-->>SSE: Publish normalized event
        SSE-->>UI: data: {type, contractId, ledger, payload}
        UI->>UI: Update affected dashboard state
    else Horizon unavailable or stream disconnected
        Listener->>Listener: Retain last cursor and reconnect with backoff
        Listener->>Horizon: Resume from last confirmed ledger
    end

    Note over Contract,UI: Deposit, withdrawal, harvest, proposal, vote, execution, pause, and admin-transfer events use the same pipeline.
```

Events are persisted before broadcast. Consumers should deduplicate by the
contract event identity and treat SSE as a low-latency notification; REST reads
remain the source of current aggregate state.

Aura Vault is a share-based yield vault on Stellar/Soroban with a full-stack off-chain companion (API, frontend, mobile). Users deposit a single SEP-41 token, receive proportional shares, and auto-compound yield through permissionless keeper harvests.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                    │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────────────┐   │
│  │  Next.js App   │  │  React Vite UI │  │    React Native Mobile       │   │
│  │  (frontend/)   │  │    (ui/)       │  │       (mobile/)              │   │
│  └───────┬────────┘  └───────┬────────┘  └──────────────┬───────────────┘   │
└──────────┼───────────────────┼──────────────────────────┼───────────────────┘
           │  HTTPS/REST       │                          │
           ▼                   ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Backend API (Express.js / Node)                      │
│  Auth ─ Portfolio ─ WithdrawalQueue ─ EmailQueue ─ Webhooks ─ DeFi Cache     │
│                          (backend/src/)                                      │
│                  Redis (sessions · cache · job queues)                       │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ Soroban RPC (JSON-RPC 2.0)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Stellar Network (Soroban)                              │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                      AuraVault Contract                              │  │
│   │   initialize · deposit · withdraw · harvest · harvest_token          │  │
│   │   pause · unpause · propose · vote · execute                         │  │
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │  │
│   │   │  lib.rs  │  │storage.rs│  │ errors.rs│  │  governance.rs    │  │  │
│   │   │ (logic)  │◄─│(helpers) │  │(VaultErr)│  │ (multi-sig props) │  │  │
│   │   └──────────┘  └──────────┘  └──────────┘  └───────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌────────────────────────┐   ┌────────────────────────────────────────┐   │
│   │  SEP-41 Token Contract │   │  Solidity Contracts (EVM sidechain)    │   │
│   │  (underlying token)    │   │  AuraStrategy · AuraPriceOracle        │   │
│   └────────────────────────┘   │  VaultAccessControl                    │   │
│                                └────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘

AWS Deployment Topology:
  Route53 ─► CloudFront ─► ALB ─► EC2 Auto Scaling Group (Backend API)
                                          │
                                    RDS PostgreSQL
                                    ElastiCache Redis
  Lambda: email-forwarder · dns-check · rds-backup
  S3: static assets, Wasm artifacts
  SES: transactional email
```

---

## Components

### Smart Contract (`aura-vault/src/`)

| Module | Role |
|---|---|
| `lib.rs` | All callable functions: auth guards → arithmetic → CEI writes → TTL bumps |
| `interface.rs` | `AuraVaultTrait` — public ABI definition only, no logic |
| `storage.rs` | `DataKey` enum, TTL constants, typed get/set helpers |
| `errors.rs` | `VaultError` enum (12 variants, `#[contracterror]`) |
| `fee.rs` | `calc_perf_fee(amount, bps)` — basis-point fee arithmetic |
| `governance.rs` | Multi-sig proposal/vote/execute for admin parameter changes |
| `test.rs` | 22+ unit + property-based tests (`#[cfg(test)]`-gated) |

### Backend API (`backend/src/`)

| Module | Role |
|---|---|
| `index.ts` | Express app wiring: middleware, route mounts, lifecycle |
| `auth.ts` | JWT token generation/validation, session management, blacklist |
| `portfolio.ts` | `GET /api/v1/user/portfolio` — paginated vault positions |
| `services/defi.ts` | Asset price + pool data with Redis caching |
| `services/withdrawalQueue.ts` | Large-withdrawal job queue (flash-loan rate limiting) |
| `services/emailQueue.ts` | Transactional email enqueue/retry |
| `services/emailService.ts` | DKIM/bounce/tracking/unsubscribe |
| `routes/emailRoutes.ts` | Email send, webhooks, tracking, DNS verify endpoints |
| `routes/withdrawalRoutes.ts` | Withdrawal submission and queue status endpoints |
| `middleware/authMiddleware.ts` | Bearer token validation on protected routes |
| `middleware/rateLimitMiddleware.ts` | IP-level + per-user rate limiters |
| `cache.ts` | Redis namespaced get/set/del helpers |
| `queue.ts` | Generic transaction job queue with retry + dead-letter |
| `webhook.ts` | Outbound webhook delivery with HMAC signing |

### Frontend (`frontend/src/`)
Next.js 14 app with wallet connection (Freighter), vault actions (deposit/withdraw/harvest), i18n (6 locales), dark/light theme.

### UI Library (`ui/src/`)
Standalone Vite + React component library: design tokens, primitives (Button, Input, Modal), composites (DepositForm, WithdrawForm, HarvestPanel, PerformanceCharts), Storybook stories.

### Infrastructure (`terraform/`)
Full AWS stack managed by Terraform: VPC, public/private subnets, ALB, EC2 autoscaling, RDS PostgreSQL, Route53, CloudFront, SES/Lambda for email, CloudWatch alarms.

### Monitoring (`monitoring/`)
Prometheus scrapes backend metrics → Grafana dashboards. Loki + Promtail for log aggregation. Alertmanager routes alerts to Slack/PagerDuty.

---

## Data Flows

### Deposit Flow

```
User ──deposit(amount)──► AuraVault
  1. require_auth(caller)
  2. Guard: amount > 0, vault initialized, not paused
  3. Flash-loan guard: token.balance(vault) == total_deposited  [revert if mismatch]
  4. Read: total_shares, total_deposited
  5. Compute shares:
       if total_shares == 0: new_shares = amount  (1:1 seed)
       else:                 new_shares = floor(amount × total_shares / total_deposited)
  6. Guard: new_shares > 0  [inflation-attack fence]
  7. INTERACT: token.transfer(caller → vault, amount)
  8. EFFECT: balance[caller] += new_shares
             total_shares    += new_shares
             total_deposited += amount
  9. Emit: deposit(caller, amount, new_shares, total_shares, total_deposited)
 10. Bump TTLs (instance + persistent[caller])
 Returns: new_shares minted
```

### Withdraw Flow

```
User ──withdraw(shares)──► AuraVault
  1. require_auth(caller)
  2. Guard: shares > 0, vault initialized, not paused
  3. Flash-loan guard: token.balance(vault) == total_deposited  [revert if mismatch]
  4. Read: balance[caller], total_shares, total_deposited
  5. Guard: shares ≤ balance[caller]
  6. Compute: redeem = floor(shares × total_deposited / total_shares)
  7. Guard: redeem > 0, total_deposited ≥ redeem
  8. EFFECT: balance[caller] -= shares      (burn shares first — CEI)
             total_shares    -= shares
             total_deposited -= redeem
  9. INTERACT: token.transfer(vault → caller, redeem)
 10. Emit: withdraw(caller, shares, redeem, total_shares, total_deposited)
 11. Bump TTLs
 Returns: underlying tokens redeemed
```

### Harvest Flow

```
Keeper ──harvest(yield_amount)──► AuraVault
  1. require_auth(caller)
  2. Guard: yield_amount > 0, initialized, not paused, total_shares > 0
  3. Flash-loan guard: token.balance(vault) == total_deposited
  4. Compute: perf_fee  = yield_amount × perf_fee_bps / 10000
              net_yield = yield_amount - perf_fee
  5. INTERACT: token.transfer(keeper → vault, yield_amount)
  6. EFFECT: total_deposited   += net_yield
             total_fee_collected += perf_fee
  7. Emit: harvest(caller, yield_amount, net_yield, fee_amount)
  8. Bump TTL
  Exchange rate rises; no new shares minted → existing holders gain pro-rata.
```

### Authentication Flow (Backend)

```
Client ──POST /api/auth/login { walletAddress }──► Backend
  1. generateTokens(walletAddress, deviceId, tier)
     ├─ sign accessToken  (JWT, 15 min, HS256)
     ├─ sign refreshToken (JWT, 30 days)
     ├─ store refreshToken → Redis (NS.AUTH_REFRESH, TTL 30d)
     └─ add sessionId     → Redis set (NS.AUTH_SESSIONS:userId)
  2. Return { accessToken, refreshToken, expiresIn: 900 }

Client ──GET /api/v1/* { Authorization: Bearer <accessToken> }──►
  authenticate middleware:
    1. Verify JWT signature + expiry
    2. Check blacklist (NS.AUTH_BLACKLIST:token) → 401 if found
    3. Attach payload to req.user → next()

Client ──POST /api/auth/refresh { refreshToken }──►
  1. Look up refreshToken in Redis
  2. Verify JWT not expired
  3. Delete old refreshToken (rotation)
  4. Issue new token pair
```

### Portfolio Query Flow

```
Client ──GET /api/v1/user/portfolio?page=1&pageSize=20──►
  authenticate middleware (validates JWT)
  portfolioLimiter (100 req/min per user)
  handler:
    1. Check in-memory cache (30s TTL, key = userId:page:pageSize)
       └─ Cache HIT → return with X-Cache: HIT header
    2. Cache MISS → buildPortfolio(userId, page, pageSize)
       ├─ [production] Soroban RPC: balance_of(userId), total_assets()
       ├─ Paginate positions
       └─ Compute totalBalance
    3. Store in cache, return with X-Cache: MISS header
  Returns: { userId, totalBalance, positions[], pagination }
```

### Large Withdrawal Queue Flow

```
Client ──POST /api/v1/withdraw { shares, walletAddress, contractId }──►
  authenticate middleware
  handler:
    if shares > LARGE_WITHDRAWAL_THRESHOLD (100,000):
      enqueueWithdrawal(walletAddress, shares, contractId)
      └─ Return { queued: true, jobId }
      Background processor (every 10s):
        1. Pick oldest pending job
        2. Call Soroban RPC to submit withdraw tx
        3. Update job status: processing → completed | failed
    else:
      Build Soroban XDR tx params immediately
      └─ Return { immediate: true, txParams }
```

---

## Storage Layout

### Soroban Contract Storage

| DataKey | Bucket | Type | Notes |
|---|---|---|---|
| `Admin` | Instance | `Address` | Set once at init |
| `UnderlyingToken` | Instance | `Address` | SEP-41 token contract |
| `TotalShares` | Instance | `i128` | Sum of all outstanding shares |
| `TotalDeposited` | Instance | `i128` | Principal + net harvested yield |
| `Paused` | Instance | `bool` | Emergency halt flag |
| `Treasury` | Instance | `Address` | Fee recipient |
| `PerfFeeBps` | Instance | `u32` | Performance fee (default 1000 = 10%) |
| `MgmtFeeBps` | Instance | `u32` | Management fee in bps |
| `TotalFeeCollected` | Instance | `i128` | Cumulative fees |
| `LastMgmtFeeTime` | Instance | `u64` | Timestamp of last mgmt fee collection |
| `Version` | Instance | `u32` | Contract version counter |
| `LayoutVersion` | Instance | `u32` | Storage schema version |
| `YieldToken(addr)` | Instance | `bool` | Alt yield token whitelist |
| `Balance(addr)` | Persistent | `i128` | Per-user share balance |

**Instance storage** — single shared TTL, bumped on every mutating call.
**Persistent storage** — independent TTL per address entry; users inactive for weeks don't cause vault-wide archival.

### Redis Namespaces (Backend)

| Namespace | Key pattern | Value | TTL |
|---|---|---|---|
| `AUTH_REFRESH` | `<refreshToken>` | `{ userId, sessionId, deviceId, tier }` | 30 days |
| `AUTH_BLACKLIST` | `<accessToken>` | `true` | Remaining token lifetime |
| `AUTH_SESSIONS` | `<userId>` | Set of sessionIds | 30 days |
| `DEFI_PRICE` | `<ASSET>` | `AssetPrice` | 30s |
| `DEFI_POOLS` | `all` | `PoolData[]` | 60s |
| `EMAIL_QUEUE` | job keys | Email job payloads | Until processed |

---

## TTL / Archival Strategy

Soroban ledgers close ~every 5 seconds (17,280 ledgers ≈ 1 day).

| Constant | Value | Meaning |
|---|---|---|
| `INSTANCE_LIFETIME_THRESHOLD` | 7 days | Trigger threshold for instance TTL bump |
| `INSTANCE_BUMP_AMOUNT` | 30 days | TTL extended on every mutating call |
| `PERSISTENT_LIFETIME_THRESHOLD` | 7 days | Per-user trigger |
| `PERSISTENT_BUMP_AMOUNT` | 30 days | Per-user TTL extended on deposit/withdraw |

TTL bumps happen unconditionally at the end of every mutating function (not conditional on remaining TTL) to avoid a race between the threshold check and the bump.

---

## Security Properties

| Property | Implementation |
|---|---|
| **CEI ordering** | Withdraw: effects (burn shares) before interaction (token send). Deposit: interaction before effects (pull then write). |
| **Flash-loan guard** | `token.balance(vault) == total_deposited` checked before every mutating call. Mismatch emits `suspicious` event and returns `BalanceMismatch`. |
| **Inflation attack fence** | If computed `new_shares == 0`, deposit rejected before any token movement. |
| **Overflow safety** | All arithmetic via `checked_mul`/`checked_div`. `overflow-checks = true` in release profile. |
| **No `unwrap()` in production** | Only in `#[cfg(test)]` blocks. |
| **Emergency pause** | Admin-only `pause()`/`unpause()`. Halts deposit, withdraw, harvest. |
| **Multi-sig governance** | Parameter changes require proposal + quorum votes before execution. |
| **No upgradeability** | No `set_code` or upgrade hook. Immutability is intentional for a DeFi primitive. |
| **Rate limiting** | IP-level + per-user rate limiters on all backend endpoints. |
| **JWT rotation** | Refresh token rotated on each use; old token deleted from Redis. |
| **Token blacklist** | Logout adds access token to Redis blacklist until natural expiry. |

---

## Deployment Topology

```
Internet
    │
    ▼
Route53 (DNS) ──► CloudFront (CDN + WAF)
                       │
              ┌────────┴────────┐
              │                 │
          Static Assets      ALB (HTTPS :443)
          (S3 bucket)            │
                        ┌────────┴────────┐
                        │  EC2 Auto       │
                        │  Scaling Group  │
                        │  (Backend API)  │
                        └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
              RDS PostgreSQL  Redis     Lambda Functions
              (persistent     (cache /  ├─ email-forwarder (SES)
               data)          sessions) ├─ dns-check
                                        └─ rds-backup

Stellar Network (separate, no AWS dependency):
  Soroban RPC endpoint ◄── Backend calls directly via SOROBAN_RPC_URL
  AuraVault contract
  SEP-41 Token contract
```

---

## Decision Rationales

| Decision | Alternative Considered | Rationale |
|---|---|---|
| Internal `TotalDeposited` counter | Read live `token.balance(vault)` | Immune to direct-transfer (donation) inflation attacks |
| CEI: effects before interaction on withdraw | Interaction first | Prevents re-entrancy from exploiting intermediate share/balance state |
| CEI: interaction before effects on deposit | Effects first | Tokens must arrive before shares are minted |
| `i128` for all amounts | `u128` or fixed-point | Matches SEP-41 token standard natively; Soroban SDK uses i128 |
| Non-upgradeable contract | WASM upgrade hook | Eliminates admin-key attack surface; immutability is a security property |
| Permissionless keeper for harvest | Whitelisted keepers | Simpler; keeper whitelist can be added as a v2 governance proposal |
| Instance storage for global state | All persistent | Cheaper gas; single TTL entry to manage for globals |
| 1:1 seed ratio for first depositor | Virtual shares (OpenZeppelin ERC4626 pattern) | Simpler; zero-share fence provides same inflation protection |
| Basis-point fees (u32 bps) | Fixed amounts or percentages | Standard DeFi convention; easy to reason about; governance-adjustable |
| Redis for JWT sessions | Stateless JWT only | Enables token revocation (logout) and session enumeration |
| Withdrawal queue for large amounts | Immediate on-chain submit | Prevents flash-loan attacks exploiting large redemptions; smooths RPC load |
| Multi-sig governance for params | Single-admin mutable | Reduces single point of failure for critical parameter changes |

---

## Monitoring Stack

```
Backend API
    │ /metrics (Prometheus exposition format)
    ▼
Prometheus ──► Grafana (dashboards: system health, vault TVL, API latency)
    │
    ├─► Alertmanager ──► Slack / PagerDuty
    │     Rules: high error rate, Redis down, RDS connections, response time p99

Promtail (log collector)
    │ scrapes container logs
    ▼
Loki ──► Grafana (log exploration + alert on error patterns)
```

Key alert rules (from `monitoring/prometheus/alert.rules.yml`):
- `HighErrorRate`: HTTP 5xx rate > threshold for 5 minutes
- `RedisDown`: Redis exporter reports instance unreachable
- `HighResponseTime`: p99 latency > 500ms
- `RDSConnectionSaturation`: connection count near max

---

## CI/CD Pipeline Architecture

```
Developer Push / PR
        │
        ▼
GitHub Actions (pipeline.yml)
    │
    ├── Lint & Format (cargo fmt, clippy, eslint)
    │
    ├── Tests
    │   ├── Smart Contract (cargo test, 22 unit + integration tests)
    │   └── Frontend (vitest — performanceCharts.ts utilities)
    │
    ├── SAST
    │   ├── cargo-audit  ── known Rust CVE database
    │   ├── cargo-deny   ── license + advisory policy
    │   ├── CodeQL       ── semantic JS/TS analysis (security-extended queries)
    │   └── Trivy        ── container image scan (CRITICAL + HIGH CVEs → SARIF)
    │
    ├── Build
    │   ├── Wasm binary  ── cargo build --target wasm32-unknown-unknown --release
    │   │                   SHA-256 stamped into deployment log
    │   └── Docker image ── pushed to ghcr.io/<owner>/aura-vault-protocol
    │
    ├── Deploy — Staging (on push to main, after all gates pass)
    │   ├── stellar contract upload (Stellar testnet)
    │   ├── Deployment log written to GitHub Step Summary
    │   └── Smoke test against https://staging.aura-vault.xyz/health
    │
    ├── Auto-Rollback (if deploy-staging fails)
    │   └── Re-deploys last known good commit via git log --skip=1
    │
    └── Deploy — Production (manual workflow_dispatch, requires env approval)
        └── stellar contract upload (Stellar mainnet)

Gate: ci-gate job aggregates all required checks.
      PR merge is blocked until ci-gate succeeds.
      Target: all checks complete in < 10 minutes.
```

### Workflow Files

| File | Purpose |
|---|---|
| `.github/workflows/pipeline.yml` | Comprehensive pipeline (lint → test → SAST → build → deploy → rollback) |
| `.github/workflows/ci.yml` | Fast per-commit Rust + UI smoke tests |
| `.github/workflows/pr.yml` | PR-specific checks (lint, test, cargo-audit, Wasm size gate) |
| `.github/workflows/deploy.yml` | Standalone deploy workflow |
| `.github/workflows/docker-build.yml` | Docker image build/push |
| `.github/workflows/ci.backend-frontend.yml` | Backend + Next.js build validation |

---

## Developer Onboarding

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust | stable | `rustup default stable` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| Stellar CLI | latest | `cargo install stellar-cli --locked` |
| Docker | ≥ 24 | [docs.docker.com](https://docs.docker.com/get-docker/) |

### Local Development (5-minute setup)

```bash
# 1. Clone
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol

# 2. Run smart contract tests
cd aura-vault
cargo test

# 3. Build deployable Wasm
cargo build --target wasm32-unknown-unknown --release
# Output: aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm

# 4. Start full stack locally
cd ..
cp .env.staging.example .env
docker compose up -d        # Postgres + Redis + backend + frontend

# 5. Run UI component tests
cd ui && npm ci && npm test

# 6. Run frontend chart utility tests
cd ../frontend && npm ci && npm test
```

### Adding a New Feature

1. Create a branch: `git checkout -b feat/<short-description>`
2. Make changes; ensure `cargo test` and `npm test` pass locally
3. Open a PR targeting `main` — the CI gate runs automatically
4. All SAST + test jobs must pass before merge is allowed

### Key Decision Points for New Contributors

- **Why no proxy contract?** Immutability is a deliberate security property. Admin-key compromise cannot silently upgrade the vault.
- **Why `i128` everywhere?** SEP-41 uses `i128`; matching the type avoids implicit conversions and overflow edge cases.
- **Why mock data in PerformanceCharts?** The `/api/vault/performance` endpoint falls back to deterministic mock data when unavailable, enabling frontend development without a live backend.
- **Why cargo-deny in SAST?** `cargo-audit` catches CVEs in the dependency tree; `cargo-deny` enforces license compatibility and blocks newly-introduced advisories before they reach main.

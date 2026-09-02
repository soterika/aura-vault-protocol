# Aura Vault Protocol

A production-ready, share-based yield vault built on **Soroban** for the Stellar ecosystem — with a full-stack backend API, Next.js frontend, and mobile app.

## Overview

Aura solves fragmented liquidity and manual yield compounding in Soroban DeFi. It aggregates deposits of a single SEP-41-compatible underlying token, issues proportional vault shares to depositors, and auto-compounds yield through permissionless keeper harvests — all in a trust-minimized, `no_std` on-chain environment.

- **Deposit** — Transfer underlying tokens into the vault and receive shares proportional to your contribution. First depositor gets a 1:1 seed ratio; subsequent depositors get `floor(amount × total_shares / total_assets)` shares.
- **Withdraw** — Burn your shares to redeem `floor(shares × total_assets / total_shares)` underlying tokens, including any accrued yield.
- **Harvest** — Any keeper injects yield tokens into the vault without minting new shares, increasing the exchange rate for all existing shareholders.
- **View** — `total_assets` and `balance_of` are gas-free read-only calls.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Smart Contract | Rust · Soroban SDK · `wasm32` | On-chain vault logic on Stellar |
| Backend API | Node.js · TypeScript · Express v5 | REST API, auth, caching, jobs |
| Frontend | Next.js 15 · React 19 · Tailwind CSS | Web UI |
| Mobile | React Native · Expo | iOS / Android app |
| Database | PostgreSQL 16 | Persistent state and analytics |
| Cache / Queue | Redis 7 · BullMQ | API caching, job queues |
| Auth | JWT (HS256) · bcrypt | Stateless auth with refresh tokens |
| Validation | Zod | Schema validation for all inputs |
| Logging | Winston | Structured JSON logging |
| Infrastructure | Docker · Kubernetes · Terraform · AWS | Container orchestration and IaC |
| CI/CD | GitHub Actions | Build, test, lint, deploy pipelines |
| Monitoring | Prometheus · Grafana · Loki · Alertmanager | Observability stack |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  Next.js Frontend (port 3000)    React Native Mobile App         │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTPS / REST
┌───────────────────────▼─────────────────────────────────────────┐
│                   BACKEND API (port 3001)                        │
│  Express v5 · TypeScript · JWT auth · Zod validation            │
│                                                                  │
│  Routes:                                                         │
│   POST /api/auth/login         ← wallet address → JWT tokens     │
│   POST /api/auth/refresh       ← refresh token rotation          │
│   GET  /api/v1/vault/stats     ← vault metrics (Redis-cached)    │
│   GET  /api/v1/yield/*         ← yield calculations              │
│   GET  /api/v1/gas/*           ← EVM gas estimates               │
│   GET  /api/vault/leaderboard  ← public depositor rankings       │
│   GET  /api/users/preferences  ← user settings (auth required)   │
└──────────────┬────────────────────────┬────────────────────────-─┘
               │                        │
┌──────────────▼──────────┐  ┌──────────▼────────────────────────┐
│     PostgreSQL 16        │  │         Redis 7                    │
│  vault_positions         │  │  API response cache (60 s TTL)     │
│  transaction_queue       │  │  JWT blacklist / session store     │
│  apy_snapshots           │  │  BullMQ job queues                 │
│  audit_logs              │  │  Rate-limit counters               │
└─────────────────────────┘  └───────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────┐
│               STELLAR / SOROBAN CONTRACT                         │
│  Horizon REST API  ←→  AuraVault Wasm Contract                   │
│  horizonEventListener.ts streams on-chain events                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Backend Architecture

The backend is a plain **Express v5** application — not NestJS. Key design patterns:

- **Routing** — feature routers in `backend/src/routes/` mounted in `backend/src/index.ts`
- **Middleware** — auth (`authMiddleware.ts`), rate limiting, logging, CORS, security headers (Helmet)
- **Configuration** — centralised in `backend/src/config/index.ts`; all env vars parsed and validated by Zod at startup
- **Response DTOs** — `backend/src/dto/ApiResponseDto.ts` provides `successResponse`, `errorResponse`, and `paginatedResponse` factories for consistent API envelopes
- **Services** — business logic in `backend/src/services/`; pure functions, no singletons
- **Validation** — Zod schemas in `backend/src/validation.ts`; `validate()` middleware used on all mutating routes

### Centralized Configuration

All environment variables are validated by Zod when the process starts. Missing required variables throw immediately.

```typescript
import { config } from './config/index.js';

const { port } = config.server;        // safe, typed
const { url }  = config.database;      // never logged
const { rpcUrl } = config.gas;         // typed number coercions
```

See `backend/src/config/index.ts` for all exported sections: `server`, `secrets`, `redis`, `cache`, `gas`, `database`, `stellar`, `email`.

### Standardized API Responses

All endpoints wrap their output in a standard envelope:

```json
// Success
{ "success": true, "data": { ... }, "meta": { "timestamp": "2026-01-01T00:00:00.000Z" } }

// Error
{ "success": false, "error": { "code": "INVALID_ADDRESS", "message": "Invalid Stellar address format" }, "meta": { "timestamp": "..." } }

// Paginated
{ "success": true, "data": [...], "pagination": { "page": 1, "pageSize": 20, "total": 150, "totalPages": 8, "hasNext": true, "hasPrev": false }, "meta": { "timestamp": "..." } }
```

---

## Database

PostgreSQL 16 managed by migration files in `backend/migrations/`:

| Migration | Table | Purpose |
|---|---|---|
| `001_create_vault_positions.sql` | `vault_positions` | Wallet share balances |
| `002_create_transaction_queue.sql` | `transaction_queue` | Pending on-chain transactions |
| `004_create_yield_calculations.sql` | `yield_calculations` | Historical yield records |
| `005_create_contract_events.sql` | `contract_events` | Soroban event log |
| `006_create_apy_snapshots.sql` | `apy_snapshots` | Hourly APY history |
| `007_create_user_preferences.sql` | `user_preferences` | Per-user settings |
| `009_create_audit_logs.sql` | `audit_logs` | Security audit trail |

Reads use a separate `DATABASE_REPLICA_URL` if configured; falls back to `DATABASE_URL`.

---

## Redis / BullMQ

Redis serves two roles:

1. **Cache** — API responses, DeFi prices, vault stats cached with configurable TTLs (see `CACHE_API_TTL`, `CACHE_DEFI_PRICE_TTL` in `.env.example`).
2. **Job Queues (BullMQ)** — yield calculations, email delivery, on-chain transaction submission run as background workers. Workers start automatically in `backend/src/index.ts`.

Configure via `REDIS_URL` (single node) or `REDIS_CLUSTER` (comma-separated `host:port` pairs for cluster mode).

---

## Stellar / Soroban Integration

The `horizonEventListener.ts` service polls the Horizon API for on-chain events emitted by the Soroban vault contract and writes them to `contract_events`. The `vaultStatsService.ts` exposes a cached summary via `GET /api/v1/vault/stats`.

Contract operations (deposit, withdraw, harvest) are initiated from the frontend via Freighter wallet XDR signing or MetaMask. See **[docs/wallet-integration.md](./docs/wallet-integration.md)** for the full interaction flow.

---

## Major Features

- **Vault operations** — deposit, withdraw, harvest with Soroban CEI ordering and flash-loan guard
- **Share math** — proportional share minting/burning with overflow-safe arithmetic
- **Yield auto-compounding** — keeper-permissionless harvest increases share price for all holders
- **JWT authentication** — wallet-address login, 15-minute access tokens, 30-day refresh tokens with rotation
- **Multi-wallet support** — Freighter, MetaMask, Coinbase Wallet (frontend)
- **Background jobs** — BullMQ workers for yield calculations, email, transaction queue
- **Rate limiting** — per-IP and per-user rate limits using `express-rate-limit`
- **GDPR compliance** — erasure request flow in `gdprRoutes.ts`
- **Leaderboard** — public ranked depositor list with address truncation
- **Email notifications** — SendGrid / Mailgun integration with queue-based delivery
- **Governance** — multi-sig timelock system for contract upgrades
- **Emergency pause** — admin can halt all vault mutations; resumable with `unpause()`
- **Blue-green deployment** — zero-downtime backend releases with automated smoke tests

---

## Local Development

### Prerequisites

- Node.js 22+
- Rust + `wasm32-unknown-unknown` target
- Docker + Docker Compose
- `stellar` CLI (for contract deployment)

### Setup

```bash
# Clone and install dependencies
git clone https://github.com/your-org/aura-vault-protocol.git
cd aura-vault-protocol

# Backend
cd backend
cp .env.example .env          # fill in JWT_SECRET and DATABASE_URL at minimum
npm install
npm run dev                   # starts on :3001 with hot reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # starts on :3000

# Smart contract (separate terminal)
cd aura-vault
cargo test                    # run all 22+ unit/integration tests
```

### Docker Compose (recommended for local services)

```bash
docker compose up -d          # starts Postgres + Redis
```

### Running Tests

```bash
# Backend unit tests (Vitest)
cd backend && npm test

# Frontend tests (Vitest)
cd frontend && npm test

# Smart contract tests (Cargo)
cd aura-vault && cargo test

# E2E tests (Playwright)
npm run test:e2e               # from repo root

# Cypress integration tests
npm run cypress:run
```

---

## API Documentation

The backend exposes a machine-readable OpenAPI spec at **[docs/openapi.yaml](./docs/openapi.yaml)**.

### Accessing Swagger Locally

Start the backend (`npm run dev` in `backend/`) and visit:

```
http://localhost:3001/api-docs
```

> The Swagger UI is served by `swagger-ui-express` only when `NODE_ENV=development`.

### Authentication Inside Swagger

1. Open the Swagger UI.
2. Click **Authorize** (lock icon).
3. Call `POST /api/auth/login` with your wallet address to obtain an `accessToken`.
4. Paste the token into the Bearer field: `Bearer <your-access-token>`.
5. All authenticated endpoints will now include the header automatically.

### Key Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Exchange wallet address for JWT tokens |
| `POST` | `/api/auth/refresh` | — | Rotate refresh token |
| `POST` | `/api/auth/logout` | ✓ | Revoke current session |
| `GET` | `/api/health` | — | Liveness probe with Redis and cache warmup status |
| `GET` | `/api/v1/vault/stats` | — | Vault metrics (Redis-cached, 60 s TTL) |
| `GET` | `/api/v1/yield/calculate` | ✓ | Compute yield for a set of positions |
| `GET` | `/api/v1/gas/estimate` | — | Current EVM gas price estimate |
| `GET` | `/api/vault/leaderboard` | — | Public depositor rankings |
| `GET` | `/api/users/preferences` | ✓ | Read user preferences |
| `PUT` | `/api/users/preferences` | ✓ | Update user preferences |

Full endpoint reference: **[docs/api-reference.md](./docs/api-reference.md)**

---

## Smart Contract

### Architecture

```
aura-vault/
├── Cargo.toml
└── src/
    ├── lib.rs          # AuraVault contract — initialize, deposit, withdraw, harvest, views
    ├── errors.rs       # VaultError (15 typed variants)
    ├── storage.rs      # DataKey, TTL constants, get/set/bump helpers
    ├── interface.rs    # AuraVaultTrait public ABI
    ├── governance.rs   # Multi-sig timelock governance
    ├── fee.rs          # Fee calculation module
    └── test.rs         # 22+ unit and integration tests
```

### Contract Interface

| Function | Description |
|---|---|
| `initialize(admin, underlying_token)` | One-time setup; stores admin and token address |
| `deposit(caller, amount)` | Mint shares proportional to deposit |
| `withdraw(caller, shares)` | Burn shares and redeem underlying tokens |
| `harvest(caller, yield_amount)` | Inject yield without minting shares |
| `pause()` | Admin-only: halt all mutating operations |
| `unpause()` | Admin-only: resume operations |
| `is_paused()` | Read current pause state |
| `total_assets()` | Read current total underlying tokens in vault |
| `balance_of(address)` | Read share balance for any address |

### Security Properties

- **Checks-Effects-Interactions (CEI)** ordering on every mutating function
- **Inflation attack prevention** — zero-share mint rejection fence
- **Overflow safety** — all arithmetic uses `checked_mul` / `checked_div`; `overflow-checks = true` in release profile
- **No `unwrap()` / `expect()`** outside `#[cfg(test)]`
- **Soroban archival safety** — TTL extended on every mutating call (30-day lifetime, 7-day threshold)
- **Flash loan guard** — `deposit`, `withdraw`, and `harvest` verify actual on-chain balance matches `total_deposited` before executing
- **Emergency pause** — admin can halt and resume all mutating operations
- **Event logging** — all state-changing operations emit typed events; suspicious balance discrepancies emit a `suspicious` event

### Error Codes

| Code | Variant | Trigger |
|---|---|---|
| 1 | `NotInitialized` | Vault not yet initialized |
| 2 | `AlreadyInitialized` | `initialize` called more than once |
| 3 | `InsufficientShares` | Withdraw amount exceeds caller's balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover redemption |
| 5 | `ZeroAmount` | Zero or negative input; or share mint rounds to zero |
| 6 | `MathOverflow` | Arithmetic overflow in share formula |
| 7 | `InvalidAddress` | Reserved for future address validation |
| 8 | `ZeroShares` | Harvest called when total shares is zero |
| 9 | `UpgradeUnauthorized` | Caller is not the admin |
| 10 | `StorageLayoutMismatch` | On-chain layout version mismatch on upgrade |
| 11 | `VaultPaused` | Mutating operation called while vault is paused |
| 12 | `BalanceMismatch` | Actual token balance differs from tracked state (flash loan guard) |
| 13 | `TimelockNotExpired` | Governance proposal execution attempted before timelock has elapsed |
| 14 | `NotApproved` | Governance proposal has not reached required signature threshold |
| 15 | `AlreadyVoted` | Signer has already cast a vote on this proposal |

### Building the Contract

```bash
rustup default stable
rustup target add wasm32-unknown-unknown

cd aura-vault
cargo test                                              # run all tests
cargo build --target wasm32-unknown-unknown --release   # build deployable Wasm
```

Output: `aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm`

---

## Deployment

### Smart Contract (Stellar Testnet / Mainnet)

```bash
# Upload Wasm
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source <your-keypair> \
  --network testnet

# Deploy instance
stellar contract deploy \
  --wasm-hash <hash-from-upload> \
  --source <your-keypair> \
  --network testnet

# Initialize
stellar contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network testnet \
  -- initialize \
  --admin <admin-address> \
  --underlying_token <token-contract-id>
```

### Backend (Blue-Green)

Aura Vault Protocol uses a **blue-green deployment strategy** for zero-downtime backend releases:

- Instant atomic traffic switches between deployment slots
- Automated smoke tests before and after each deployment
- 30-minute rollback window with one-command reversion
- Deployment duration under 5 minutes

See **[BLUE_GREEN_DEPLOYMENT.md](./BLUE_GREEN_DEPLOYMENT.md)** for the complete runbook.

---

## Documentation

| Document | Description |
|---|---|
| **[docs/wallet-integration.md](./docs/wallet-integration.md)** | Stellar wallet connection, auth, NFT/share minting, transaction signing flows |
| **[docs/api-reference.md](./docs/api-reference.md)** | Full REST API endpoint reference |
| **[docs/openapi.yaml](./docs/openapi.yaml)** | OpenAPI 3.0 specification |
| **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** | Detailed system architecture |
| **[docs/smart-contract-api.md](./docs/smart-contract-api.md)** | Soroban contract ABI reference |
| **[docs/getting-started.md](./docs/getting-started.md)** | New developer onboarding guide |
| **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** | Smart contract deployment to Stellar |
| **[BLUE_GREEN_DEPLOYMENT.md](./BLUE_GREEN_DEPLOYMENT.md)** | Backend zero-downtime deployment runbook |
| **[OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md)** | Day-to-day operational procedures |
| **[GOVERNANCE.md](./GOVERNANCE.md)** | Multi-signature governance and timelock system |
| **[SECURITY.md](./SECURITY.md)** | Security model, audit results, and vulnerability reporting |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | Contribution guidelines |

---

## Database Backup

Daily automated PostgreSQL backups with AES-256 encryption and S3 storage.

| Feature | Implementation |
|---|---|
| Schedule | Daily 02:00 UTC via K8s CronJob |
| Encryption | AES-256-CBC (PBKDF2, 600k iterations) + S3 SSE-KMS |
| Retention | 30 days (STANDARD → STANDARD_IA → GLACIER_IR → expire) |
| Restore testing | Weekly Sunday 04:00 UTC in CI |
| Alerting | Prometheus alerts: `BackupMissed`, `BackupFailed`, `BackupRestoreTestFailed` |

See [docs/backup-recovery.md](./docs/backup-recovery.md) for setup instructions and runbooks.

## License

MIT

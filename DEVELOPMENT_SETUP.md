# Developer Onboarding Guide

Get a new contributor from zero to a fully running local stack in under 30 minutes.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and Install Dependencies](#2-clone-and-install-dependencies)
3. [Configure Environment](#3-configure-environment)
4. [Run the Full Stack](#4-run-the-full-stack)
5. [Running Tests](#5-running-tests)
6. [Code Style and PR Conventions](#6-code-style-and-pr-conventions)
7. [Architecture Overview](#7-architecture-overview)
8. [Troubleshooting](#8-troubleshooting)
9. [Getting Help](#9-getting-help)

---

## 1. Prerequisites

Install the following tools before cloning the repo.

| Tool | Required version | Install |
|------|-----------------|---------|
| **Git** | 2.40+ | [git-scm.com](https://git-scm.com/) |
| **Node.js** | 18 LTS or 20 LTS | [nodejs.org](https://nodejs.org/) |
| **Rust** (stable) | 1.75+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Docker** | 24+ | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| **Docker Compose** | 2.20+ | Bundled with Docker Desktop |
| **Stellar CLI** | Latest | `cargo install --locked stellar-cli --features opt` |
| **k6** (optional, load tests) | 0.50+ | [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation/) |

**Platform notes**

- macOS: Homebrew users can install most tools via `brew install node rustup-init stellar-cli k6`.
- Windows: Use WSL2 with Ubuntu 22.04 or later. The Rust/WASM toolchain and Stellar CLI require a POSIX environment.
- Linux: All commands below are tested on Ubuntu 22.04.

---

## 2. Clone and Install Dependencies

```bash
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol

# Add the WASM build target for the Soroban contract
rustup target add wasm32-unknown-unknown

# Root-level tooling (Playwright, shared scripts)
npm install

# UI (Vite + React)
cd ui && npm install && cd ..

# Frontend (Next.js dashboard)
cd frontend && npm install && cd ..

# Backend (Express + TypeScript)
cd backend && npm install && cd ..

# Solidity contracts (Hardhat)
cd contracts && npm install && cd ..
```

---

## 3. Configure Environment

### Backend

```bash
cp backend/.env.example backend/.env.local
```

Open `backend/.env.local` and fill in the values marked with `# required`:

```bash
PORT=3001
NODE_ENV=development

# JWT — generate a random 64-byte string for local use
JWT_SECRET=<run: openssl rand -hex 64>
UNSUBSCRIBE_SECRET=<run: openssl rand -hex 32>

# Redis — Docker Compose starts this automatically (see Step 4)
REDIS_URL=redis://localhost:6379

# Stellar (testnet)
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Leave these empty for local dev; set only for email features
SENDGRID_API_KEY=
MAILGUN_DOMAIN=
MAILGUN_API_KEY=
```

### UI (Vite React)

```bash
cp .env.staging.example .env.local
# Edit VITE_STELLAR_NETWORK=testnet and VITE_API_URL=http://localhost:3001
```

### Stellar keypair (testnet only)

```bash
stellar keys generate dev-key --network testnet
# Fund with testnet XLM
stellar keys fund dev-key --network testnet
# Print the public key
stellar keys address dev-key
```

---

## 4. Run the Full Stack

### Option A — Docker Compose (recommended)

Starts PostgreSQL, Redis, the backend, and the Next.js frontend in one command:

```bash
docker compose up --build
```

Services:

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3001 |
| Next.js frontend | http://localhost:3000 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Option B — Manual (each service in its own terminal)

**Terminal 1 — Infrastructure**
```bash
docker compose up postgres redis
```

**Terminal 2 — Backend**
```bash
cd backend
npm run dev          # ts-node watch mode, port 3001
```

**Terminal 3 — UI (Vite)**
```bash
cd ui
npm run dev          # Vite HMR, port 5173
```

**Terminal 4 — Frontend (Next.js)**
```bash
cd frontend
npm run dev          # Next.js dev server, port 3000
```

### Build and test the Soroban contract (optional)

```bash
cd aura-vault
cargo test                                             # 22 unit + integration tests
cargo build --target wasm32-unknown-unknown --release  # produces aura_vault.wasm
```

### Deploy the contract to Stellar Testnet

```bash
export STELLAR_NETWORK=testnet
export SOURCE=dev-key

WASM_HASH=$(stellar contract upload \
  --wasm aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source $SOURCE --network $STELLAR_NETWORK)

CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source $SOURCE --network $STELLAR_NETWORK)

stellar contract invoke \
  --id "$CONTRACT_ID" --source $SOURCE --network $STELLAR_NETWORK \
  -- initialize \
  --admin "$(stellar keys address $SOURCE)" \
  --underlying_token "<SEP-41 token contract ID>"

echo "CONTRACT_ID=$CONTRACT_ID" >> .env.local
```

---

## 5. Running Tests

### Soroban contract tests (Rust)

```bash
cd aura-vault
cargo test                  # 22 deterministic unit + integration tests
cargo test -- --nocapture   # with log output
cargo clippy --all-targets  # linting
```

What they cover:
- First-deposit 1:1 share ratio and subsequent share formula
- Withdraw round-trips, rounding edge cases
- Harvest yield injection and non-dilution invariant
- Overflow and underflow guards
- Pause / unpause lifecycle
- Flash-loan balance mismatch guard
- Upgrade authorization and version increment
- Storage archival safety

### Backend tests (Vitest)

```bash
cd backend
npm test                    # Vitest unit + integration tests
```

Tests cover the job queue, webhook delivery, Redis cache, and route handlers.

### UI unit tests (Vitest)

```bash
cd ui
npm test                    # component, error-translation, and form tests
npm run test:a11y            # accessibility (axe-core)
```

### Frontend tests (Vitest)

```bash
cd frontend
npm test
```

### k6 load tests (requires a deployed contract)

```bash
CONTRACT_ID=<your-contract-id> k6 run ui/src/tests/load.k6.ts
```

See [docs/load-test-report.md](docs/load-test-report.md) for thresholds and scenario details.

### End-to-end tests

```bash
# Cypress
npx cypress run

# Playwright (cross-browser)
npx playwright test
```

### CI pipelines

All tests run automatically on every pull request via GitHub Actions:

| Workflow | File | Trigger |
|----------|------|---------|
| Contract CI | `.github/workflows/ci.yml` | push / PR |
| Backend + Frontend | `.github/workflows/ci.backend-frontend.yml` | push / PR |
| PR checks | `.github/workflows/pr.yml` | PR only |
| Load tests | `.github/workflows/load-test.yml` | schedule + manual |
| Security scan | `.github/workflows/security-scan.yml` | push / PR |
| Cypress E2E | `.github/workflows/cypress.yml` | push |
| Fuzz tests | `.github/workflows/fuzz-test.yml` | schedule |

---

## 6. Code Style and PR Conventions

### Formatting and linting

| Layer | Tool | Command |
|-------|------|---------|
| Rust | `rustfmt` + `clippy` | `cargo fmt && cargo clippy --all-targets -- -D warnings` |
| TypeScript / TSX | ESLint + Prettier | `npm run lint && npm run format` (per workspace) |
| Solidity | Solhint | `cd contracts && npx solhint '**/*.sol'` |

CI will reject PRs that fail linting. Run the commands above locally before pushing.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: Closes #<issue>]
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`.

Examples:
```
feat(contract): add conditional TTL bump to reduce ledger write pressure
fix(backend): prevent double-delivery of webhook events on retry
docs(mobile): add push notification setup guide
```

### Branch naming

```
<type>/issue-<number>-<short-slug>
```

Examples:
- `feat/issue-42-harvest-fee`
- `fix/issue-99-withdraw-rounding`
- `docs/issue-404-onboarding`

### Pull request checklist

Before opening a PR:

- [ ] All tests pass locally (`cargo test`, `npm test` in each workspace)
- [ ] Linting passes (`cargo clippy`, `npm run lint`)
- [ ] New behaviour is covered by tests
- [ ] `CHANGELOG.md` updated for user-facing changes
- [ ] PR title follows Conventional Commits format (≤ 70 characters)
- [ ] PR description includes: **what changed**, **why**, **how to test**, **issue reference**
- [ ] No hardcoded secrets, keys, or real addresses in committed code

### Review process

1. Open the PR against `main`.
2. Automated checks must pass before review is requested.
3. At least one maintainer approval is required.
4. Squash-merge is preferred for feature branches; merge commits for release branches.
5. The PR author merges after approval.

---

## 7. Architecture Overview

```
aura-vault-protocol/
├── aura-vault/          # Soroban smart contract (Rust / no_std)
├── contracts/           # EVM companion contracts (Hardhat / Solidity)
├── backend/             # REST API (Express + TypeScript, port 3001)
├── frontend/            # User-facing dashboard (Next.js, port 3000)
├── ui/                  # Component library + design system (Vite React)
├── mobile/              # iOS & Android app (Expo 52 / React Native 0.76)
├── docs/                # Technical documentation
├── monitoring/          # Prometheus, Grafana, Loki, Alertmanager configs
├── k8s/                 # Kubernetes manifests
├── terraform/           # AWS infrastructure (ECS, RDS, CloudFront, Route 53)
└── .github/workflows/   # CI/CD pipelines
```

### Data flow

```
Mobile / Browser
     │
     ▼
Frontend (Next.js) ──► Backend API (Express) ──► PostgreSQL
     │                        │                       │
     │                        ├──► Redis (cache)      │
     │                        └──► Webhook delivery   │
     │
     ▼
Stellar Soroban RPC ──► AuraVault contract (Wasm)
```

### Key documents

| Topic | Document |
|-------|----------|
| Full system architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Smart contract API reference | [docs/smart-contract-api.md](docs/smart-contract-api.md) |
| REST API reference | [docs/api-reference.md](docs/api-reference.md) |
| OpenAPI spec | [docs/openapi.yaml](docs/openapi.yaml) |
| Deployment guide | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Webhook integration | [docs/webhooks.md](docs/webhooks.md) |
| Mobile integration | [mobile/README.md](mobile/README.md) |
| Load test report | [docs/load-test-report.md](docs/load-test-report.md) |
| Security audit | [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md) |
| Governance | [GOVERNANCE.md](GOVERNANCE.md) |
| Operations runbook | [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) |
| Design system | [ui/DESIGN_SYSTEM.md](ui/DESIGN_SYSTEM.md) |
| JavaScript SDK integration | [INTEGRATION_JAVASCRIPT.md](INTEGRATION_JAVASCRIPT.md) |
| Rust client integration | [INTEGRATION_RUST.md](INTEGRATION_RUST.md) |
| Python client integration | [INTEGRATION_PYTHON.md](INTEGRATION_PYTHON.md) |

---

## 8. Troubleshooting

### WASM build fails

```bash
cd aura-vault
cargo clean
rustup update stable
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

### Rust tests fail

```bash
cargo update           # refresh dependency lockfile
cargo test --verbose   # show full output
```

### Docker Compose: port already in use

```bash
docker compose down --volumes  # stop all containers and remove volumes
docker compose up --build
```

### Backend won't start — missing env variable

Ensure `backend/.env.local` exists and all required keys are set. The backend will print which key is missing on startup.

### Frontend can't connect to backend

- Check `VITE_API_URL=http://localhost:3001` in `.env.local`.
- Confirm the backend is running: `curl http://localhost:3001/health`.
- Clear browser cache if you changed env vars.

### Contract not initialized

- Verify the token contract ID is valid on testnet.
- Confirm your keypair is funded: `stellar keys fund dev-key --network testnet`.
- Re-run the `initialize` invocation with the correct `--admin` and `--underlying_token`.

### ESLint / Prettier version conflict

```bash
cd ui   # or frontend/
rm -rf node_modules package-lock.json
npm install
npm run lint
```

---

## 9. Getting Help

- **Contract bugs**: open an issue and attach the failing test output.
- **UI / backend bugs**: include the relevant log output and `.env.local` (with secrets redacted).
- **Architecture questions**: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) or ask in the repo discussions.
- **Stellar SDK questions**: [Stellar Developer Docs](https://developers.stellar.org/) and [Stellar Dev Discord](https://discord.gg/stellardev).
- **Security vulnerabilities**: follow the responsible disclosure process in [SECURITY.md](SECURITY.md) — do not open a public issue.

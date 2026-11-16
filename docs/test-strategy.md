# Aura Vault — Comprehensive Test Strategy

This document describes the testing strategy for the entire Aura Vault Protocol stack: the Soroban smart contract (`aura-vault/`), the Node.js backend API (`backend/`), the Next.js frontend (`frontend/`), the React component library (`ui/`), and cross-cutting concerns including security, fuzz testing, and E2E user flows.

---

## Test Pyramid

```
                        ┌───────────────┐
                        │   E2E Tests   │  slow · expensive · few
                        │  (Cypress /   │
                        │  Playwright)  │
                     ┌──┴───────────────┴──┐
                     │  Integration Tests  │  medium speed · medium cost
                     │  (Backend routes,   │
                     │  contract+DB flows) │
              ┌──────┴─────────────────────┴──────┐
              │          Unit Tests               │  fast · cheap · many
              │  (Contract, backend services,     │
              │  UI components, pure functions)   │
              └───────────────────────────────────┘
```

The pyramid guides investment: most tests are fast, isolated unit tests. Integration tests verify that components work together correctly. E2E tests verify full user journeys from the browser through to the blockchain.

---

## Layer 1 — Unit Tests

### 1a. Smart Contract (Rust / Soroban SDK)

**Location:** `aura-vault/src/test.rs`  
**Runner:** `cargo test`  
**Current count:** 35+ tests (22 core + 13 governance)

Unit tests run in the Soroban `Env::default()` testnet simulator — no live network required. All authentication is mocked with `env.mock_all_auths()`.

#### Coverage Targets

| Area | Target | Current Status |
|------|--------|---------------|
| Happy paths (deposit, withdraw, harvest) | 100% | ✅ Covered |
| Error paths (all 12 `VaultError` variants) | 100% | ✅ Covered |
| Pause / unpause lifecycle | 100% | ✅ Covered |
| Fee collection and withdrawal | 100% | ✅ Covered |
| Upgrade with version tracking | 100% | ✅ Covered |
| Flash-loan guard (`suspicious` event) | 100% | ✅ Covered |
| Governance proposals, voting, timelock | 100% | ✅ Covered |
| Multi-token harvest (`harvest_token`) | 80% | 🔲 Expand |
| Alt-token whitelist (`register_yield_token`) | 60% | 🔲 Expand |

#### Naming Convention

Tests follow `test_<function>_<scenario>_<expected_result>`:

- `test_first_deposit_mints_one_to_one`
- `test_withdraw_more_than_balance_returns_insufficient_shares`
- `test_harvest_then_withdraw_yields_more`

#### Key Test Patterns

```rust
// Pattern 1: Error path — assert the exact VaultError variant
let result = vault.try_deposit(&user, &0);
assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));

// Pattern 2: State assertion after mutation
vault.deposit(&user, &1_000_000);
assert_eq!(vault.total_assets(), 1_000_000);
assert_eq!(vault.balance_of(&user), 1_000_000);

// Pattern 3: Round-trip invariant (deposit + withdraw ≤ deposited)
let minted = vault.deposit(&user, &amount);
let received = vault.withdraw(&user, &minted);
assert!(received >= amount - 1, "rounding loss > 1 unit");
```

#### Running

```bash
cd aura-vault
cargo test                          # all tests
cargo test test_deposit             # filter by name
cargo test -- --nocapture           # show println! output
```

---

### 1b. Backend Services (TypeScript / Vitest)

**Location:** `backend/src/services/*.test.ts`, `backend/src/queue.test.ts`  
**Runner:** `npx vitest run` (configured in `package.json`)

#### Coverage Targets

| Service | Target | Notes |
|---------|--------|-------|
| `yieldService` | 90% line | Compound yield math must be exact |
| `gasService` | 85% line | Covers feeHistory, legacyGasPrice, fallback paths |
| `emailService` | 80% line | Template rendering, queue integration |
| `queue` | 80% line | BullMQ worker lifecycle, retry logic |
| `auth` | 90% line | Token generation, refresh, revoke |
| `webhook` | 85% line | Signature signing, delivery, retry backoff |
| `rateLimitMiddleware` | 80% line | Per-IP and per-user limits |

#### Key Test Patterns

```typescript
// yieldService — pure math verification
it("dailyYieldForSource returns compound daily yield", () => {
  const result = dailyYieldForSource(1_000_000, 0.1); // 10% APY
  const expected = 1_000_000 * (Math.pow(1.1, 1 / 365) - 1);
  expect(result).toBeCloseTo(expected, 10);
});

// gasService — fallback when RPC fails
it("falls back to history-based estimate when RPC throws", async () => {
  const rpc = { request: vi.fn().mockRejectedValue(new Error("timeout")) };
  const store = createMockStore({ history: [mockHistoryEntry] });
  const service = new GasPriceService({ rpc, store });
  const result = await service.estimate(1);
  expect(result.source).toBe("fallback");
});

// webhook — delivery retry
it("schedules retry on non-2xx response", async () => {
  fetchMock.mockResponseOnce("", { status: 500 });
  const delivery = await dispatchEvent("deposit", { amount: "1000" });
  expect(delivery.status).toBe("pending");
});
```

#### Running

```bash
cd backend
npm test                        # all tests
npx vitest run --reporter=verbose
npx vitest run --coverage       # with coverage report
```

---

### 1c. UI Components (TypeScript / Vitest + Testing Library)

**Location:** `ui/src/tests/`  
**Runner:** `npx vitest run` (configured in `ui/package.json`)

#### Coverage Targets

| Area | Target | Notes |
|------|--------|-------|
| Form components (DepositForm, WithdrawForm) | 90% | Validation, submission, error display |
| Error handling (`errors.ts`) | 95% | All error code paths |
| Accessibility (a11y tests) | Pass | WCAG 2.1 AA via `axe-core` |
| Component rendering | 85% | Snapshot tests for visual regression |

#### Key Test Patterns

```typescript
// Accessibility test — axe-core
it("DepositForm is accessible", async () => {
  const { container } = render(<DepositForm onDeposit={vi.fn()} />);
  const results = await axe(container);
  expect(results.violations).toHaveLength(0);
});

// Form validation
it("rejects zero deposit amount", async () => {
  const onDeposit = vi.fn();
  render(<DepositForm onDeposit={onDeposit} />);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: /deposit/i }));
  expect(onDeposit).not.toHaveBeenCalled();
  expect(screen.getByText(/amount must be greater than 0/i)).toBeInTheDocument();
});
```

#### Running

```bash
cd ui
npm test
npm run test:coverage
npm run test:a11y        # accessibility-only run
```

---

### 1d. Frontend (TypeScript / Jest or Vitest)

**Location:** `frontend/src/`  
**Runner:** Framework-standard test command

#### Coverage Targets

| Area | Target |
|------|--------|
| API call wrappers / `lib/` | 85% |
| i18n translations (all locale files) | 100% key coverage |
| Wallet connection logic | 80% |

---

## Layer 2 — Integration Tests

### 2a. Backend API Routes

**Location:** `backend/src/routes/*.test.ts` (to be created)  
**Runner:** Vitest with Supertest or a real test server

Integration tests spin up the Express app against a test PostgreSQL instance (Docker Compose) and a test Redis instance.

#### Test Matrix

| Endpoint | Scenarios |
|----------|-----------|
| `POST /api/auth/login` | Valid wallet, missing wallet, rate limit |
| `POST /api/auth/refresh` | Valid token, expired token, invalid token |
| `GET /api/v1/user/portfolio` | Authenticated, unauthenticated, empty portfolio |
| `GET /api/v1/yield` | Valid positions, zero positions, inactive vault |
| `GET /api/v1/gas` | Cache hit, cache miss, RPC fallback |
| `POST /api/webhooks` | Valid registration, duplicate URL, invalid URL |
| `POST /api/webhooks/:id/deliveries` | Successful delivery, retry, 24h expiry |
| `GET /api/health` | Redis up, Redis down |

#### Setup / Teardown

```typescript
beforeAll(async () => {
  await runMigrations(testDb); // run 001_create_vault_positions.sql
  await seedTestData(testDb);
});

afterEach(async () => {
  await clearTables(testDb);   // reset between tests
});

afterAll(async () => {
  await testDb.end();
  await testRedis.quit();
});
```

#### Running

```bash
cd backend
docker-compose -f docker-compose.test.yml up -d  # start test DB and Redis
npm run test:integration
```

---

### 2b. Contract + Backend Event Processing

These tests verify that on-chain contract events are correctly picked up by the backend event listener, stored, and dispatched via webhooks.

**Environment:** Soroban testnet or local `soroban-env-host`

#### Scenarios

1. Deposit → verify `deposit` webhook event is dispatched within 30 seconds
2. Suspicious event → verify `suspicious` webhook fires and `#security-alerts` integration is triggered
3. Pause → verify vault state is correctly reflected in the backend API
4. Horizon SSE reconnect → disconnect the Horizon stream, reconnect, verify no events are missed (replay from cursor)

---

## Layer 3 — Fuzz Testing

### 3a. Property-Based Tests (Rust / proptest)

**Location:** `aura-vault/src/fuzz.rs`  
**Runner:** `cargo test` (proptest integrates into the standard test harness)

#### Properties Under Test

| Property | Description |
|----------|-------------|
| First deposit 1:1 | `deposit(amount)` returns `shares == amount` when vault is empty |
| No-gain on round-trip | `withdraw(deposit(x)) ≤ x` (floor division cannot gain tokens) |
| Cannot overdraw | `withdraw(shares > balance)` always returns `InsufficientShares` |
| Zero-amount rejection | `deposit(0)` and `withdraw(0)` always return `ZeroAmount` |
| Harvest improves exchange rate | `total_assets` after `harvest(y) == before + y` |
| Arithmetic never panics | No `unwrap()` panic on any valid `i128` input |
| Share-sum consistency | `sum(balance_of(user) for all users) == total_shares` |

#### Fuzz Goals

- Minimum 10,000 cases per property (proptest default)
- Verify all properties pass at `i128::MAX / 2` boundary inputs
- All failures are reproduced via `proptest.toml` corpus persistence

#### Running

```bash
cd aura-vault
cargo test prop_                    # run only proptest cases
PROPTEST_CASES=100000 cargo test    # increase case count for CI nightly run
```

#### Failure Handling

proptest automatically saves failing cases to `aura-vault/test_snapshots/` and replays them on subsequent runs until they pass. Do not delete snapshot files — they are regression guards.

---

### 3b. Smart Contract Fuzzing (cargo-fuzz / libFuzzer) — Future

For deeper coverage beyond property tests, `cargo-fuzz` targets can be added:

```toml
# fuzz/Cargo.toml
[dependencies]
libfuzzer-sys = "0.4"
```

```rust
// fuzz/fuzz_targets/fuzz_deposit.rs
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(amount) = i128::from_le_bytes(data.try_into().unwrap_or_default()) {
        let env = soroban_sdk::Env::default();
        // ... fuzz deposit with raw bytes
    }
});
```

**Goal:** Run cargo-fuzz for 24 hours before each major release. Track coverage via LLVM SanitizerCoverage.

---

## Layer 4 — E2E Tests

### 4a. Cypress (UI Flows)

**Location:** `cypress/e2e/`  
**Runner:** `npx cypress run`

#### Test Suites

| Suite | Path | Scenarios |
|-------|------|-----------|
| Wallet connection | `cypress/e2e/wallet-connection.cy.ts` | Connect Freighter, disconnect, wrong network |
| Deposit flow | `cypress/e2e/deposit.cy.ts` | Happy path, max balance, invalid input |
| Withdrawal flow | `cypress/e2e/withdrawal.cy.ts` | Full withdrawal, partial, zero shares |
| Portfolio dashboard | `cypress/e2e/portfolio.cy.ts` | Yield display, position history, no positions |
| Multi-step modal | `cypress/e2e/multi-step-modal.cy.ts` | Confirm → sign → success → error recovery |
| Error handling | `cypress/e2e/error-handling.cy.ts` | Network errors, wallet rejection, contract errors |

#### Test Data Management

- Cypress uses a **test wallet** with a fixed Stellar testnet keypair (seeded with testnet XLM).
- The vault under test is a dedicated **testnet deployment** separate from mainnet.
- Database state is reset between test runs via a `cy.task('resetTestDb')` command.
- Token balances are topped up by a `cy.task('mintTestTokens', { amount })` helper calling the testnet token admin.

#### Running

```bash
# Headless CI run
npx cypress run

# Interactive debug mode
npx cypress open

# Run a single spec
npx cypress run --spec "cypress/e2e/deposit.cy.ts"
```

---

### 4b. Playwright (Cross-Browser)

**Location:** `playwright/cross-browser.spec.ts`  
**Runner:** `npx playwright test`

#### Browser Matrix

| Browser | Version | Notes |
|---------|---------|-------|
| Chromium | Latest | Primary CI browser |
| Firefox | Latest | Secondary CI |
| WebKit (Safari) | Latest | Mobile simulation |

#### Mobile Viewports

- iPhone 14 Pro (390 × 844)
- iPad Pro 11" (1024 × 1366)
- Android (360 × 800)

#### Running

```bash
npx playwright test
npx playwright test --headed         # with browser window
npx playwright test --project=webkit # single browser
```

---

## Security Testing

### Static Analysis (SAST)

| Tool | Target | Trigger |
|------|--------|---------|
| `cargo clippy -- -D warnings` | Rust contract | Every PR |
| `cargo audit` | Rust dependencies | Every PR + daily |
| `eslint` with security plugins | TypeScript backend/frontend | Every PR |
| `npm audit --audit-level=high` | Node.js dependencies | Every PR |
| `semgrep` (OWASP ruleset) | TypeScript + Rust | Weekly scheduled scan |
| `trivy` (container scan) | Docker images | On every Docker build |

### Dynamic Analysis (DAST)

| Tool | Target | Schedule |
|------|--------|----------|
| OWASP ZAP baseline scan | Backend API (`/api/*`) | Weekly, against staging |
| Burp Suite (manual) | Full API surface | Pre-release |
| `k6` load test | Backend API | Pre-release (see `ui/src/tests/load.k6.ts`) |

### Smart Contract Audit

- **Internal audit:** Review `AUDIT.md` checklist before each major release.
- **External audit:** Engage a Soroban-specialised firm (e.g., OtterSec, Kudelski Security) before mainnet deployment.
- **Audit scope:** All functions in `lib.rs`, arithmetic in `storage.rs` and `fee.rs`, governance in `governance.rs`.

### Authentication and Authorization Tests

| Scenario | Expected Result |
|----------|----------------|
| Expired JWT on API call | 401 Unauthorized |
| `pause()` called by non-admin | `VaultError::UpgradeUnauthorized` |
| `upgrade()` called by non-admin | `VaultError::UpgradeUnauthorized` |
| Webhook delivery with invalid signature | Rejected by consumer |
| Rate limit exceeded (auth endpoint) | 429 Too Many Requests |

---

## Test Data Management

### Testnet Contract Addresses

Maintain a `.env.test` file (not committed) or CI environment variables:

```
VAULT_CONTRACT_ID_TESTNET=C...
TOKEN_CONTRACT_ID_TESTNET=C...
ADMIN_SECRET_KEY_TESTNET=S...   # testnet only — never use mainnet keys in tests
HORIZON_URL_TESTNET=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL_TESTNET=https://soroban-testnet.stellar.org
```

### Database Test Fixtures

```typescript
// backend/src/__fixtures__/vault-positions.ts
export const activePosition = {
  user_id: "550e8400-e29b-41d4-a716-446655440000",
  vault_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  amount: "1000000.000000000000000000",
  entry_date: new Date("2025-01-01T00:00:00Z"),
  entry_price: "1.000000000000000000",
  yield_earned: "50000.000000000000000000",
  deleted_at: null,
};
```

### Isolation Strategy

| Layer | Isolation Method |
|-------|----------------|
| Unit tests | In-memory / mock objects — no external dependencies |
| Integration tests | Dedicated test database (Docker); truncated between runs |
| E2E tests | Dedicated testnet vault + wallet; seeded before each run |
| Fuzz tests | Soroban in-memory `Env::default()` — no state leaks |

---

## CI/CD Integration

### GitHub Actions Workflows

| Workflow | File | Trigger | Tests Run |
|----------|------|---------|-----------|
| `ci.yml` | `.github/workflows/ci.yml` | Every push/PR | Rust unit, backend unit, UI unit, SAST |
| `pr.yml` | `.github/workflows/pr.yml` | PR to main | All unit + integration |
| `cypress.yml` | `.github/workflows/cypress.yml` | PR to main | E2E Cypress |
| `fuzz-test.yml` | `.github/workflows/fuzz-test.yml` | Nightly | proptest (high case count) |
| `fuzzing-properties.yml` | `.github/workflows/fuzzing-properties.yml` | Nightly | Property-based tests |

### Gate Policy

| Gate | Required to Merge |
|------|-------------------|
| All unit tests pass | ✅ Yes |
| Integration tests pass | ✅ Yes |
| E2E tests pass | ✅ Yes |
| No new `cargo clippy` warnings | ✅ Yes |
| No high/critical `npm audit` findings | ✅ Yes |
| `cargo audit` clean | ✅ Yes |
| Coverage does not drop > 2% | ✅ Yes |

---

## Coverage Targets Summary

| Layer | Metric | Target |
|-------|--------|--------|
| Smart contract (Rust) | Line coverage | 95% |
| Smart contract (Rust) | Branch coverage | 90% |
| Backend services (TS) | Line coverage | 85% |
| Backend API routes (TS) | Line coverage | 80% |
| UI components (TS/TSX) | Line coverage | 85% |
| Frontend pages (TS/TSX) | Line coverage | 75% |
| E2E user journeys | Critical paths covered | 100% |
| Fuzz properties | Properties defined | 7 core + invariants |

---

## Test Infrastructure Requirements

| Component | Tooling | Notes |
|-----------|---------|-------|
| Rust contract tests | `cargo test`, `proptest` | In-process, no external deps |
| TypeScript unit/integration | `vitest`, `supertest` | Node 18+ |
| UI component tests | `vitest`, `@testing-library/react`, `axe-core` | jsdom environment |
| E2E tests | `cypress`, `playwright` | Requires testnet access |
| Database for integration | PostgreSQL 15 via Docker | `docker-compose.yml` |
| Cache for integration | Redis 7 via Docker | `docker-compose.yml` |
| Coverage reporting | `c8` (TS), `cargo-tarpaulin` (Rust) | Published to CI artifacts |
| Static analysis | `semgrep`, `trivy`, `cargo audit` | Docker-based in CI |

---

## Writing New Tests — Checklist

Before merging any new contract function or backend endpoint:

- [ ] Unit test for each success path
- [ ] Unit test for each error/rejection path
- [ ] Edge case: zero / max values
- [ ] If mutating state: verify state before and after
- [ ] If emitting an event: verify event topics and data
- [ ] If new proptest property applies: add to `fuzz.rs`
- [ ] If new API route: add integration test
- [ ] If new user-visible UI: add Cypress test for the happy path
- [ ] Update this document if the strategy changes

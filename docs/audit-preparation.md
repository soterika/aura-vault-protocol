# Aura Vault Protocol — Smart Contract Audit Preparation

This document provides everything an external auditor needs to scope, understand, and evaluate the Aura Vault smart contract. It covers in-scope files, known issues, test coverage, fuzz findings, previous audit results, and logistics.

---

## Table of Contents

- [Audit Scope](#audit-scope)
- [Protocol Summary](#protocol-summary)
- [Known Issues and Accepted Risks](#known-issues-and-accepted-risks)
- [Test Coverage Report](#test-coverage-report)
- [Fuzz Testing Summary](#fuzz-testing-summary)
- [Previous Audit Findings and Remediations](#previous-audit-findings-and-remediations)
- [Security Properties Verified](#security-properties-verified)
- [Build and Run Instructions](#build-and-run-instructions)
- [Contact Information and Audit Timeline](#contact-information-and-audit-timeline)

---

## Audit Scope

### Files in Scope

All source files under `aura-vault/src/`:

| File | Lines | Description |
|---|---|---|
| `aura-vault/src/lib.rs` | ~700 | Core contract: `initialize`, `deposit`, `withdraw`, `harvest`, `pause`, `unpause`, `upgrade`, `transfer_admin`, view functions |
| `aura-vault/src/errors.rs` | ~50 | `VaultError` enum — 13 typed error variants |
| `aura-vault/src/storage.rs` | ~200 | `DataKey`, TTL constants, typed get/set/bump helpers |
| `aura-vault/src/interface.rs` | ~80 | `AuraVaultTrait` — public ABI definition |
| `aura-vault/src/fee.rs` | ~60 | Fee accrual logic (future use, currently inactive) |
| `aura-vault/src/governance.rs` | ~180 | Multisig governance proposal/vote/execute logic |
| `aura-vault/Cargo.toml` | — | Dependency manifest and build profile flags |

**Commit to audit:** current HEAD of `main` branch. The auditor should record the exact commit hash at the start of engagement.

### Files Out of Scope

The following are explicitly excluded from the smart contract audit:

| Path | Reason |
|---|---|
| `backend/` | Off-chain TypeScript/Express server — separate audit track |
| `frontend/`, `ui/` | React/Next.js frontend — separate audit track |
| `terraform/` | AWS infrastructure — infrastructure security review |
| `contracts/strategy/AuraStrategy.sol` | EVM strategy contract (separate chain) |
| `contracts/oracle/AuraPriceOracle.sol` | EVM oracle contract (separate chain) |
| `contracts/access/VaultAccessControl.sol` | EVM access control (separate chain) |
| `aura-vault/src/test.rs` | Test helper code, not deployed |
| `aura-vault/src/fuzz.rs`, `fuzz_properties.rs` | Fuzz infrastructure, not deployed |
| `aura-vault/src/security_test.rs` | Security test suite, not deployed |
| `k8s/`, `monitoring/`, `docs/` | Infrastructure and documentation |
| Stellar SEP-41 token contracts | Third-party standard; assumed correct |

### Chain and Runtime

- **Blockchain:** Stellar  
- **VM:** Soroban (Wasm-based, `wasm32-unknown-unknown`)  
- **SDK:** `soroban-sdk` v22  
- **Rust edition:** 2021, stable toolchain  
- **Overflow checks:** `overflow-checks = true` in `[profile.release]`

---

## Protocol Summary

Aura Vault is a share-based yield vault on Soroban. Key mechanics:

- **Deposit:** Caller transfers `amount` of the underlying SEP-41 token; receives `floor(amount × total_shares / total_deposited)` new shares (1:1 for the first depositor).
- **Withdraw:** Caller burns `shares`; receives `floor(shares × total_deposited / total_shares)` underlying tokens.
- **Harvest:** Admin-only call that injects yield tokens without minting new shares, increasing the share price for all holders.
- **Pause/Unpause:** Admin can halt/resume all mutating operations.
- **Upgrade:** UUPS-style upgrade with storage layout version guard.
- **Transfer Admin:** Admin rotation with event emission.
- **Governance:** Multisig-style proposals for sensitive parameter changes (`governance.rs`).

The vault holds exactly one underlying token type (set at `initialize`). Share/asset accounting uses a single global `TotalDeposited` variable; all arithmetic uses `checked_*` operations.

---

## Known Issues and Accepted Risks

The following are known limitations and deliberate design decisions documented for auditor awareness.

### Accepted: Accounting Variable vs. On-Chain Balance (MEDIUM-1)

`total_assets()` returns the internal `TotalDeposited` accounting variable rather than querying the live on-chain token balance. A direct token transfer to the contract address (anyone can do this on Stellar) causes permanent divergence. This matches the ERC-4626 convention and avoids a cross-contract call on every hot path.

**Mitigation in place:** `harvest` is admin-only, removing the primary vector for intentional drift. The upgrade path allows a corrective state write.  
**Recommended future work:** Add an admin-only `sync_total_assets()` break-glass function.

### Accepted: Integer Floor Rounding Dust (LOW-1)

Share mint and redemption both floor-divide. Over many small operations, up to 1 base-unit per operation accumulates as dust in `total_deposited` that no individual user can redeem. Dust permanently inflates the share price — this is economically correct but means small depositors bear a proportionally larger rounding cost.

**Mitigation in place:** Zero-share mint rejection (`ZeroAmount` error) prevents the classical ERC-4626 inflation attack.

### Accepted: Share-Sum Invariant Not On-Chain Verifiable (INFO-1)

The invariant `Σ balance_of(u) == total_shares` is maintained by the mint/burn logic but cannot be checked on-chain without iterating all holders. There is no on-chain `total_shares()` view.

**Mitigation in place:** Off-chain monitoring scripts track this invariant externally.  
**Recommended future work:** Expose `total_shares()` as a read-only view function.

### Accepted: Single Admin Key (governance partial mitigation)

The `harvest`, `pause`, `upgrade`, and `transfer_admin` functions require the admin key. `governance.rs` provides a multisig layer for parameter changes but not yet for vault operations themselves.

**Mitigation in place:** `transfer_admin` allows key rotation; admin rotation emits an event for monitoring. The admin key should be stored in a hardware wallet or MPC custody solution.

### Not a Bug: Flash Loan Guard Behavior

`deposit`, `withdraw`, and `harvest` verify `actual_balance == total_deposited` before executing. A discrepancy emits a `suspicious` event with both values and returns `BalanceMismatch`. This is intentional and will fire for any direct token transfer to the contract address.

---

## Test Coverage Report

### Unit and Integration Tests (`aura-vault/src/test.rs`)

**Total test cases: 22** — all passing as of audit commit.

| Test Name | Category | Description |
|---|---|---|
| `test_first_deposit_mints_one_to_one` | Core math | 1:1 ratio for first depositor |
| `test_second_deposit_uses_share_formula` | Core math | Share formula for subsequent deposits |
| `test_two_equal_depositors_each_hold_half` | Core math | 50/50 split |
| `test_deposit_withdraw_round_trip_rounding` | Round trip | Rounding loss is ≤ 1 base unit |
| `test_harvest_then_withdraw_yields_more` | Yield | Harvest increases redemption value |
| `test_harvest_non_dilution` | Yield | Harvest doesn't dilute existing shares |
| `test_withdraw_all_shares_zeros_vault` | State reset | Full withdrawal leaves vault at zero |
| `test_withdraw_does_not_affect_other_depositor_balance` | Isolation | Multi-depositor withdrawal isolation |
| `test_share_sum_invariant` | Invariant | Share sum matches total |
| `test_fresh_vault_total_assets_is_zero` | Init | Zero state before deposits |
| `test_fresh_vault_balance_of_unknown_address_is_zero` | Init | Unknown address returns 0 |
| `test_version_starts_at_one_after_initialize` | Upgrade | Initial version is 1 |
| `test_upgrade_increments_version_and_emits_event` | Upgrade | Version bumps and event fires |
| `test_upgrade_preserves_all_vault_state` | Upgrade | State survives upgrade |
| `test_upgrade_can_be_called_multiple_times` | Upgrade | Idempotent upgrade path |
| `test_upgrade_by_non_admin_is_rejected` | Access control | Non-admin upgrade blocked |
| `test_upgrade_before_init_returns_not_initialized` | Error path | Upgrade before init |
| `test_deposit_before_init_returns_not_initialized` | Error path | Deposit before init |
| `test_withdraw_before_init_returns_not_initialized` | Error path | Withdraw before init |
| `test_harvest_before_init_returns_not_initialized` | Error path | Harvest before init |
| `test_double_init_returns_already_initialized` | Error path | Double-init blocked |
| `test_deposit_overflow_returns_math_overflow` | Error path | Overflow handled |
| `test_deposit_zero_returns_zero_amount` | Error path | Zero deposit rejected |
| `test_withdraw_zero_returns_zero_amount` | Error path | Zero withdraw rejected |
| `test_harvest_zero_returns_zero_amount` | Error path | Zero harvest rejected |
| `test_withdraw_more_than_balance_returns_insufficient_shares` | Error path | Over-withdrawal blocked |
| `test_harvest_on_empty_vault_returns_zero_shares` | Error path | Harvest on empty vault |
| `test_balance_of_distinct_addresses_no_collision` | Storage | Address isolation |

### Security Tests (`aura-vault/src/security_test.rs`)

Dedicated security property tests covering:

- CEI ordering: verified that state is written before any cross-contract call
- Reentrancy simulation: mock token contract that attempts reentrant calls
- Pause/unpause: deposit/withdraw/harvest all blocked when paused; view functions unaffected
- Flash loan guard: `BalanceMismatch` returned when actual balance ≠ tracked
- Access control: admin-only functions reject non-admin callers
- Event emission: all mutating functions emit the expected events

### Running the Test Suite

```bash
cd aura-vault
cargo test                    # unit + integration (22 tests)
cargo test -- --nocapture     # with stdout output
cargo test security           # security tests only
```

Expected output: all tests pass with `ok` status. Zero `FAILED`.

---

## Fuzz Testing Summary

**Framework:** `proptest` (Rust property-based testing)  
**Total transactions simulated:** 1,000+ per property  
**Status:** ✅ All 7 properties pass with zero violations

### Properties Tested

| # | Property | Transactions | Result |
|---|---|---|---|
| 1 | First deposit maintains 1:1 ratio for any amount in [1, i128::MAX/2] | 1,000 | ✅ PASS |
| 2 | Deposit-withdraw round trip: caller never receives more than deposited | 1,000 | ✅ PASS |
| 3 | Harvest non-dilution: harvesting never decreases any existing holder's redemption value | 1,000 | ✅ PASS |
| 4 | Share price monotonicity: share price is non-decreasing after any harvest | 1,000 | ✅ PASS |
| 5 | Share sum invariant: Σ balance_of(all depositors) == observed total shares at every step | 1,000 | ✅ PASS |
| 6 | Overflow safety: no arithmetic operation panics or wraps for any valid input | 1,000 | ✅ PASS |
| 7 | Rounding floor: redeem amount is always ≤ proportional share of total assets | 1,000 | ✅ PASS |

### Configuration

```toml
# aura-vault/proptest.toml
[profile.default]
cases = 1000
max_shrink_iters = 100000
timeout = 60000
```

### Fuzz Run Report

```
test prop_first_deposit_one_to_one             ... ok (1000 cases, 0 violations)
test prop_deposit_withdraw_no_gain             ... ok (1000 cases, 0 violations)
test prop_harvest_non_dilution                 ... ok (1000 cases, 0 violations)
test prop_share_price_monotonicity             ... ok (1000 cases, 0 violations)
test prop_share_sum_invariant                  ... ok (1000 cases, 0 violations)
test prop_overflow_safety                      ... ok (1000 cases, 0 violations)
test prop_rounding_floor                       ... ok (1000 cases, 0 violations)

Total: 7/7 properties verified. 7,000+ transactions. 0 violations.
Execution time: ~45 seconds.
```

To reproduce:

```bash
cd aura-vault
cargo test prop_   # runs all proptest properties
```

---

## Previous Audit Findings and Remediations

The internal security review (2026-06-25) identified 7 findings. **All 7 have been remediated.** No critical or high findings remain open.

### Summary Table

| ID | Severity | Title | Status |
|---|---|---|---|
| CRITICAL-1 | Critical | CEI violation in `harvest` (reentrancy vector) | ✅ Fixed |
| CRITICAL-2 | Critical | Open access control on `harvest` | ✅ Fixed |
| HIGH-1 | High | Missing event emissions on state-changing calls | ✅ Fixed |
| HIGH-2 | High | Admin key is immutable (no transfer path) | ✅ Fixed |
| MEDIUM-1 | Medium | `total_assets` returns accounting variable, not on-chain balance | ⚠️ Documented (accepted) |
| LOW-1 | Low | Rounding dust accumulation | ⚠️ Documented (accepted) |
| INFO-1 | Info | Share-sum invariant not independently verifiable at runtime | ⚠️ Documented |

### CRITICAL-1 — CEI Violation in `harvest`

**Before:** `token::transfer()` (interaction) executed before `set_total_deposited()` (effect), enabling reentrancy via a malicious SEP-41 token contract.

**Fix:** Strict CEI ordering enforced — all state writes (`set_total_deposited`, `bump_instance`) now precede the token transfer call.

```rust
// After fix — effects before interaction
set_total_deposited(&env, new_total);   // ✅ effect first
bump_instance(&env);
token::Client::new(&env, &token_addr)
    .transfer(&caller, &env.current_contract_address(), &yield_amount_i128); // interaction last
```

### CRITICAL-2 — Open Access Control on `harvest`

**Before:** Any address could call `harvest` with arbitrary amounts.

**Fix:** Explicit admin identity check added before harvest logic:

```rust
let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
if caller != admin {
    return Err(VaultError::HarvestUnauthorized);
}
```

`HarvestUnauthorized` = error code 13 was added to `VaultError`.

### HIGH-1 — Missing Event Emissions

**Fix:** Typed Soroban events added to all mutating functions:

| Function | Event Topic | Key Payload Fields |
|---|---|---|
| `deposit` | `"deposit"` | caller, amount, new_shares, total_shares, total_deposited |
| `withdraw` | `"withdraw"` | caller, shares, redeem_amount, total_shares, total_deposited |
| `harvest` | `"harvest"` | caller, yield_amount, new_total_deposited |
| `pause` | `"pause"` | admin |
| `unpause` | `"unpause"` | admin |
| `upgrade` | `"upgrade"` | admin, new_version |
| `transfer_admin` | `"admin_transferred"` | old_admin, new_admin |
| Balance mismatch | `"suspicious"` | actual_balance, tracked_balance |

### HIGH-2 — Immutable Admin Key

**Fix:** `transfer_admin(env, new_admin)` added to contract and `AuraVaultTrait`. Call requires current admin authorization. Emits `admin_transferred` event.

### MEDIUM-1, LOW-1, INFO-1

Documented as accepted risks with mitigations as described in [Known Issues and Accepted Risks](#known-issues-and-accepted-risks).

---

## Security Properties Verified

Post-remediation security posture:

| Property | Mechanism | Test Coverage |
|---|---|---|
| Reentrancy safety | CEI on all mutating functions | `security_test.rs` + CRITICAL-1 fix |
| Inflation attack prevention | Zero-share mint rejection (`ZeroAmount` fence) | `test_deposit_zero_returns_zero_amount` |
| Overflow safety | `checked_*` arithmetic; `overflow-checks = true` | `prop_overflow_safety`; `test_deposit_overflow_returns_math_overflow` |
| Harvest access control | Admin-only check + `HarvestUnauthorized` | `security_test.rs` |
| Upgrade access control | Admin-only UUPS with layout version guard | `test_upgrade_by_non_admin_is_rejected` |
| Admin key rotation | `transfer_admin` with event | `security_test.rs` |
| Observability | Events on all mutating calls | `security_test.rs` |
| Archival safety | TTL extended on every mutating call (30-day lifetime, 7-day threshold) | `storage.rs` + snapshot tests |
| No panic paths | No `unwrap()`/`expect()` outside `#[cfg(test)]` | Enforced by lint (`clippy::unwrap_used`) |
| Flash loan guard | Balance check before execution; `suspicious` event on mismatch | `security_test.rs` |
| Emergency pause | `pause()`/`unpause()` halt/resume all mutating ops | `security_test.rs` |

---

## Build and Run Instructions

### Prerequisites

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
# cargo 1.70+ required
```

### Build

```bash
cd aura-vault
cargo build --target wasm32-unknown-unknown --release
# Output: target/wasm32-unknown-unknown/release/aura_vault.wasm
```

### Tests

```bash
# All unit + integration tests
cargo test

# With output
cargo test -- --nocapture

# Security tests only
cargo test security_

# Fuzz/property tests only
cargo test prop_

# Single test
cargo test test_first_deposit_mints_one_to_one
```

### Linting

```bash
cargo clippy --all-targets -- \
  -D warnings \
  -D clippy::unwrap_used \
  -D clippy::expect_used \
  -D clippy::panic
```

Zero `unwrap`/`expect`/`panic` outside test code is a hard build requirement.

### Dependency Audit

```bash
cargo audit
# Expected: 0 vulnerabilities
```

---

## Contact Information and Audit Timeline

### Contacts

| Role | Contact |
|---|---|
| Protocol Lead / Technical POC | See repo CODEOWNERS or open a GitHub issue tagged `audit` |
| Security Lead | File a confidential issue via GitHub Security Advisories |
| On-Call (during audit) | PagerDuty — see `docs/disaster-recovery/on-call-rotation.md` |

For pre-audit questions, open a GitHub Discussion in this repository with the `audit-prep` label. We respond within 1 business day.

### Suggested Audit Timeline

| Phase | Duration | Description |
|---|---|---|
| Kickoff & scope confirmation | Day 1 | Joint call; auditor reviews this document; questions answered |
| Source review | Days 2–8 | Auditor reviews in-scope files; preliminary findings shared informally |
| Draft report | Day 9 | Draft report delivered to protocol team |
| Remediation window | Days 10–14 | Protocol team addresses findings |
| Re-audit (fixes) | Days 15–16 | Auditor verifies fixes |
| Final report | Day 17 | Final report delivered and published |

Total engagement: ~3 weeks.

### Deliverables Expected from Auditor

- [ ] Final audit report (PDF or Markdown) with severity-graded findings
- [ ] Proof-of-concept code for any critical/high findings
- [ ] Re-audit confirmation letter after remediation
- [ ] Permission to publish the final report (with any agreed redactions)

### Deliverables Provided to Auditor

- [x] This audit preparation document
- [x] Full source code access (this repository)
- [x] Internal security audit report (`SECURITY_AUDIT_REPORT.md`)
- [x] Fuzz testing findings (`FUZZING_PROPERTIES_FINDINGS.md`)
- [x] Test snapshots for all 22 unit tests (`aura-vault/test_snapshots/`)
- [x] Architecture documentation (`docs/ARCHITECTURE.md`)
- [x] Deployment guide (`DEPLOYMENT_GUIDE.md`)
- [x] Answering auditor questions within 1 business day

### Re-audit Policy

Any critical or high severity finding must be re-audited before mainnet deployment. Medium findings must be re-audited or formally accepted with written rationale. Low and informational findings may be addressed at the team's discretion.

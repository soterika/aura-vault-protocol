# Contributing to Aura Vault Protocol

Thanks for helping improve Aura Vault Protocol. This guide explains how to report issues, propose features, submit pull requests, and meet the project’s quality bar across both off-chain applications and on-chain Soroban smart contracts.

---

## Table of Contents

1. [How to Report Issues](#how-to-report-issues)
2. [Pull Request Process](#pull-request-process)
3. [Code Quality Standards](#code-quality-standards)
4. [Smart Contract Development Guide (Rust / Soroban)](#smart-contract-development-guide-rust--soroban)
   - [Rust Toolchain Setup (stable, wasm32 target)](#rust-toolchain-setup-stable-wasm32-target)
   - [Running the Test Suite](#running-the-test-suite)
   - [Running Fuzz Tests](#running-fuzz-tests)
   - [Code Review Checklist for Contract Changes](#code-review-checklist-for-contract-changes)
   - [Security Review Requirements](#security-review-requirements)
   - [How to Propose New Error Variants](#how-to-propose-new-error-variants)
5. [Commit Message Conventions](#commit-message-conventions)
6. [Review Process](#review-process)

---

## How to Report Issues

Please use the issue templates in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE) when possible.

### Bug Report

Use the bug report template when you have reproducible behavior, a broken flow, or a failing test. Include:
- Clear steps to reproduce the issue
- Expected vs. actual behavior
- Relevant error logs, transaction hashes, or console outputs
- Environment info (OS, Node.js version, Rust version, Stellar network)

### Feature Request

Use the feature request template when you want to propose a new capability, workflow, or integration. Detail:
- The problem or use case motivating the feature
- Proposed design or user story
- Potential architectural impacts on smart contract state or API interfaces

---

## Pull Request Process

1. Create a feature branch off the latest `main`: `git checkout -b feat/your-feature-name main`.
2. Make focused changes and keep diffs small and atomic.
3. Update or add corresponding tests and documentation.
4. Ensure all linters and formatting checks pass.
5. Open a pull request using the repository template.
6. The target maintainer review SLA is **2 business days**.

### Pull Request Checklist

- [ ] The change is scoped to a single concern.
- [ ] All relevant tests and builds pass locally.
- [ ] Smart contract changes meet the [Smart Contract Review Checklist](#code-review-checklist-for-contract-changes).
- [ ] The change is documented when it affects workflows, APIs, or contract ABI.
- [ ] Security-sensitive changes have been reviewed against [SECURITY.md](SECURITY.md) and [AUDIT.md](AUDIT.md).
- [ ] The PR description includes the rationale, testing steps, and rollout/migration notes.

---

## Code Quality Standards

### Internationalization

The App Router uses `next-intl` with locale routes under `frontend/src/app/[locale]`.
Add or update translation keys in every supported locale file under
`frontend/src/locales/` (`en`, `es`, `fr`, `de`, `zh`, and `ar`), and use the
translation hook in user-facing components instead of adding new hardcoded
English labels. Use `Intl.NumberFormat` and `Intl.DateTimeFormat` for locale-
sensitive numbers and dates. Include a translation update with UI changes so
the English fallback and translated routes stay in sync.

### JavaScript and TypeScript

- Follow workspace lint rules: `npm run lint` within the target package (`backend` or `ui`).
- Keep TypeScript strictness consistent (`strict: true`, no explicit `any` unless strictly necessary).
- Favor small, testable modules and avoid introducing unnecessary external dependencies.

### General Rust Guidelines

- Format code using `cargo fmt`.
- Lint using `cargo clippy --all-targets -- -D warnings`.
- Avoid `unwrap()` and `expect()` in production paths; propagate errors using `Result<T, E>`.

---

## Smart Contract Development Guide (Rust / Soroban)

The core yield vault logic is implemented as a Soroban smart contract located in the [`aura-vault/`](aura-vault/) directory. All smart contract code runs in a sandboxed WebAssembly (Wasm) environment on the Stellar network.

### Rust Toolchain Setup (stable, wasm32 target)

Contributors developing on fresh Ubuntu / Debian or macOS environments need Rust stable and the WebAssembly compilation target.

#### 1. Install Rust via Rustup

```bash
# Install rustup and Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Ensure Rust stable is active (minimum version: 1.79+)
rustup default stable
rustup update stable
```

#### 2. Add the Wasm32 Target & Components

The Soroban SDK compiles smart contracts to `wasm32-unknown-unknown`.

```bash
# Add the wasm32 compilation target
rustup target add wasm32-unknown-unknown

# Install formatting and linting tools
rustup component add rustfmt clippy
```

#### 3. Install Stellar CLI (Optional for Local Contract Invocation)

```bash
# Install Stellar CLI with wasm optimization features
cargo install --locked stellar-cli --features opt

# Verify installation
stellar --version
```

#### 4. Verify Local Setup

Run the following commands inside the repository root to verify your toolchain:

```bash
rustc --version
cargo --version
rustup target list | grep "wasm32-unknown-unknown (installed)"
```

---

### Running the Test Suite

Soroban unit and integration tests run on the host architecture using the Soroban SDK's built-in testing environment (`soroban-sdk::Env`).

#### Run All Contract Tests

```bash
# Run all unit and integration tests
cargo test --manifest-path aura-vault/Cargo.toml

# Run tests with output printed to console
cargo test --manifest-path aura-vault/Cargo.toml -- --nocapture

# Run tests with 4 parallel threads (matches CI)
cargo test --manifest-path aura-vault/Cargo.toml -- --test-threads=4
```

#### Run Specific Test Modules

```bash
# Run lifecycle tests (deposit -> harvest -> withdraw)
cargo test --manifest-path aura-vault/Cargo.toml --lib lifecycle_test

# Run reentrancy protection tests
cargo test --manifest-path aura-vault/Cargo.toml --lib reentrancy_test

# Run circuit breaker and emergency pause tests
cargo test --manifest-path aura-vault/Cargo.toml --lib circuit_breaker_test

# Run governance and admin upgrade tests
cargo test --manifest-path aura-vault/Cargo.toml --lib test_upgrade
```

#### Formatting and Clippy Checks

CI enforces zero warnings on clippy and formatting:

```bash
# Check code formatting without modifying files
cargo fmt --manifest-path aura-vault/Cargo.toml -- --check

# Auto-format code
cargo fmt --manifest-path aura-vault/Cargo.toml

# Run clippy with strict warnings turned into compiler errors
cargo clippy --manifest-path aura-vault/Cargo.toml --all-targets -- -D warnings
```

#### Building the Wasm Binary

To ensure the contract builds cleanly for the Wasm target:

```bash
# Compile release Wasm
cargo build --manifest-path aura-vault/Cargo.toml --target wasm32-unknown-unknown --release

# The compiled output will be located at:
# aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm
```

---

### Running Fuzz Tests

Aura Vault Protocol utilizes property-based testing and fuzzing via [`proptest`](aura-vault/proptest.toml) to explore complex state spaces, edge conditions, and arithmetic boundaries.

#### 1. Fast Sample Property Tests (PR Check Profile)

Used in daily workflows and sample PR checks to catch obvious regressions quickly:

```bash
# Run arithmetic overflow property tests (200 cases)
PROPTEST_CASES=200 \
cargo test --manifest-path aura-vault/Cargo.toml --lib overflow_fuzz -- --nocapture
```

#### 2. Invariant & CEI Fuzz Checks

Verifies protocol invariants (e.g. `total_assets >= total_shares`) and Checks-Effects-Interactions ordering:

```bash
# Run system invariant property checks
cargo test --manifest-path aura-vault/Cargo.toml --lib invariants -- --nocapture

# Run Checks-Effects-Interactions fuzzing
cargo test --manifest-path aura-vault/Cargo.toml --lib cei_fuzz_test -- --nocapture
```

#### 3. Full Fuzz Test Suite (Nightly CI Profile)

Simulates 1,000+ to 10,000+ randomized transaction sequences:

```bash
# Run full property fuzzing with 1,000+ transactions
PROPTEST_CASES=1000 \
PROPTEST_MAX_SHRINK_ITERS=100000 \
cargo test --manifest-path aura-vault/Cargo.toml --lib fuzz -- --nocapture --test-threads=1
```

If a property fails, `proptest` automatically shrinks the input to the minimal failing case and persists it in `aura-vault/.proptest-regressions/` for deterministic reproduction.

---

### Code Review Checklist for Contract Changes

Every pull request modifying files in `aura-vault/` must satisfy the following checklist during code review:

- [ ] **Checks-Effects-Interactions (CEI)**:
  - Internal state (balances, shares, timestamps) must be updated **before** invoking external token transfers (`token::Client::transfer`) or cross-contract calls.
- [ ] **Arithmetic Safety**:
  - All arithmetic operations must use safe checked math (`checked_add`, `checked_sub`, `checked_mul`, `checked_div`).
  - No bare `+`, `-`, `*`, `/` operations that could panic or overflow.
- [ ] **Caller Authentication**:
  - Every external entry point must verify authorization using `caller.require_auth()`.
  - Administrative functions must assert `admin.require_auth()` and check against the stored admin address.
- [ ] **Input & Boundary Validation**:
  - Non-zero amount checks on deposits, withdrawals, and fee collections.
  - Verification that calculations do not result in zero shares minted for non-zero deposits (`VaultError::ZeroSharesMinted`).
- [ ] **No Panic Paths**:
  - Production contract paths must **never** call `unwrap()`, `expect()`, or `panic!()`.
  - All error conditions must return a typed `Result<T, VaultError>`.
- [ ] **Reentrancy Protection**:
  - Reentrancy guards (`set_reentrancy_guard` / `clear_reentrancy_guard`) must wrap sensitive execution contexts.
- [ ] **Storage Key Isolation**:
  - Storage keys must be defined in the [`DataKey`](aura-vault/src/storage.rs) enum to prevent key collisions across contract variables.
- [ ] **Event Observability**:
  - State changes must emit structured events using `env.events().publish(...)` matching the schemas in [docs/event-schema.md](docs/event-schema.md).
- [ ] **Gas & Footprint Optimization**:
  - Avoid unbounded loops or vector traversals that could exceed Soroban CPU/memory invocation limits.

---

### Security Review Requirements

Due to the immutable nature of smart contracts handling user funds, security is our primary focus.

Contributors must review and adhere to the security standards documented in:
- [**SECURITY.md**](SECURITY.md) — Outlines our protocol threat model, actor taxonomy, trust assumptions, invariant definitions, and vulnerability reporting procedures.
- [**AUDIT.md**](AUDIT.md) — Historical audit findings and remediation records covering inflation attack defenses, rounding vulnerabilities, flash loan mitigations, and storage layouts.

#### Security Invariants to Maintain

1. **Inflation Attack Prevention**: The vault prevents first-depositor inflation attacks through virtual share offsets / dead shares as documented in [AUDIT.md](AUDIT.md). Never alter share calculation formulas without explicit security team approval.
2. **Flash Loan Defense**: Share price manipulation within a single transaction or ledger is mitigated by cooldown checks and high-water mark validation.
3. **Emergency Pause**: Any new state-changing user operation must honor the `is_paused` flag check.

Any PR modifying `aura-vault/src/lib.rs`, `storage.rs`, `errors.rs`, or `fee.rs` requires review and explicit sign-off from at least one **Security Reviewer** before merging.

---

### How to Propose New Error Variants

All contract errors are defined as strongly-typed variants in [`aura-vault/src/errors.rs`](aura-vault/src/errors.rs) using the `#[contracterror]` macro. Because error discriminants (`u32`) form part of the public Soroban ABI, adding or modifying errors must follow strict conventions:

#### 1. ABI Stability Rules
- **NEVER change or reorder existing discriminant numbers.** Discriminants are permanently bound to client SDKs and transaction explorers.
- **NEVER delete existing variants.** Mark deprecated variants with rustdoc `#[deprecated]` instead.

#### 2. Discriminant Range Allocation

Error codes are grouped by operational category:

| Range | Category | Description |
|---|---|---|
| **1–2** | Initialisation errors | Contract already/not yet initialized |
| **3–6** | Input / arithmetic errors | Zero amount, overflow, invalid input |
| **7–8** | State precondition errors | Inactive status, unexpected ledger state |
| **9–12** | Authorization / invariant errors | Unauthorized caller, broken invariant |
| **13–15** | Governance errors | Proposal rejected, timelock active |
| **16–19** | Operational / configuration errors | TVL cap exceeded, invalid fee bps |
| **20–23** | Withdrawal queue errors | Cooldown active, queue empty |
| **24** | Circuit-breaker errors | Tripped breaker, price deviation |
| **25+** | Future extensions | Next sequential sequential block |

#### 3. Step-by-Step Procedure to Add a New Error

1. **Verify Necessity**: Confirm that no existing variant in [`aura-vault/src/errors.rs`](aura-vault/src/errors.rs) already communicates the failure condition.
2. **Assign the Next Discriminant**: Identify the relevant range or take the next sequential number (e.g. `25`).
3. **Add the Variant with Rustdoc**:
   ```rust
   /// Brief one-line summary of the error.
   ///
   /// **Trigger:** The exact precondition or scenario that returns this error.
   #[contracterror]
   #[derive(Copy, Clone, Debug, Eq, PartialEq)]
   #[repr(u32)]
   pub enum VaultError {
       // ... existing variants ...

       /// New error description.
       ///
       /// **Trigger:** Returned when condition X occurs.
       NewErrorVariant = 25,
   }
   ```
4. **Update Human-Readable Message Mapping**:
   In `impl VaultError`, add a branch to `pub fn message(&self) -> &'static str`:
   ```rust
   impl VaultError {
       pub fn message(&self) -> &'static str {
           match self {
               // ... existing mappings ...
               VaultError::NewErrorVariant => "Human-readable description of error",
           }
       }
   }
   ```
5. **Add Test Coverage**: Add a test in `aura-vault/src/errors.rs` asserting that the variant has the correct discriminant number and returns the expected message.
6. **Update Documentation**: Update the error list in [`docs/error-reference.md`](docs/error-reference.md) if present.

---

## Commit Message Conventions

We adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat(vault): implement cooldown period for withdrawals`
- `fix(contract): prevent rounding underflow in share calculation`
- `docs(contributing): expand smart contract setup guide`
- `test(fuzz): add property test for flash loan guard`
- `chore(deps): update soroban-sdk to v22`

---

## Review Process

- Pull requests are reviewed by at least one maintainer.
- Smart contract modifications require review from a designated smart contract engineer.
- Review turnaround time is targeted within **2 business days**.
- Breaking changes require an associated migration guide and governance proposal draft.

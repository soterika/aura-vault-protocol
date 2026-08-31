# Changelog

All notable changes to Aura Vault Protocol are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Versioning Policy

> **Issue:** [#399 — Create changelog and versioning policy document](https://github.com/soterika/aura-vault-protocol/issues/399)

### Semantic Versioning (MAJOR.MINOR.PATCH)

Aura Vault Protocol uses Semantic Versioning across three independently versioned layers:

| Layer | Scope | Breaking change definition |
|-------|-------|---------------------------|
| **Contract** | `aura-vault/` Soroban WASM | Any change to the ABI, storage layout, or observable behaviour |
| **API** | `backend/` Node.js REST API | Removed or renamed endpoints, changed required fields, altered response shape |
| **Frontend** | `frontend/` Next.js app | N/A — frontend versions track the monorepo release tag |

#### MAJOR version (`X.0.0`)

Increment when a **breaking change** is introduced:

- **Contract:** Any change to a public function signature (`initialize`, `deposit`, `withdraw`, `harvest`, `pause`, `unpause`, `balance_of`, `total_assets`), removal of a function, change to an error code's numeric value, or a storage layout migration that requires admin intervention.
- **API:** Removal of a stable endpoint, rename of a required request field, change in a response field's data type, or removal of a previously supported authentication method.
- **Protocol:** Change to the fee formula, share calculation, or withdrawal redemption formula.

> ⚠️ Every MAJOR increment **must** include a Migration Guide section in this changelog (see format below) and be announced to integrators at least 14 days in advance.

#### MINOR version (`0.X.0`)

Increment when **new, backward-compatible functionality** is added:

- New contract functions or view functions added to the ABI
- New optional API endpoints or optional request/response fields
- New frontend features (new pages, UI components)
- New monitoring dashboards or alert rules
- New integration language guides

#### PATCH version (`0.0.X`)

Increment for **backward-compatible bug fixes**:

- Security patches that do not change the ABI
- Performance improvements
- Documentation corrections
- Dependency updates (minor or patch bumps)
- Test coverage improvements
- CI/CD pipeline fixes

### Contract Version (on-chain)

The Soroban contract stores an integer version in instance storage, starting at `1` after `initialize`. The version is incremented by `1` on every `upgrade()` call, regardless of whether the upgrade is a MAJOR, MINOR, or PATCH change. This version is queryable:

```bash
stellar contract invoke --id <CONTRACT_ID> --network mainnet -- version
```

A contract upgrade also emits an `upgrade` event containing the old and new version numbers, which is indexed on Stellar Explorer.

### Git Tagging Convention

Every release must be accompanied by a Git tag:

```bash
# Tag format: v<MAJOR>.<MINOR>.<PATCH>
git tag -a v0.3.0 -m "Release v0.3.0 — K8s docs, runbook, FAQ, changelog policy"
git push origin v0.3.0
```

Layer-specific releases (if a layer releases independently of the monorepo):

```
contract/v1.2.0
api/v2.1.0
frontend/v0.3.0
```

### PR Merge Requirements

Every merged pull request that changes user-facing behaviour must:

1. Update the `[Unreleased]` section in this file before merge
2. Categorise changes under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`
3. Flag breaking changes with a `⚠️ BREAKING` label in the PR title and changelog entry
4. Include a migration note if the change is `MAJOR`

Reviewers must verify the changelog entry as part of the PR review.

---

## [Unreleased]

### Added
- **Kubernetes deployment guide** (`docs/KUBERNETES.md`) — full K8s manifests reference for namespaces, RBAC, network policies, HPA, PostgreSQL, Redis, monitoring stack, Sealed Secrets, and Ingress. Closes #397.
- **Monitoring & Alerting Runbook** (`docs/OPERATIONS_RUNBOOK.md`) — one runbook entry per Prometheus alert, incident commander checklist, escalation matrix, Loki log queries, and PIR template. Closes #398.
- **FAQ document** (`docs/faq.md`) — 45 Q&A pairs covering getting started, deposits, withdrawals, yield & harvests, shares & pricing, fees, security, and technical topics. Closes #396.
- **Versioning policy** (this section) — MAJOR/MINOR/PATCH criteria for contract, API, and frontend; PR merge requirements; git tagging convention. Closes #399.

---

## [0.2.0] — 2026-06-24

### Added
- **Frontend form validation** (`frontend/`) — zero-dependency browser UI for the Aura Vault registration flow.
  - Real-time field validation on `input` and `blur` events with per-field rules (username, email, password, confirm password).
  - Inline error messages with `aria-live` support for screen readers.
  - ✓ / ✗ success and error icons per field.
  - 5-level password strength meter scoring length, mixed case, digits, and special characters.
  - Phone input masking — formats digits as `+1 234 567 8900` on every keystroke.
  - Email domain autocomplete suggestions triggered after `@` (gmail.com, yahoo.com, outlook.com, proton.me, stellar.org).
  - Submit button disabled until all required fields pass validation.
  - Dark-themed UI (`styles.css`) consistent with Aura's aesthetic.

### Files Added
- `frontend/index.html`
- `frontend/validation.js`
- `frontend/styles.css`

---

## [0.1.0] — 2026-06-04

### Added
- **Aura Vault smart contract** — production-ready, share-based yield vault on Soroban (Stellar).
  - `initialize(admin, underlying_token)` — one-time vault setup.
  - `deposit(caller, amount)` — mint shares proportional to deposit; first depositor seeded at 1:1.
  - `withdraw(caller, shares)` — burn shares and redeem underlying tokens including accrued yield.
  - `harvest(caller, yield_amount)` — permissionless keeper injects yield without minting new shares, increasing the exchange rate for all shareholders.
  - `total_assets()` — gas-free read of total underlying tokens held.
  - `balance_of(address)` — gas-free read of share balance for any address.
- **Security properties**:
  - Checks-Effects-Interactions (CEI) ordering on all mutating functions.
  - Inflation attack prevention via zero-share mint rejection.
  - Overflow-safe arithmetic (`checked_mul` / `checked_div`; `overflow-checks = true` in release profile).
  - No `unwrap()` / `expect()` outside `#[cfg(test)]`.
  - Soroban archival safety — TTL extended on every mutating call (30-day lifetime, 7-day threshold).
- **8 typed error variants** (`VaultError`): `NotInitialized`, `AlreadyInitialized`, `InsufficientShares`, `InsufficientUnderlying`, `ZeroAmount`, `MathOverflow`, `InvalidAddress`, `ZeroShares`.
- **22 unit and integration tests** covering all contract functions and edge cases.
- **Contribution plan** (`plan.md`) — Wave development roadmap.

### Architecture
```
aura-vault/src/
├── lib.rs        # contract entrypoints
├── errors.rs     # VaultError enum
├── storage.rs    # DataKey, TTL helpers
├── interface.rs  # AuraVaultTrait ABI
└── test.rs       # 22 tests
```

---

## Breaking Changes

| Version | Layer | Change | Migration |
|---------|-------|--------|-----------|
| —       | —     | No breaking changes to date | — |

---

## Migration Guides

### 0.1.0 → 0.2.0

No on-chain changes. The `aura-vault` contract is unchanged.  
The `frontend/` directory is additive — no action required for existing deployments.

---

## Upcoming (Planned)

- Strategy layer — pluggable yield strategies (lending, liquidity provision).
- Fee module — configurable performance fee with fee-recipient distribution.
- Multi-asset support — multiple underlying tokens per vault instance.
- CLI deployment scripts — automated testnet/mainnet deploy helpers.
- Kubernetes manifests — `/k8s/` directory with all production manifests referenced in `docs/KUBERNETES.md`.

---

[Unreleased]: https://github.com/soterika/aura-vault-protocol/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/soterika/aura-vault-protocol/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/soterika/aura-vault-protocol/releases/tag/v0.1.0

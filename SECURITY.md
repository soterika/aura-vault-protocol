# Aura Vault Protocol — Security Model & Threat Analysis

> Last updated: 2026-08-30 | Contract version: v1 | Document version: 2.0

---

## Table of Contents

1. [Disclaimer & Terms of Use](#1-disclaimer--terms-of-use)
2. [Threat Model](#2-threat-model)
   - 2.1 [Trust Assumptions](#21-trust-assumptions)
   - 2.2 [Actor Taxonomy](#22-actor-taxonomy)
   - 2.3 [Threat Scenarios](#23-threat-scenarios)
3. [Security Properties — Smart Contract](#3-security-properties--smart-contract)
   - 3.1 [Checks-Effects-Interactions (CEI) Ordering](#31-checks-effects-interactions-cei-ordering)
   - 3.2 [Flash Loan Guard](#32-flash-loan-guard)
   - 3.3 [Inflation Attack Prevention](#33-inflation-attack-prevention)
   - 3.4 [Overflow Safety](#34-overflow-safety)
   - 3.5 [Access Control](#35-access-control)
   - 3.6 [Emergency Pause](#36-emergency-pause)
   - 3.7 [Archival Safety](#37-archival-safety)
   - 3.8 [No Panic Paths](#38-no-panic-paths)
   - 3.9 [Event Observability](#39-event-observability)
4. [Security Properties — Backend API](#4-security-properties--backend-api)
   - 4.1 [Authentication & Session Management](#41-authentication--session-management)
   - 4.2 [HTTP Security Headers](#42-http-security-headers)
   - 4.3 [Input Validation & Injection Prevention](#43-input-validation--injection-prevention)
   - 4.4 [Transport Security](#44-transport-security)
   - 4.5 [Rate Limiting & Abuse Prevention](#45-rate-limiting--abuse-prevention)
   - 4.6 [Secrets Management](#46-secrets-management)
5. [Governance & Upgrade Security](#5-governance--upgrade-security)
6. [Fee System Security](#6-fee-system-security)
7. [Known Limitations & Accepted Risks](#7-known-limitations--accepted-risks)
8. [Audit Findings](#8-audit-findings)
   - 8.1 [Smart Contract Audit](#81-smart-contract-audit)
   - 8.2 [Backend OWASP Audit](#82-backend-owasp-audit)
   - 8.3 [Property-Based Fuzz Testing](#83-property-based-fuzz-testing)
9. [Continuous Security Assurance](#9-continuous-security-assurance)
10. [Incident History](#10-incident-history)
11. [Incident Response Overview](#11-incident-response-overview)
12. [Security Best Practices for Users](#12-security-best-practices-for-users)
13. [Vulnerability Disclosure Policy](#13-vulnerability-disclosure-policy)

---

## 1. Disclaimer & Terms of Use

**READ CAREFULLY BEFORE USING THIS PROTOCOL.**

Aura Vault Protocol ("the Protocol") is experimental, open-source software deployed on the Stellar/Soroban blockchain. By interacting with the Protocol you acknowledge and agree to the following:

- **No guarantees.** The Protocol is provided "as-is" without warranty of any kind, express or implied.
- **Financial risk.** You may lose some or all funds you deposit. Past performance is not indicative of future results.
- **Irreversibility.** Blockchain transactions are final. Erroneous or malicious transactions cannot be reversed by any party.
- **Not financial advice.** Nothing in this documentation constitutes investment, legal, or financial advice.
- **Regulatory uncertainty.** DeFi protocols may be subject to evolving regulation. Users are solely responsible for compliance in their jurisdiction.
- **No recourse.** The Protocol has no legal entity, treasury, or insurance fund obligated to compensate you for losses.

By depositing funds you accept all risks described in this document.

---

## 2. Threat Model

### 2.1 Trust Assumptions

The security model rests on the following explicit trust assumptions:

| Assumption | Basis |
|---|---|
| The Stellar/Soroban runtime is correct | Stellar Foundation; Protocol Level 19+ |
| The SEP-41 underlying token contract is not malicious | Operator selects token at initialization; cannot be changed without governance vote |
| The admin key is held securely | Mitigated by 3-of-5 multi-sig governance for critical changes |
| The CI/CD supply chain has not been compromised | Verified via `cargo audit`, Trivy, CodeQL, and pinned lockfiles |
| Keepers are authorized by the admin | Harvest is admin-only; keeper rotation requires admin action |

**Non-assumptions** (i.e., things the contract does not trust):

- The contract does not trust callers to be honest: every operation validates auth before acting.
- The contract does not trust that the token contract has no bugs: the flash loan guard independently verifies balance consistency.
- The contract does not trust that `total_assets()` equals the real vault balance: the flash loan guard cross-checks them on every mutating call.

### 2.2 Actor Taxonomy

| Actor | Description | Capabilities | Trust Level |
|---|---|---|---|
| **Depositor** | Any wallet that deposits the underlying token | `deposit`, `withdraw`, `balance_of` | Untrusted; all inputs validated |
| **Keeper** | Admin-authorized address that calls `harvest` | `harvest` only | Semi-trusted; admin controls the role |
| **Admin** | Single address set at `initialize` | `pause`, `unpause`, `set_fees`, `set_treasury`, `withdraw_fees`, `upgrade`, `transfer_admin` | Trusted; protected by multi-sig governance for critical changes |
| **Governance Signer** | One of five addresses in the multi-sig set | Propose, vote, and (after timelock) execute governance actions | Trusted; 3-of-5 threshold prevents unilateral action |
| **Backend API User** | Any client calling the REST API | Unauthenticated and authenticated routes per spec | Untrusted; Zod-validated, rate-limited |
| **External Keeper Bot** | Permissionless Horizon event listener | Reads on-chain state; triggers backend jobs | Untrusted; read-only from contract perspective |
| **Attacker** | Adversarial actor attempting to steal funds or disrupt service | Anything a normal Stellar account can do | Fully untrusted |

### 2.3 Threat Scenarios

The following threat scenarios were explicitly considered in the design. Each links to the mitigation.

#### T1 — Reentrancy Attack

**Description:** A malicious SEP-41 token contract calls back into the vault during a `transfer` call, exploiting stale state to double-redeem or double-deposit.

**Mitigation:** Strict [CEI ordering](#31-checks-effects-interactions-cei-ordering) on all mutating functions. State is fully committed before any token transfer executes. Previously a Critical finding (CRITICAL-1) — remediated.

#### T2 — Flash Loan Share Price Manipulation

**Description:** An attacker flash-borrows a large token amount, injects it directly into the vault's token balance (bypassing `deposit`), deposits at an artificially inflated share price, then withdraws, draining honest depositors.

**Mitigation:** [Flash loan guard](#32-flash-loan-guard) checks that `actual_balance == total_deposited` at the start of every mutating call. Any discrepancy aborts with `BalanceMismatch` and emits a `suspicious` event.

#### T3 — Vault Inflation Attack (ERC-4626 Style)

**Description:** Attacker deposits 1 unit to own all shares, donates tokens directly to inflate asset-per-share, causing subsequent depositors to receive 0 shares.

**Mitigation:** [Zero-share mint fence](#33-inflation-attack-prevention) rejects any deposit that would mint 0 shares. Direct token transfers are also blocked by the flash loan guard.

#### T4 — Arithmetic Overflow / Underflow

**Description:** Attacker provides extreme input values to trigger integer overflow in share math, obtaining vastly more shares than deposited value.

**Mitigation:** [Overflow safety](#34-overflow-safety): all arithmetic uses `checked_mul`, `checked_div`, `checked_add`, `checked_sub`; `overflow-checks = true` in release profile.

#### T5 — Unauthorized Admin Operations

**Description:** Non-admin caller invokes `pause`, `set_fees`, `upgrade`, or other privileged functions.

**Mitigation:** [Access control](#35-access-control) checks `caller == stored_admin` plus `require_auth()` before every privileged operation.

#### T6 — Unauthorized Harvest (Yield Rate Manipulation)

**Description:** Any token holder calls `harvest` with a manipulated `yield_amount` to skew the exchange rate or cause DoS via dust erosion.

**Mitigation:** `harvest` is admin-only (CRITICAL-2 fix). Non-admin callers receive `HarvestUnauthorized`. Future versions may replace single-admin with a keeper registry.

#### T7 — Admin Key Compromise / Loss

**Description:** Admin private key is stolen or permanently lost, enabling an attacker to call privileged functions or permanently bricking upgrades.

**Mitigation:** [Governance](#5-governance--upgrade-security) requires 3-of-5 multi-sig approval plus 24h timelock for admin transfer. `transfer_admin` function (HIGH-2 fix) provides a rotation path; the admin transfer event alerts monitors.

#### T8 — Governance Capture

**Description:** An attacker compromises 3 or more governance signers to pass a malicious proposal (e.g., upgrade the vault Wasm to drain funds).

**Mitigation:** 24h timelock between approval and execution provides a window to detect and respond. Proposal events are public and monitorable. See [Section 11](#11-incident-response-overview) for the detection and response playbook.

#### T9 — Backend JWT Forgery / Session Hijacking

**Description:** Attacker forges a JWT or replays a stolen access token to impersonate another user.

**Mitigation:** [JWT security](#41-authentication--session-management): explicit HS256 algorithm pinning (prevents RS256→HS256 confusion), issuer/audience validation, 15-minute access token TTL, token blacklisting in Redis, refresh token rotation.

#### T10 — SQL Injection / Input Injection

**Description:** Attacker submits crafted input to a backend API endpoint to exfiltrate database contents or modify records.

**Mitigation:** All SQL uses parameterized queries (`$1, $2, …`); all inputs validated with Zod schemas that strip unknown fields before any handler sees them.

#### T11 — Soroban State Archival

**Description:** A user's vault share balance entry expires in Soroban persistent storage, making their shares temporarily irredeemable.

**Mitigation:** [Archival safety](#37-archival-safety): per-user TTL is extended on every `deposit` and `withdraw`. Expired entries are restorable; shares are never destroyed by archival.

#### T12 — Supply Chain Attack

**Description:** A compromised Rust crate or npm package introduces malicious code into the contract or backend.

**Mitigation:** `cargo audit` blocks HIGH/CRITICAL CVEs in CI; `cargo deny` checks licenses and advisories; Dependabot sends weekly dependency update PRs; Trivy scans Docker images; `package-lock.json` committed for reproducible installs.

---

## 3. Security Properties — Smart Contract

### 3.1 Checks-Effects-Interactions (CEI) Ordering

All mutating vault functions follow strict CEI ordering to eliminate reentrancy risk, regardless of whether the underlying token's `transfer` implementation is well-behaved.

| Function | Check | Effect | Interaction |
|---|---|---|---|
| `deposit` | Validate amount, shares > 0, not paused, balance == total_deposited | Write share balance, update total_deposited | `token.transfer(caller → vault)` |
| `withdraw` | Validate shares, caller balance, not paused, balance == total_deposited | **Burn shares first**, update total_deposited | `token.transfer(vault → caller)` |
| `harvest` | Validate yield_amount, admin caller, not paused | Update total_deposited | `token.transfer(caller → vault)` |

The critical invariant is that `withdraw` burns the caller's shares **before** the token transfer executes. Even if a reentrant call is attempted, the shares are already gone and subsequent operations fail with `InsufficientShares`. This was the root cause of CRITICAL-1 (pre-fix `harvest` interaction occurred before effect); the fix moved the state write to precede the transfer.

### 3.1.1 Explicit Reentrancy Guard (Defence-in-Depth)

In addition to CEI ordering, all state-mutating functions enforce an explicit reentrancy lock (`DataKey::ReentrancyGuard`, Issue #345):

- **Guard Key:** `DataKey::ReentrancyGuard` in instance storage.
- **Entry Check:** If the lock is already `true`, the invocation immediately reverts with `VaultError::Reentrancy` (`code 30`).
- **Exit Guarantee:** The lock is cleared to `false` via `with_reentrancy_guard` on both success (`Ok`) and failure (`Err`) execution branches, preventing contract lockup.
- **Measured Gas Overhead:**
  - CPU Instructions: ~1,850 native CPU instructions per mutating invocation (2 instance storage operations: lock set + lock clear).
  - Memory Overhead: ~64 bytes instance storage memory.
  - Persistent IO: 0 persistent storage writes.


### 3.2 Flash Loan Guard

Every mutating function verifies that the vault's actual on-chain token balance matches the internal `total_deposited` accounting variable before proceeding:

```
actual_balance = token.balance(vault_address)
expected_balance = get_total_deposited()

if actual_balance != expected_balance {
    emit suspicious event
    return Err(VaultError::BalanceMismatch)
}
```

This prevents two attack classes:

1. **Direct token donation**: Sending tokens to the vault address (outside `deposit`) to inflate the share price before depositing at the artificially high price.
2. **Flash-loan-funded balance inflation**: Borrowing a large amount, injecting it into the vault's balance, then depositing to capture artificially cheap shares.

The guard runs on `deposit`, `withdraw`, and `harvest`. On `harvest`, the check is performed **after** the yield transfer (post-injection position) to validate that the injected amount exactly matches `yield_amount` — any extra tokens arriving unexpectedly will trigger the mismatch. This timing was refined during INC-2024-002 (see [Section 10](#10-incident-history)).

**Error code:** `BalanceMismatch = 12`

### 3.3 Inflation Attack Prevention

The vault rejects any `deposit` call whose computed share quantity rounds down to zero or less, even if the token input amount is nonzero:

```rust
let new_shares = floor(amount × total_shares / total_deposited);
if new_shares <= 0 {
    return Err(VaultError::ZeroAmount);  // code 5
}
```

This closes the classic ERC-4626 inflation attack vector:

- Attacker deposits 1 stroop (minimum unit) → `total_shares = 1`, `total_assets = 1`
- Attacker attempts to donate tokens to inflate price → blocked by flash loan guard
- Victim deposits small amount that rounds to 0 shares → blocked by zero-share fence

**Error code:** `ZeroAmount = 5`

This property was discovered and fixed during INC-2024-001 (see [Section 10](#10-incident-history)) before mainnet deployment.

### 3.4 Overflow Safety

All arithmetic in share calculations uses Rust's checked integer methods:

| Operation | Method | On Overflow |
|---|---|---|
| Multiplication | `checked_mul` | Returns `Err(MathOverflow)` |
| Division | `checked_div` | Returns `Err(MathOverflow)` |
| Addition | `checked_add` | Returns `Err(MathOverflow)` |
| Subtraction | `checked_sub` | Returns `Err(MathOverflow)` |

The release build profile also sets `overflow-checks = true`, providing a compile-time secondary net that converts any unchecked overflow into a Wasm trap (rather than silent wraparound).

**Error code:** `MathOverflow = 6`

The contract uses `i128` throughout, giving a maximum representable value of 2^127 − 1 ≈ 1.7 × 10^38. For reference, the total supply of XLM is ~50 billion (5 × 10^10), so overflow in practical vault sizes is only reachable via malicious inputs — which the checked arithmetic handles cleanly.

### 3.5 Access Control

Every privileged operation validates caller identity before `require_auth()`:

| Operation | Authorization Required |
|---|---|
| `pause` / `unpause` | `caller == stored_admin` + `admin.require_auth()` |
| `harvest` | `caller == stored_admin` + `admin.require_auth()` |
| `set_fees` | `caller == stored_admin` + `admin.require_auth()` |
| `set_treasury` | `caller == stored_admin` + `admin.require_auth()` |
| `withdraw_fees` | `caller == stored_admin` + `admin.require_auth()` |
| `upgrade` | `admin.require_auth()` |
| `transfer_admin` | `current_admin.require_auth()` |
| `propose_*` (governance) | Signer whitelist check in `governance.rs` |
| `vote` (governance) | Signer whitelist + duplicate vote prevention |
| `execute` (governance) | Permissionless after timelock; no caller privilege needed |

Non-admin callers receive `VaultError::UpgradeUnauthorized = 9` or `VaultError::InvalidAddress = 7`. The double-initialize guard (`AlreadyInitialized = 2`) prevents reinitialization attacks.

### 3.6 Emergency Pause

The admin can halt all mutating vault operations (`deposit`, `withdraw`, `harvest`) at any time:

```
admin.pause()   → VaultPaused = true
admin.unpause() → VaultPaused = false
```

While paused, all three mutating functions immediately return `VaultError::VaultPaused = 11`. Read-only functions (`total_assets`, `balance_of`, `is_paused`) remain available.

The pause flag is stored in Soroban instance storage and TTL-bumped on every change. Governance multi-sig controls the admin account, so an attacker who compromises a single signer cannot unilaterally pause the vault.

### 3.7 Archival Safety

Soroban persistent storage entries expire unless their TTL (time-to-live) is extended. The vault extends TTLs on every mutating operation to prevent accounts from becoming unreadable:

| Operation | TTL Extension |
|---|---|
| Any mutating call | `bump_instance()` — extends instance storage (30-day lifetime, 7-day threshold) |
| `deposit` | `bump_persistent(caller)` — extends per-user share balance |
| `withdraw` | `bump_persistent(caller)` — extends per-user share balance |

If a user's balance entry expires (no interaction for >30 days), they must submit a restore transaction before withdrawing. Their shares are **not destroyed** — only temporarily unreadable until restored. The restore costs a small XLM fee.

### 3.8 No Panic Paths

All `unwrap()` and `expect()` calls in production contract code are gated behind `#[cfg(test)]`. Production paths use `?`-propagated `Result<T, VaultError>` types throughout.

This means a malicious input can never trigger a Wasm trap that would freeze the contract or produce an unhandled panic. Every error condition returns a typed `VaultError` variant that callers can inspect.

The Clippy lint configuration in CI enforces this with `deny(clippy::unwrap_used)` and `deny(clippy::expect_used)`.

### 3.9 Event Observability

All state-changing operations emit typed Soroban events. This was added in HIGH-1 (fix: events on deposit/withdraw/harvest) to enable real-time off-chain monitoring.

| Function | Event Topic | Key Payload Fields |
|---|---|---|
| `deposit` | `"deposit"` | caller, amount, new_shares, total_shares, total_deposited |
| `withdraw` | `"withdraw"` | caller, shares, redeem_amount, total_shares, total_deposited |
| `harvest` | `"harvest"` | caller, yield_amount, new_total_deposited |
| `upgrade` | `"upgrade"` | admin, new_wasm_hash |
| `transfer_admin` | `"admin_transferred"` | old_admin, new_admin |
| Flash loan guard | `"suspicious"` | actual_balance, expected_balance |
| `pause` / `unpause` | `"paused"` / `"unpaused"` | admin |

An unexpected `upgrade` or `admin_transferred` event should be treated as a security alert and trigger immediate investigation per the [Incident Response runbook](#11-incident-response-overview).

---

## 4. Security Properties — Backend API

### 4.1 Authentication & Session Management

The backend uses JWT-based stateless authentication with multiple layers of hardening against common token attacks:

**Algorithm pinning (OWASP A07):** The JWT library is configured with an explicit `algorithms: ["HS256"]` whitelist. This prevents algorithm confusion attacks where an attacker might forge tokens by downgrading to `none` or exploiting RS256→HS256 confusion.

**Short-lived access tokens:** Access tokens expire after 15 minutes. A stolen token has a narrow window of usefulness.

**Refresh token rotation:** Refresh tokens expire after 30 days. On each use, the old token is deleted from Redis and a new one is issued. A stolen refresh token used by an attacker invalidates the legitimate user's session, making replay detectable.

**Redis blacklist:** Revoked access tokens are stored in Redis under `auth:blacklist:*` until their natural expiry. Every `validateAccessToken` call checks the blacklist first. The `POST /api/auth/logout` endpoint blacklists the current access token and deletes the refresh token.

**Session revocation:** `POST /api/auth/revoke-all` removes all refresh tokens for a user from Redis (`auth:sessions:*`), instantly invalidating all active sessions across all devices.

**Issuer / audience claims:** When `JWT_ISSUER` and `JWT_AUDIENCE` environment variables are set (required in production), all tokens are issued with and validated against these claims, scoping tokens to this service.

**Rate limiting:** `/api/auth/login` and `/api/auth/refresh` are rate-limited per IP to mitigate brute-force and credential stuffing attacks.

### 4.2 HTTP Security Headers

All HTTP responses include security headers applied by Helmet v8 (`applySecurityHeaders()`):

| Header | Value | Rationale |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Forces HTTPS for 1 year including subdomains |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; object-src 'none'; …` | Prevents XSS; no `unsafe-eval`, no `unsafe-inline` scripts |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Disables unused browser APIs |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates browsing context |
| `X-Powered-By` | Removed | Hides Express fingerprint |

**CORS:** Only origins listed in the `CORS_ORIGIN` environment variable are allowed. If `CORS_ORIGIN` is unset or `*` in production, the middleware defaults to **deny all** (no allowed origins) and logs a warning. Development allows `localhost` and `127.0.0.1` by default.

### 4.3 Input Validation & Injection Prevention

**SQL injection (OWASP A03):** All database queries use `node-postgres` parameterized placeholders (`$1, $2, …`). No SQL string interpolation exists in the codebase.

**Input validation:** Every API route that accepts user input applies a Zod schema validation middleware before the handler runs. Unknown fields are stripped (Zod `strip` mode). Invalid input returns a structured `400 Bad Request` without leaking internal error details.

**Stellar address validation:** Wallet addresses submitted to endpoints are validated against the Stellar address format before any database writes. Invalid addresses return `INVALID_ADDRESS` (error code documented in `docs/error-reference.md`).

### 4.4 Transport Security

- TLS 1.2+ enforced at the CloudFront and ALB layers (`origin_ssl_protocols = ["TLSv1.2"]`).
- Database connections use SSL in production (`rejectUnauthorized: true` in `db.ts`).
- AWS RDS storage encryption is enabled (`storage_encrypted = true`).
- All secrets live in AWS Secrets Manager — never in source code or unencrypted environment variables in production.

### 4.5 Rate Limiting & Abuse Prevention

- Global per-IP rate limiting via `express-rate-limit`.
- Per-user rate limiting on authenticated endpoints.
- Tighter rate limits on auth endpoints (`/api/auth/login`, `/api/auth/refresh`).
- AWS WAF (Web Application Firewall) at the CloudFront layer provides additional DDoS and rule-based protection.

### 4.6 Secrets Management

All production secrets are stored in and retrieved from AWS Secrets Manager via `backend/src/secrets.ts`. The following are never committed to the repository or stored in environment variables in production:

- `JWT_SECRET`
- `DATABASE_URL` / `DATABASE_REPLICA_URL`
- `REDIS_URL`
- Third-party API keys (SendGrid, Mailgun, Cloudflare)

The Zod config schema (`backend/src/config/index.ts`) validates all required environment variables at startup; missing variables throw immediately rather than surfacing as runtime errors.

---

## 5. Governance & Upgrade Security

Contract upgrades and critical admin changes are governed by an on-chain multi-signature system implemented in `aura-vault/src/governance.rs`.

### Multi-Sig Configuration

| Parameter | Value |
|---|---|
| Total signers | 5 |
| Required signatures | 3 (3-of-5 threshold) |
| Timelock duration | 24 hours (86 400 seconds of ledger time) |
| Execution | Permissionless after timelock expires |

### Governance Lifecycle

1. Any signer creates a proposal (`propose_update_admin`, `propose_update_token`, `propose_parameter_update`).
2. Signers independently vote approve or reject. Each signer may vote exactly once per proposal (`AlreadyVoted = 15`).
3. When 3 votes are cast in favor, the proposal status transitions to `Approved` and the 24h timelock starts.
4. After the timelock expires, any address may call `execute` to apply the change (`TimelockNotExpired = 13` if called early).
5. Proposals that do not reach threshold are `Rejected`; executed proposals move to `Executed`.

### What Governance Controls

| Change | Governance Required |
|---|---|
| Replacing vault admin (`transfer_admin`) | 3-of-5 vote + 24h timelock |
| Changing underlying token | 3-of-5 vote + 24h timelock |
| Generic parameter updates | 3-of-5 vote + 24h timelock |
| Vault Wasm upgrade (`upgrade`) | Admin key authorization (admin itself is gov-controlled) |

### Security Properties

- **No unilateral changes:** A single compromised signer cannot approve any proposal alone.
- **Vote immutability:** Once cast, a vote cannot be changed or retracted.
- **Timelock:** A 24-hour window exists between approval and execution, giving depositors time to withdraw if they object to a pending change.
- **Permissionless execution:** Once the timelock expires and the proposal is approved, anyone can call `execute` — the governance process cannot be stalled by the admin or signers.
- **Full audit trail:** All proposal creation, votes, and executions emit on-chain events.

---

## 6. Fee System Security

The dual-fee model (performance + management fees) is bounded by contract-enforced limits:

| Fee Type | Minimum | Maximum | Scope |
|---|---|---|---|
| Performance fee | 0 bps (0%) | 2000 bps (20%) | Applied to each harvest yield |
| Management fee | 0 bps (0%) | 100 bps (1%) | Applied annually as daily accrual |

These bounds are validated by `validate_fees()` in `aura-vault/src/fee.rs`. Attempting to set fees outside the ranges returns `VaultError::InvalidAddress` (pending a dedicated error code in a future release).

**Fee controls are admin-only**: `set_fees`, `set_treasury`, and `withdraw_fees` all require admin authorization.

**Fee transparency**: `get_fees()` and `total_fees_collected()` are public read-only functions. All fee accrual and withdrawal events are emitted on-chain.

**No user-facing fee**: `deposit` and `withdraw` do not charge fees, eliminating a common source of accounting errors and user confusion.

**Fee math integrity**: Fee calculations use the same `checked_*` arithmetic as the share math, preventing overflow in fee computation. Fee accuracy is validated within a 0.01% tolerance via `validate_fee_accuracy()`.

---

## 7. Known Limitations & Accepted Risks

The following limitations are inherent to the current design or are explicit acceptance decisions. None represent exploitable vulnerabilities in the current codebase, but users should understand them before depositing.

| # | Limitation | Detail | Risk Level |
|---|---|---|---|
| L1 | `total_assets()` reflects accounting variable, not live balance | Returns `TotalDeposited` internal counter; a direct token donation can cause temporary divergence. Divergence is caught by the flash loan guard on the next mutating call. | Low — guard prevents exploitation |
| L2 | No `total_shares()` view function | The global share count is not publicly exposed. Off-chain invariant checks (sum of all depositor balances) cannot be done by reading a single value. Recommended: add `total_shares()` in v1.1. | Informational |
| L3 | No `sync_total_assets()` break-glass | No admin function to forcibly reconcile `TotalDeposited` against the real token balance. If divergence occurs (e.g., from a bug in a future upgrade), recovery requires an on-chain governance proposal. Recommended: add `sync_total_assets()` in v1.1. | Low — governance path exists |
| L4 | Rounding dust accumulation | Integer floor division loses up to 1 unit per operation. Accumulated dust inflates share price for all holders but is not extractable by any individual. Dust is economically correct behavior. | Cosmetic |
| L5 | Minimum rational deposit size | Deposits far smaller than `total_deposited / total_shares` tokens will be rejected with `ZeroAmount`. Users should check the current share price before submitting dust deposits. | User UX |
| L6 | Permissionless harvest → single admin | Harvest is currently restricted to the admin, removing the open-keeper model. This means yield compounding depends on the admin operating a keeper reliably. A future release will support a keeper registry (allowlist). | Operational |
| L7 | Single underlying token | The vault accepts only one SEP-41 token set at initialization. No diversification. Token issuer actions (freeze, clawback) are outside the vault's control. | Design scope |
| L8 | No native slippage protection | The vault does not enforce slippage limits. Callers are responsible for verifying received shares (on deposit) or received tokens (on withdraw) meet their expectations before the transaction is signed. | User responsibility |
| L9 | No fee-on-transfer token handling | If the underlying token deducts a fee on transfer, the vault's `total_deposited` will diverge from the actual token balance over time. Fee-on-transfer tokens are not supported. | Token compatibility |
| L10 | No insurance coverage | There is no DeFi insurance relationship, protocol treasury, or reserve fund to compensate depositors in an exploit scenario. | User awareness |
| L11 | Governance timelock measured in ledger time | The 24h timelock uses `env.ledger().timestamp()`. On Stellar, this is the ledger close time rather than wall-clock time. In normal network operation these are equivalent, but during network stalls the timelock may appear to pause. | Platform dependency |

---

## 8. Audit Findings

### 8.1 Smart Contract Audit

**Date:** 2026-06-25 through 2026-06-29
**Scope:** `aura-vault/src/` (lib.rs, errors.rs, storage.rs, fee.rs, governance.rs, interface.rs)
**Status: All 7 findings remediated. No critical or high findings remain open.**

| ID | Severity | Title | Status |
|---|---|---|---|
| CRITICAL-1 | Critical | CEI violation in `harvest` — interaction before effect, reentrancy vector | ✅ Fixed: effect (state write) now precedes interaction (transfer) |
| CRITICAL-2 | Critical | Open access control on `harvest` — any caller could invoke | ✅ Fixed: explicit admin check + `HarvestUnauthorized` error code added |
| HIGH-1 | High | Missing event emissions on `deposit`, `withdraw`, `harvest` | ✅ Fixed: typed events added to all three functions |
| HIGH-2 | High | Immutable admin key — no transfer or rotation path | ✅ Fixed: `transfer_admin()` function added with event emission |
| MEDIUM-1 | Medium | `total_assets()` returns accounting variable, not live balance | 📝 Documented; `sync_total_assets()` recommended for v1.1 |
| LOW-1 | Low | Rounding dust accumulation in share math | 📝 Documented; inherent to integer arithmetic |
| INFO-1 | Informational | Share-sum invariant not independently verifiable at runtime | 📝 `total_shares()` view recommended for v1.1 |

**Automated scan results (same audit):**

| Tool | Finding | Status |
|---|---|---|
| `cargo audit` | Zero HIGH/CRITICAL CVEs in dependency tree | ✅ Pass |
| `cargo clippy --deny` | Zero lint violations (unwrap, panic, integer arithmetic, cast truncation) | ✅ Pass |
| `cargo build --release` | `overflow-checks = true` confirms checked arithmetic active | ✅ Pass |

Full report: [`SECURITY_AUDIT_REPORT.md`](./SECURITY_AUDIT_REPORT.md)

### 8.2 Backend OWASP Audit

**Date:** 2026-07-25
**Scope:** `backend/` Express API
**Status: All 10 OWASP categories passing.**

| # | Category | Result |
|---|---|---|
| A01 | Broken Access Control | ✅ All mutating routes protected by `authenticate` middleware |
| A02 | Cryptographic Failures | ✅ TLS 1.2+, AWS Secrets Manager, RDS encryption, algorithm-pinned JWTs |
| A03 | Injection | ✅ Parameterized SQL, Zod input validation, unknown field stripping |
| A04 | Insecure Design | ✅ CEI on contract, flash loan guard, rate limiting, defense-in-depth |
| A05 | Security Misconfiguration | ✅ Helmet headers, strict CORS, `X-Powered-By` removed |
| A06 | Vulnerable Components | ✅ `cargo audit`, Trivy, CodeQL, Dependabot, pinned `package-lock.json` |
| A07 | Auth Failures | ✅ Algorithm pinning, 15m TTL, refresh rotation, Redis blacklist, rate limiting |
| A08 | Software Integrity | ✅ Wasm SHA-256 artifacts, digest-pinned Docker images, `cargo deny` |
| A09 | Logging Failures | ✅ Winston structured logs, correlation IDs, CloudWatch alarms |
| A10 | SSRF | ✅ No user-controlled URLs; all outbound calls to operator-configured allowlist |

Full report: [`OWASP_AUDIT_REPORT.md`](./OWASP_AUDIT_REPORT.md)
Extended backend audit: [`AUDIT.md`](./AUDIT.md)

### 8.3 Property-Based Fuzz Testing

**Date:** 2024-06-25
**Tool:** `proptest` (Rust)
**Test volume:** 11,000+ test cases (1,000 per property × 7 properties + 1,000 per invariant × 4 invariants)
**Status: All 7 properties and 4 invariants verified. Zero violations.**

**Properties verified:**

| Property | Test | Result |
|---|---|---|
| First deposit produces a 1:1 share ratio | `prop_first_deposit_one_to_one` | ✅ Pass (1,000 cases, amounts from 1 to i128::MAX/2) |
| Deposit-withdraw produces no gain | `prop_deposit_withdraw_no_gain` | ✅ Pass (1,000 cases; redeem ≤ deposited) |
| Share balance consistency across users | `prop_total_shares_consistency` | ✅ Pass (1,000 two-user scenarios, 100% consistency) |
| Overdraw is always rejected | `prop_cannot_overdraw` | ✅ Pass (847 overdraw attempts blocked; 0 false allows) |
| Zero amounts always rejected | `prop_zero_amount_rejected` | ✅ Pass (1,000 cases; all zero/negative rejected) |
| Harvest improves exchange rate | `prop_harvest_improves_exchange_rate` | ✅ Pass (1,000 harvests; rate improved 1,000/1,000) |
| No overflow panics | `prop_no_overflow` | ✅ Pass (47 expected MathOverflow; 0 panics) |

**Invariants verified:**

| Invariant | Test | Result |
|---|---|---|
| Total assets always ≥ 0 | `invariant_assets_cover_shares` | ✅ Pass |
| All share balances ≥ 0 | `invariant_balance_non_negative` | ✅ Pass |
| Version counter ≥ 1 after init | `invariant_version_exists` | ✅ Pass |
| NotInitialized error before init | `invariant_must_initialize` | ✅ Pass |

Full report: [`FUZZ_FINDINGS.md`](./FUZZ_FINDINGS.md)

---

## 9. Continuous Security Assurance

The following automated checks run in CI on every push and pull request touching `aura-vault/`:

| Check | Tool | Failure Condition |
|---|---|---|
| CVE scanning | `cargo audit` | Any HIGH or CRITICAL advisory in `Cargo.lock` |
| Security lint | `cargo clippy --deny` | `unwrap_used`, `expect_used`, `panic`, `integer_arithmetic`, `as_conversions`, `cast_possible_truncation`, `cast_sign_loss`, `indexing_slicing` |
| Security unit tests | `cargo test security_tests::` | Any test failure |
| Property-based fuzz | `cargo test fuzz_properties::` | Any property violation |
| SAST (TypeScript) | CodeQL | Any detected vulnerability |
| Container scanning | Trivy | Any HIGH/CRITICAL CVE in Docker images |
| Dependency updates | Dependabot | Weekly PRs; auto-merged for non-breaking patch updates |

A weekly scheduled run (Monday 02:00 UTC) catches new CVEs that postdate the last push.

The security gate job in `.github/workflows/security-scan.yml` aggregates all checks; any failure blocks merge to `main`.

---

## 10. Incident History

All incidents to date occurred on Stellar Testnet before mainnet launch. No user funds have ever been at risk on mainnet.

### INC-2024-001 — Testnet Inflation Attack Edge Case

| Field | Value |
|---|---|
| **ID** | INC-2024-001 |
| **Date** | 2024-03-15 |
| **Severity** | P1 (High — potential mainnet impact before fix) |
| **Environment** | Stellar Testnet only |
| **Fund loss** | None |
| **Detection** | Internal integration testing during pre-launch audit preparation |

**What happened:** Internal tests discovered that a first deposit of exactly 1 stroop followed by a second deposit of a small amount could produce 0 shares for the second depositor. More critically, the team identified this as the classic ERC-4626 inflation attack vector: an attacker could deposit 1 stroop, then inflate `total_assets` via a direct token transfer, causing subsequent depositors to receive 0 shares.

**Root cause:** The share-minting formula `floor(amount × total_shares / total_assets)` performed integer floor division without checking whether the result was zero. A zero-shares outcome silently accepted the depositor's tokens without crediting them.

**Fix:** The zero-share mint rejection fence (`VaultError::ZeroAmount`, code 5) was added. Any deposit whose computed share count rounds to zero now returns an error instead of completing. The flash loan guard also independently blocks the direct-transfer inflation vector.

**Post-mortem:** [`docs/post-mortems/2024-03-15-testnet-inflation-attack.md`](./docs/post-mortems/2024-03-15-testnet-inflation-attack.md)

---

### INC-2024-002 — Testnet Flash Loan Guard False Positives

| Field | Value |
|---|---|
| **ID** | INC-2024-002 |
| **Date** | 2024-07-22 |
| **Severity** | P2 (Medium — feature broken; no fund loss) |
| **Environment** | Stellar Testnet only |
| **Fund loss** | None |
| **Detection** | Automated load testing (keeper simulation) |

**What happened:** During high-volume load testing with 20 concurrent harvest transactions per ledger close, every harvest call failed with `VaultError::BalanceMismatch`. The flash loan guard was producing false positives, blocking legitimate yield compounding.

**Root cause:** The balance check inside `harvest` read the vault's token balance **before** the yield transfer instruction executed. When multiple harvest calls were submitted in rapid succession, the balance read in a subsequent transaction reflected the intermediate state before the previous harvest's tokens had settled, causing a spurious mismatch.

**Fix:** The balance check was moved to **after** the yield token transfer. The guard now validates that `actual_balance == total_deposited + yield_amount` (post-injection), confirming that exactly `yield_amount` was deposited and no unexpected tokens arrived. Security review confirmed this adjusted position still catches genuine flash loan injection attempts.

**Post-mortem:** [`docs/post-mortems/2024-07-22-testnet-balance-mismatch-false-positive.md`](./docs/post-mortems/2024-07-22-testnet-balance-mismatch-false-positive.md)

---

## 11. Incident Response Overview

A detailed operational runbook is maintained in [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) and [`docs/incident-response-playbook.md`](./docs/incident-response-playbook.md).

### Severity Levels and Response Times

| Level | Impact | Response Time | Example |
|---|---|---|---|
| **Critical (P1)** | Users unable to withdraw; potential fund loss | Acknowledge within 5 min | Vault contract unresponsive; `BalanceMismatch` event on mainnet |
| **High (P2)** | Degraded functionality; elevated error rate | Acknowledge within 15 min | >20% deposit/withdrawal failure; admin key compromise suspected |
| **Medium (P3)** | Minor degradation; no user fund impact | Acknowledge within 1 hour | RPC latency spike; flash loan guard false positive |
| **Low (P4)** | No user impact | Next business day | Documentation gap; cosmetic UI issue |

### Key Response Procedures

**Suspected exploit (balance mismatch, unexpected `upgrade` event):**
1. Call `pause()` immediately (requires admin key, coordinated via multi-sig if admin has been rotated).
2. Query `total_assets()` and actual token balance; document the discrepancy.
3. Convene governance signers; determine root cause before `unpause()`.
4. Notify users: "Vault paused while we investigate irregular activity. No funds at risk until further notice."

**Admin key compromise:**
1. Do NOT use the compromised key again.
2. Convene governance signers; initiate `transfer_admin` governance proposal.
3. Requires 3-of-5 signers + 24h timelock before new admin takes effect.
4. Audit all transactions from the compromised key in the preceding window.

**Escalation path:**
```
Alert (Grafana / on-chain event monitor)
    ↓
On-call engineer (Slack + PagerDuty) — acknowledges
    ↓
[Critical?] Page second engineer + protocol lead
    ↓
[30 min unresolved?] Escalate to VP Engineering
    ↓
[Fund loss risk?] Pause vault + initiate governance vote
```

**Communication templates and full playbook:** [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md)

---

## 12. Security Best Practices for Users

### Before Depositing

- Only deposit amounts you can afford to lose entirely.
- Verify the contract ID against official sources. Do not trust links in DMs or social media.
- Confirm the underlying token address by calling `total_assets()` and reviewing initialized storage.
- Understand the current share price (`total_assets / total_shares`) to estimate the minimum economically rational deposit size.

### During Transactions

- Review the complete transaction payload before signing: confirm `amount`, `caller`, and contract ID.
- Use a dedicated DeFi wallet separate from your main holdings.
- If a transaction returns `ZeroAmount`, your deposit is too small relative to the current vault size. No tokens were transferred.

### Monitoring Your Position

- Periodically call `balance_of(<your-address>)` and `total_assets()` to verify your position is intact.
- Subscribe to on-chain events for the vault contract. Watch for unexpected `upgrade` or `admin_transferred` events — these are rare and should be investigated.
- If your balance entry approaches archival (no interaction for close to 30 days), perform any small `deposit` or `withdraw` to reset the TTL, or submit a restore transaction.

### Withdrawing

- The `withdraw` function returns `floor(shares × total_assets / total_shares)` tokens. Floor rounding means you may receive 1 unit less than the raw ratio suggests for small withdrawals.
- Verify the actual redeem amount before finalizing if precision matters for your use case.

---

## 13. Vulnerability Disclosure Policy

### Scope

**In scope for responsible disclosure:**

- `aura-vault/src/` — all smart contract source files
- `backend/src/` — backend API logic
- Any deployed instance of the compiled Wasm on Stellar Testnet or Mainnet
- The backend API at production endpoints

**Out of scope:**

- Frontend UI cosmetic bugs that do not affect on-chain funds
- Documentation typos or formatting issues
- Theoretical issues with no realistic exploit path
- Vulnerabilities in third-party dependencies not yet reflected in a CVE advisory (report those upstream)

### Severity Classification

| Severity | Description | Examples |
|---|---|---|
| **Critical** | Direct or near-certain loss or theft of user funds | Arithmetic bypass allowing over-redemption; admin check bypass in `upgrade` |
| **High** | Significant disruption or indirect fund risk | Permanent DoS on withdraw; harvest manipulation affecting all depositors |
| **Medium** | Limited impact or requires privileged access to exploit | Flash loan guard false positive under specific conditions; rounding exploitation below 1% impact |
| **Low** | Best-practice deviation; no fund risk | Minor code quality issues; missing documentation |
| **Informational** | Observation with no direct risk | Off-chain monitoring gap; missing view function |

### How to Report

1. **Do not disclose publicly** until the issue has been acknowledged and a fix has been deployed, or a coordinated disclosure date has been agreed upon.

2. **Submit your report** via GitHub Security Advisories on this repository:
   `Settings → Security → Advisories → New draft security advisory`

   Alternatively, email the address in this repository's GitHub profile security contact.

3. **Include in your report:**
   - Severity assessment with rationale
   - Affected file(s), function(s), and contract version (commit hash)
   - Step-by-step reproduction — a failing test case or PoC transaction sequence is ideal
   - Estimated impact (funds at risk, affected users, preconditions)
   - Suggested fix (optional but appreciated)

4. **Response timeline:**

   | Severity | Acknowledgement | Triage | Fix / Coordinated Disclosure |
   |---|---|---|---|
   | Critical / High | 72 hours | 7 days | 30 days |
   | Medium | 72 hours | 14 days | 90 days |
   | Low / Info | 7 days | 30 days | Next release cycle |

5. **Recognition:** Reporters of Critical and High issues will be credited publicly in the changelog and this document (with consent). No formal bug bounty program is currently active.

### Safe Harbor

Security researchers acting in good faith under this policy — who do not exploit vulnerabilities beyond proof-of-concept, do not access or exfiltrate user data, and report promptly — will not face legal action from the Protocol maintainers.

---

## Related Documents

| Document | Description |
|---|---|
| [`SECURITY_AUDIT_REPORT.md`](./SECURITY_AUDIT_REPORT.md) | Full smart contract audit report (7 findings, all remediated) |
| [`AUDIT.md`](./AUDIT.md) | Extended backend and smart contract OWASP audit |
| [`OWASP_AUDIT_REPORT.md`](./OWASP_AUDIT_REPORT.md) | Backend OWASP Top 10 audit (all passing) |
| [`FUZZ_FINDINGS.md`](./FUZZ_FINDINGS.md) | Property-based fuzz test results (11,000+ cases) |
| [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) | Incident response runbook and escalation procedures |
| [`docs/incident-response-playbook.md`](./docs/incident-response-playbook.md) | Detailed incident playbook |
| [`docs/post-mortems/`](./docs/post-mortems/) | Post-mortem reports for all historical incidents |
| [`GOVERNANCE.md`](./GOVERNANCE.md) | Multi-sig governance system documentation |
| [`GOVERNANCE_USAGE.md`](./GOVERNANCE_USAGE.md) | Governance operational guide |
| [`docs/secrets-management.md`](./docs/secrets-management.md) | Secrets management and rotation procedures |
| [`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md) | Day-to-day operational procedures |

---

*This document is the authoritative security reference for Aura Vault Protocol. It is updated with each release. For questions not addressed here, open a GitHub issue or email the security contact in the repository profile.*

*Last reviewed: 2026-08-30*

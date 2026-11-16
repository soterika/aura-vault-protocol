# Error Code Reference — Aura Vault Protocol

This document lists every error the Aura Vault contract can return, explains what it means, why it happens, and how to resolve it.

> **Programmatic lookup:** A machine-readable version of this data is available at [`/docs/error-codes.json`](./error-codes.json).

---

## Quick Reference Table

| Code | Name | Summary |
|------|------|---------|
| 1 | `NotInitialized` | The vault has not been set up yet |
| 2 | `AlreadyInitialized` | The vault was already set up |
| 3 | `InsufficientShares` | You are trying to withdraw more shares than you hold |
| 4 | `InsufficientUnderlying` | The vault does not have enough tokens to pay you |
| 5 | `ZeroAmount` | You passed a zero or negative amount |
| 6 | `MathOverflow` | Your number is too large to process safely |
| 7 | `InvalidAddress` | The address or fee value is not permitted |
| 8 | `ZeroShares` | Harvest was called when no one has deposited |
| 9 | `UpgradeUnauthorized` | Only the admin can upgrade the contract |
| 10 | `StorageLayoutMismatch` | The upgrade target has an incompatible storage layout |
| 11 | `VaultPaused` | The vault is temporarily halted by the admin |
| 12 | `BalanceMismatch` | A flash-loan or balance manipulation was detected |

---

## Detailed Error Entries

---

### Error 1 — `NotInitialized`

**What it means**

The vault contract has been deployed but `initialize` has never been called. No operations are possible until the vault is set up with an admin address, an underlying token, and governance signers.

**Common triggers**

- Calling `deposit`, `withdraw`, or `harvest` against a freshly deployed contract before initialization.
- Pointing your client at the wrong contract address (e.g., a staging deployment instead of mainnet).
- The `initialize` transaction was submitted but failed silently and was never retried.

**How to resolve**

1. Confirm you are using the correct contract ID in your configuration.
2. Check on-chain state: `stellar contract invoke --id <CONTRACT_ID> -- is_paused` — if this also fails with `NotInitialized`, the vault definitely needs to be set up.
3. If you are the deployer, call `initialize` with the admin address, underlying token contract ID, and at least one governance signer.
4. If you are a user, contact the protocol admin — the vault is not yet ready for use.

**Related docs:** [Getting Started](/docs/getting-started.md) · [Deployment Guide](/docs/DEPLOYMENT.md)

---

### Error 2 — `AlreadyInitialized`

**What it means**

`initialize` was called on a vault that has already been set up. This is a one-time operation and cannot be repeated.

**Common triggers**

- Running an initialization script twice by mistake.
- A deployment automation tool that does not check existing state before calling `initialize`.
- Attempting to re-initialize after an upgrade (upgrades do not require re-initialization).

**How to resolve**

1. This is almost always a scripting bug. Add a guard to your deployment scripts: check whether `total_assets()` or `balance_of()` returns without error before calling `initialize`.
2. If you need to change the admin or token address, use the governance proposal functions (`propose_update_admin`, `propose_update_token`) rather than reinitializing.
3. If you are testing, deploy a fresh contract instance instead of reusing an existing one.

---

### Error 3 — `InsufficientShares`

**What it means**

You tried to withdraw more shares than your account currently holds. The vault checks your share balance before processing any withdrawal.

**Common triggers**

- Typing the wrong number of shares — for example, entering a raw token amount instead of a share count.
- Your shares were already redeemed in a previous transaction that you did not track.
- Multiple automated calls racing to withdraw the same balance.
- Querying the wrong address for share balance.

**How to resolve**

1. Call `balance_of(<your_address>)` to confirm your current share balance.
2. Make sure you are not confusing shares with underlying tokens. Shares and underlying amounts are related by the exchange rate (`total_assets / total_shares`), but they are not equal unless no yield has ever been harvested.
3. If you have an automated system, add a `balance_of` check before each withdrawal call to prevent over-withdrawal.
4. Check your transaction history to see if a prior withdrawal already consumed those shares.

**Related docs:** [Integration Guide](/docs/integration-rust.md#withdraw)

---

### Error 4 — `InsufficientUnderlying`

**What it means**

The vault does not hold enough underlying tokens to pay out the amount your shares entitle you to. This should be extremely rare under normal operation, as the vault tracks `total_deposited` in sync with its actual token balance.

**Common triggers**

- The underlying token contract suffered a separate bug or exploit that drained vault funds.
- A misconfigured fee withdrawal removed more tokens than intended.
- `total_deposited` state drifted from actual balance due to a contract bug (in which case `BalanceMismatch (12)` would typically fire first).

**How to resolve**

1. This error is a red flag. Check `total_assets()` and compare it with the actual on-chain token balance by querying the SEP-41 token contract directly.
2. If amounts diverge significantly, do not interact with the vault and alert the protocol admin immediately.
3. If amounts are close (within rounding), this may be a temporary state — try again in a few ledgers.
4. Monitor the `suspicious` event emitted alongside `BalanceMismatch` for evidence of an active attack.

**Related docs:** [Security](/SECURITY.md) · [Incident Response](/INCIDENT_RESPONSE.md)

---

### Error 5 — `ZeroAmount`

**What it means**

You passed a zero or negative value to a function that requires a positive amount. This also fires when your deposit is so small that the share formula rounds down to zero shares.

**Common triggers**

- Submitting a form without filling in the amount field (the UI should prevent this, but contract-level validation is the last line of defense).
- Passing `0` as `amount` to `deposit`, or `0` as `shares` to `withdraw`, or `0` as `yield_amount` to `harvest`.
- Depositing a very small amount of tokens when the vault already has a large `total_assets` balance, causing the share calculation to floor to zero.

**How to resolve**

1. Ensure your amount is strictly positive.
2. If your deposit amount is small relative to vault size, try a larger amount. The minimum viable deposit equals `ceil(total_assets / total_shares)` underlying tokens to guarantee at least 1 share.
3. For UI integrations, validate input on the client side before submitting the transaction to avoid wasting gas fees.

---

### Error 6 — `MathOverflow`

**What it means**

An intermediate arithmetic value during the share or fee calculation exceeded the maximum representable `i128` value (2¹²⁷ − 1, approximately 1.7 × 10³⁸). The contract uses `checked_mul` and `checked_div` throughout to detect this safely.

**Common triggers**

- Passing an astronomically large `amount` or `yield_amount` value.
- Very large `total_assets` combined with a large new deposit — the intermediate product `amount × total_shares` overflows before division.
- A programming error in an automated bot that passes raw floating-point values instead of properly scaled integers.

**How to resolve**

1. Use `i128`-safe arithmetic throughout your client. All amounts are in the smallest indivisible unit of the underlying token (analogous to stroops for XLM).
2. If you are building a keeper bot or integration, cap amounts at a reasonable maximum (e.g., `i64::MAX`) to stay well within safe range.
3. The contract uses 7-decimal-place precision. Amounts exceeding ~10²⁴ (one quadrillion tokens with 9 decimal places) are practically unreachable in normal operation.

---

### Error 7 — `InvalidAddress`

**What it means**

An address argument failed validation, or a fee parameter was out of the permitted range. Currently used as a combined sentinel for invalid addresses and out-of-range fee values.

**Common triggers**

- Passing `perf_fee_bps > 2000` (more than 20%) to `set_fees`.
- Passing `mgmt_fee_bps > 100` (more than 1% annually) to `set_fees`.
- Passing a whitelisted yield-token address that has not been registered by the admin.
- Future: malformed Stellar address strings (currently caught at the SDK layer before reaching the contract).

**How to resolve**

1. For fee parameters: ensure `perf_fee_bps` is between 0 and 2000 and `mgmt_fee_bps` is between 0 and 100.
2. For yield token operations: verify the alternate yield token address has been whitelisted by the admin via `register_yield_token`.
3. Validate all address strings against the Stellar address format before passing them to the contract.

---

### Error 8 — `ZeroShares`

**What it means**

`harvest` (or `harvest_token`) was called when no vault shares exist — i.e., no one has ever deposited into the vault (or everyone has withdrawn). There is no valid way to distribute yield when the depositor pool is empty.

**Common triggers**

- An automated keeper bot calling `harvest` before any deposits have been made.
- All depositors withdrew and the keeper continued calling `harvest` without checking share count first.
- Harvesting against a newly deployed and initialized vault that has not yet received its first deposit.

**How to resolve**

1. Check `total_assets()` before calling `harvest`. If it returns 0, there are no depositors.
2. In your keeper bot, add a guard: only call `harvest` when `total_assets() > 0`.
3. Wait for at least one depositor to fund the vault before setting up automated yield harvesting.

**Related docs:** [Keeper Guide](/docs/keeper-guide.md)

---

### Error 9 — `UpgradeUnauthorized`

**What it means**

A non-admin address tried to call `upgrade`. Contract Wasm upgrades are restricted exclusively to the configured admin address.

**Common triggers**

- Calling `upgrade` with a user keypair instead of the admin keypair.
- The admin key has been rotated via a governance proposal and the old key is still being used.
- A governance proposal to update the admin completed successfully but the upgrade scripts were not updated to use the new admin key.

**How to resolve**

1. Confirm which address is the current admin by checking the governance proposal history or the contract's instance storage.
2. Sign the `upgrade` transaction with the admin keypair.
3. If admin access has been lost, follow the governance process to propose a new admin through the multi-sig signers.

**Related docs:** [Governance Guide](/GOVERNANCE.md)

---

### Error 10 — `StorageLayoutMismatch`

**What it means**

The new Wasm being uploaded during an upgrade has a different `CURRENT_LAYOUT_VERSION` constant than what is recorded on-chain. This prevents silent state corruption when a migration script is required before upgrading.

**Common triggers**

- Deploying a contract version that adds or changes storage keys without first running the appropriate data migration.
- Building the new Wasm from a branch that bumped `CURRENT_LAYOUT_VERSION` but deploying it without reading the migration guide.
- Accidentally uploading the wrong `.wasm` file.

**How to resolve**

1. Check the `CURRENT_LAYOUT_VERSION` constant in `aura-vault/src/storage.rs` for both the current on-chain version (stored at `DataKey::LayoutVersion`) and the new Wasm you are uploading.
2. Follow the migration checklist in the release notes for the version you are upgrading to.
3. If no migration is needed and the version bump was unintentional, rebuild the contract from the correct source revision.

**Related docs:** [Deployment Guide](/docs/DEPLOYMENT.md)

---

### Error 11 — `VaultPaused`

**What it means**

The admin has activated the emergency pause. All state-changing operations (`deposit`, `withdraw`, `harvest`) are blocked until the admin calls `unpause`. Read-only queries (`total_assets`, `balance_of`, `is_paused`) continue to work.

**Common triggers**

- The admin detected suspicious activity and manually paused to prevent further damage.
- Scheduled maintenance requiring vault operations to be halted temporarily.
- An automated circuit breaker triggered the pause.

**How to resolve**

1. Call `is_paused()` to confirm the vault is actually paused (rather than having a different error).
2. Your funds are safe — the vault is in a read-only protective state, not compromised.
3. Monitor the protocol's official communication channels for an announcement about when operations will resume.
4. If you are the admin, call `unpause` once the issue has been resolved.

**Related docs:** [Operations Runbook](/docs/OPERATIONS_RUNBOOK.md) · [Incident Response](/INCIDENT_RESPONSE.md)

---

### Error 12 — `BalanceMismatch`

**What it means**

The vault's recorded `total_deposited` state does not match the actual on-chain token balance at the start of a mutating operation. This is the flash-loan guard. Whenever a discrepancy is detected, the contract emits a `suspicious` event and rejects the transaction.

**Common triggers**

- A flash-loan attack attempting to inflate or deflate the vault's apparent balance.
- A direct transfer of underlying tokens to the vault address outside of the normal `deposit` flow (tokens sent without calling `deposit` will cause a discrepancy).
- A bug in a wrapper contract or strategy that interacts with vault token accounts incorrectly.
- Extremely rare: a race condition between two simultaneous transactions that both pass pre-checks but interfere on execution (Soroban's atomic ledger model makes this effectively impossible in practice).

**How to resolve**

1. **If you are a regular user:** This error is almost never caused by normal user activity. Retry your transaction. If it persists, the vault may be under active attack — stop interacting with it and check the protocol's status page.
2. **If you are a developer or integration:** Never send underlying tokens directly to the vault contract address. Always use the `deposit` function, which is the only legitimate way to increase vault balance.
3. **If you are the admin:** Check the `suspicious` event data, which includes both the observed balance and the expected `total_deposited`. A persistent mismatch is grounds for pausing the vault and conducting a security audit.

**Related docs:** [Security](/SECURITY.md) · [Incident Response](/INCIDENT_RESPONSE.md)

---

## Programmatic Error Lookup

Import the [error-codes.json](./error-codes.json) file in any environment that supports JSON parsing.

```javascript
// JavaScript / Node.js
import errors from './error-codes.json' assert { type: 'json' };
const info = errors.find(e => e.code === 11);
console.log(info.name);        // "VaultPaused"
console.log(info.description); // "The vault is paused..."
```

```python
# Python
import json
with open('docs/error-codes.json') as f:
    errors = {e['code']: e for e in json.load(f)}
print(errors[11]['resolution'])
```

```rust
// Rust — see /docs/integration-rust.md for the full VaultClientError enum
use crate::vault_client::VaultClientError;
let e = VaultClientError::from_code(11);
println!("{}", e); // "vault is paused — all mutating operations are halted (code 11)"
```

---

## See Also

- [Rust Integration Guide](/docs/integration-rust.md) — typed error enum and mapping helper
- [Smart Contract API](/docs/smart-contract-api.md) — full on-chain ABI reference
- [Keeper Guide](/docs/keeper-guide.md) — keeper-specific errors and best practices
- [Security Policy](/SECURITY.md) — responsible disclosure and audit history

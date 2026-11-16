# API Migration Guide — v0 to v1

This guide covers every breaking change between the Aura Vault contract v0 (initial release) and v1 (governance + fee + pause release). Follow it when upgrading any integration that calls the on-chain contract, the backend REST API, or subscribes to contract events.

---

## Table of Contents

1. [Overview of Changes](#overview-of-changes)
2. [Breaking Changes Changelog](#breaking-changes-changelog)
3. [Side-by-Side Function Comparison](#side-by-side-function-comparison)
4. [Code Migration Examples](#code-migration-examples)
5. [New Functions Reference](#new-functions-reference)
6. [New Error Codes](#new-error-codes)
7. [Event Changes](#event-changes)
8. [Migration Timeline and Deprecation Dates](#migration-timeline-and-deprecation-dates)
9. [Migration Support](#migration-support)

---

## Overview of Changes

v1 introduces governance, fee collection, pause controls, and multi-token harvest. The majority of new functions are additive (non-breaking). The one **breaking** change that affects all existing integrators is the updated signature of `initialize`.

| Category | Count | Breaking? |
|---|---|---|
| Modified function signatures | 1 | **Yes** — `initialize` |
| New admin functions | 6 | No (additive) |
| New governance functions | 5 | No (additive) |
| New error codes | 7 (codes 9–15) | Only if you do exhaustive error-code matching |
| New events | 3 | Only if you rely on an exact event topic list |

---

## Breaking Changes Changelog

### BC-1 — `initialize` requires a `signers` parameter (breaking)

**Affected**: All deployers. Any script or integration that calls `initialize` without the new `signers` argument will fail to compile against the v1 ABI.

**v0 signature**

```rust
fn initialize(env: Env, admin: Address, underlying_token: Address) -> Result<(), VaultError>
```

**v1 signature**

```rust
fn initialize(env: Env, admin: Address, underlying_token: Address, signers: Vec<Address>) -> Result<(), VaultError>
```

`signers` is the initial governance multisig signer set. A minimum of 3 signers is recommended. The list may not be empty.

---

### BC-2 — `harvest` now emits a different event data structure (breaking for event subscribers)

**Affected**: Any off-chain listener that parses the `harvest` event data tuple.

**v0 harvest event data**

```
topic:  ("harvest", caller, yield_amount)
data:   (yield_amount, total_deposited)
```

**v1 harvest event data**

```
topic:  ("harvest", caller, yield_amount)
data:   (yield_after_fee, fee_amount, total_deposited)
```

The data tuple now includes the `fee_amount` deducted before applying yield. If you are indexing on-chain events and parsing the data tuple by position, you must add a field at index 1 for `fee_amount`.

---

### BC-3 — Error code exhaustive matching must handle codes 9–15 (breaking for strict switch statements)

**Affected**: Any integration that matches `VaultError` codes exhaustively (e.g., a `switch` with no default case, or a `match` in Rust).

v1 adds seven new error variants. If your code does exhaustive matching without a default branch, it will either fail to compile (Rust) or silently fall through (JavaScript/Python). Add handling for codes 9–15 or a default/wildcard case.

---

## Side-by-Side Function Comparison

### `initialize`

| | v0 | v1 |
|---|---|---|
| Parameters | `admin`, `underlying_token` | `admin`, `underlying_token`, `signers` |
| CLI invocation | `-- initialize --admin G... --underlying_token G...` | `-- initialize --admin G... --underlying_token G... --signers '[{"address":"G..."}]'` |
| Errors | `AlreadyInitialized` | `AlreadyInitialized` (unchanged) |

### `deposit`

| | v0 | v1 |
|---|---|---|
| Parameters | `caller`, `amount` | `caller`, `amount` (unchanged) |
| Returns | `i128` shares minted | `i128` shares minted (unchanged) |
| New errors | — | `VaultPaused` (11), `BalanceMismatch` (12) |

### `withdraw`

| | v0 | v1 |
|---|---|---|
| Parameters | `caller`, `shares` | `caller`, `shares` (unchanged) |
| Returns | `i128` underlying returned | `i128` underlying returned (unchanged) |
| New errors | — | `VaultPaused` (11), `BalanceMismatch` (12) |

### `harvest`

| | v0 | v1 |
|---|---|---|
| Parameters | `caller`, `yield_amount` | `caller`, `yield_amount` (unchanged) |
| Event data | `(yield_amount, total_deposited)` | `(yield_after_fee, fee_amount, total_deposited)` |
| New errors | — | `VaultPaused` (11), `BalanceMismatch` (12) |

### `total_assets`, `balance_of`

No changes. Both remain read-only and require no auth.

---

## Code Migration Examples

### Example 1 — Updating `initialize` (Stellar CLI)

**Before (v0)**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network mainnet \
  -- initialize \
  --admin GADMINADDRESS... \
  --underlying_token GTOKENADDRESS...
```

**After (v1)**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network mainnet \
  -- initialize \
  --admin GADMINADDRESS... \
  --underlying_token GTOKENADDRESS... \
  --signers '[
    {"address": "GSIGNER1ADDRESS..."},
    {"address": "GSIGNER2ADDRESS..."},
    {"address": "GSIGNER3ADDRESS..."}
  ]'
```

Minimum viable signer list is one address, but three or more is strongly recommended to meet governance quorum. See [Governance documentation](./smart-contract-api.md#governance) for quorum thresholds.

---

### Example 2 — Updating `initialize` (JavaScript / Stellar SDK)

**Before (v0)**

```js
const tx = await contract.call("initialize", {
  admin: adminKeypair.publicKey(),
  underlying_token: tokenContractId,
});
```

**After (v1)**

```js
import { xdr, Address } from "@stellar/stellar-sdk";

const signers = [
  signer1PublicKey,
  signer2PublicKey,
  signer3PublicKey,
].map(pk => new Address(pk).toScVal());

const tx = await contract.call("initialize", {
  admin: adminKeypair.publicKey(),
  underlying_token: tokenContractId,
  signers: xdr.ScVal.scvVec(signers),
});
```

---

### Example 3 — Updating `initialize` (Rust integration test)

**Before (v0)**

```rust
client.initialize(&admin_addr, &token_addr);
```

**After (v1)**

```rust
use soroban_sdk::vec;

let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
client.initialize(&admin_addr, &token_addr, &signers);
```

---

### Example 4 — Updating harvest event parsing

**Before (v0)** — parsing two-element data tuple

```js
function onHarvestEvent(data) {
  const [yieldAmount, totalDeposited] = data;
  updateUI({ yieldAmount, totalDeposited });
}
```

**After (v1)** — parsing three-element data tuple

```js
function onHarvestEvent(data) {
  const [yieldAfterFee, feeAmount, totalDeposited] = data;
  updateUI({ yieldAfterFee, feeAmount, totalDeposited });
}
```

---

### Example 5 — Handling new error codes

**Before (v0)** — 8 known error codes

```js
function translateError(code) {
  const errors = {
    1: "Not initialized",
    2: "Already initialized",
    3: "Insufficient shares",
    4: "Insufficient underlying",
    5: "Zero amount",
    6: "Math overflow",
    7: "Invalid address",
    8: "Zero shares",
  };
  return errors[code] ?? `Unknown error (${code})`;
}
```

**After (v1)** — add codes 9–15

```js
function translateError(code) {
  const errors = {
    1:  "Not initialized",
    2:  "Already initialized",
    3:  "Insufficient shares",
    4:  "Insufficient underlying",
    5:  "Zero amount",
    6:  "Math overflow",
    7:  "Invalid address",
    8:  "Zero shares",
    // v1 additions
    9:  "Upgrade unauthorized — caller is not the admin",
    10: "Storage layout mismatch — on-chain layout version mismatch on upgrade",
    11: "Vault paused — operation rejected while vault is paused",
    12: "Balance mismatch — flash-loan guard triggered",
    13: "Timelock not expired — governance proposal executed too early",
    14: "Not approved — proposal has not reached required signature threshold",
    15: "Already voted — signer has already voted on this proposal",
  };
  return errors[code] ?? `Unknown error (${code})`;
}
```

---

### Example 6 — Handling `VaultPaused` (error 11)

Any call to `deposit`, `withdraw`, or `harvest` while the vault is paused will return error 11. Add a pre-flight check or handle the error gracefully:

```js
import { isVaultPaused } from "./vaultUtils";

async function deposit(caller, amount) {
  // Optional pre-flight check to give a better UX
  const paused = await contract.call("is_paused");
  if (paused) {
    throw new Error("Vault is currently paused. Check status page for updates.");
  }

  return contract.call("deposit", { caller, amount });
}
```

---

### Example 7 — Responding to `BalanceMismatch` (error 12)

Error 12 indicates a flash-loan attack was detected. Do not retry automatically; alert operators.

```js
async function safeWithdraw(caller, shares) {
  try {
    return await contract.call("withdraw", { caller, shares });
  } catch (err) {
    if (err.code === 12) {
      // Flash-loan guard triggered — do NOT retry
      alertOps("SECURITY: BalanceMismatch detected on withdraw", { caller, shares });
      throw new Error("Withdrawal rejected due to security guard. Contact support.");
    }
    throw err;
  }
}
```

---

## New Functions Reference

The following functions are **additive** in v1 — they do not change any existing function and can be adopted on your own timeline.

### Admin — Pause Controls

| Function | Auth | Description |
|---|---|---|
| `pause()` | Admin | Halt all mutating operations. Emits `("paused",)` event. |
| `unpause()` | Admin | Resume operations. Emits `("unpaused",)` event. |
| `is_paused()` | None | Returns `bool`. Free read-only call. |

### Admin — Fee Management

| Function | Auth | Description |
|---|---|---|
| `set_fees(performance_bps)` | Admin | Set performance fee in basis points (e.g. 200 = 2%). |
| `set_treasury(address)` | Admin | Set fee recipient address. |
| `withdraw_fees()` | Admin | Transfer accrued fees to treasury. Emits `("fees_withdrawn",)`. |
| `total_fees_collected()` | None | Returns cumulative fees collected as `i128`. |

### Admin — Yield Token Registry

| Function | Auth | Description |
|---|---|---|
| `register_yield_token(token)` | Admin | Whitelist an alternate token for use with `harvest_token`. |

### Core — Alternate Token Harvest

| Function | Auth | Description |
|---|---|---|
| `harvest_token(caller, alt_token, amount)` | Caller | Inject yield from a registered alternate token (e.g. staking rewards). Auto-converts to the underlying via the price oracle. |

### Admin — Contract Upgrade

| Function | Auth | Description |
|---|---|---|
| `upgrade(new_wasm_hash)` | Admin | Upgrade the contract Wasm. Validates storage layout version. Emits `("upgrade",)`. |

### Governance

| Function | Auth | Description |
|---|---|---|
| `propose_update_admin(new_admin)` | Signer | Create governance proposal to change admin. |
| `propose_update_token(new_token)` | Signer | Create governance proposal to change underlying token. |
| `propose_parameter_update(key, value)` | Signer | Create generic parameter update proposal. |
| `vote(proposal_id)` | Signer | Cast a vote on an open proposal. |
| `execute(proposal_id)` | Any | Execute an approved proposal after the 24-hour timelock. |
| `proposal_status(proposal_id)` | None | Read-only status check: pending / approved / executed / expired. |

---

## New Error Codes

| Code | Variant | Trigger | Retryable? |
|---|---|---|---|
| 9 | `UpgradeUnauthorized` | `upgrade` called by non-admin | No |
| 10 | `StorageLayoutMismatch` | Upgrade Wasm has incompatible storage layout | No |
| 11 | `VaultPaused` | Mutating operation while vault is paused | Yes (after unpause) |
| 12 | `BalanceMismatch` | Flash-loan guard: actual balance ≠ tracked state | No — alert ops |
| 13 | `TimelockNotExpired` | `execute` called before 24-hour timelock elapses | Yes (wait) |
| 14 | `NotApproved` | `execute` called before quorum reached | Yes (wait for votes) |
| 15 | `AlreadyVoted` | Signer called `vote` a second time on same proposal | No |

---

## Event Changes

### New events in v1

| Event topic | Emitted by | Data |
|---|---|---|
| `("paused",)` | `pause()` | `()` |
| `("unpaused",)` | `unpause()` | `()` |
| `("upgrade", admin)` | `upgrade()` | `(old_version, new_version)` |
| `("fees_withdrawn", admin)` | `withdraw_fees()` | `(fees, treasury)` |
| `("harvest_token", caller, alt_token)` | `harvest_token()` | `(yield_amount, net_underlying, fee_amount)` |
| `("suspicious",)` | Any flash-loan guard trip | `("balance_mismatch", actual, tracked)` |

### Modified events in v1

| Event | v0 data | v1 data |
|---|---|---|
| `harvest` | `(yield_amount, total_deposited)` | `(yield_after_fee, fee_amount, total_deposited)` |

---

## Migration Timeline and Deprecation Dates

| Milestone | Date | Notes |
|---|---|---|
| v1 contract deployed to Testnet | 2026-09-01 | Full v1 feature set available for integration testing |
| v0 Testnet support ends | 2026-10-01 | Testnet v0 contract instances will stop responding |
| v1 contract deployed to Mainnet | 2026-10-15 | Production cut-over |
| v0 Mainnet soft-deprecation begins | 2026-10-15 | v0 instances remain accessible but are not monitored |
| v0 Mainnet hard-deprecation | 2026-12-31 | v0 instances may be paused and/or shut down |
| Migration support window closes | 2026-12-31 | Post-deadline migrations are community-supported only |

**All integrators must complete migration to v1 by 2026-12-31.**

If your deployment schedule requires an extension, contact the team (see below) before 2026-11-30.

---

## Migration Support

For questions, breaking-change reports, or migration timeline extensions:

- **GitHub Issues**: Open an issue tagged `migration` in [soterika/aura-vault-protocol](https://github.com/soterika/aura-vault-protocol/issues/new?labels=migration)
- **Discord**: `#dev-migrations` channel in the Aura Vault Discord server
- **Email**: integrations@aura-vault.xyz (monitored during business hours, UTC)
- **Security issues**: If the migration uncovers a security concern, use the private disclosure path described in [SECURITY.md](../SECURITY.md)

When opening a support request, include:
1. Your integration type (CLI, Rust SDK, JS SDK, other)
2. The specific function(s) affected
3. The error or unexpected behavior you are seeing
4. Your target migration date

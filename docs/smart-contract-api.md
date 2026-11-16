# Smart Contract API Reference

This document covers every public function of the `AuraVault` Soroban contract: signatures, parameter descriptions, return types, possible errors, and example invocations using the Stellar CLI.

All token amounts are expressed in **stroops** (the smallest indivisible unit). For a token with 7 decimal places (e.g., XLM, USDC on Stellar), 1 token = 10,000,000 stroops.

---

## Table of Contents

1. [Error Codes](#1-error-codes)
2. [initialize](#2-initialize)
3. [deposit](#3-deposit)
4. [withdraw](#4-withdraw)
5. [harvest](#5-harvest)
6. [harvest_token](#6-harvest_token)
7. [register_yield_token](#7-register_yield_token)
8. [pause](#8-pause)
9. [unpause](#9-unpause)
10. [is_paused](#10-is_paused)
11. [set_fees](#11-set_fees)
12. [set_treasury](#12-set_treasury)
13. [withdraw_fees](#13-withdraw_fees)
14. [total_fees_collected](#14-total_fees_collected)
15. [total_assets](#15-total_assets)
    - [Share accounting views](#151-share-accounting-views)
16. [balance_of](#16-balance_of)
17. [upgrade](#17-upgrade)
18. [Governance Functions](#18-governance-functions)
    - [propose_update_admin](#181-propose_update_admin)
    - [propose_update_token](#182-propose_update_token)
    - [propose_parameter_update](#183-propose_parameter_update)
    - [vote](#184-vote)
    - [execute](#185-execute)
    - [proposal_status](#186-proposal_status)
19. [Events Reference](#19-events-reference)
20. [Storage Layout](#20-storage-layout)
21. [Additional Public Methods and ABI Status](#21-additional-public-methods-and-abi-status)

---

## 1. Error Codes

All mutating functions return `Result<_, VaultError>`. The following error codes can be returned:

| Code | Variant | Description |
|---|---|---|
| 1 | `NotInitialized` | Vault has not been initialized yet |
| 2 | `AlreadyInitialized` | `initialize` was called more than once |
| 3 | `InsufficientShares` | Caller's share balance is less than the requested withdrawal amount |
| 4 | `InsufficientUnderlying` | Vault's token balance cannot cover the redemption |
| 5 | `ZeroAmount` | Input is zero, negative, or computed shares/tokens round to zero |
| 6 | `MathOverflow` | Integer overflow during share/token arithmetic |
| 7 | `InvalidAddress` | Address is not in the governance signers list, or token is not whitelisted |
| 8 | `ZeroShares` | `harvest` called when `total_shares == 0` (nobody has deposited yet) |
| 9 | `UpgradeUnauthorized` | Caller is not the stored admin |
| 10 | `StorageLayoutMismatch` | On-chain layout version does not match `CURRENT_LAYOUT_VERSION` |
| 11 | `VaultPaused` | Mutating operation called while the vault is paused |
| 12 | `BalanceMismatch` | Flash loan guard: actual token balance ≠ `total_deposited` |
| 13 | `TimelockNotExpired` | Governance timelock has not elapsed |
| 14 | `NotApproved` | Proposal has not reached required signature threshold |
| 15 | `AlreadyVoted` | Signer already voted on this proposal |
| 16 | `TvlCapExceeded` | Deposit would exceed the configured TVL cap |
| 17 | `YieldTooSmall` | Yield rounds to zero per share — accumulate more before distributing |
| 18 | `DistributionAccuracyError` | Rounding error exceeds 0.01% accuracy threshold |
| 19 | `HarvestCooldown` | Harvest attempted before the cooldown period has elapsed |
| 20 | `WithdrawalQueued` | Withdrawal queued; call `claim_queued_withdrawal` after unbonding |
| 21 | `QueueEntryNotFound` | Queue entry does not exist or was already claimed |
| 22 | `QueueUnbondingPending` | Queue entry is still within the unbonding period |
| 23 | `InvalidWithdrawalFee` | Withdrawal fee exceeds the 5% maximum |
| 24 | `TransferFailed` | Token transfer amount assertion failed (fee-on-transfer guard) |
| 25 | `OraclePriceZero` | Oracle returned a zero price |
| 26 | `OraclePriceTooHigh` | Oracle price exceeds sanity cap (possible manipulation) |
| 27 | `OraclePriceStale` | Oracle price is older than the configured `max_age_secs` |
| 28 | `NotWhitelisted` | Deposit attempted by an address not on the whitelist |
| 29 | `BelowMinDeposit` | Deposit amount is below the configured minimum |
| 30 | `OracleUnavailable` | Oracle unavailable; `total_assets_usd` returned fallback value 0 |
| 31 | `CircuitBreakerTripped` | Share price moved more than the configured limit; vault auto-paused |

---

## 2. initialize

One-time setup. Stores the admin address, underlying token address, initial version metadata, and governance signers. Reverts if called more than once.

### Signature

```rust
fn initialize(
    env: Env,
    admin: Address,
    underlying_token: Address,
    signers: Vec<Address>,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | The privileged account that can pause, set fees, upgrade, and manage the vault |
| `underlying_token` | `Address` | The SEP-41-compatible token contract address that the vault holds |
| `signers` | `Vec<Address>` | List of multi-sig governance signers; 3-of-N approval required for governance proposals |

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `AlreadyInitialized` | `initialize` has already been called |

### Side effects

- Sets `admin`, `underlying_token`, `total_shares = 0`, `total_deposited = 0`, `version = 1`, `layout_version = 1`
- Initializes governance signer list
- Bumps instance TTL (30-day lifetime)

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- initialize \
  --admin GADMIN_ADDRESS \
  --underlying_token GTOKEN_ADDRESS \
  --signers '["GSIGNER1","GSIGNER2","GSIGNER3"]'
```

---

## 3. deposit

Transfer underlying tokens into the vault and receive vault shares proportional to the deposit. Requires caller authorization.

### Signature

```rust
fn deposit(
    env: Env,
    caller: Address,
    amount: i128,
) -> Result<i128, VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | The depositing account; must authorize this transaction |
| `amount` | `i128` | Amount of underlying tokens to deposit, in stroops (must be > 0) |

### Returns

`Ok(new_shares)` — the number of vault shares minted to the caller, in the same unit as the underlying token stroops.

### Share formula

```
// First deposit (or when vault is empty):
new_shares = amount

// Subsequent deposits:
new_shares = floor(amount × total_shares / total_assets)
```

### Errors

| Error | Condition |
|---|---|
| `ZeroAmount` | `amount ≤ 0`, or computed shares round to 0 |
| `NotInitialized` | Vault not yet initialized |
| `VaultPaused` | Vault is paused |
| `BalanceMismatch` | Flash loan guard triggered |
| `MathOverflow` | Arithmetic overflow in share computation |

### Events emitted

```
topics: ("deposit", caller: Address, amount: i128)
data:   (new_shares: i128, new_total_shares: i128, new_total_deposited: i128)
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source depositor-keypair \
  --network testnet \
  -- deposit \
  --caller GDEPOSITOR_ADDRESS \
  --amount 1000000000
```

The above deposits 100 tokens (1,000,000,000 stroops for a 7-decimal token).

---

## 4. withdraw

Burn vault shares and redeem the proportional amount of underlying tokens. Requires caller authorization.

### Signature

```rust
fn withdraw(
    env: Env,
    caller: Address,
    shares: i128,
) -> Result<i128, VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | The withdrawing account; must authorize this transaction |
| `shares` | `i128` | Number of vault shares to burn (must be > 0 and ≤ caller's share balance) |

### Returns

`Ok(redeem_amount)` — the number of underlying token stroops transferred to the caller.

### Redeem formula

```
redeem_amount = floor(shares × total_assets / total_shares)
```

### Errors

| Error | Condition |
|---|---|
| `ZeroAmount` | `shares ≤ 0`, or computed redeem amount rounds to 0 |
| `NotInitialized` | Vault not yet initialized |
| `VaultPaused` | Vault is paused |
| `BalanceMismatch` | Flash loan guard triggered |
| `InsufficientShares` | `shares > caller's balance` |
| `InsufficientUnderlying` | Vault balance cannot cover `redeem_amount` |
| `MathOverflow` | Arithmetic overflow in redemption computation |

### Events emitted

```
topics: ("withdraw", caller: Address, shares: i128)
data:   (redeem_amount: i128, new_total_shares: i128, new_total_deposited: i128)
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source depositor-keypair \
  --network testnet \
  -- withdraw \
  --caller GDEPOSITOR_ADDRESS \
  --shares 500000000
```

---

## 5. harvest

Keeper entry point. Injects underlying yield and applies the configured performance fee. Net yield is tracked for the balance invariant immediately, then becomes visible to share pricing linearly over the configured vesting period (default seven days / 120,960 ledgers). `total_assets` and deposit/withdraw pricing include only the vested portion. A new harvest restarts the schedule for the still-unvested remainder plus the new net yield.

### Signature

```rust
fn harvest(
    env: Env,
    caller: Address,
    yield_amount: i128,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | The keeper account injecting yield; must authorize and hold sufficient tokens |
| `yield_amount` | `i128` | Amount of underlying tokens to inject as yield, in stroops (must be > 0) |

### Returns

`Ok(())` on success.

### Fee deduction

```
fee_amount   = floor(yield_amount × perf_fee_bps / 10000)
yield_net    = yield_amount - fee_amount
tracked_assets += yield_net
visible_assets += vested portion of yield_net over the vesting period
fees_collected += fee_amount
```

Default `perf_fee_bps` = 1000 (10%).

### Errors

| Error | Condition |
|---|---|
| `ZeroAmount` | `yield_amount ≤ 0` |
| `NotInitialized` | Vault not yet initialized |
| `VaultPaused` | Vault is paused |
| `ZeroShares` | `total_shares == 0` (no depositors yet) |
| `BalanceMismatch` | Flash loan guard triggered |
| `MathOverflow` | Arithmetic overflow |

The admin can change the duration with `set_yield_vesting_period`; a zero
duration is rejected. `get_yield_vesting_period` returns the current value.

### Events emitted

```
topics: ("harvest", caller: Address, yield_amount: i128)
data:   (yield_net: i128, fee_amount: i128, new_total_assets: i128)
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source keeper-keypair \
  --network testnet \
  -- harvest \
  --caller GKEEPER_ADDRESS \
  --yield_amount 10000000
```

---

## 6. harvest_token

Permissionless keeper entry point for whitelisted alternative yield tokens. The keeper provides an alt-token yield amount and the vault's admin-provided equivalent value in the underlying token. Requires caller authorization.

### Signature

```rust
fn harvest_token(
    env: Env,
    caller: Address,
    alt_token: Address,
    yield_amount: i128,
    underlying_amount: i128,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Keeper account; must authorize |
| `alt_token` | `Address` | Address of the alternative yield token (must be whitelisted via `register_yield_token`) |
| `yield_amount` | `i128` | Amount of the alt token to transfer from caller to vault, in that token's stroops |
| `underlying_amount` | `i128` | Equivalent value in underlying token stroops; used for exchange rate calculation |

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `ZeroAmount` | Either `yield_amount ≤ 0` or `underlying_amount ≤ 0` |
| `NotInitialized` | Vault not yet initialized |
| `VaultPaused` | Vault is paused |
| `ZeroShares` | `total_shares == 0` |
| `InvalidAddress` | `alt_token` is not whitelisted |
| `BalanceMismatch` | Flash loan guard on underlying token triggered |
| `MathOverflow` | Arithmetic overflow |

### Events emitted

```
topics: ("harvest_token", caller: Address, alt_token: Address)
data:   (yield_amount: i128, net_underlying: i128, fee_amount: i128)
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source keeper-keypair \
  --network testnet \
  -- harvest_token \
  --caller GKEEPER_ADDRESS \
  --alt_token GALT_TOKEN_ADDRESS \
  --yield_amount 5000000 \
  --underlying_amount 4800000
```

---

## 7. register_yield_token

Admin-only. Whitelist an alternative yield token so it can be used with `harvest_token`. Requires admin authorization.

### Signature

```rust
fn register_yield_token(
    env: Env,
    alt_token: Address,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `alt_token` | `Address` | Token contract address to whitelist |

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | Caller is not the stored admin |

### Events emitted

```
topics: ("yield_token_registered",)
data:   (alt_token: Address,)
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- register_yield_token \
  --alt_token GALT_TOKEN_ADDRESS
```

---

## 8. pause

Admin-only emergency control. Blocks all mutating operations (`deposit`, `withdraw`, `harvest`). Requires admin authorization.

### Signature

```rust
fn pause(
    env: Env,
    admin: Address,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match the stored admin address; must authorize this transaction |

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | `admin` does not match stored admin |

### Events emitted

```
topics: ("paused",)
data:   ()
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- pause \
  --admin GADMIN_ADDRESS
```

---

## 9. unpause

Admin-only. Resumes operations after a pause. Requires admin authorization.

### Signature

```rust
fn unpause(
    env: Env,
    admin: Address,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match the stored admin address; must authorize this transaction |

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | `admin` does not match stored admin |

### Events emitted

```
topics: ("unpaused",)
data:   ()
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- unpause \
  --admin GADMIN_ADDRESS
```

---

## 10. is_paused

Read-only. Returns the current pause state.

### Signature

```rust
fn is_paused(env: Env) -> bool
```

### Returns

`true` if the vault is currently paused, `false` otherwise.

### Errors

None. This is a pure read-only call.

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- is_paused
```

---

## 11. set_fees

Admin-only. Update the performance fee and management fee rates. Requires admin authorization.

### Signature

```rust
fn set_fees(
    env: Env,
    admin: Address,
    perf_fee_bps: u32,
    mgmt_fee_bps: u32,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match the stored admin address; must authorize |
| `perf_fee_bps` | `u32` | Performance fee in basis points. Default: 1000 (= 10%). Applied to each harvest. |
| `mgmt_fee_bps` | `u32` | Management fee in basis points. Default: 0. Reserved for future time-based fee logic. |

**Basis points:** 100 bps = 1%. Valid range is 0–10000 (0%–100%). Setting above 10000 will result in fee amounts exceeding yield, which is invalid — ensure sensible values.

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | `admin` does not match stored admin |

### Example

```bash
# Set performance fee to 5% (500 bps), management fee to 0
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- set_fees \
  --admin GADMIN_ADDRESS \
  --perf_fee_bps 500 \
  --mgmt_fee_bps 0
```

---

## 12. set_treasury

Admin-only. Set the treasury address where fees are transferred when `withdraw_fees` is called. Requires admin authorization.

### Signature

```rust
fn set_treasury(
    env: Env,
    admin: Address,
    treasury: Address,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match the stored admin address; must authorize |
| `treasury` | `Address` | The Stellar address that will receive accumulated fees |

### Returns

`Ok(())` on success.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | `admin` does not match stored admin |

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- set_treasury \
  --admin GADMIN_ADDRESS \
  --treasury GTREASURY_ADDRESS
```

---

## 13. withdraw_fees

Admin-only. Transfer all accumulated fees from the vault to the treasury address. Requires admin authorization.

### Signature

```rust
fn withdraw_fees(
    env: Env,
    admin: Address,
) -> Result<i128, VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match the stored admin address; must authorize |

### Returns

`Ok(fees_transferred)` — the amount of underlying token stroops sent to the treasury. Returns `0` if there are no fees accumulated.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not initialized, or treasury address not set |
| `UpgradeUnauthorized` | `admin` does not match stored admin |

### Events emitted

```
topics: ("fees_withdrawn", admin: Address)
data:   (fees: i128, treasury: Address)
```

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- withdraw_fees \
  --admin GADMIN_ADDRESS
```

---

## 14. total_fees_collected

Read-only. Returns the total accumulated (unwithdrawn) performance fees held in the vault.

### Signature

```rust
fn total_fees_collected(env: Env) -> i128
```

### Returns

Total accumulated fees in underlying token stroops.

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- total_fees_collected
```

---

## 15. total_assets

Read-only. Returns underlying assets used for share pricing: deposits plus vested yield, minus withdrawals. Harvested yield is included linearly over its configured ledger period.

### Signature

```rust
fn total_assets(env: Env) -> i128
```

### Returns

Vested underlying asset value in stroops. Internal tracked token balance can be higher while harvested yield is unvested; mutating calls still compare the actual token balance with that internal tracked balance.

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- total_assets
```

---

## 15.1 Share accounting views

These read-only functions expose the vault's current asset-to-share ratio for
integrators. Calculations round down, matching the vault's deposit and
withdrawal accounting. On an empty vault, `preview_deposit` and
`convert_to_shares` use a 1:1 ratio; a withdrawal preview on an empty vault
returns 0.

### Signatures

```rust
fn preview_deposit(env: Env, assets: i128) -> Result<i128, VaultError>
fn preview_withdraw(env: Env, shares: i128) -> Result<i128, VaultError>
fn convert_to_shares(env: Env, assets: i128) -> Result<i128, VaultError>
fn convert_to_assets(env: Env, shares: i128) -> Result<i128, VaultError>
fn max_deposit(env: Env, caller: Address) -> i128
fn max_withdraw(env: Env, caller: Address) -> Result<i128, VaultError>
```

`preview_deposit` and `convert_to_shares` return the shares represented by an
asset amount. `preview_withdraw` and `convert_to_assets` return the underlying
asset value of a share amount. Negative amounts return `ZeroAmount`; checked
arithmetic failures return `MathOverflow`. Conversion functions use the same
current accounting ratio as their corresponding previews.

`max_deposit` reports the largest deposit accepted for the supplied caller,
accounting for the TVL cap, minimum deposit, deposit whitelist, and pause
status. A TVL cap of 0 means there is no configured cap. It returns 0 when the
caller cannot deposit or the vault is paused. `max_withdraw` returns the
underlying asset value of the caller's shares, or 0 when the vault is
uninitialized, paused, or the caller has no shares.

These functions are read-only and do not require authorization.

### Examples

```bash
stellar contract invoke --id CONTRACT_ID --network testnet -- preview_deposit --assets 10000000
stellar contract invoke --id CONTRACT_ID --network testnet -- convert_to_assets --shares 10000000
stellar contract invoke --id CONTRACT_ID --network testnet -- max_deposit --caller GDEPOSITOR_ADDRESS
stellar contract invoke --id CONTRACT_ID --network testnet -- max_withdraw --caller GDEPOSITOR_ADDRESS
```

---

## 16. balance_of

Read-only. Returns the vault share balance for a specific address.

### Signature

```rust
fn balance_of(env: Env, address: Address) -> i128
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `address` | `Address` | The account to query |

### Returns

Number of vault shares held by `address`. Returns 0 if no balance exists.

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- balance_of \
  --address GDEPOSITOR_ADDRESS
```

---

## 16.1 decimals

Read-only. Returns the number of decimal places used by vault shares (e.g. 7 for Stellar standard). Set during `initialize` and immutable thereafter.

### Signature

```rust
fn decimals(env: Env) -> u32
```

### Returns

Vault share precision as `u32` (e.g. `7`).

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- decimals
```

---

## 17. upgrade

Admin-only. Upgrade the contract's Wasm bytecode to a new version. Requires admin authorization. Fails if the on-chain storage layout version does not match `CURRENT_LAYOUT_VERSION`.

### Signature

```rust
fn upgrade(
    env: Env,
    new_wasm_hash: BytesN<32>,
) -> Result<(), VaultError>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `new_wasm_hash` | `BytesN<32>` | The 32-byte hash of the new Wasm binary, obtained from `stellar contract upload` |

### Returns

`Ok(())` on success. The contract version counter is incremented.

### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | Caller is not the stored admin |
| `StorageLayoutMismatch` | On-chain `layout_version` does not equal `CURRENT_LAYOUT_VERSION` (1) |

### Events emitted

```
topics: ("upgrade", admin: Address)
data:   (old_version: u32, new_version: u32)
```

### Example

```bash
# 1. Upload new Wasm
NEW_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source admin-keypair \
  --network testnet)

# 2. Invoke upgrade
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- upgrade \
  --new_wasm_hash "$NEW_HASH"
```

---

## 18. Governance Functions

Aura Vault uses a multi-sig governance model. Changes to critical parameters (admin address, underlying token, vault parameters) require:

- A proposal created by a governance **signer**.
- **3-of-N approvals** from the signer set (`REQUIRED_SIGNATURES = 3`).
- A **24-hour timelock** (`TIMELOCK_DURATION = 86400 seconds`) after approval before execution.

### 18.1 propose_update_admin

Propose changing the vault admin. Proposer must be a governance signer.

#### Signature

```rust
fn propose_update_admin(
    env: Env,
    proposer: Address,
    new_admin: Address,
) -> Result<u64, VaultError>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `proposer` | `Address` | Must be in the governance signer list; must authorize |
| `new_admin` | `Address` | The proposed new admin address |

#### Returns

`Ok(proposal_id)` — the numeric ID of the created proposal.

#### Errors

| Error | Condition |
|---|---|
| `InvalidAddress` | `proposer` is not in the signer list |

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source signer1-keypair \
  --network testnet \
  -- propose_update_admin \
  --proposer GSIGNER1_ADDRESS \
  --new_admin GNEW_ADMIN_ADDRESS
```

---

### 18.2 propose_update_token

Propose changing the underlying token. Proposer must be a governance signer.

#### Signature

```rust
fn propose_update_token(
    env: Env,
    proposer: Address,
    new_token: Address,
) -> Result<u64, VaultError>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `proposer` | `Address` | Must be in the governance signer list; must authorize |
| `new_token` | `Address` | The proposed new underlying token contract address |

#### Returns

`Ok(proposal_id)`

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source signer1-keypair \
  --network testnet \
  -- propose_update_token \
  --proposer GSIGNER1_ADDRESS \
  --new_token GNEW_TOKEN_ADDRESS
```

---

### 18.3 propose_parameter_update

Propose updating a named vault parameter. Proposer must be a governance signer.

#### Signature

```rust
fn propose_parameter_update(
    env: Env,
    proposer: Address,
    name: Symbol,
    value: i128,
) -> Result<u64, VaultError>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `proposer` | `Address` | Must be in the governance signer list; must authorize |
| `name` | `Symbol` | Name of the parameter to update (e.g., `"perf_fee_bps"`) |
| `value` | `i128` | Proposed new value for the parameter |

#### Returns

`Ok(proposal_id)`

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source signer1-keypair \
  --network testnet \
  -- propose_parameter_update \
  --proposer GSIGNER1_ADDRESS \
  --name perf_fee_bps \
  --value 500
```

---

### 18.4 vote

Cast a vote on a pending proposal. Voter must be a governance signer and must not have already voted on this proposal.

#### Signature

```rust
fn vote(
    env: Env,
    voter: Address,
    proposal_id: u64,
    approve: bool,
) -> Result<(), VaultError>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `voter` | `Address` | Must be in the governance signer list; must authorize |
| `proposal_id` | `u64` | ID of the proposal to vote on |
| `approve` | `bool` | `true` to vote in favor, `false` to vote against |

#### Returns

`Ok(())`. If the proposal accumulates ≥ 3 approvals, its status changes to `Approved`.

#### Errors

| Error | Condition |
|---|---|
| `InvalidAddress` | Voter is not a signer, or has already voted |
| `NotInitialized` | Proposal ID does not exist |

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source signer2-keypair \
  --network testnet \
  -- vote \
  --voter GSIGNER2_ADDRESS \
  --proposal_id 1 \
  --approve true
```

---

### 18.5 execute

Execute an approved proposal after the timelock has expired. Any account can call execute (it is permissionless once the proposal is approved and the timelock passed).

#### Signature

```rust
fn execute(
    env: Env,
    executor: Address,
    proposal_id: u64,
) -> Result<(), VaultError>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `executor` | `Address` | The account executing the proposal; must authorize |
| `proposal_id` | `u64` | ID of the approved proposal to execute |

#### Returns

`Ok(())`. Proposal status changes to `Executed`.

#### Errors

| Error | Condition |
|---|---|
| `InvalidAddress` | Proposal is not in `Approved` state, or timelock has not expired |
| `NotInitialized` | Proposal ID does not exist |

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source executor-keypair \
  --network testnet \
  -- execute \
  --executor GEXECUTOR_ADDRESS \
  --proposal_id 1
```

---

### 18.6 proposal_status

Read-only. Returns the current status of a proposal as a human-readable string.

#### Signature

```rust
fn proposal_status(env: Env, proposal_id: u64) -> Option<String>
```

#### Returns

One of: `"Pending"`, `"Approved"`, `"Executed"`, `"Rejected"`. Returns `None` if the proposal ID does not exist.

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- proposal_status \
  --proposal_id 1
```

---

## 19. Events Reference

The following table lists all events emitted by the contract with their topics and data payloads.

| Event name | Emitted by | Topics | Data |
|---|---|---|---|
| `deposit` | `deposit` | `("deposit", caller, amount)` | `(new_shares, new_total_shares, new_total_deposited)` |
| `withdraw` | `withdraw` | `("withdraw", caller, shares)` | `(redeem_amount, new_total_shares, new_total_deposited)` |
| `harvest` | `harvest` | `("harvest", caller, yield_amount)` | `(yield_net, fee_amount, new_total_assets)` |
| `harvest_token` | `harvest_token` | `("harvest_token", caller, alt_token)` | `(yield_amount, net_underlying, fee_amount)` |
| `yield_token_registered` | `register_yield_token` | `("yield_token_registered",)` | `(alt_token,)` |
| `paused` | `pause` | `("paused",)` | `()` |
| `unpaused` | `unpause` | `("unpaused",)` | `()` |
| `fees_withdrawn` | `withdraw_fees` | `("fees_withdrawn", admin)` | `(fees, treasury)` |
| `upgrade` | `upgrade` | `("upgrade", admin)` | `(old_version, new_version)` |
| `suspicious` | `deposit`/`withdraw`/`harvest` | `("suspicious",)` | `("balance_mismatch", actual_balance, tracked_deposited)` |

Topics are indexed on-chain for efficient filtering by event name, caller, or amount. Data fields are contextual payloads included in the event body.

---

## 20. Storage Layout

| Key | Storage type | Type | Description |
|---|---|---|---|
| `Admin` | Instance | `Address` | Vault admin |
| `UnderlyingToken` | Instance | `Address` | Underlying token contract |
| `TotalShares` | Instance | `i128` | Outstanding shares |
| `TotalDeposited` | Instance | `i128` | Net tracked underlying tokens |
| `Version` | Instance | `u32` | Contract version counter (incremented on upgrade) |
| `LayoutVersion` | Instance | `u32` | Storage layout version (must equal `CURRENT_LAYOUT_VERSION = 1`) |
| `Paused` | Instance | `bool` | Emergency pause flag |
| `Treasury` | Instance | `Address` | Fee destination |
| `PerfFeeBps` | Instance | `u32` | Performance fee rate (default: 1000) |
| `MgmtFeeBps` | Instance | `u32` | Management fee rate (default: 0) |
| `TotalFeeCollected` | Instance | `i128` | Accumulated unwithdrawn fees |
| `LastMgmtFeeTime` | Instance | `u64` | Last management fee timestamp (reserved) |
| `YieldToken(addr)` | Instance | `bool` | Yield token whitelist |
| `Balance(addr)` | Persistent | `i128` | Per-user share balance |
| `Decimals` | Instance | `u32` | Number of decimal places used by vault shares (immutable; default: 7) |
| `ReentrancyGuard` | Instance | `bool` | Transient lock preventing reentrant contract calls (cleared on exit) |

**TTL constants:**  
- Instance and persistent storage: 30-day bump amount (517,200 ledgers), 7-day threshold (120,960 ledgers).
- Every mutating call bumps the instance TTL. `deposit` and `withdraw` also bump the caller's persistent balance entry.

---

## 21. Reentrancy Protection (Defence-in-Depth)

Although Soroban's single-invocation execution model provides strong baseline protection against classical EVM reentrancy, AuraVault implements an explicit reentrancy lock on all state-mutating functions for **defence-in-depth**:

1. On entry, `DataKey::ReentrancyGuard` is checked; if `true`, call reverts with `VaultError::Reentrancy` (code 30).
2. `DataKey::ReentrancyGuard` is set to `true`.
3. The function body executes.
4. On exit (including error paths), `DataKey::ReentrancyGuard` is reset to `false`.

### Gas Overhead
The reentrancy guard adds approximately:
- **~1,850 CPU instructions** per mutating call (1 storage read + 2 instance storage writes).
- Negligible ledger footprint since `ReentrancyGuard` is stored in the already-accessed instance storage map.

---

*Issues: [#345](https://github.com/soterika/aura-vault-protocol/issues/345), [#347](https://github.com/soterika/aura-vault-protocol/issues/347), [#385](https://github.com/soterika/aura-vault-protocol/issues/385)*

## 21. Additional Public Methods and ABI Status

The current Rust contract exports the following methods in addition to the
core methods above. `aura-vault/src/lib.rs` is the ABI source of truth.

| Signature | Return type | Purpose / principal failure condition |
|---|---|---|
| `set_withdrawal_queue_threshold(Env, Address, i128)` | `Result<(), VaultError>` | Admin configures the minimum queued withdrawal amount. |
| `set_withdrawal_unbonding_secs(Env, Address, u64)` | `Result<(), VaultError>` | Admin configures queue unbonding duration. |
| `set_withdrawal_fee(Env, Address, u32)` | `Result<(), VaultError>` | Admin sets fee bps; values above 500 fail. |
| `get_withdrawal_queue_threshold(Env)` / `get_withdrawal_unbonding_secs(Env)` / `get_withdrawal_fee_bps(Env)` | `i128` / `u64` / `u32` | Read withdrawal queue and fee configuration. |
| `claim_queued_withdrawal(Env, Address, u64)` | `Result<i128, VaultError>` | Claim a mature queued withdrawal; fails if missing or still unbonding. |
| `get_withdrawal_entry(Env, u64)` | `Option<WithdrawalEntry>` | Read a queued withdrawal entry. |
| `register_yield_token(Env, Address)` | `Result<(), VaultError>` | Admin registers an alternative yield token. |
| `distribute_yield(Env, Address, i128)` / `collect_yield(Env, Address, i128)` | `Result<(), VaultError>` | Distribute underlying yield; `collect_yield` is an alias. |
| `distribute_yield_token(Env, Address, Address, i128, i128)` | `Result<(), VaultError>` | Distribute a whitelisted alternative token against an underlying value. |
| `preview_distribution(Env, i128)` | `Result<(i128, i128, i128, bool), VaultError>` | Preview net yield, fee, per-share increment, and representability. |
| `collect_pending_yield(Env, Address)` / `pending_yield(Env, Address)` | `Result<i128, VaultError>` / `i128` | Collect or read a user's accrued yield. |
| `distribution_epoch(Env)` | `u64` | Read the distribution counter. |
| `pending_admin(Env)` / `propose_admin(Env, Address, Address)` / `accept_admin(Env, Address)` / `cancel_admin(Env, Address)` | `Option<Address>` / `Result<(), VaultError>` | Inspect and execute two-step admin transfer. |
| `get_roles(Env, Address)` / `has_role_query(Env, Address, u32)` | `u32` / `bool` | Read an address's roles. |
| `grant_role(Env, Address, u32, Address)` / `revoke_role(Env, Address, u32, Address)` | `Result<(), VaultError>` | Admin changes an address's role mask. |
| `set_tvl_cap(Env, Address, i128)` / `get_tvl_cap(Env)` | `Result<(), VaultError>` / `i128` | Configure/read the TVL cap; zero disables the cap. |
| `set_harvest_cooldown(Env, Address, u64)` / `reset_harvest_cooldown(Env, Address)` / `last_harvest_time(Env)` | `Result<(), VaultError>` / `u64` | Configure and inspect harvest cooldown state. |
| `set_yield_vesting_period(Env, Address, u32)` / `get_yield_vesting_period(Env)` | `Result<(), VaultError>` / `u32` | Configure/read linear yield vesting in ledgers; default is 120,960 (seven days). |
| `set_price_movement_limit(Env, Address, u32)` / `get_price_movement_limit(Env)` | `Result<(), VaultError>` / `u32` | Configure/read the share-price circuit breaker. |
| `enable_whitelist(Env, Address)` / `disable_whitelist(Env, Address)` | `Result<(), VaultError>` | Toggle whitelist-only deposits. |
| `add_to_whitelist(Env, Address, Address)` / `remove_from_whitelist(Env, Address, Address)` / `is_whitelisted(Env, Address)` | `Result<(), VaultError>` / `bool` | Manage and read depositor whitelist status. |
| `set_min_deposit(Env, Address, i128)` / `min_deposit(Env)` | `Result<(), VaultError>` / `i128` | Configure/read the minimum deposit. |
| `name(Env)` / `symbol(Env)` / `version(Env)` / `decimals(Env)` | `Option<String>` / `u32` | Read share metadata and contract version. |
| `get_vault_error_message(Env, u32)` | `Option<String>` | Return a human-readable message for a known error code. |

### Requested names absent from the current Soroban ABI

The Rust contract does **not** currently export `set_fee_bps`,
`set_withdrawal_fee_bps`, share `transfer`/`approve`/`transfer_from`/
`allowance`, `set_deposit_cap`/`get_deposit_cap`, keeper-statistics methods,
`deposit_with_swap`, or `set_dex_router`. The available methods are
`set_fees`, `set_withdrawal_fee`, `set_tvl_cap`/`get_tvl_cap`, and the yield
token methods listed above. Planned Solidity APIs must not be treated as part
of the Soroban ABI.

`harvest` and `harvest_token` retain tracked accounting for the balance invariant while
`total_assets` exposes only vested yield. The vault vests each harvest linearly
over the configured ledger period. A later harvest restarts the remaining
unvested balance together with the new yield, so integrations should expect a
more conservative vesting schedule after frequent harvests. Deposits and
withdrawals price shares using the vested asset value. The separate
[`yield-smoothing.md`](./yield-smoothing.md) document describes a Solidity
design and is not the Soroban ABI specification.

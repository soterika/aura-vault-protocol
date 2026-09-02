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

Permissionless keeper entry point. Injects yield (underlying token) into the vault, increasing the exchange rate for all shareholders. A performance fee is deducted before crediting `total_assets`. Requires caller authorization.

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
total_assets += yield_net
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

Read-only. Returns the total amount of underlying tokens currently tracked by the vault (net of fees, including accrued yield).

### Signature

```rust
fn total_assets(env: Env) -> i128
```

### Returns

Total underlying token stroops held and tracked by the vault.

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- total_assets
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

**TTL constants:**  
- Instance and persistent storage: 30-day bump amount (517,200 ledgers), 7-day threshold (120,960 ledgers).
- Every mutating call bumps the instance TTL. `deposit` and `withdraw` also bump the caller's persistent balance entry.

---

*Issues: [#385](https://github.com/soterika/aura-vault-protocol/issues/385)*

---

## 21. total_supply _(Issue #346)_

Returns the total outstanding vault shares. Satisfies the SEP-41 token interface `total_supply()` requirement.

### Signature

```rust
fn total_supply(env: Env) -> i128
```

### Returns

The total number of shares currently outstanding (`DataKey::TotalShares`). Equals the sum of all `balance_of(addr)` values across active depositors. Always matches `total_shares()`.

### Notes

- Read-only; no authorization required.
- Returns `0` before any deposits have been made.

### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- total_supply
```

---

## 22. AuraPriceOracle Integration _(Issue #348)_

The vault can be configured with an external AuraPriceOracle contract to provide USD-denominated values of vault assets. The oracle must expose a `price(token) -> (i128, u64)` entry point returning `(price_in_micro_usd, updated_at_timestamp)`.

**Price precision:** prices are in micro-USD with 6 decimal places. `1_000_000` = $1.00.

### 22.1 set_oracle_address

Admin-only. Stores the oracle contract address. Emits `oracle_set` event.

```rust
fn set_oracle_address(env: Env, admin: Address, oracle: Address) -> Result<(), VaultError>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match stored admin and authorize the call |
| `oracle` | `Address` | AuraPriceOracle contract address |

#### Errors

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized |
| `UpgradeUnauthorized` | Caller is not the admin |

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin-keypair \
  --network testnet \
  -- set_oracle_address \
  --admin GADMIN_ADDRESS \
  --oracle GORACLE_ADDRESS
```

---

### 22.2 set_oracle_max_age

Admin-only. Sets the maximum age (in seconds) for an oracle price to be considered fresh. Prices older than this are treated as stale and trigger the `OracleUnavailable` fallback.

```rust
fn set_oracle_max_age(env: Env, admin: Address, max_age_secs: u64) -> Result<(), VaultError>
```

| Parameter | Default | Description |
|---|---|---|
| `max_age_secs` | `3600` | Maximum price age in seconds (1 hour default) |

---

### 22.3 get_oracle_address

Read-only. Returns the configured oracle address, or `None` if not set.

```rust
fn get_oracle_address(env: Env) -> Option<Address>
```

---

### 22.4 total_assets_usd

Read-only. Returns the total vault assets expressed in **micro-USD** (6 decimal places, `1_000_000 = $1.00`).

```rust
fn total_assets_usd(env: Env) -> i128
```

#### Computation

```
price_usd  = oracle.price(underlying_token)   // micro-USD per underlying unit
total_usd  = floor(total_assets × price_usd / 1_000_000)
```

#### Graceful fallback

If any of the following conditions are true, the function returns `0` and emits an `oracle_unavailable` event — it **never reverts**:

- No oracle address configured
- Oracle cross-contract call fails
- Oracle returns a zero or sanity-cap-exceeding price (`OraclePriceZero`, `OraclePriceTooHigh`)
- Oracle price timestamp is older than `oracle_max_age_secs` (`OraclePriceStale`)

#### Events emitted on fallback

```
topics: ("oracle_unavailable",)
data:   ("not_configured" | "call_failed" | "invalid_price", ...)
```

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- total_assets_usd
# Returns: 50000000000  (= $50,000.00 with 6 decimal places)
```

---

## 23. Harvest Cooldown _(Issue #351)_

The vault enforces a configurable minimum time between harvests. These functions were added to satisfy the full Issue #351 acceptance criteria.

### 23.1 next_harvest_allowed_at

Read-only convenience function. Returns the earliest ledger timestamp at which the next harvest call will succeed.

```rust
fn next_harvest_allowed_at(env: Env) -> u64
```

#### Return values

| Condition | Returns |
|---|---|
| No cooldown configured (`cooldown_secs == 0`) | `0` (harvest always allowed) |
| No harvest has occurred yet (`last_harvest_time == 0`) | `0` (first harvest always allowed) |
| Inside cooldown window | `last_harvest_time + cooldown_secs` |
| Cooldown window already elapsed | `0` (harvest allowed now) |

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- next_harvest_allowed_at
# Returns 0 if harvest is allowed, or a future timestamp if still cooling down.
```

See also: [`set_harvest_cooldown`](#set_harvest_cooldown), [`last_harvest_time`](#last_harvest_time), [`reset_harvest_cooldown`](#reset_harvest_cooldown).

---

## 24. Price Snapshots _(Issue #352)_

After every successful harvest, the vault stores a share-price snapshot at the harvest timestamp. Snapshots are retained for **90 days** via Soroban's TTL-based archival and are used by the backend indexer to compute APY charts.

**Share price formula stored:**

```
snapshot_price = floor(total_assets × 1_000_000 / total_shares)
```

The value is an integer scaled by `1_000_000` — multiply by the oracle USD price and divide by `1_000_000` to get the USD value per share.

### 24.1 get_price_snapshot

Read-only. Returns the share-price snapshot for a specific harvest timestamp, or `None` if no snapshot exists.

```rust
fn get_price_snapshot(env: Env, timestamp: u64) -> Option<i128>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `timestamp` | `u64` | Ledger timestamp of a past harvest (from a `harvest` event) |

#### Returns

`Some(share_price)` where `share_price` is scaled ×1 000 000, or `None` if the snapshot does not exist or its 90-day TTL has expired.

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- get_price_snapshot \
  --timestamp 1751500000
# Returns: 1050000  (= 1.05 underlying tokens per share)
```

---

### 24.2 list_price_snapshots

Read-only. Returns share-price snapshots for a supplied list of timestamps filtered to the `[from, to]` range.

```rust
fn list_price_snapshots(
    env: Env,
    timestamps: Vec<u64>,
    from: u64,
    to: u64,
) -> Vec<(u64, i128)>
```

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `timestamps` | `Vec<u64>` | List of harvest timestamps to query (from indexer/events) |
| `from` | `u64` | Start of range (inclusive) |
| `to` | `u64` | End of range (inclusive) |

#### Returns

`Vec<(timestamp, share_price)>` — one entry per timestamp that is (a) within `[from, to]` and (b) has a live snapshot in storage. Entries are returned in the order they appear in `timestamps`. Timestamps outside the range or without a stored snapshot are silently omitted.

#### Notes

- Soroban persistent storage does not support range iteration. Callers must supply the timestamps they want to query, typically from backend indexer records of past `harvest` events.
- The backend APY chart service reads harvest events to build the timestamp list and calls this function to retrieve share prices.

#### Example

```bash
stellar contract invoke \
  --id CONTRACT_ID \
  --network testnet \
  -- list_price_snapshots \
  --timestamps '[1751400000, 1751490000, 1751580000]' \
  --from 1751400000 \
  --to 1751580000
# Returns: [(1751400000, 1020000), (1751490000, 1035000), (1751580000, 1051000)]
```

#### Events

Snapshots are stored silently — no event is emitted for snapshot writes. They are derived from the `harvest` event's timestamp.

---

## Updated Storage Layout

The following keys were added as part of Issues #346, #348, #351, #352:

| Key | Storage type | Type | Description |
|---|---|---|---|
| `OracleAddress` | Instance | `Address` | AuraPriceOracle contract address (Issue #348) |
| `OracleMaxAge` | Instance | `u64` | Max oracle price age in seconds; default 3600 (Issue #348) |
| `PriceSnapshot(u64)` | Persistent | `i128` | Share price at each harvest timestamp; 90-day TTL (Issue #352) |

**PriceSnapshot TTL:** 90-day bump amount (`17280 * 90` ledgers), 7-day threshold.

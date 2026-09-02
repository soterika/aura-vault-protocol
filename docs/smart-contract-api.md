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

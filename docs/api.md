# AuraVault Smart Contract API

AuraVault is a share-based yield vault on Soroban (Stellar). Depositors receive vault shares proportional to their contribution; permissionless keepers auto-compound yield; a multisig governance layer controls sensitive parameter changes.

---

## Table of Contents

- [Core Vault](#core-vault)
  - [initialize](#initialize)
  - [deposit](#deposit)
  - [withdraw](#withdraw)
  - [harvest](#harvest)
  - [harvest_token](#harvest_token)
- [View Functions](#view-functions)
  - [total_assets](#total_assets)
  - [balance_of](#balance_of)
  - [is_paused](#is_paused)
  - [total_fees_collected](#total_fees_collected)
  - [proposal_status](#proposal_status)
- [Admin: Emergency Controls](#admin-emergency-controls)
  - [pause](#pause)
  - [unpause](#unpause)
- [Admin: Fee Management](#admin-fee-management)
  - [set_fees](#set_fees)
  - [set_treasury](#set_treasury)
  - [withdraw_fees](#withdraw_fees)
- [Admin: Yield Token Registry](#admin-yield-token-registry)
  - [register_yield_token](#register_yield_token)
- [Admin: Upgrade](#upgrade)
- [Governance](#governance)
  - [propose_update_admin](#propose_update_admin)
  - [propose_update_token](#propose_update_token)
  - [propose_parameter_update](#propose_parameter_update)
  - [vote](#vote)
  - [execute](#execute)
- [Events](#events)
- [Error Codes](#error-codes)

---

## Core Vault

### initialize

One-time setup. Stores the admin, the underlying SEP-41 token, and the governance signer set. Reverts if called a second time.

```
fn initialize(
    admin: Address,
    underlying_token: Address,
    signers: Vec<Address>,
) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Account that controls pause, fees, upgrade, and treasury |
| `underlying_token` | `Address` | SEP-41 token contract accepted as deposits |
| `signers` | `Vec<Address>` | Addresses eligible to create and vote on governance proposals |

**Errors:** `AlreadyInitialized`

**Example (Stellar CLI)**

```bash
stellar contract invoke --id $CONTRACT_ID --source $ADMIN_KEY --network testnet \
  -- initialize \
  --admin $ADMIN_ADDR \
  --underlying_token $TOKEN_ADDR \
  --signers '["GABC...","GDEF...","GHIJ..."]'
```

---

### deposit

Transfer underlying tokens into the vault and receive vault shares. The share amount is computed as:

- First deposit (or when vault is empty): `shares = amount` (1:1 seed ratio)
- Subsequent deposits: `shares = floor(amount × total_shares / total_assets)`

Caller must have previously approved the vault to spend `amount` tokens.

```
fn deposit(
    caller: Address,
    amount: i128,
) -> Result<i128, VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Depositor; must authorize this call |
| `amount` | `i128` | Token amount to deposit (must be > 0) |

**Returns:** `i128` — number of vault shares minted.

**Errors:** `ZeroAmount`, `NotInitialized`, `VaultPaused`, `BalanceMismatch`, `MathOverflow`

**Emits:** [`deposit`](#deposit-event) event

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --source $USER_KEY --network testnet \
  -- deposit \
  --caller $USER_ADDR \
  --amount 1000000
```

---

### withdraw

Burn vault shares and redeem the proportional amount of underlying tokens, including any accrued yield.

```
redeem_amount = floor(shares × total_assets / total_shares)
```

```
fn withdraw(
    caller: Address,
    shares: i128,
) -> Result<i128, VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Share holder; must authorize this call |
| `shares` | `i128` | Number of shares to burn (must be > 0 and ≤ caller's balance) |

**Returns:** `i128` — underlying token amount sent to caller.

**Errors:** `ZeroAmount`, `NotInitialized`, `VaultPaused`, `BalanceMismatch`, `InsufficientShares`, `InsufficientUnderlying`, `MathOverflow`

**Emits:** [`withdraw`](#withdraw-event) event

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --source $USER_KEY --network testnet \
  -- withdraw \
  --caller $USER_ADDR \
  --shares 500000
```

---

### harvest

Permissionless keeper entry point. Injects yield denominated in the vault's underlying token. No new shares are minted, so the exchange rate increases for all existing shareholders. A performance fee (default 10%) is deducted before crediting the vault.

```
fn harvest(
    caller: Address,
    yield_amount: i128,
) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Keeper injecting yield; must authorize and hold `yield_amount` tokens |
| `yield_amount` | `i128` | Gross yield to inject (must be > 0) |

**Errors:** `ZeroAmount`, `NotInitialized`, `VaultPaused`, `ZeroShares`, `BalanceMismatch`, `MathOverflow`

**Emits:** [`harvest`](#harvest-event) event

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --source $KEEPER_KEY --network testnet \
  -- harvest \
  --caller $KEEPER_ADDR \
  --yield_amount 50000
```

---

### harvest_token

Multi-yield-token entry point for keepers who earn yield in a token different from the vault's underlying asset. The alt token must be whitelisted via [`register_yield_token`](#register_yield_token). The caller provides both the alt-token amount to transfer and the equivalent underlying value to credit to the vault.

```
fn harvest_token(
    caller: Address,
    alt_token: Address,
    yield_amount: i128,
    underlying_amount: i128,
) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Keeper; must authorize and hold `yield_amount` of `alt_token` |
| `alt_token` | `Address` | Whitelisted alternative yield token contract |
| `yield_amount` | `i128` | Amount of alt token to transfer into vault |
| `underlying_amount` | `i128` | Equivalent underlying value to credit (after any off-chain swap pricing) |

**Errors:** `ZeroAmount`, `NotInitialized`, `VaultPaused`, `ZeroShares`, `BalanceMismatch`, `InvalidAddress` (token not whitelisted), `MathOverflow`

**Emits:** [`harvest_token`](#harvest_token-event) event

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --source $KEEPER_KEY --network testnet \
  -- harvest_token \
  --caller $KEEPER_ADDR \
  --alt_token $ALT_TOKEN_ADDR \
  --yield_amount 200000 \
  --underlying_amount 195000
```

---

## View Functions

### total_assets

Returns the total underlying tokens tracked by the vault (sum of all deposits plus harvested yield, minus withdrawals and fee accrual). This is a gas-free read-only call.

```
fn total_assets() -> i128
```

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --network testnet -- total_assets
```

---

### balance_of

Returns the vault share balance for a given address.

```
fn balance_of(address: Address) -> i128
```

| Parameter | Type | Description |
|---|---|---|
| `address` | `Address` | Any address to query |

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --network testnet \
  -- balance_of --address $USER_ADDR
```

---

### is_paused

Returns `true` if the vault is currently paused (deposit, withdraw, and harvest are blocked).

```
fn is_paused() -> bool
```

---

### total_fees_collected

Returns the accumulated performance fees not yet withdrawn to the treasury.

```
fn total_fees_collected() -> i128
```

---

### proposal_status

Returns the status string of a governance proposal, or `None` if the proposal ID does not exist.

```
fn proposal_status(proposal_id: u64) -> Option<String>
```

Possible return values: `"Pending"`, `"Approved"`, `"Executed"`, `"Rejected"`

---

## Admin: Emergency Controls

Both functions require the caller to pass their address explicitly so Soroban can enforce `require_auth`. The address must match the stored admin.

### pause

Halts `deposit`, `withdraw`, and `harvest`. Emits a `paused` event.

```
fn pause(admin: Address) -> Result<(), VaultError>
```

**Errors:** `NotInitialized`, `UpgradeUnauthorized`

**Example**

```bash
stellar contract invoke --id $CONTRACT_ID --source $ADMIN_KEY --network testnet \
  -- pause --admin $ADMIN_ADDR
```

---

### unpause

Resumes normal operations. Emits an `unpaused` event.

```
fn unpause(admin: Address) -> Result<(), VaultError>
```

**Errors:** `NotInitialized`, `UpgradeUnauthorized`

---

## Admin: Fee Management

### set_fees

Set performance and management fee rates in basis points (1 bps = 0.01%).

- Performance fee range: 0–2000 bps (0–20%)
- Management fee range: 0–100 bps (0–1% annually)

```
fn set_fees(
    admin: Address,
    perf_fee_bps: u32,
    mgmt_fee_bps: u32,
) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match stored admin |
| `perf_fee_bps` | `u32` | Performance fee in bps (default: 1000 = 10%) |
| `mgmt_fee_bps` | `u32` | Annual management fee in bps (default: 0) |

**Errors:** `NotInitialized`, `UpgradeUnauthorized`

**Example** — set 5% performance fee, 0.5% management fee:

```bash
stellar contract invoke --id $CONTRACT_ID --source $ADMIN_KEY --network testnet \
  -- set_fees --admin $ADMIN_ADDR --perf_fee_bps 500 --mgmt_fee_bps 50
```

---

### set_treasury

Set the address that receives fees when `withdraw_fees` is called.

```
fn set_treasury(admin: Address, treasury: Address) -> Result<(), VaultError>
```

**Errors:** `NotInitialized`, `UpgradeUnauthorized`

---

### withdraw_fees

Transfer all accumulated fees to the treasury. Returns 0 if no fees have accrued.

```
fn withdraw_fees(admin: Address) -> Result<i128, VaultError>
```

**Returns:** `i128` — amount transferred.

**Errors:** `NotInitialized`, `UpgradeUnauthorized`

**Emits:** [`fees_withdrawn`](#fees_withdrawn-event) event

---

## Admin: Yield Token Registry

### register_yield_token

Whitelist an alternative token that keepers may use with [`harvest_token`](#harvest_token). Emits a `yield_token_registered` event.

```
fn register_yield_token(alt_token: Address) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `alt_token` | `Address` | Token contract to whitelist |

**Auth:** Caller must be the stored admin (implicit auth on `env.current_contract_address()` is enforced internally).

**Errors:** `NotInitialized`

---

## Upgrade

### upgrade

Replace the contract's Wasm bytecode. Verifies the on-chain storage layout version matches the compiled constant before proceeding to prevent data corruption on incompatible upgrades.

```
fn upgrade(new_wasm_hash: BytesN<32>) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `new_wasm_hash` | `BytesN<32>` | Hash of the uploaded Wasm binary |

**Errors:** `NotInitialized`, `StorageLayoutMismatch`

**Emits:** [`upgrade`](#upgrade-event) event

**Example**

```bash
# 1. Upload new Wasm
HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source $ADMIN_KEY --network testnet)

# 2. Execute upgrade
stellar contract invoke --id $CONTRACT_ID --source $ADMIN_KEY --network testnet \
  -- upgrade --new_wasm_hash $HASH
```

---

## Governance

AuraVault uses an on-chain multisig governance system. A proposal requires **3 approving votes** from whitelisted signers and a **24-hour timelock** before it can be executed.

### propose_update_admin

Create a proposal to replace the vault admin. Only whitelisted signers may propose.

```
fn propose_update_admin(
    proposer: Address,
    new_admin: Address,
) -> Result<u64, VaultError>
```

**Returns:** `u64` — the new proposal ID.

**Errors:** `InvalidAddress` (proposer not a signer)

---

### propose_update_token

Create a proposal to replace the underlying token address.

```
fn propose_update_token(
    proposer: Address,
    new_token: Address,
) -> Result<u64, VaultError>
```

**Returns:** `u64` — the new proposal ID.

**Errors:** `InvalidAddress`

---

### propose_parameter_update

Create a proposal to update a named numeric parameter.

```
fn propose_parameter_update(
    proposer: Address,
    name: Symbol,
    value: i128,
) -> Result<u64, VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `proposer` | `Address` | Must be a whitelisted signer |
| `name` | `Symbol` | Parameter name (e.g., `"perf_fee_bps"`) |
| `value` | `i128` | New value |

**Returns:** `u64` — the new proposal ID.

---

### vote

Cast an approve or reject vote on an open proposal. Each signer may vote once per proposal.

```
fn vote(
    voter: Address,
    proposal_id: u64,
    approve: bool,
) -> Result<(), VaultError>
```

| Parameter | Type | Description |
|---|---|---|
| `voter` | `Address` | Must be a whitelisted signer |
| `proposal_id` | `u64` | ID returned by a `propose_*` call |
| `approve` | `bool` | `true` to approve, `false` to reject |

**Errors:** `NotInitialized` (unknown proposal), `InvalidAddress` (not a signer, or already voted)

A proposal moves to `Approved` status automatically once it receives 3 approving votes.

---

### execute

Execute an approved proposal after the 24-hour timelock has elapsed.

```
fn execute(
    executor: Address,
    proposal_id: u64,
) -> Result<(), VaultError>
```

**Errors:** `NotInitialized`, `InvalidAddress` (timelock not expired or proposal not approved)

**Example — full governance flow**

```bash
# Propose
ID=$(stellar contract invoke --id $CONTRACT_ID --source $SIGNER1_KEY --network testnet \
  -- propose_update_admin --proposer $SIGNER1 --new_admin $NEW_ADMIN)

# Three signers vote
stellar contract invoke --id $CONTRACT_ID --source $SIGNER1_KEY --network testnet \
  -- vote --voter $SIGNER1 --proposal_id $ID --approve true
stellar contract invoke --id $CONTRACT_ID --source $SIGNER2_KEY --network testnet \
  -- vote --voter $SIGNER2 --proposal_id $ID --approve true
stellar contract invoke --id $CONTRACT_ID --source $SIGNER3_KEY --network testnet \
  -- vote --voter $SIGNER3 --proposal_id $ID --approve true

# Wait 24 hours, then execute
stellar contract invoke --id $CONTRACT_ID --source $SIGNER1_KEY --network testnet \
  -- execute --executor $SIGNER1 --proposal_id $ID
```

---

## Events

All events are published via `env.events().publish(topics, data)`. Topics are indexed and filterable by Horizon; data is contextual payload.

### deposit event

| Field | Location | Value |
|---|---|---|
| `"deposit"` | topic | Event name |
| `caller` | topic | Depositor address |
| `amount` | topic | Token amount deposited |
| `new_shares` | data | Shares minted to caller |
| `new_total_shares` | data | Vault total shares after deposit |
| `new_total_deposited` | data | Vault total assets after deposit |

### withdraw event

| Field | Location | Value |
|---|---|---|
| `"withdraw"` | topic | Event name |
| `caller` | topic | Withdrawer address |
| `shares` | topic | Shares burned |
| `redeem_amount` | data | Tokens sent to caller |
| `new_total_shares` | data | Vault total shares after withdrawal |
| `new_total_deposited` | data | Vault total assets after withdrawal |

### harvest event

| Field | Location | Value |
|---|---|---|
| `"harvest"` | topic | Event name |
| `caller` | topic | Keeper address |
| `yield_amount` | topic | Gross yield injected |
| `yield_after_fee` | data | Net yield credited to vault |
| `fee_amount` | data | Performance fee deducted |
| `new_total` | data | Vault total assets after harvest |

### harvest_token event

| Field | Location | Value |
|---|---|---|
| `"harvest_token"` | topic | Event name |
| `caller` | topic | Keeper address |
| `alt_token` | topic | Alt token contract address |
| `yield_amount` | data | Alt-token amount transferred |
| `net_underlying` | data | Net underlying value credited |
| `fee_amount` | data | Performance fee deducted |

### paused / unpaused events

Topics: `("paused",)` or `("unpaused",)`. No data payload.

### fees_withdrawn event

| Field | Location | Value |
|---|---|---|
| `"fees_withdrawn"` | topic | Event name |
| `admin` | topic | Admin address |
| `fees` | data | Amount transferred |
| `treasury` | data | Treasury address |

### upgrade event

| Field | Location | Value |
|---|---|---|
| `"upgrade"` | topic | Event name |
| `admin` | topic | Admin address |
| `old_version` | data | Contract version before upgrade |
| `new_version` | data | Contract version after upgrade |

### suspicious event

Emitted when the vault's actual token balance differs from `total_deposited` (flash loan guard). All mutating functions return `BalanceMismatch` immediately after.

| Field | Location | Value |
|---|---|---|
| `"suspicious"` | topic | Event name |
| `"balance_mismatch"` | data | Descriptor |
| `balance_before` | data | Actual on-chain token balance |
| `total_deposited` | data | Tracked state value |

### yield_token_registered event

Topics: `("yield_token_registered",)`. Data: `(alt_token,)`.

---

## Error Codes

| Code | Variant | Trigger |
|---|---|---|
| 1 | `NotInitialized` | Contract not yet initialized, or required storage key missing |
| 2 | `AlreadyInitialized` | `initialize` called more than once |
| 3 | `InsufficientShares` | Withdraw `shares` exceeds caller's balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover redemption amount |
| 5 | `ZeroAmount` | Input ≤ 0, or share mint rounds to zero |
| 6 | `MathOverflow` | Checked arithmetic overflow in share formula |
| 7 | `InvalidAddress` | Token not whitelisted; signer not in governance set; already voted; timelock not elapsed |
| 8 | `ZeroShares` | `harvest` called when `total_shares == 0` |
| 9 | `UpgradeUnauthorized` | Caller is not the stored admin |
| 10 | `StorageLayoutMismatch` | On-chain layout version mismatch on `upgrade` |
| 11 | `VaultPaused` | Mutating operation called while vault is paused |
| 12 | `BalanceMismatch` | Actual token balance ≠ tracked state (flash loan guard triggered) |

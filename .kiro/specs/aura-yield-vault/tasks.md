# Implementation Plan: Aura Yield Vault

## Overview

Scaffold and implement a production-ready, single-crate Soroban smart contract that custodies a SEP-41 token, issues proportional vault shares, and compounds yield through permissionless keeper harvests. Implementation follows the five-module layout defined in the design document (`errors.rs → storage.rs → interface.rs → lib.rs → test.rs`), wiring everything together in `lib.rs` before adding the full test suite.

---

## Tasks

- [x] 1. Bootstrap Cargo workspace and crate skeleton
  - Create `aura-vault/Cargo.toml` as a single-crate manifest with:
    - `[lib] crate-type = ["cdylib", "rlib"]`
    - `[dependencies] soroban-sdk = { version = "22", default-features = true }`
    - `[dev-dependencies] soroban-sdk = { version = "22", features = ["testutils"] }` and `proptest = "1"`
    - `[profile.release] overflow-checks = true` and `opt-level = "z"` and `lto = true` and `codegen-units = 1`
  - Create `aura-vault/src/lib.rs` with:
    - `#![no_std]` at the crate root
    - Stub module declarations: `mod errors; mod storage; mod interface;`
    - `#[cfg(test)] mod test;`
    - An empty `pub struct AuraVault;` annotated `#[contract]`
    - An empty `#[contractimpl] impl AuraVault {}` block
  - Create empty stub files: `src/errors.rs`, `src/storage.rs`, `src/interface.rs`, `src/test.rs`
  - Verify the crate compiles with `cargo build --target wasm32-unknown-unknown --release`
  - _Requirements: 9.1, 9.2, 9.3, 9.6_

- [x] 2. Define the error enum
  - [x] 2.1 Implement `VaultError` in `src/errors.rs`
    - Add `#![allow(unused)]` at the top of the file (errors are re-exported from `lib.rs`)
    - Import `soroban_sdk::contracterror`
    - Define `#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq)] #[repr(u32)] pub enum VaultError` with exactly eight variants and their assigned discriminants:
      - `NotInitialized = 1`
      - `AlreadyInitialized = 2`
      - `InsufficientShares = 3`
      - `InsufficientUnderlying = 4`
      - `ZeroAmount = 5`
      - `MathOverflow = 6`
      - `InvalidAddress = 7`
      - `ZeroShares = 8`
    - Re-export from `lib.rs`: `pub use errors::VaultError;`
    - _Requirements: 8.1, 8.2, 9.4_

- [x] 3. Define storage keys, TTL constants, and storage helpers
  - [x] 3.1 Implement `DataKey` and TTL constants in `src/storage.rs`
    - Import `soroban_sdk::{contracttype, Address, Env}`
    - Define `#[contracttype] pub enum DataKey` with variants:
      - `Admin`
      - `UnderlyingToken`
      - `TotalShares`
      - `TotalDeposited`
      - `Balance(Address)`
    - Define five named constants:
      - `pub const DAY_IN_LEDGERS: u32 = 17_280;`
      - `pub const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;`
      - `pub const INSTANCE_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;`
      - `pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;`
      - `pub const PERSISTENT_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;`
    - _Requirements: 7.5, 11.1, 11.2, 11.6_

  - [x] 3.2 Implement all storage helper functions in `src/storage.rs`
    - Instance-storage get/set pairs (all use `env.storage().instance()`):
      - `get_admin(env: &Env) -> Option<Address>` / `set_admin(env: &Env, admin: &Address)`
      - `get_token(env: &Env) -> Option<Address>` / `set_token(env: &Env, token: &Address)`
      - `get_total_shares(env: &Env) -> i128` / `set_total_shares(env: &Env, val: i128)` (default `0`)
      - `get_total_deposited(env: &Env) -> i128` / `set_total_deposited(env: &Env, val: i128)` (default `0`)
    - Persistent-storage get/set pair:
      - `get_balance(env: &Env, addr: &Address) -> i128` — returns `0_i128` when key absent, no panic
      - `set_balance(env: &Env, addr: &Address, val: i128)`
    - TTL bump helpers:
      - `bump_instance(env: &Env)` — calls `env.storage().instance().extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT)`
      - `bump_persistent(env: &Env, addr: &Address)` — calls `env.storage().persistent().extend_ttl(&DataKey::Balance(addr.clone()), PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT)`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 11.3, 11.4, 11.5_

- [x] 4. Define the public contract trait
  - [x] 4.1 Implement `AuraVaultTrait` in `src/interface.rs`
    - Import `soroban_sdk::{contractspecentry, Address, Env}` and `crate::errors::VaultError`
    - Annotate the trait with `#[contractspecentry]`
    - Declare all six function signatures exactly as specified in the design:
      ```rust
      fn initialize(env: Env, admin: Address, underlying_token: Address) -> Result<(), VaultError>;
      fn deposit(env: Env, amount: i128) -> Result<i128, VaultError>;
      fn withdraw(env: Env, shares: i128) -> Result<i128, VaultError>;
      fn harvest(env: Env, yield_amount: i128) -> Result<(), VaultError>;
      fn total_assets(env: Env) -> i128;
      fn balance_of(env: Env, address: Address) -> i128;
      ```
    - _Requirements: 9.5_

- [x] 5. Implement `initialize`
  - [x] 5.1 Write `AuraVault::initialize` in `src/lib.rs`
    - Add imports at the top of `lib.rs`: `soroban_sdk::{contract, contractimpl, Address, Env, token}`, `crate::{errors::VaultError, storage::*}`
    - Guard: if `storage::get_admin(&env).is_some()` → return `Err(VaultError::AlreadyInitialized)`
    - Write `set_admin`, `set_token`, `set_total_shares(0)`, `set_total_deposited(0)`
    - Call `bump_instance(&env)` at the end
    - Return `Ok(())`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 6. Implement `deposit`
  - [x] 6.1 Write `AuraVault::deposit` in `src/lib.rs`
    - Call `env.current_contract_address()` to obtain the vault address
    - Call `env.invoker()` (or use `Address::require_auth()` pattern via the caller address retrieved from the environment) — use `let caller = env.current_contract_address(); /* caller is obtained via auth */` — specifically, accept `caller: Address` as a parameter and call `caller.require_auth()`
    - Guard `amount == 0` → `Err(VaultError::ZeroAmount)`
    - Guard `get_admin(&env).is_none()` → `Err(VaultError::NotInitialized)`
    - Read `total_shares = get_total_shares(&env)` and `total_deposited = get_total_deposited(&env)`
    - Compute `new_shares`:
      - If `total_shares == 0`: `new_shares = amount` (1:1 seed)
      - Else: `let num = amount.checked_mul(total_shares).ok_or(VaultError::MathOverflow)?; let new_shares = num.checked_div(total_deposited).ok_or(VaultError::MathOverflow)?;`
    - Guard `new_shares == 0` → `Err(VaultError::ZeroAmount)` (inflation-attack fence, Req 2.13)
    - CEI — Interaction first: call `token::Client::new(&env, &get_token(&env).unwrap()).transfer_from(&caller, &env.current_contract_address(), &amount)`
    - Effects: `set_balance(&env, &caller, get_balance(&env, &caller) + new_shares)`
    - `set_total_shares(&env, total_shares + new_shares)`
    - `set_total_deposited(&env, total_deposited + amount)`
    - Bumps: `bump_persistent(&env, &caller); bump_instance(&env);`
    - Return `Ok(new_shares)`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13_

- [x] 7. Implement `withdraw`
  - [x] 7.1 Write `AuraVault::withdraw` in `src/lib.rs`
    - Accept `caller: Address`; call `caller.require_auth()`
    - Guard `shares == 0` → `Err(VaultError::ZeroAmount)`
    - Guard `get_admin(&env).is_none()` → `Err(VaultError::NotInitialized)`
    - Read `user_balance = get_balance(&env, &caller)`
    - Guard `shares > user_balance` → `Err(VaultError::InsufficientShares)`
    - Read `total_shares = get_total_shares(&env)` and `total_deposited = get_total_deposited(&env)`
    - Compute `redeem_amount`: `let num = shares.checked_mul(total_deposited).ok_or(VaultError::MathOverflow)?; let redeem_amount = num.checked_div(total_shares).ok_or(VaultError::MathOverflow)?;`
    - Guard `redeem_amount == 0` → `Err(VaultError::ZeroAmount)` (Req 3.12)
    - Guard `total_deposited < redeem_amount` → `Err(VaultError::InsufficientUnderlying)` (Req 3.11, 8.4)
    - CEI — Effects first (writes before token transfer):
      - `set_balance(&env, &caller, user_balance - shares)`
      - `set_total_shares(&env, total_shares - shares)`
      - `set_total_deposited(&env, total_deposited - redeem_amount)`
    - Interaction: call `token::Client::new(&env, &get_token(&env).unwrap()).transfer(&env.current_contract_address(), &caller, &redeem_amount)`
    - Bumps: `bump_persistent(&env, &caller); bump_instance(&env);`
    - Return `Ok(redeem_amount)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

- [x] 8. Implement `harvest`
  - [x] 8.1 Write `AuraVault::harvest` in `src/lib.rs`
    - Accept `caller: Address`; call `caller.require_auth()`
    - Guard `yield_amount == 0` → `Err(VaultError::ZeroAmount)`
    - Guard `get_admin(&env).is_none()` → `Err(VaultError::NotInitialized)`
    - Read `total_shares = get_total_shares(&env)`
    - Guard `total_shares == 0` → `Err(VaultError::ZeroShares)` (Req 4.9)
    - Read `total_deposited = get_total_deposited(&env)`
    - Overflow guard: `let new_total = total_deposited.checked_add(yield_amount).ok_or(VaultError::MathOverflow)?;`
    - Interaction: call `token::Client::new(&env, &get_token(&env).unwrap()).transfer_from(&caller, &env.current_contract_address(), &yield_amount)`
    - Effect: `set_total_deposited(&env, new_total)`
    - Bump: `bump_instance(&env);`
    - Return `Ok(())`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

- [x] 9. Implement read-only view functions
  - [x] 9.1 Write `AuraVault::total_assets` and `AuraVault::balance_of` in `src/lib.rs`
    - `total_assets`: call `get_total_deposited(&env)` and return the value directly — no storage writes, no bumps
    - `balance_of`: call `get_balance(&env, &address)` and return the value directly — no storage writes, no bumps; returns `0` if key absent (handled in `get_balance`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 10. Verify compilation and correct CEI ordering
  - Run `cargo build --target wasm32-unknown-unknown --release` and confirm zero errors and zero warnings
  - Manually audit each mutating function against the CEI checklist:
    - `deposit`: checks → arithmetic → `transfer_from` → storage writes → bumps
    - `withdraw`: checks → arithmetic → storage writes → `transfer` → bumps
    - `harvest`: checks → overflow guard → `transfer_from` → `set_total_deposited` → bump
  - Ensure no `unwrap()` or `expect()` calls exist outside `#[cfg(test)]`-gated code
  - _Requirements: 8.6, 9.1, 9.2, 9.3, 9.6_

- [x] 11. Implement unit tests for all error paths and happy paths
  - [x] 11.1 Add test infrastructure and `setup()` helper in `src/test.rs`
    - Gate with `#[cfg(test)]`
    - Import `soroban_sdk::{testutils::{Address as _, AuthorizedFunction, Ledger}, Address, Env}` and `soroban_sdk::token::StellarAssetClient`
    - Import `crate::{AuraVault, AuraVaultClient, VaultError}`
    - Write `fn setup() -> (Env, AuraVaultClient<'static>, Address, Address)`:
      - `let env = Env::default(); env.mock_all_auths();`
      - `let admin = Address::generate(&env);`
      - `let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();`
      - `let vault_address = env.register_contract(None, AuraVault);`
      - `let vault = AuraVaultClient::new(&env, &vault_address);`
      - `vault.initialize(&admin, &token_address);`
      - `return (env, vault, admin, token_address)`
    - Write `fn mint_tokens(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128)` that uses `StellarAssetClient` to mint `amount` tokens to `to`
    - _Requirements: 10.7_

  - [x]* 11.2 Write unit tests for `initialize` error paths
    - Test `double_init_returns_already_initialized`: call `initialize` twice; assert second call returns `Err(VaultError::AlreadyInitialized)` — Req 1.2, 10.6
    - Test `fresh_vault_total_assets_is_zero`: assert `vault.total_assets() == 0` — Req 5.1
    - Test `fresh_vault_balance_of_unknown_address_is_zero`: assert `vault.balance_of(&unknown) == 0` — Req 5.3, 10.10
    - _Requirements: 1.2, 5.1, 5.3, 10.6, 10.10_

  - [x]* 11.3 Write unit tests for `deposit` error paths
    - Test `deposit_before_init_returns_not_initialized`: deploy uninitialised vault, call `deposit`; assert `Err(VaultError::NotInitialized)` — Req 2.11
    - Test `deposit_zero_returns_zero_amount`: assert `Err(VaultError::ZeroAmount)` — Req 2.7, 10.5
    - Test `deposit_overflow_returns_math_overflow`: seed vault with 1 share, then call `deposit(i128::MAX)`; assert `Err(VaultError::MathOverflow)` — Req 2.8, 10.4
    - _Requirements: 2.7, 2.8, 2.11, 10.4, 10.5_

  - [x]* 11.4 Write unit tests for `deposit` happy paths
    - Test `first_deposit_mints_one_to_one`: deposit `1_000_000`; assert `minted == 1_000_000` and `vault.total_assets() == 1_000_000` — Req 2.2, 6.5
    - Test `second_deposit_uses_formula`: seed with 1_000_000, harvest 200_000, deposit 600_000; assert minted shares match `floor(600_000 * 1_000_000 / 1_200_000) = 500_000` — Req 2.3
    - Test `two_equal_depositors_each_hold_half`: two depositors each deposit equal amount; assert each holds `total_shares / 2` — Req 10.8
    - _Requirements: 2.2, 2.3, 6.5, 10.8_

  - [x]* 11.5 Write unit tests for `withdraw` error paths
    - Test `withdraw_zero_returns_zero_amount` — Req 3.5, 10.5
    - Test `withdraw_before_init_returns_not_initialized` — Req 3.10
    - Test `withdraw_more_than_balance_returns_insufficient_shares` — Req 3.6
    - _Requirements: 3.5, 3.6, 3.10, 10.5_

  - [x]* 11.6 Write unit tests for `withdraw` happy paths
    - Test `withdraw_all_shares_zeros_vault`: sole depositor withdraws all shares; assert `total_assets() == 0` and `total_shares` (via `balance_of`) is zero — Req 6.4
    - Test `harvest_then_withdraw_yields_more`: deposit, harvest, then withdraw same share count; assert returned tokens > pre-harvest redemption value — Req 10.9
    - Test `withdraw_does_not_affect_other_depositor_balance`: two depositors, one withdraws; assert second depositor's `balance_of` unchanged — Req 6.6
    - _Requirements: 3.1, 6.4, 6.6, 10.9_

  - [x]* 11.7 Write unit tests for `harvest` error paths
    - Test `harvest_zero_returns_zero_amount` — Req 4.5, 10.5
    - Test `harvest_before_init_returns_not_initialized` — Req 4.8
    - Test `harvest_on_empty_vault_returns_zero_shares`: deposit then withdraw all, then harvest; assert `Err(VaultError::ZeroShares)` — Req 4.9
    - _Requirements: 4.5, 4.8, 4.9, 10.5_

- [x] 12. Implement property-based tests
  - [x] 12.1 Write property test for Property 2: Deposit-Withdraw Round-Trip Rounding Invariant
    - Use `proptest!` macro with strategy `1_i128..=(i128::MAX / 2)`
    - Seed vault with 1_000_000 underlying and 1_000_000 shares (1:1 state)
    - For each generated `amount`: call `deposit(amount)`, capture `minted_shares`, call `withdraw(minted_shares)`, assert returned tokens `>= amount - 1`
    - Tag with comment `// Feature: aura-yield-vault, Property 2: Deposit-Withdraw Round-Trip Rounding Invariant`
    - _Requirements: 6.3, 10.1_

  - [x] 12.2 Write property test for Property 3 + 9: Harvest Non-Dilution and Exchange Rate Strict Increase
    - Use `proptest!` with strategy `1_i128..=(i128::MAX / 4)`
    - Seed vault; record `old_balance` for depositor, `old_rate = total_deposited * 1_000_000 / total_shares`
    - For each `yield_amount`: call `harvest(yield_amount)`, assert depositor `balance_of` unchanged, assert `new_rate > old_rate`
    - Tag with comment `// Feature: aura-yield-vault, Property 3 + 9: Harvest Non-Dilution and Exchange Rate Strict Increase`
    - _Requirements: 4.3, 4.4, 10.2_

  - [x] 12.3 Write property test for Property 4: First-Deposit 1:1 Seeding
    - Use `proptest!` with strategy `1_i128..=(i128::MAX / 2)`
    - For each `amount`: deploy fresh vault, call `deposit(amount)`, assert `minted_shares == amount` and `vault.total_assets() == amount`
    - Tag with comment `// Feature: aura-yield-vault, Property 4: First-Deposit 1:1 Seeding`
    - _Requirements: 2.2, 6.5_

  - [x] 12.4 Write property test for Property 5: Share Minting Formula Correctness
    - Use `proptest!` with strategy `(1_i128..=1_000_000_i128, 1_i128..=1_000_000_i128)`
    - Seed vault with `total_shares` and `total_deposited` set via deposits and harvest
    - For each `amount` where formula `> 0`: assert minted shares `== floor(amount * total_shares / total_deposited)` and `total_assets` increases by exactly `amount`
    - Tag with comment `// Feature: aura-yield-vault, Property 5: Share Minting Formula Correctness`
    - _Requirements: 2.3, 2.4_

  - [x] 12.5 Write property test for Property 6: Overflow Guard
    - Use `proptest!` — generate `amount` values near `i128::MAX` that would overflow `amount * total_shares`
    - Seed vault with any `total_shares > 0`; call `deposit(i128::MAX)` and `withdraw(i128::MAX)` on a vault where the multiplication would overflow
    - Assert `Err(VaultError::MathOverflow)` and vault state unchanged after each call
    - Tag with comment `// Feature: aura-yield-vault, Property 6: Overflow Guard`
    - _Requirements: 2.8, 3.7, 8.3, 10.4_

  - [x] 12.6 Write property test for Property 7: Zero-Share Mint Rejection (Inflation-Attack Fence)
    - Use `proptest!` — generate `total_shares` and `total_deposited` values where `floor(1 * total_shares / total_deposited) == 0` (i.e., `total_deposited > total_shares`)
    - Assert `deposit(1)` returns `Err(VaultError::ZeroAmount)` and vault state unchanged
    - Tag with comment `// Feature: aura-yield-vault, Property 7: Zero-Share Mint Rejection`
    - _Requirements: 2.13, 6.5_

  - [x] 12.7 Write property test for Property 8: Withdrawal User Isolation
    - Use `proptest!` with strategy for two different deposit amounts
    - Two depositors each deposit; depositor A withdraws all shares; assert depositor B `balance_of` is identical before and after
    - Tag with comment `// Feature: aura-yield-vault, Property 8: Withdrawal User Isolation`
    - _Requirements: 6.6_

  - [x] 12.8 Write property test for Property 1: Share-Sum Invariant
    - Use `proptest!` generating sequences of deposit/withdraw operations
    - After each operation, read all known balances and sum them; assert sum equals `total_shares` (tracked via `balance_of` calls for each actor)
    - Tag with comment `// Feature: aura-yield-vault, Property 1: Share-Sum Invariant`
    - _Requirements: 6.1, 10.3_

  - [x] 12.9 Write property test for Property 10: Serialization Round-Trip
    - Use `proptest!` — generate random `Address` pairs where `addr_a != addr_b`
    - Write a balance for `addr_a` and a different balance for `addr_b`; assert `balance_of(addr_a)` returns the value written for `addr_a` and `balance_of(addr_b)` returns the value written for `addr_b` (no slot collision)
    - Tag with comment `// Feature: aura-yield-vault, Property 10: Serialization Round-Trip`
    - _Requirements: 11.3, 11.4_

- [x] 13. Final checkpoint — all tests pass
  - Run `cargo test` and confirm all unit tests pass
  - Run `cargo build --target wasm32-unknown-unknown --release` and confirm clean build
  - Confirm no `unwrap()` / `expect()` outside test gate: `grep -r 'unwrap\|expect' src/ --include='*.rs'` and verify every hit is inside a `#[cfg(test)]` block
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they are property and unit tests only
- Each implementation task references specific requirement acceptance criteria for traceability
- CEI ordering is a hard constraint: `deposit` interacts (transfer_from) before writing state; `withdraw` writes state before interacting (transfer)
- `total_assets` and `balance_of` perform no storage writes and no TTL bumps — gas optimization by design
- `get_balance` must never panic on a missing key — return `0_i128` as default
- All property tests use `proptest = "1"` from dev-dependencies and run on the host (not Wasm); `std` is available in tests
- The Soroban test env requires `mock_all_auths()` and `register_stellar_asset_contract_v2` for token setup

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["10"] },
    { "id": 9, "tasks": ["11.1"] },
    { "id": 10, "tasks": ["11.2", "11.3", "11.4", "11.5", "11.6", "11.7"] },
    { "id": 11, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "12.9"] }
  ]
}
```

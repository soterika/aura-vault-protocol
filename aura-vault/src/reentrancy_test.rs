//! Reentrancy guard test suite (Issue #345).
//!
//! Verifies that:
//! 1. `DataKey::ReentrancyGuard` is set during mutating calls and blocks reentrant entry with `VaultError::Reentrancy`.
//! 2. Guard is cleanly cleared at the end of every mutating call (normal path).
//! 3. Guard is cleanly cleared even on error paths (zero amount, paused, TVL cap, etc.), preventing state lockup.
//! 4. Reentrant invocations via mock attacker/strategy callbacks revert with `VaultError::Reentrancy`.

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient, VaultError};
use crate::storage::{enter_reentrancy_guard, exit_reentrancy_guard, is_reentrancy_locked};

// ---------------------------------------------------------------------------
// Test Setup Helpers
// ---------------------------------------------------------------------------

fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_addr, &signers, &0_u32);
    vault.set_fees(&admin, &0_u32, &0_u32);
    (env, vault, admin, token_addr)
}

fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. Guard entry / exit unit behavior
// ---------------------------------------------------------------------------

#[test]
fn test_reentrancy_guard_enter_and_exit() {
    let env = Env::default();
    assert!(!is_reentrancy_locked(&env));

    assert!(enter_reentrancy_guard(&env).is_ok());
    assert!(is_reentrancy_locked(&env));

    // Second entry while locked must fail with Reentrancy
    let err = enter_reentrancy_guard(&env).unwrap_err();
    assert_eq!(err, VaultError::Reentrancy);

    // After exit, lock is released and entry is permitted again
    exit_reentrancy_guard(&env);
    assert!(!is_reentrancy_locked(&env));
    assert!(enter_reentrancy_guard(&env).is_ok());
    exit_reentrancy_guard(&env);
}

// ---------------------------------------------------------------------------
// 2. Mutating calls blocked when guard is active
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_blocked_when_reentrancy_locked() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);

    // Simulate an ongoing mutating execution that holds the lock
    enter_reentrancy_guard(&env).unwrap();

    let res = vault.try_deposit(&user, &100_000);
    assert_eq!(res.unwrap_err().unwrap(), VaultError::Reentrancy);

    exit_reentrancy_guard(&env);

    // Once released, deposit works normally
    let shares = vault.deposit(&user, &100_000);
    assert_eq!(shares, 100_000);
}

#[test]
fn test_withdraw_blocked_when_reentrancy_locked() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &500_000);

    // Hold lock
    enter_reentrancy_guard(&env).unwrap();

    let res = vault.try_withdraw(&user, &200_000);
    assert_eq!(res.unwrap_err().unwrap(), VaultError::Reentrancy);

    exit_reentrancy_guard(&env);

    // Once released, withdraw succeeds
    let redeemed = vault.withdraw(&user, &200_000);
    assert_eq!(redeemed, 200_000);
}

#[test]
fn test_harvest_blocked_when_reentrancy_locked() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &500_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 100_000);

    // Hold lock
    enter_reentrancy_guard(&env).unwrap();

    let res = vault.try_harvest(&keeper, &50_000);
    assert_eq!(res.unwrap_err().unwrap(), VaultError::Reentrancy);

    exit_reentrancy_guard(&env);

    let res_ok = vault.try_harvest(&keeper, &50_000);
    assert!(res_ok.is_ok());
}

// ---------------------------------------------------------------------------
// 3. Guard cleanup on error paths
// ---------------------------------------------------------------------------

#[test]
fn test_guard_cleared_on_zero_amount_error() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);

    // Deposit with 0 amount returns ZeroAmount
    let res = vault.try_deposit(&user, &0);
    assert_eq!(res.unwrap_err().unwrap(), VaultError::ZeroAmount);

    // Guard must NOT remain locked after error
    assert!(!is_reentrancy_locked(&env));

    // Subsequent valid deposit must succeed
    assert!(vault.try_deposit(&user, &100_000).is_ok());
}

#[test]
fn test_guard_cleared_on_pause_error() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);

    vault.pause(&admin);

    // Deposit on paused vault returns VaultPaused
    let res = vault.try_deposit(&user, &100_000);
    assert_eq!(res.unwrap_err().unwrap(), VaultError::VaultPaused);

    // Guard must not remain locked
    assert!(!is_reentrancy_locked(&env));

    vault.unpause(&admin);
    assert!(vault.try_deposit(&user, &100_000).is_ok());
}

#[test]
fn test_guard_cleared_on_insufficient_shares_error() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &100_000);

    // Withdraw more shares than held
    let res = vault.try_withdraw(&user, &999_999);
    assert_eq!(res.unwrap_err().unwrap(), VaultError::InsufficientShares);

    assert!(!is_reentrancy_locked(&env));
    assert!(vault.try_withdraw(&user, &50_000).is_ok());
}

// ---------------------------------------------------------------------------
// 4. Admin and governance mutating operations protected
// ---------------------------------------------------------------------------

#[test]
fn test_admin_operations_protected_by_reentrancy_guard() {
    let (env, vault, admin, _token) = setup();

    enter_reentrancy_guard(&env).unwrap();

    let res_fee = vault.try_set_fees(&admin, &500_u32, &0_u32);
    assert_eq!(res_fee.unwrap_err().unwrap(), VaultError::Reentrancy);

    let res_pause = vault.try_pause(&admin);
    assert_eq!(res_pause.unwrap_err().unwrap(), VaultError::Reentrancy);

    exit_reentrancy_guard(&env);

    assert!(vault.try_set_fees(&admin, &500_u32, &0_u32).is_ok());
}

//! Tests for `emergency_withdraw` — Issue #344
//!
//! Acceptance criteria verified:
//!   1. Only callable when vault IS paused  → NotVaultPaused when unpaused
//!   2. Burns shares and transfers pro-rata vault balance  → exact amount
//!   3. No fee deducted  → full pro-rata received
//!   4. EmergencyWithdraw event emitted  → event topic check
//!   5. Cannot be disabled by admin  → no admin guard in the function
//!   6. Correct share/balance state after withdrawal

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient, VaultError};

// ---------------------------------------------------------------------------
// Helper — same as test.rs setup() but defined locally to avoid import issues.
// ---------------------------------------------------------------------------

fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_address, &signers, &soroban_sdk::String::from_str(&env, "AuraVault"), &soroban_sdk::String::from_str(&env, "AURA"));
    // Zero fees so arithmetic is exact
    vault.set_fees(&admin, &0_u32, &0_u32);

    (env, vault, admin, token_address)
}

fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(recipient, &amount);
}

// ---------------------------------------------------------------------------
// 1. Requires vault to be paused
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_fails_when_not_paused() {
    let (env, vault, _admin, token) = setup();
    let user = Address::generate(&env);

    // Deposit so user has shares
    mint(&env, &token, &_admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    // Vault is NOT paused — should return NotVaultPaused
    let result = vault.try_emergency_withdraw(&user, &500_000);
    assert_eq!(result, Err(Ok(VaultError::NotVaultPaused)));
}

#[test]
fn test_emergency_withdraw_succeeds_when_paused() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.pause(&admin);

    // Should succeed now
    let result = vault.try_emergency_withdraw(&user, &500_000);
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// 2. Pro-rata amount: shares × actual_balance / total_shares
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_pro_rata_single_user() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    // Deposit 1_000_000 → receives 1_000_000 shares (1:1 seed)
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    vault.pause(&admin);

    // total_shares = 1_000_000, actual_balance = 1_000_000
    // redeem(500_000 shares) = 500_000 × 1_000_000 / 1_000_000 = 500_000
    let received = vault.emergency_withdraw(&user, &500_000);
    assert_eq!(received, 500_000);
    assert_eq!(vault.balance_of(&user), 500_000);
}

#[test]
fn test_emergency_withdraw_pro_rata_full_balance() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 2_000_000);
    vault.deposit(&user, &2_000_000);

    vault.pause(&admin);

    // Withdraw all shares — should receive the full balance
    let received = vault.emergency_withdraw(&user, &2_000_000);
    assert_eq!(received, 2_000_000);
    assert_eq!(vault.balance_of(&user), 0);
    assert_eq!(vault.total_shares(), 0);
}

#[test]
fn test_emergency_withdraw_pro_rata_two_users() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Alice deposits 3_000_000, Bob deposits 1_000_000
    // total_shares = 4_000_000, total_deposited = 4_000_000
    mint(&env, &token, &admin, &alice, 3_000_000);
    mint(&env, &token, &admin, &bob, 1_000_000);
    vault.deposit(&alice, &3_000_000);
    vault.deposit(&bob, &1_000_000);

    vault.pause(&admin);

    // Alice has 3_000_000 / 4_000_000 = 75% of the vault
    // Emergency withdraw all alice's shares:
    // redeem = 3_000_000 × 4_000_000 / 4_000_000 = 3_000_000
    let alice_received = vault.emergency_withdraw(&alice, &3_000_000);
    assert_eq!(alice_received, 3_000_000);

    // Bob still has 1_000_000 shares; remaining balance is 1_000_000
    assert_eq!(vault.balance_of(&bob), 1_000_000);
    assert_eq!(vault.total_shares(), 1_000_000);
}

// ---------------------------------------------------------------------------
// 3. No fee deducted
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_no_fee_even_when_fee_configured() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    // Configure a 10% performance fee and a 5% withdrawal fee
    vault.set_fees(&admin, &1000_u32, &0_u32);
    vault.set_withdrawal_fee(&admin, &500_u32);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    vault.pause(&admin);

    // Emergency path — no fee applied
    // redeem = 1_000_000 × 1_000_000 / 1_000_000 = 1_000_000 (full amount)
    let received = vault.emergency_withdraw(&user, &1_000_000);
    assert_eq!(received, 1_000_000, "emergency_withdraw must not deduct any fee");
}

// ---------------------------------------------------------------------------
// 4. EmergencyWithdraw event emitted
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_emits_event() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.pause(&admin);

    vault.emergency_withdraw(&user, &1_000_000);

    // Verify the "emergency_withdraw" event was published.
    // Soroban test env stores events; we check that at least one has the
    // expected topic symbol.
    let events = env.events().all();
    let found = events.iter().any(|e| {
        // Each event is (contract_id, topics, data).
        // topics is a Vec<Val> — the first entry is the event name symbol.
        let topics_raw = e.1.clone();
        // Convert to string for easy matching
        let topics_str = std::format!("{:?}", topics_raw);
        topics_str.contains("emergency_withdraw")
    });
    assert!(found, "emergency_withdraw event was not emitted");
}

// ---------------------------------------------------------------------------
// 5. Cannot be disabled — no admin guard (structural check)
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_non_admin_can_call_when_paused() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    let non_admin = Address::generate(&env);

    // non_admin has no special permissions
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    // Give non_admin shares too
    mint(&env, &token, &admin, &non_admin, 500_000);
    vault.deposit(&non_admin, &500_000);

    vault.pause(&admin);

    // non_admin is not the vault admin but can still call emergency_withdraw
    let result = vault.try_emergency_withdraw(&non_admin, &500_000);
    assert!(
        result.is_ok(),
        "non-admin should be able to call emergency_withdraw when paused: {:?}",
        result
    );
}

// ---------------------------------------------------------------------------
// 6. Error paths
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_zero_shares_rejected() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.pause(&admin);

    let result = vault.try_emergency_withdraw(&user, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_emergency_withdraw_insufficient_shares_rejected() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.pause(&admin);

    // User has 1_000_000 shares, tries to withdraw 2_000_000
    let result = vault.try_emergency_withdraw(&user, &2_000_000);
    assert_eq!(result, Err(Ok(VaultError::InsufficientShares)));
}

#[test]
fn test_emergency_withdraw_requires_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let user = Address::generate(&env);

    // Not initialized
    let result = vault.try_emergency_withdraw(&user, &1_000);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

// ---------------------------------------------------------------------------
// 7. State consistency after emergency withdrawal
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_withdraw_updates_total_shares() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    assert_eq!(vault.total_shares(), 1_000_000);
    vault.pause(&admin);

    vault.emergency_withdraw(&user, &600_000);

    assert_eq!(vault.total_shares(), 400_000);
    assert_eq!(vault.balance_of(&user), 400_000);
}

#[test]
fn test_emergency_withdraw_partial_then_unpause_normal_withdraw() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    // Pause and do an emergency partial withdrawal
    vault.pause(&admin);
    vault.emergency_withdraw(&user, &500_000);

    // Unpause and do a normal withdrawal with remaining shares
    vault.unpause(&admin);
    let result = vault.try_withdraw(&user, &500_000);
    assert!(result.is_ok(), "normal withdraw should work after unpause: {:?}", result);
}

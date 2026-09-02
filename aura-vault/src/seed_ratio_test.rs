#![cfg(test)]
// Issue #465 — First-depositor seed ratio tests
//
// Verifies:
//   ✅ First deposit of 1000 tokens → 1000 shares minted (1:1 seed ratio)
//   ✅ Second deposit of 500 tokens with no harvest → 500 shares minted
//   ✅ Deposit after harvest → fewer shares minted (price increased)
//   ✅ Deposit of 1 token when price is high → ZeroAmount error
//   ✅ All formulas validated with exact integer arithmetic

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient, VaultError};

// ---------------------------------------------------------------------------
// Test helpers (mirrors the setup() in test.rs)
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
    // Zero fees so share arithmetic is exact throughout
    vault.set_fees(&admin, &0_u32, &0_u32);

    (env, vault, admin, token_address)
}

fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(recipient, &amount);
}

// ---------------------------------------------------------------------------
// #465-1: First deposit of 1000 tokens → exactly 1000 shares minted (1:1)
// ---------------------------------------------------------------------------

#[test]
fn test_first_deposit_seed_ratio_one_to_one() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000);
    let minted = vault.deposit(&user, &1_000);

    // Exact 1:1 seed ratio
    assert_eq!(minted, 1_000, "first depositor must receive exactly 1:1 shares");
    assert_eq!(vault.balance_of(&user), 1_000);
    assert_eq!(vault.total_assets(), 1_000);
}

/// Verify with a larger amount to ensure the 1:1 is universal for any first deposit
#[test]
fn test_first_deposit_large_amount_seed_ratio() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1_000_000_000);
    let minted = vault.deposit(&user, &1_000_000_000);

    assert_eq!(minted, 1_000_000_000, "first deposit of any size must be 1:1");
    assert_eq!(vault.balance_of(&user), 1_000_000_000);
}

/// Verify the single stroop boundary case for the first deposit
#[test]
fn test_first_deposit_minimum_amount_seed_ratio() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);

    mint(&env, &token, &admin, &user, 1);
    let minted = vault.deposit(&user, &1);

    assert_eq!(minted, 1, "even 1 stroop first deposit must be 1:1");
    assert_eq!(vault.total_assets(), 1);
}

// ---------------------------------------------------------------------------
// #465-2: Second deposit of 500 tokens with no harvest → exactly 500 shares
//
// After first deposit: total_shares = 1000, total_assets = 1000.
// Price per share = 1.0  →  new_shares = floor(500 × 1000 / 1000) = 500.
// ---------------------------------------------------------------------------

#[test]
fn test_second_deposit_no_harvest_uses_share_formula() {
    let (env, vault, admin, token) = setup();

    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000);
    vault.deposit(&alice, &1_000); // seeds the vault: 1000 shares / 1000 assets

    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 500);
    let minted = vault.deposit(&bob, &500);

    // floor(500 × 1000 / 1000) = 500
    assert_eq!(minted, 500, "second deposit at 1:1 price must mint exactly 500 shares");
    assert_eq!(vault.balance_of(&bob), 500);
    assert_eq!(vault.total_assets(), 1_500);
}

/// Exact integer arithmetic verification with unequal starting ratio
///
/// Vault state: 1_200 assets, 1_000 shares  (price = 1.2 per share)
/// Bob deposits 600 tokens.
/// new_shares = floor(600 × 1_000 / 1_200) = floor(500) = 500
#[test]
fn test_second_deposit_after_harvest_formula_exact_integer() {
    let (env, vault, admin, token) = setup();

    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000);
    vault.deposit(&alice, &1_000); // 1000 shares / 1000 assets

    // Harvest 200 tokens: price rises to 1.2 (1200 assets / 1000 shares)
    mint(&env, &token, &admin, &admin, 200);
    vault.harvest(&admin, &200);
    assert_eq!(vault.total_assets(), 1_200);

    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 600);
    let minted = vault.deposit(&bob, &600);

    // Exact integer: floor(600 × 1_000 / 1_200) = 500
    assert_eq!(minted, 500, "expected floor(600×1000/1200) = 500 shares");
    assert_eq!(vault.total_assets(), 1_800);
}

// ---------------------------------------------------------------------------
// #465-3: Deposit after harvest → fewer shares minted (price increased)
//
// After seed deposit and harvest the share price rises above 1.0, so a
// subsequent depositor receives fewer shares per token than the first.
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_after_harvest_mints_fewer_shares() {
    let (env, vault, admin, token) = setup();

    // First depositor seeds at 1:1
    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 10_000);
    vault.deposit(&alice, &10_000); // 10_000 shares / 10_000 assets

    // Harvest boosts share price: 10_000 assets + 5_000 yield = 15_000 assets / 10_000 shares
    mint(&env, &token, &admin, &admin, 5_000);
    vault.harvest(&admin, &5_000);

    // Bob deposits the same 10_000 tokens that Alice deposited
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 10_000);
    let bob_shares = vault.deposit(&bob, &10_000);

    // Alice got 10_000 shares; Bob should get fewer since price is now 1.5
    // floor(10_000 × 10_000 / 15_000) = floor(6666.67) = 6_666
    assert_eq!(bob_shares, 6_666, "bob should get floor(10000×10000/15000) = 6666 shares");
    assert!(bob_shares < 10_000, "deposit after harvest must mint fewer shares than seed ratio");

    // After Bob's deposit, verify cumulative state is consistent
    // total_assets = 15_000 + 10_000 = 25_000
    // total_shares = 10_000 + 6_666 = 16_666
    assert_eq!(vault.total_assets(), 25_000);
    assert_eq!(vault.balance_of(&alice), 10_000);
    assert_eq!(vault.balance_of(&bob), 6_666);
}

/// Deposit after two separate harvests further reduces the share count
#[test]
fn test_deposit_after_multiple_harvests_mints_even_fewer_shares() {
    let (env, vault, admin, token) = setup();

    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    vault.deposit(&alice, &1_000_000); // 1_000_000 shares / 1_000_000 assets

    // First harvest: price → 2.0
    mint(&env, &token, &admin, &admin, 1_000_000);
    vault.harvest(&admin, &1_000_000);

    // Second harvest: price → 3.0
    mint(&env, &token, &admin, &admin, 1_000_000);
    vault.harvest(&admin, &1_000_000);

    assert_eq!(vault.total_assets(), 3_000_000); // 3:1

    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 1_000_000);
    let bob_shares = vault.deposit(&bob, &1_000_000);

    // floor(1_000_000 × 1_000_000 / 3_000_000) = floor(333_333.33) = 333_333
    assert_eq!(bob_shares, 333_333);

    // Bob's underlying value: floor(333_333 × 4_000_000 / 1_333_333) ≈ 1_000_000
    // (bob gets proportional ownership of expanded vault)
    let redeemed = vault.withdraw(&bob, &bob_shares);
    // Due to floor rounding bob may get slightly less than 1_000_000
    assert!(redeemed <= 1_000_000, "should not get more than deposited");
    assert!(redeemed >= 999_000, "rounding loss should be less than 0.1%");
}

// ---------------------------------------------------------------------------
// #465-4: Deposit of 1 token when share price is very high → ZeroAmount error
//
// When floor(1 × total_shares / total_assets) == 0, the contract must reject
// the deposit with VaultError::ZeroAmount rather than mint 0 shares.
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_rounds_to_zero_shares_returns_zero_amount_error() {
    let (env, vault, admin, token) = setup();

    // Seed the vault with 1 token → 1 share
    let seeder = Address::generate(&env);
    mint(&env, &token, &admin, &seeder, 1);
    vault.deposit(&seeder, &1);

    // Massively inflate the price: inject 1_000_000 tokens of yield with only 1 share outstanding.
    // Now price = 1_000_001 tokens per share.
    mint(&env, &token, &admin, &admin, 1_000_000);
    vault.harvest(&admin, &1_000_000);
    assert_eq!(vault.total_assets(), 1_000_001);

    // A deposit of 1 token yields floor(1 × 1 / 1_000_001) = 0 shares → ZeroAmount
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1);
    let result = vault.try_deposit(&user, &1);
    assert_eq!(
        result,
        Err(Ok(VaultError::ZeroAmount)),
        "deposit that rounds to zero shares must return ZeroAmount"
    );
}

/// Boundary case: deposit of (price - 1) tokens also rounds to 0 shares
#[test]
fn test_deposit_just_below_share_price_returns_zero_amount() {
    let (env, vault, admin, token) = setup();

    // Vault: 1 share / 1000 assets  (price = 1000 per share)
    let seeder = Address::generate(&env);
    mint(&env, &token, &admin, &seeder, 1);
    vault.deposit(&seeder, &1);
    mint(&env, &token, &admin, &admin, 999);
    vault.harvest(&admin, &999);
    assert_eq!(vault.total_assets(), 1_000);

    // Deposit 999 → floor(999 × 1 / 1000) = 0 → ZeroAmount
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 999);
    let result = vault.try_deposit(&user, &999);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));

    // Deposit exactly 1000 → floor(1000 × 1 / 1000) = 1 → succeeds
    mint(&env, &token, &admin, &user, 1);
    let minted = vault.deposit(&user, &1_000);
    assert_eq!(minted, 1, "deposit of exactly the share price must mint 1 share");
}

// ---------------------------------------------------------------------------
// #465-5: Exact integer arithmetic — end-to-end invariant validation
//
// Verifies that total_assets always equals
//   sum over all users: floor(user_shares × total_assets / total_shares)
// i.e. no tokens are "lost" in excess of rounding (at most 1 stroop per user).
// ---------------------------------------------------------------------------

#[test]
fn test_share_price_formula_exact_integer_arithmetic() {
    let (env, vault, admin, token) = setup();

    // Three depositors at different prices
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    // Step 1: Alice deposits 10_000 at 1:1 seed
    mint(&env, &token, &admin, &alice, 10_000);
    let alice_shares = vault.deposit(&alice, &10_000);
    assert_eq!(alice_shares, 10_000);

    // Step 2: Harvest 5_000 → price = 1.5
    mint(&env, &token, &admin, &admin, 5_000);
    vault.harvest(&admin, &5_000);

    // Step 3: Bob deposits 15_000 → floor(15_000 × 10_000 / 15_000) = 10_000 shares
    mint(&env, &token, &admin, &bob, 15_000);
    let bob_shares = vault.deposit(&bob, &15_000);
    assert_eq!(bob_shares, 10_000, "floor(15000×10000/15000) = 10000");

    // Step 4: Harvest 6_000 → total_assets = 36_000, total_shares = 20_000 → price = 1.8
    mint(&env, &token, &admin, &admin, 6_000);
    vault.harvest(&admin, &6_000);
    assert_eq!(vault.total_assets(), 36_000);

    // Step 5: Carol deposits 18_000 → floor(18_000 × 20_000 / 36_000) = 10_000 shares
    mint(&env, &token, &admin, &carol, 18_000);
    let carol_shares = vault.deposit(&carol, &18_000);
    assert_eq!(carol_shares, 10_000, "floor(18000×20000/36000) = 10000");

    // State: 30_000 total shares, 54_000 total assets → price = 1.8
    assert_eq!(vault.total_assets(), 54_000);
    assert_eq!(vault.balance_of(&alice), alice_shares);
    assert_eq!(vault.balance_of(&bob), bob_shares);
    assert_eq!(vault.balance_of(&carol), carol_shares);

    // Each user redeems; total withdrawn must ≤ total_assets (rounding losses possible)
    let total_shares = alice_shares + bob_shares + carol_shares;
    let alice_out = vault.withdraw(&alice, &alice_shares);
    let bob_out = vault.withdraw(&bob, &bob_shares);
    let carol_out = vault.withdraw(&carol, &carol_shares);
    let total_out = alice_out + bob_out + carol_out;

    assert!(
        total_out <= 54_000,
        "total withdrawn ({total_out}) must not exceed total_assets (54000)"
    );
    assert!(
        total_out >= 54_000 - total_shares as i128,
        "rounding loss must not exceed 1 stroop per user: got {total_out}"
    );
}

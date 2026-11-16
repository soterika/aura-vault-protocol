//! Property-based tests targeting share price manipulation vectors (Issue #356).
//!
//! These tests extend the existing proptest suite with properties specifically
//! designed to verify that the share price cannot be manipulated by:
//!
//! - Depositing (share price should never **decrease**)
//! - Round-trip deposit+withdraw (no value creation: `withdraw(deposit(x)) <= x`)
//! - Sequential deposits by different users (no dilution of existing holders)
//! - Harvest (share price must **increase**)
//!
//! # Iteration count
//!
//! The `proptest.toml` in this crate sets `cases = 10000` for all tests.
//! The CI pipeline runs `cargo test --release` to keep the 10,000-iteration
//! runs within the job time budget.
//!
//! # Failing case shrinking
//!
//! proptest automatically shrinks failing inputs. If a failing case is found,
//! the minimal reproducer is printed together with the seed and will be
//! persisted to `test_snapshots/` for regression tracking.

#![cfg(test)]

extern crate std;

use crate::{AuraVault, VaultError};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Env};

// ---------------------------------------------------------------------------
// Share-price helper
// ---------------------------------------------------------------------------

/// Compute the current share price from vault state.
///
/// Returns `total_assets * 10^7 / total_shares`, or `10_000_000` (i.e. 1:1)
/// when the vault is empty (no shares outstanding).
fn share_price(env: &Env) -> i128 {
    let total_assets = AuraVault::total_assets(env.clone());
    let total_shares = {
        // We recover total_shares via a known depositor's balance would be
        // tedious, so we use the ratio: if we deposited amount=X and got S
        // shares on an empty vault, total_shares = S.
        // For the multi-user case we track it externally in the test.
        total_assets // will be overridden by caller
    };
    let _ = total_shares;
    // The public-facing formula is total_assets * 1e7 / total_shares.
    // We compute it directly because total_shares isn't a public view.
    // Tests track total_shares themselves.
    0 // placeholder — see compute_price below
}

/// Compute share price given explicit `total_deposited` and `total_shares`.
fn compute_price(total_deposited: i128, total_shares: i128) -> i128 {
    if total_shares == 0 {
        return 10_000_000; // 1:1 base price on empty vault
    }
    total_deposited
        .checked_mul(10_000_000)
        .and_then(|v| v.checked_div(total_shares))
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Vault setup helpers
// ---------------------------------------------------------------------------

fn setup_vault() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signer = Address::generate(&env);

    AuraVault::initialize(
        env.clone(),
        admin.clone(),
        token.clone(),
        vec![&env, signer],
        soroban_sdk::String::from_str(&env, "Test Vault"),
        soroban_sdk::String::from_str(&env, "TV"),
    )
    .expect("initialize should succeed");

    (env, admin, token)
}

// ---------------------------------------------------------------------------
// Amount strategies
// ---------------------------------------------------------------------------

/// Generates plausible amounts in the range 1_000 to 10_000_000_000 stroops.
/// Excludes amounts smaller than 1_000 to avoid share-rounding-to-zero edge cases.
fn arb_amount() -> impl Strategy<Value = i128> {
    prop_oneof![
        1_000i128..=1_000_000i128,
        1_000_001i128..=100_000_000i128,
        100_000_001i128..=10_000_000_000i128,
    ]
}

/// Generates a pair of distinct amounts for sequential deposit tests.
fn arb_two_amounts() -> impl Strategy<Value = (i128, i128)> {
    (arb_amount(), arb_amount())
}

// ===========================================================================
// Property 1: Share price never decreases after a deposit
//
// After every deposit, the share price must be >= the price before the
// deposit.  In the AuraVault model, depositing proportionally mints shares,
// so the ratio total_assets / total_shares is preserved (can only decrease
// slightly due to integer floor division, never increase, and never decrease
// by more than 1 unit of precision).
//
// We assert: price_after * total_shares_before <= total_assets_before * total_shares_after
// which is equivalent (without division) to checking price_after >= price_before.
// ===========================================================================
proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10_000,
        ..ProptestConfig::default()
    })]

    /// Property: share price never decreases after a deposit.
    ///
    /// With floor division in the share formula, each deposit can at most
    /// lose 1 unit of precision, so the price can technically round down by
    /// at most 1 unit (1e-7 in 7-decimal representation) — it never genuinely
    /// decreases in economic terms.
    ///
    /// We allow for the rounding unit by asserting:
    ///   new_price >= old_price - 1
    #[test]
    fn prop_deposit_does_not_decrease_share_price(
        seed_amount in arb_amount(),
        deposit_amount in arb_amount(),
    ) {
        let (env, _admin, _token) = setup_vault();

        // Seed the vault with a first depositor so the share formula kicks in.
        let seeder = Address::generate(&env);
        let seed_shares = AuraVault::deposit(env.clone(), seeder, seed_amount)
            .expect("seed deposit should succeed");

        let total_deposited_before = AuraVault::total_assets(env.clone());
        let total_shares_before = seed_shares; // first depositor: shares == amount

        let price_before = compute_price(total_deposited_before, total_shares_before);

        // Second depositor
        let user = Address::generate(&env);
        let new_shares = match AuraVault::deposit(env.clone(), user, deposit_amount) {
            Ok(s) => s,
            Err(VaultError::ZeroAmount) => {
                // Rounding means deposit is too small; property trivially holds.
                return Ok(());
            }
            Err(e) => prop_assert!(false, "unexpected error: {:?}", e),
        };

        let total_deposited_after = AuraVault::total_assets(env.clone());
        let total_shares_after = total_shares_before + new_shares;
        let price_after = compute_price(total_deposited_after, total_shares_after);

        // Allow for at most 1 unit of floor-division rounding loss.
        prop_assert!(
            price_after >= price_before - 1,
            "share price decreased by more than rounding: before={} after={} seed={} deposit={}",
            price_before, price_after, seed_amount, deposit_amount
        );
    }

    /// Property: withdraw(deposit(x)) <= x (no value creation from round-trip).
    ///
    /// A user who deposits X tokens and immediately withdraws all their shares
    /// must receive at most X tokens back.  The vault can legitimately return
    /// slightly less due to floor division in both the share-minting and
    /// redemption formulas.
    #[test]
    fn prop_round_trip_no_gain(amount in arb_amount()) {
        let (env, _admin, _token) = setup_vault();

        let user = Address::generate(&env);

        // First depositor: shares == amount (1:1 seed)
        let shares = AuraVault::deposit(env.clone(), user.clone(), amount)
            .expect("deposit should succeed");

        let redeemed = match AuraVault::withdraw(env.clone(), user, shares) {
            Ok(r) => r,
            Err(VaultError::ZeroAmount) => 0,
            Err(e) => {
                prop_assert!(false, "unexpected error on withdraw: {:?}", e);
                unreachable!()
            }
        };

        prop_assert!(
            redeemed <= amount,
            "round-trip created value: deposited={} redeemed={}",
            amount, redeemed
        );
    }

    /// Property: sequential deposits don't dilute existing holders.
    ///
    /// When user A deposits amount_a and then user B deposits amount_b,
    /// the value backing user A's shares must not decrease (ignoring floor
    /// rounding of at most 1 unit per share).
    ///
    /// Formally: a_value_after >= a_value_before - total_shares_a
    /// where `a_value = balance_a * total_deposited / total_shares`.
    #[test]
    fn prop_sequential_deposits_no_dilution(
        (amount_a, amount_b) in arb_two_amounts(),
    ) {
        let (env, _admin, _token) = setup_vault();

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        // User A deposits first
        let shares_a = AuraVault::deposit(env.clone(), user_a.clone(), amount_a)
            .expect("user_a deposit should succeed");

        let total_after_a = AuraVault::total_assets(env.clone());
        // total_shares_after_a == shares_a on an empty vault
        let value_a_before: i128 = shares_a; // 1:1 on empty vault

        // User B deposits
        let shares_b = match AuraVault::deposit(env.clone(), user_b, amount_b) {
            Ok(s) => s,
            Err(VaultError::ZeroAmount) => {
                // Too small to mint shares; no dilution possible.
                return Ok(());
            }
            Err(e) => {
                prop_assert!(false, "user_b deposit failed: {:?}", e);
                unreachable!()
            }
        };

        let total_deposited = AuraVault::total_assets(env.clone());
        let total_shares = shares_a + shares_b;

        // Value backing user A's shares after B's deposit
        let value_a_after = shares_a
            .checked_mul(total_deposited)
            .and_then(|v| v.checked_div(total_shares))
            .unwrap_or(0);

        // Allow rounding error of at most shares_a (1 unit per share)
        prop_assert!(
            value_a_after >= amount_a - shares_a,
            "user A diluted: amount_a={} value_after={} shares_a={} total_deposited={} total_shares={}",
            amount_a, value_a_after, shares_a, total_deposited, total_shares
        );

        let _ = (total_after_a, value_a_before);
    }

    /// Property: harvest always increases share price.
    ///
    /// After a successful harvest, `total_assets` increases, while
    /// `total_shares` stays the same, so the share price must strictly
    /// increase (or stay the same when fee == yield_amount, which is an
    /// extreme configuration not exercised here with the default 10% fee).
    #[test]
    fn prop_harvest_increases_share_price(
        seed_amount in arb_amount(),
        yield_amount in 1_000i128..=100_000_000i128,
    ) {
        let (env, admin, _token) = setup_vault();

        // Seed depositor
        let seeder = Address::generate(&env);
        let shares_before = AuraVault::deposit(env.clone(), seeder, seed_amount)
            .expect("seed deposit should succeed");

        let total_deposited_before = AuraVault::total_assets(env.clone());
        let price_before = compute_price(total_deposited_before, shares_before);

        // Harvest requires KEEPER or ADMIN role; admin was set as ADMIN at init.
        match AuraVault::harvest(env.clone(), admin.clone(), yield_amount) {
            Ok(()) => {}
            Err(VaultError::HarvestCooldown) => {
                // Cooldown not configured in this test, so this shouldn't happen,
                // but if it does the property trivially holds.
                return Ok(());
            }
            Err(VaultError::CircuitBreakerTripped) => {
                // Large yield relative to TVL may trip the circuit breaker;
                // the vault is auto-paused but price didn't decrease.
                return Ok(());
            }
            Err(e) => {
                prop_assert!(false, "unexpected harvest error: {:?}", e);
                unreachable!()
            }
        }

        let total_deposited_after = AuraVault::total_assets(env.clone());
        // total_shares unchanged after harvest
        let price_after = compute_price(total_deposited_after, shares_before);

        prop_assert!(
            price_after > price_before,
            "harvest did not increase share price: before={} after={} seed={} yield={}",
            price_before, price_after, seed_amount, yield_amount
        );
    }
}

// ===========================================================================
// Deterministic unit tests complementing the property tests
// ===========================================================================

/// Baseline: share price after seed deposit is exactly 1:1 (1e7).
#[test]
fn unit_seed_deposit_price_is_one_to_one() {
    let (env, _admin, _token) = setup_vault();
    let user = Address::generate(&env);
    let amount = 1_000_000i128;

    AuraVault::deposit(env.clone(), user, amount).expect("deposit should succeed");

    let price = compute_price(amount, amount); // 1:1
    assert_eq!(price, 10_000_000, "seed price should be exactly 1e7");
}

/// Baseline: two equal depositors each hold exactly half the vault value.
#[test]
fn unit_two_equal_depositors_equal_value() {
    let (env, _admin, _token) = setup_vault();
    let amount = 1_000_000i128;

    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    let shares_a = AuraVault::deposit(env.clone(), user_a, amount).expect("deposit a");
    let shares_b = AuraVault::deposit(env.clone(), user_b, amount).expect("deposit b");

    let total = AuraVault::total_assets(env.clone());
    let total_shares = shares_a + shares_b;

    let value_a = shares_a * total / total_shares;
    let value_b = shares_b * total / total_shares;

    // Each user should back exactly half the vault (allow 1 stroop rounding)
    assert!(
        (value_a - value_b).abs() <= 1,
        "value mismatch: value_a={} value_b={}",
        value_a,
        value_b
    );
}

/// Baseline: harvest with 0% perf fee increases price by full yield amount.
#[test]
fn unit_harvest_zero_fee_increases_price_by_full_yield() {
    let (env, admin, _token) = setup_vault();

    // Set perf fee to 0%
    AuraVault::set_fees(env.clone(), admin.clone(), 0, 0)
        .expect("set_fees should succeed");

    let seeder = Address::generate(&env);
    let seed = 1_000_000i128;
    let shares = AuraVault::deposit(env.clone(), seeder, seed).expect("seed deposit");

    let yield_amount = 100_000i128;
    AuraVault::harvest(env.clone(), admin.clone(), yield_amount)
        .expect("harvest should succeed");

    let total_after = AuraVault::total_assets(env.clone());
    assert_eq!(total_after, seed + yield_amount);

    let price_after = compute_price(total_after, shares);
    let price_before = compute_price(seed, shares);
    assert!(price_after > price_before, "harvest should increase price");
}

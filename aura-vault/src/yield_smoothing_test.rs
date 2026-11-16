//! Regression cases for linear yield vesting. These tests are intentionally
//! added without running the test suite for issue #1286.
#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;
use crate::{AuraVault, AuraVaultClient};

fn setup() -> (Env, AuraVaultClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token, &signers, &soroban_sdk::String::from_str(&env, "Aura Vault"), &soroban_sdk::String::from_str(&env, "AVS"));
    vault.set_fees(&admin, &0_u32, &0_u32);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);
    vault.deposit(&user, &1_000_000);
    (env, vault, admin, token, user)
}

fn harvest(env: &Env, vault: &AuraVaultClient, admin: &Address, token: &Address, amount: i128) {
    let keeper = Address::generate(env);
    StellarAssetClient::new(env, token).mint(&keeper, &amount);
    vault.harvest(&keeper, &amount);
    let _ = admin;
}

#[test]
fn defaults_to_seven_days_in_ledgers() {
    let (_env, vault, _admin, _token, _user) = setup();
    assert_eq!(vault.get_yield_vesting_period(), 120_960);
}

#[test]
fn harvest_does_not_immediately_raise_visible_assets() {
    let (env, vault, admin, token, _user) = setup();
    harvest(&env, &vault, &admin, &token, 700_000);
    assert_eq!(vault.total_assets(), 1_000_000);
}

#[test]
fn assets_vest_linearly_at_half_period() {
    let (env, vault, admin, token, _user) = setup();
    vault.set_yield_vesting_period(&admin, &200);
    harvest(&env, &vault, &admin, &token, 700_000);
    env.ledger().with_mut(|ledger| ledger.sequence_number += 100);
    assert_eq!(vault.total_assets(), 1_350_000);
}

#[test]
fn all_yield_is_visible_after_period() {
    let (env, vault, admin, token, _user) = setup();
    vault.set_yield_vesting_period(&admin, &200);
    harvest(&env, &vault, &admin, &token, 700_000);
    env.ledger().with_mut(|ledger| ledger.sequence_number += 200);
    assert_eq!(vault.total_assets(), 1_700_000);
}

#[test]
fn changing_period_preserves_currently_unvested_amount() {
    let (env, vault, admin, token, _user) = setup();
    vault.set_yield_vesting_period(&admin, &200);
    harvest(&env, &vault, &admin, &token, 700_000);
    env.ledger().with_mut(|ledger| ledger.sequence_number += 100);
    vault.set_yield_vesting_period(&admin, &100);
    assert_eq!(vault.total_assets(), 1_350_000);
    env.ledger().with_mut(|ledger| ledger.sequence_number += 100);
    assert_eq!(vault.total_assets(), 1_700_000);
}

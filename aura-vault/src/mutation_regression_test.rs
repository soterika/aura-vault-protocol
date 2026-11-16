#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Vec};

use crate::{AuraVault, AuraVaultClient, VaultError};

fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &contract);
    vault.initialize(&admin, &token, &Vec::new(&env), &0_u32);
    vault.set_fees(&admin, &0_u32, &0_u32);
    (env, vault, admin, token)
}

fn mint(env: &Env, token: &Address, admin: &Address, user: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(user, &amount);
}

#[test]
fn seed_deposit_mints_shares_one_to_one() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    assert_eq!(vault.deposit(&user, &1_000_000), 1_000_000);
    assert_eq!(vault.total_assets(), 1_000_000);
    assert_eq!(vault.total_shares(), 1_000_000);
}

#[test]
fn subsequent_deposit_uses_floor_share_conversion_after_yield() {
    let (env, vault, admin, token) = setup();
    let first = Address::generate(&env);
    let second = Address::generate(&env);
    mint(&env, &token, &admin, &first, 1_000_000);
    vault.deposit(&first, &1_000_000);
    mint(&env, &token, &admin, &first, 500_000);
    vault.harvest(&first, &500_000);
    mint(&env, &token, &admin, &second, 500_000);
    assert_eq!(vault.deposit(&second, &500_000), 333_333);
    assert_eq!(vault.balance_of(&second), 333_333);
}

#[test]
fn zero_deposit_is_rejected_without_mutating_totals() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    assert_eq!(vault.try_deposit(&user, &0), Err(Ok(VaultError::ZeroAmount)));
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.total_shares(), 0);
}

#[test]
fn zero_harvest_is_rejected_without_changing_share_price() {
    let (_env, vault, admin, _token) = setup();
    let before = vault.share_price();
    assert_eq!(vault.try_harvest(&admin, &0), Err(Ok(VaultError::ZeroAmount)));
    assert_eq!(vault.share_price(), before);
}

#[test]
fn withdrawal_cannot_burn_more_than_the_users_share_balance() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    assert_eq!(vault.try_withdraw(&user, &1_000_001), Err(Ok(VaultError::InsufficientShares)));
    assert_eq!(vault.balance_of(&user), 1_000_000);
}

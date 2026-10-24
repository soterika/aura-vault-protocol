#![cfg(test)]

use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, vec, Address, Env, Vec};

use crate::{AuraVault, AuraVaultClient};

#[test]
fn keeper_registration_and_successful_harvests_update_leaderboard() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_id = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_id);
    vault.initialize(
        &admin,
        &token,
        &Vec::<Address>::new(&env),
        &soroban_sdk::String::from_str(&env, "Aura Vault"),
        &soroban_sdk::String::from_str(&env, "AURA"),
    );
    vault.set_fees(&admin, &0, &0);

    let depositor = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&depositor, &1_000);
    vault.deposit(&depositor, &1_000);
    StellarAssetClient::new(&env, &token).mint(&admin, &300);
    vault.harvest(&admin, &100);
    vault.harvest(&admin, &200);

    let record = vault.get_keeper_stats(&admin).unwrap();
    assert_eq!(record.address, admin);
    assert_eq!(record.harvest_count, 2);
    assert_eq!(record.total_yield_harvested, 300);
    assert!(record.last_harvest_ledger > 0);
    assert_eq!(vault.get_top_keepers(&10), vec![&env, record]);
}

#[test]
fn registered_keeper_starts_with_zeroed_counters() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_id = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_id);
    vault.initialize(
        &admin,
        &token,
        &Vec::<Address>::new(&env),
        &soroban_sdk::String::from_str(&env, "Aura Vault"),
        &soroban_sdk::String::from_str(&env, "AURA"),
    );

    let keeper = Address::generate(&env);
    let record = vault.register_keeper(&keeper);
    assert_eq!(record.harvest_count, 0);
    assert_eq!(record.total_yield_harvested, 0);
    assert!(vault.get_keeper_stats(&keeper).is_some());
}

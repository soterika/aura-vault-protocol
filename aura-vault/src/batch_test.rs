#![cfg(test)]

use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, vec, Address, Env, Vec};

use crate::{AuraVault, AuraVaultClient};

fn setup() -> (Env, AuraVaultClient<'static>, Address, Address, Address) {
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
    let user = Address::generate(&env);
    (env, vault, admin, token, user)
}

#[test]
fn batch_deposit_and_withdraw_apply_all_amounts_atomically() {
    let (env, vault, admin, token, user) = setup();
    StellarAssetClient::new(&env, &token).mint(&user, &300);

    let minted = vault.batch_deposit(&user, &vec![&env, 100, 200]);
    assert_eq!(minted, vec![&env, 100, 200]);
    assert_eq!(vault.total_assets(), 300);
    assert_eq!(vault.balance_of(&user), 300);

    let redeemed = vault.batch_withdraw(&user, &vec![&env, 100, 200]);
    assert_eq!(redeemed, vec![&env, 100, 200]);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.balance_of(&user), 0);
    assert_eq!(StellarAssetClient::new(&env, &token).balance(&user), 300);
    let _ = admin;
}

#[test]
fn batch_deposit_rejects_more_than_twenty_operations() {
    let (env, vault, _admin, _token, user) = setup();
    let amounts = Vec::from_array(&env, [1_i128; 21]);
    assert!(vault.try_batch_deposit(&user, &amounts).is_err());
    assert_eq!(vault.total_assets(), 0);
}

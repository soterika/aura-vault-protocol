#![cfg(test)]

use aura_vault::{AuraVault, AuraVaultClient, ROLE_ADMIN, ROLE_GUARDIAN, ROLE_KEEPER};
use soroban_sdk::{testutils::{Address as _, Ledger}, vec, Address, Env};

#[test]
fn admin_transfer_updates_only_admin_role_bit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AuraVault, ());
    let client = AuraVaultClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &vec![&env, signer], &7);
    client.grant_role(&admin, &ROLE_GUARDIAN, &admin);
    client.grant_role(&admin, &ROLE_KEEPER, &new_admin);

    client.propose_admin(&admin, &new_admin);
    client.accept_admin(&new_admin);

    assert_eq!(client.get_roles(&admin), ROLE_GUARDIAN);
    assert_eq!(client.get_roles(&new_admin), ROLE_ADMIN | ROLE_KEEPER);
}

#[test]
fn expired_admin_nomination_is_not_reported_as_pending() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AuraVault, ());
    let client = AuraVaultClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &vec![&env, signer], &7);
    client.propose_admin(&admin, &new_admin);
    env.ledger().set_timestamp(48 * 60 * 60 + 1);

    assert_eq!(client.pending_admin(), None);
}

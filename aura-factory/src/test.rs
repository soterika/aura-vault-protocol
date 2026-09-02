#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraFactory, AuraFactoryClient, FactoryError};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Deploy + initialise a factory with no deployment fee (open factory).
fn setup() -> (Env, AuraFactoryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let factory_address = env.register(AuraFactory, ());
    let factory = AuraFactoryClient::new(&env, &factory_address);

    factory.initialize(&admin, &0_i128);

    (env, factory, admin)
}

/// Deploy + initialise a factory with a deployment fee (for future fee-path tests).
#[allow(dead_code)]
fn setup_with_fee(fee: i128) -> (Env, AuraFactoryClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let factory_address = env.register(AuraFactory, ());
    let factory = AuraFactoryClient::new(&env, &factory_address);

    // Mint some XLM to a payer address using a stellar asset contract.
    let xlm_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let payer = Address::generate(&env);
    StellarAssetClient::new(&env, &xlm_address).mint(&payer, &(fee * 10));

    factory.initialize(&admin, &fee);

    (env, factory, admin, payer)
}

/// Register `count` unique vaults and return their addresses in order.
fn register_n(
    env: &Env,
    factory: &AuraFactoryClient,
    admin: &Address,
    token: &Address,
    count: usize,
) -> std::vec::Vec<Address> {
    factory.whitelist_token(admin, token, &true);
    let caller = Address::generate(env);
    let mut vaults = std::vec::Vec::new();
    for _ in 0..count {
        let vault = Address::generate(env);
        factory.deploy_vault(&caller, &vault, token);
        vaults.push(vault);
    }
    vaults
}

// ---------------------------------------------------------------------------
// 1. Initialisation
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_sets_admin_and_fee() {
    let (_env, factory, _admin) = setup();
    assert_eq!(factory.get_deployment_fee(), 0);
    assert_eq!(factory.vault_count(), 0);
}

#[test]
fn test_double_initialize_returns_already_initialized() {
    let (_env, factory, admin) = setup();
    let result = factory.try_initialize(&admin, &0_i128);
    assert_eq!(result, Err(Ok(FactoryError::AlreadyInitialized)));
}

#[test]
fn test_vault_count_starts_at_zero() {
    let (_env, factory, _admin) = setup();
    assert_eq!(factory.vault_count(), 0);
}

// ---------------------------------------------------------------------------
// 2. Token whitelist
// ---------------------------------------------------------------------------

#[test]
fn test_whitelist_token_adds_token() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    assert!(!factory.is_token_whitelisted(&token));
    factory.whitelist_token(&admin, &token, &true);
    assert!(factory.is_token_whitelisted(&token));
}

#[test]
fn test_delist_token_removes_token() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    factory.whitelist_token(&admin, &token, &true);
    factory.whitelist_token(&admin, &token, &false);
    assert!(!factory.is_token_whitelisted(&token));
}

#[test]
fn test_whitelist_non_admin_returns_unauthorized() {
    let (env, factory, _admin) = setup();
    let rando = Address::generate(&env);
    let token = Address::generate(&env);
    let result = factory.try_whitelist_token(&rando, &token, &true);
    assert_eq!(result, Err(Ok(FactoryError::Unauthorized)));
}

// ---------------------------------------------------------------------------
// 3. Deployment fee
// ---------------------------------------------------------------------------

#[test]
fn test_set_deployment_fee_updates_value() {
    let (_env, factory, admin) = setup();
    factory.set_deployment_fee(&admin, &5_000_000_i128);
    assert_eq!(factory.get_deployment_fee(), 5_000_000);
}

#[test]
fn test_set_deployment_fee_zero_disables_fee() {
    let (_env, factory, admin) = setup();
    factory.set_deployment_fee(&admin, &1_000_i128);
    factory.set_deployment_fee(&admin, &0_i128);
    assert_eq!(factory.get_deployment_fee(), 0);
}

#[test]
fn test_set_deployment_fee_non_admin_returns_unauthorized() {
    let (env, factory, _admin) = setup();
    let rando = Address::generate(&env);
    let result = factory.try_set_deployment_fee(&rando, &100_i128);
    assert_eq!(result, Err(Ok(FactoryError::Unauthorized)));
}

// ---------------------------------------------------------------------------
// 4. deploy_vault — happy path
// ---------------------------------------------------------------------------

#[test]
fn test_deploy_vault_returns_vault_address() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    let vault = Address::generate(&env);
    factory.whitelist_token(&admin, &token, &true);
    let returned = factory.deploy_vault(&Address::generate(&env), &vault, &token);
    assert_eq!(returned, vault);
}

#[test]
fn test_deploy_vault_increments_count() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    factory.whitelist_token(&admin, &token, &true);
    let caller = Address::generate(&env);
    factory.deploy_vault(&caller, &Address::generate(&env), &token);
    factory.deploy_vault(&caller, &Address::generate(&env), &token);
    assert_eq!(factory.vault_count(), 2);
}

#[test]
fn test_deploy_vault_token_not_whitelisted_returns_error() {
    let (env, factory, _admin) = setup();
    let token = Address::generate(&env); // never whitelisted
    let vault = Address::generate(&env);
    let caller = Address::generate(&env);
    let result = factory.try_deploy_vault(&caller, &vault, &token);
    assert_eq!(result, Err(Ok(FactoryError::TokenNotWhitelisted)));
}

#[test]
fn test_deploy_vault_duplicate_returns_error() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    let vault = Address::generate(&env);
    factory.whitelist_token(&admin, &token, &true);
    let caller = Address::generate(&env);
    factory.deploy_vault(&caller, &vault, &token);
    let result = factory.try_deploy_vault(&caller, &vault, &token);
    assert_eq!(result, Err(Ok(FactoryError::VaultAlreadyRegistered)));
}

// ---------------------------------------------------------------------------
// 5. list_vaults — pagination
// ---------------------------------------------------------------------------

#[test]
fn test_list_vaults_empty_returns_empty_vec() {
    let (_env, factory, _admin) = setup();
    let result = factory.list_vaults(&0_u32, &10_u32);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_list_vaults_page_zero_returns_first_page() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    let vaults = register_n(&env, &factory, &admin, &token, 5);

    let page = factory.list_vaults(&0_u32, &3_u32);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap(), vaults[0]);
    assert_eq!(page.get(1).unwrap(), vaults[1]);
    assert_eq!(page.get(2).unwrap(), vaults[2]);
}

#[test]
fn test_list_vaults_page_one_returns_remainder() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    let vaults = register_n(&env, &factory, &admin, &token, 5);

    let page = factory.list_vaults(&1_u32, &3_u32);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), vaults[3]);
    assert_eq!(page.get(1).unwrap(), vaults[4]);
}

#[test]
fn test_list_vaults_beyond_last_page_returns_empty() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    register_n(&env, &factory, &admin, &token, 3);

    // Page 1 with page_size 5: only 3 vaults total, all on page 0.
    let page = factory.list_vaults(&1_u32, &5_u32);
    assert_eq!(page.len(), 0);
}

#[test]
fn test_list_vaults_page_size_one_iterates_individually() {
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    let vaults = register_n(&env, &factory, &admin, &token, 3);

    for (i, expected) in vaults.iter().enumerate() {
        let page = factory.list_vaults(&(i as u32), &1_u32);
        assert_eq!(page.len(), 1);
        assert_eq!(&page.get(0).unwrap(), expected);
    }
}

#[test]
fn test_list_vaults_zero_page_size_returns_invalid_page() {
    let (_env, factory, _admin) = setup();
    let result = factory.try_list_vaults(&0_u32, &0_u32);
    assert_eq!(result, Err(Ok(FactoryError::InvalidPage)));
}

#[test]
fn test_list_vaults_exact_page_boundary() {
    // 4 vaults, page_size = 2 → page 0 = [0,1], page 1 = [2,3]
    let (env, factory, admin) = setup();
    let token = Address::generate(&env);
    let vaults = register_n(&env, &factory, &admin, &token, 4);

    let p0 = factory.list_vaults(&0_u32, &2_u32);
    assert_eq!(p0.len(), 2);
    assert_eq!(p0.get(0).unwrap(), vaults[0]);
    assert_eq!(p0.get(1).unwrap(), vaults[1]);

    let p1 = factory.list_vaults(&1_u32, &2_u32);
    assert_eq!(p1.len(), 2);
    assert_eq!(p1.get(0).unwrap(), vaults[2]);
    assert_eq!(p1.get(1).unwrap(), vaults[3]);
}

// ---------------------------------------------------------------------------
// 6. Error path — not initialized
// ---------------------------------------------------------------------------

#[test]
fn test_deploy_vault_before_init_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let factory_address = env.register(AuraFactory, ());
    let factory = AuraFactoryClient::new(&env, &factory_address);

    let token = Address::generate(&env);
    let vault = Address::generate(&env);
    let caller = Address::generate(&env);
    let result = factory.try_deploy_vault(&caller, &vault, &token);
    assert_eq!(result, Err(Ok(FactoryError::NotInitialized)));
}

#[test]
fn test_whitelist_before_init_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let factory_address = env.register(AuraFactory, ());
    let factory = AuraFactoryClient::new(&env, &factory_address);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let result = factory.try_whitelist_token(&admin, &token, &true);
    assert_eq!(result, Err(Ok(FactoryError::NotInitialized)));
}

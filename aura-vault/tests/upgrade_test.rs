#![cfg(test)]

//! Local Soroban host test for the state-preservation contract upgrade path.
//! No RPC, Horizon, or testnet account is used.

use aura_vault::{AuraVault, AuraVaultClient};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, Vec,
};

fn registered_test_wasm_hash(env: &Env, contract_id: &Address) -> BytesN<32> {
    // Native test registration installs deterministic code under the hash of
    // this contract-id-specific byte string.
    let code = std::format!("test_contract_for_contract_id_{}", contract_id.to_string());
    env.crypto()
        .sha256(&Bytes::from_slice(env, code.as_bytes()))
        .into()
}

#[test]
fn upgrade_preserves_three_depositor_state_and_accepts_new_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(AuraVault, ());
    let vault = AuraVaultClient::new(&env, &contract_id);
    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token, &signers, &7);
    vault.set_fees(&admin, &0, &0);

    let users = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let token_admin = StellarAssetClient::new(&env, &token);
    for (user, amount) in users.iter().zip([1_000_000_i128, 2_000_000, 3_000_000]) {
        token_admin.mint(user, &amount);
        vault.deposit(user, &amount);
    }

    // Realize yield so the preserved exchange rate is not the seed 1:1 price.
    token_admin.mint(&admin, &900_000);
    vault.harvest(&admin, &900_000);
    vault.pause(&admin);

    let assets_before = vault.total_assets();
    let shares_before = vault.total_shares();
    let balances_before: [i128; 3] = users.each_ref().map(|user| vault.balance_of(user));
    let share_price_before = assets_before * 10_000_000 / shares_before;
    assert!(vault.is_paused());

    // Upgrade to the already-registered v1 test code. The contract's upgrade
    // counter supplies the version bump; no RPC or external Wasm artifact is
    // needed to exercise storage preservation in the local host.
    vault.upgrade(&registered_test_wasm_hash(&env, &contract_id));

    let assets_after = vault.total_assets();
    let shares_after = vault.total_shares();
    let balances_after: [i128; 3] = users.each_ref().map(|user| vault.balance_of(user));
    let share_price_after = assets_after * 10_000_000 / shares_after;
    println!(
        "before: assets={assets_before}, shares={shares_before}, balances={balances_before:?}, share_price={share_price_before}, paused=true"
    );
    println!(
        "after:  assets={assets_after}, shares={shares_after}, balances={balances_after:?}, share_price={share_price_after}, paused={}",
        vault.is_paused()
    );

    assert_eq!(assets_after, assets_before);
    assert_eq!(shares_after, shares_before);
    assert_eq!(balances_after, balances_before);
    assert_eq!(share_price_after, share_price_before);
    assert!(vault.is_paused());

    vault.unpause(&admin);
    let newcomer = Address::generate(&env);
    token_admin.mint(&newcomer, &500_000);
    assert!(vault.deposit(&newcomer, &500_000) > 0);
    assert_eq!(vault.balance_of(&newcomer), 500_000 * shares_before / assets_before);
}

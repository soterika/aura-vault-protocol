#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, token, token::StellarAssetClient,
    Address, Env, Vec,
};

use crate::{AuraVault, AuraVaultClient, VaultError};

#[contract]
struct MockYieldStrategy;

#[contracttype]
enum StrategyKey { Token, Assets }

#[contractimpl]
impl MockYieldStrategy {
    fn set_token(env: Env, token: Address) {
        env.storage().instance().set(&StrategyKey::Token, &token);
        env.storage().instance().set(&StrategyKey::Assets, &0_i128);
    }

    fn deposit(env: Env, amount: i128) -> Result<(), VaultError> {
        let assets = env.storage().instance().get::<_, i128>(&StrategyKey::Assets).unwrap_or(0);
        env.storage().instance().set(&StrategyKey::Assets, &assets.checked_add(amount).ok_or(VaultError::MathOverflow)?);
        Ok(())
    }

    fn withdraw(env: Env, amount: i128) -> Result<i128, VaultError> {
        let assets = env.storage().instance().get::<_, i128>(&StrategyKey::Assets).unwrap_or(0);
        if amount > assets { return Err(VaultError::InsufficientUnderlying); }
        let token = env.storage().instance().get::<_, Address>(&StrategyKey::Token).ok_or(VaultError::NotInitialized)?;
        env.storage().instance().set(&StrategyKey::Assets, &(assets - amount));
        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &env.invoker(), &amount);
        Ok(amount)
    }

    fn harvest(_env: Env) -> Result<i128, VaultError> { Ok(0) }

    fn total_assets(env: Env) -> i128 {
        env.storage().instance().get(&StrategyKey::Assets).unwrap_or(0)
    }
}

#[test]
fn strategy_approval_forwards_deposits_and_returns_withdrawal_liquidity() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let signer_a = Address::generate(&env);
    let signer_b = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_id = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_id);
    let signers = Vec::from_array(&env, [signer_a.clone(), signer_b.clone()]);
    vault.initialize(
        &admin,
        &token,
        &signers,
        &soroban_sdk::String::from_str(&env, "Aura Vault"),
        &soroban_sdk::String::from_str(&env, "AURA"),
    );
    vault.set_fees(&admin, &0, &0);
    let strategy_id = env.register(MockYieldStrategy, ());
    MockYieldStrategyClient::new(&env, &strategy_id).set_token(&token);
    let proposal = vault.propose_strategy_update(&signer_a, &strategy_id);
    vault.vote(&signer_b, &proposal, &true);
    env.ledger().with_mut(|ledger| ledger.timestamp += 86_401);
    vault.execute(&signer_a, &proposal);

    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &500);
    vault.deposit(&user, &500);
    assert_eq!(vault.total_assets(), 500);
    assert_eq!(vault.get_active_strategy(), Some(strategy_id.clone()));
    assert_eq!(token::Client::new(&env, &token).balance(&strategy_id), 500);

    let redeemed = vault.withdraw(&user, &500);
    assert_eq!(redeemed, 500);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(token::Client::new(&env, &token).balance(&user), 500);
}

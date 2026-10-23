#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, token, token::StellarAssetClient,
    Address, Env, Vec,
};

use crate::{AuraVault, AuraVaultClient, VaultError};

#[contract]
struct MockTwapOracle;

#[contracttype]
enum OracleKey {
    Spot(Address),
    Twap(Address),
}

#[contractimpl]
impl MockTwapOracle {
    fn set_prices(env: Env, token: Address, spot: i128, twap: i128, updated_at: u64) {
        env.storage().instance().set(&OracleKey::Spot(token.clone()), &(spot, updated_at));
        env.storage().instance().set(&OracleKey::Twap(token), &(twap, updated_at));
    }

    fn price(env: Env, token: Address) -> (i128, u64) {
        env.storage().instance().get(&OracleKey::Spot(token)).unwrap_or((0, 0))
    }

    fn twap_price(env: Env, token: Address, _lookback_secs: u64) -> (i128, u64) {
        env.storage().instance().get(&OracleKey::Twap(token)).unwrap_or((0, 0))
    }
}

#[contract]
struct MockSwapRouter;

#[contracttype]
enum RouterKey { OutputAmount }

#[contractimpl]
impl MockSwapRouter {
    fn set_output(env: Env, amount: i128) {
        env.storage().instance().set(&RouterKey::OutputAmount, &amount);
    }

    fn swap_exact_input(
        env: Env,
        _token_in: Address,
        token_out: Address,
        _amount_in: i128,
        min_amount_out: i128,
        recipient: Address,
    ) -> i128 {
        let amount = env.storage().instance().get::<_, i128>(&RouterKey::OutputAmount).unwrap_or(0);
        if amount < min_amount_out { return 0; }
        token::Client::new(&env, &token_out)
            .transfer(&env.current_contract_address(), &recipient, &amount);
        amount
    }
}

#[test]
fn swap_output_below_twap_slippage_floor_is_rejected_atomically() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let underlying = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let input = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_id = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_id);
    vault.initialize(
        &admin,
        &underlying,
        &Vec::<Address>::new(&env),
        &soroban_sdk::String::from_str(&env, "Aura Vault"),
        &soroban_sdk::String::from_str(&env, "AURA"),
    );
    vault.set_fees(&admin, &0, &0);
    let depositor = Address::generate(&env);
    StellarAssetClient::new(&env, &underlying).mint(&depositor, &1_000);
    vault.deposit(&depositor, &1_000);

    let oracle_id = env.register(MockTwapOracle, ());
    let router_id = env.register(MockSwapRouter, ());
    let now = env.ledger().timestamp();
    let oracle = MockTwapOracleClient::new(&env, &oracle_id);
    // A sandwich moves spot by 100% while the 30-minute reference stays at 100.
    oracle.set_prices(&input, &200, &100, &now);
    oracle.set_prices(&underlying, &100, &100, &now);
    MockSwapRouterClient::new(&env, &router_id).set_output(&90);
    StellarAssetClient::new(&env, &underlying).mint(&router_id, &90);
    StellarAssetClient::new(&env, &input).mint(&depositor, &100);
    vault.set_oracle_address(&admin, &oracle_id);
    vault.set_swap_config(&admin, &router_id, &500, &1_800, &500);

    let result = vault.try_deposit_with_swap(&depositor, &input, &100, &1);
    assert_eq!(result, Err(Ok(VaultError::OraclePriceTooHigh)));
    assert_eq!(vault.total_assets(), 1_000);
    assert_eq!(vault.balance_of(&depositor), 1_000);
}

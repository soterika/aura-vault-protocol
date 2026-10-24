//! Optional Soroban yield-strategy adapter used by AuraVault.
use soroban_sdk::{contractclient, token, Address, Env};

use crate::{errors::VaultError, storage};

#[contractclient(name = "YieldStrategyClient")]
pub trait YieldStrategy {
    /// Invest tokens already transferred to the strategy by AuraVault.
    fn deposit(env: Env, amount: i128) -> Result<(), VaultError>;
    /// Return at least `amount` underlying tokens to AuraVault.
    fn withdraw(env: Env, amount: i128) -> Result<i128, VaultError>;
    /// Realize strategy yield and transfer it to AuraVault, returning gross yield.
    fn harvest(env: Env) -> Result<i128, VaultError>;
    /// Return the current underlying value managed by the strategy.
    fn total_assets(env: Env) -> i128;
}

pub fn assets(env: &Env) -> Result<i128, VaultError> {
    match storage::get_active_strategy(env) {
        Some(address) => {
            let value = YieldStrategyClient::new(env, &address).total_assets();
            if value < 0 { return Err(VaultError::MathOverflow); }
            Ok(value)
        }
        None => Ok(0),
    }
}

pub fn managed_balance(env: &Env, token: &token::Client) -> Result<i128, VaultError> {
    token.balance(&env.current_contract_address())
        .checked_add(assets(env)?)
        .ok_or(VaultError::MathOverflow)
}

pub fn deposit(env: &Env, token: &token::Client, amount: i128) -> Result<(), VaultError> {
    if amount <= 0 { return Ok(()); }
    if let Some(strategy) = storage::get_active_strategy(env) {
        let vault = env.current_contract_address();
        token.transfer(&vault, &strategy, &amount);
        YieldStrategyClient::new(env, &strategy).deposit(&amount);
    }
    Ok(())
}

pub fn ensure_liquidity(env: &Env, token: &token::Client, amount: i128) -> Result<(), VaultError> {
    let vault = env.current_contract_address();
    let liquid = token.balance(&vault);
    if liquid >= amount { return Ok(()); }
    let strategy = storage::get_active_strategy(env).ok_or(VaultError::InsufficientUnderlying)?;
    let needed = amount.checked_sub(liquid).ok_or(VaultError::MathOverflow)?;
    let returned = YieldStrategyClient::new(env, &strategy).withdraw(&needed);
    if returned < needed || token.balance(&vault) < amount {
        return Err(VaultError::InsufficientUnderlying);
    }
    Ok(())
}

pub fn validate_address(env: &Env, address: &Address) -> Result<(), VaultError> {
    // Calling the required view proves this is a conformant contract address.
    let assets = YieldStrategyClient::new(env, address).total_assets();
    if assets < 0 { return Err(VaultError::MathOverflow); }
    Ok(())
}

pub fn harvest(env: &Env) -> Result<i128, VaultError> {
    let address = storage::get_active_strategy(env).ok_or(VaultError::NotInitialized)?;
    let amount = YieldStrategyClient::new(env, &address).harvest();
    if amount < 0 { return Err(VaultError::MathOverflow); }
    Ok(amount)
}

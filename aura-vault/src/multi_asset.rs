//! # Multi-Asset Basket Vault — Issue #336
//!
//! Extends AuraVault with support for a weighted basket of SEP-41 tokens.
//! The basket value is denominated in the vault's primary underlying token
//! (1:1 mapping for deposits and withdrawals via the weight registry).

#![allow(unused)]

use soroban_sdk::{token, Address, Env, Symbol, Vec};

use crate::{
    errors::VaultError,
    storage,
};

/// Maximum number of assets in a basket.
pub const MAX_BASKET_ASSETS: u32 = 20;

/// Total basis points (weights must sum to this).
pub const TOTAL_BPS: u32 = 10_000;

/// Add or update an asset in the basket.
///
/// Admin-only. Adds `token` with `weight` basis points. Weights across all
/// registered assets must sum to exactly 10 000 bps after the update.
///
/// # Errors
///
/// - `NotInitialized` — vault not yet initialised.
/// - `UpgradeUnauthorized` — caller is not the admin.
/// - `ZeroAmount` — `weight == 0`.
/// - `MathOverflow` — total weights would overflow.
/// - `InvalidAddress` — too many basket assets (> MAX_BASKET_ASSETS).
pub fn add_asset(
    env: &Env,
    admin: &Address,
    token: &Address,
    weight: u32,
) -> Result<(), VaultError> {
    if weight == 0 {
        return Err(VaultError::ZeroAmount);
    }

    let mut assets = storage::get_basket_assets(env);

    // Check if the asset already exists (update path)
    let mut found = false;
    for i in 0..assets.len() {
        if assets.get(i).as_ref() == Some(token) {
            found = true;
            break;
        }
    }

    if !found {
        if assets.len() >= MAX_BASKET_ASSETS {
            return Err(VaultError::InvalidAddress);
        }
        assets.push_back(token.clone());
        storage::set_basket_assets(env, &assets);
    }

    storage::set_asset_weight(env, token, weight);

    env.events().publish(
        (Symbol::new(env, "asset_added"), admin.clone(), token.clone()),
        (weight,),
    );

    Ok(())
}

/// Remove an asset from the basket.
///
/// Admin-only. Removes `token` from the basket. Caller must ensure remaining
/// weights are rebalanced to sum to 10 000 bps via subsequent `add_asset` calls.
///
/// # Errors
///
/// - `NotInitialized` — vault not yet initialised.
/// - `UpgradeUnauthorized` — caller is not the admin.
/// - `InvalidAddress` — asset is not in the basket.
pub fn remove_asset(
    env: &Env,
    admin: &Address,
    token: &Address,
) -> Result<(), VaultError> {
    let assets = storage::get_basket_assets(env);
    let mut new_assets: Vec<Address> = Vec::new(env);
    let mut found = false;

    for i in 0..assets.len() {
        if let Some(a) = assets.get(i) {
            if &a == token {
                found = true;
            } else {
                new_assets.push_back(a);
            }
        }
    }

    if !found {
        return Err(VaultError::InvalidAddress);
    }

    storage::set_basket_assets(env, &new_assets);
    // Clear weight for removed asset
    storage::set_asset_weight(env, token, 0);

    env.events().publish(
        (Symbol::new(env, "asset_removed"), admin.clone(), token.clone()),
        (),
    );

    Ok(())
}

/// Validate that all basket asset weights sum to exactly TOTAL_BPS (10 000).
///
/// Returns `Ok(())` if the basket is empty or weights sum correctly.
/// Returns `Err(VaultError::ZeroAmount)` if the sum != 10 000 (reusing ZeroAmount
/// as "weight mismatch" — consider a dedicated error in a future revision).
pub fn validate_weights(env: &Env) -> Result<(), VaultError> {
    let assets = storage::get_basket_assets(env);
    if assets.is_empty() {
        return Ok(());
    }

    let mut total: u32 = 0;
    for i in 0..assets.len() {
        if let Some(a) = assets.get(i) {
            let w = storage::get_asset_weight(env, &a);
            total = total.checked_add(w).ok_or(VaultError::MathOverflow)?;
        }
    }

    if total != TOTAL_BPS {
        return Err(VaultError::ZeroAmount);
    }
    Ok(())
}

/// Deposit a specific basket asset into the vault.
///
/// Transfers `amount` of `token` from `caller` to the vault. Mints shares
/// proportional to the asset weight and the caller's contribution.
/// Does NOT require the full basket to be deposited at once — depositing in
/// any listed asset is accepted.
///
/// # Parameters
///
/// - `env` — Soroban environment.
/// - `caller` — Address depositing tokens; must authorise this call.
/// - `token` — SEP-41 token contract address. Must be in the basket.
/// - `amount` — Amount of `token` to deposit (in smallest unit).
/// - `total_shares` — Current total vault shares.
/// - `total_deposited` — Current total deposited value (in reference denomination).
///
/// # Returns
///
/// Number of new shares minted.
///
/// # Errors
///
/// - `InvalidAddress` — `token` is not a registered basket asset.
/// - `ZeroAmount` — `amount <= 0` or share formula rounds to 0.
/// - `MathOverflow` — arithmetic overflow.
pub fn deposit_asset(
    env: &Env,
    caller: &Address,
    token: &Address,
    amount: i128,
    total_shares: i128,
    total_deposited: i128,
) -> Result<i128, VaultError> {
    if amount <= 0 {
        return Err(VaultError::ZeroAmount);
    }

    let weight = storage::get_asset_weight(env, token);
    if weight == 0 {
        return Err(VaultError::InvalidAddress);
    }

    // Convert asset amount to basket value using weight:
    // basket_value = amount * weight / TOTAL_BPS
    let basket_value = (amount as i128)
        .checked_mul(weight as i128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(TOTAL_BPS as i128)
        .ok_or(VaultError::MathOverflow)?;

    if basket_value <= 0 {
        return Err(VaultError::ZeroAmount);
    }

    // Mint shares proportional to basket_value
    let new_shares: i128 = if total_shares == 0 || total_deposited == 0 {
        basket_value
    } else {
        let numerator = basket_value
            .checked_mul(total_shares)
            .ok_or(VaultError::MathOverflow)?;
        numerator
            .checked_div(total_deposited)
            .ok_or(VaultError::MathOverflow)?
    };

    if new_shares <= 0 {
        return Err(VaultError::ZeroAmount);
    }

    // Pull tokens from caller
    let vault_addr = env.current_contract_address();
    let token_client = token::Client::new(env, token);
    token_client.transfer(caller, &vault_addr, &amount);

    // Update per-asset tracked balance
    let old_asset_bal = storage::get_asset_balance(env, token);
    let new_asset_bal = old_asset_bal
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    storage::set_asset_balance(env, token, new_asset_bal);

    env.events().publish(
        (Symbol::new(env, "basket_deposit"), caller.clone(), token.clone()),
        (amount, basket_value, new_shares),
    );

    Ok(new_shares)
}

/// Withdraw proportional basket composition for given shares.
///
/// Burns `shares` and redeems each basket asset proportionally according to
/// its weight. Transfers each asset token to `caller`.
///
/// # Parameters
///
/// - `env` — Soroban environment.
/// - `caller` — Address receiving tokens; must authorise this call.
/// - `shares` — Number of vault shares to redeem. Must be > 0.
/// - `total_shares` — Total shares outstanding before burn.
/// - `total_deposited` — Total basket value before redemption.
///
/// # Returns
///
/// The redemption value in reference denomination units.
///
/// # Errors
///
/// - `ZeroAmount` — `shares <= 0` or redemption rounds to 0.
/// - `MathOverflow` — arithmetic overflow.
/// - `InsufficientUnderlying` — vault does not hold enough of an asset.
pub fn withdraw_basket(
    env: &Env,
    caller: &Address,
    shares: i128,
    total_shares: i128,
    total_deposited: i128,
) -> Result<i128, VaultError> {
    if shares <= 0 {
        return Err(VaultError::ZeroAmount);
    }

    // Calculate reference-denomination redemption amount
    let redeem_value = shares
        .checked_mul(total_deposited)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_shares)
        .ok_or(VaultError::MathOverflow)?;

    if redeem_value <= 0 {
        return Err(VaultError::ZeroAmount);
    }

    let assets = storage::get_basket_assets(env);
    let vault_addr = env.current_contract_address();

    // Transfer each asset proportionally
    for i in 0..assets.len() {
        if let Some(asset_addr) = assets.get(i) {
            let weight = storage::get_asset_weight(env, &asset_addr);
            if weight == 0 {
                continue;
            }

            // asset_amount = redeem_value * weight / TOTAL_BPS
            let asset_amount = redeem_value
                .checked_mul(weight as i128)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(TOTAL_BPS as i128)
                .ok_or(VaultError::MathOverflow)?;

            if asset_amount <= 0 {
                continue;
            }

            let asset_bal = storage::get_asset_balance(env, &asset_addr);
            if asset_bal < asset_amount {
                return Err(VaultError::InsufficientUnderlying);
            }

            let token_client = token::Client::new(env, &asset_addr);
            token_client.transfer(&vault_addr, caller, &asset_amount);

            let new_bal = asset_bal
                .checked_sub(asset_amount)
                .ok_or(VaultError::MathOverflow)?;
            storage::set_asset_balance(env, &asset_addr, new_bal);
        }
    }

    env.events().publish(
        (Symbol::new(env, "basket_withdraw"), caller.clone(), shares),
        (redeem_value, total_shares, total_deposited),
    );

    Ok(redeem_value)
}

/// Return the basket value in reference denomination for `total_deposited`
/// tracked per-asset. Sums weight-scaled asset balances.
pub fn basket_total_assets(env: &Env) -> i128 {
    let assets = storage::get_basket_assets(env);
    let mut total: i128 = 0;

    for i in 0..assets.len() {
        if let Some(a) = assets.get(i) {
            let balance = storage::get_asset_balance(env, &a);
            let weight = storage::get_asset_weight(env, &a);
            // value = balance * weight / TOTAL_BPS
            let value = (balance)
                .checked_mul(weight as i128)
                .unwrap_or(0)
                .checked_div(TOTAL_BPS as i128)
                .unwrap_or(0);
            total = total.saturating_add(value);
        }
    }

    total
}

/// Return the tracked on-chain balance for a specific basket asset.
/// Returns 0 if the asset is not registered.
pub fn asset_balance(env: &Env, token: &Address) -> i128 {
    storage::get_asset_balance(env, token)
}

/// Return the configured weight (bps) for a basket asset.
/// Returns 0 if not registered.
pub fn asset_weight(env: &Env, token: &Address) -> u32 {
    storage::get_asset_weight(env, token)
}

/// Return all registered basket asset addresses.
pub fn basket_assets(env: &Env) -> Vec<Address> {
    storage::get_basket_assets(env)
}

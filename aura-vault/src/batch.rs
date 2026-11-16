//! Atomic bounded batch operations for a single vault caller.
use soroban_sdk::{token, Address, Env, Symbol, Vec};

use crate::{
    errors::VaultError,
    storage::{self, get_admin, get_balance, get_token, get_total_deposited, get_total_shares, set_balance, set_total_deposited, set_total_shares},
};

pub const MAX_BATCH_SIZE: u32 = 20;

fn validate_batch_len<T>(items: &Vec<T>) -> Result<(), VaultError> {
    if items.is_empty() || items.len() > MAX_BATCH_SIZE {
        return Err(VaultError::InvalidAddress);
    }
    Ok(())
}

pub fn deposit(env: &Env, caller: &Address, amounts: Vec<i128>) -> Result<Vec<i128>, VaultError> {
    validate_batch_len(&amounts)?;
    caller.require_auth();
    if get_admin(env).is_none() { return Err(VaultError::NotInitialized); }
    if storage::is_paused(env) { return Err(VaultError::VaultPaused); }
    if storage::get_whitelist_enabled(env) && !storage::is_whitelisted(env, caller) {
        return Err(VaultError::NotWhitelisted);
    }

    let token_address = get_token(env).ok_or(VaultError::NotInitialized)?;
    let token = token::Client::new(env, &token_address);
    let vault_address = env.current_contract_address();
    let deposited = get_total_deposited(env);
    crate::assert_managed_balance(env, &token)?;

    let mut running_assets = deposited;
    let mut running_shares = get_total_shares(env);
    let mut total_amount: i128 = 0;
    let mut minted = Vec::new(env);
    for amount in amounts.iter() {
        if amount <= 0 { return Err(VaultError::ZeroAmount); }
        let minimum = storage::get_min_deposit(env);
        if minimum > 0 && amount < minimum { return Err(VaultError::BelowMinDeposit); }
        total_amount = total_amount.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        let shares = if running_shares == 0 || running_assets == 0 {
            amount
        } else {
            amount.checked_mul(running_shares)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(running_assets)
                .ok_or(VaultError::MathOverflow)?
        };
        if shares <= 0 { return Err(VaultError::ZeroAmount); }
        running_assets = running_assets.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        running_shares = running_shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;
        minted.push_back(shares);
    }
    let cap = storage::get_tvl_cap(env);
    if cap > 0 && running_assets > cap { return Err(VaultError::TvlCapExceeded); }

    // Perform the single external token interaction only after every item validates.
    let before = token.balance(&vault_address);
    token.transfer(caller, &vault_address, &total_amount);
    crate::assert_incoming_transfer(&token, &vault_address, before, total_amount)?;
    crate::strategy::deposit(env, &token, total_amount)?;

    let total_minted = running_shares.checked_sub(get_total_shares(env)).ok_or(VaultError::MathOverflow)?;
    let new_balance = get_balance(env, caller).checked_add(total_minted).ok_or(VaultError::MathOverflow)?;
    set_balance(env, caller, new_balance);
    storage::set_user_checkpoint(env, caller, storage::get_cumulative_yps(env));
    storage::set_user_pending_yield(env, caller, storage::get_user_pending_yield(env, caller));
    set_total_shares(env, running_shares);
    set_total_deposited(env, running_assets);
    storage::bump_persistent(env, caller);
    storage::bump_instance(env);
    env.events().publish(
        (Symbol::new(env, "batch_deposit"), caller.clone()),
        (amounts, minted.clone(), total_amount, total_minted, running_shares, running_assets),
    );
    Ok(minted)
}

pub fn withdraw(env: &Env, caller: &Address, shares: Vec<i128>) -> Result<Vec<i128>, VaultError> {
    validate_batch_len(&shares)?;
    caller.require_auth();
    if get_admin(env).is_none() { return Err(VaultError::NotInitialized); }
    if storage::is_paused(env) { return Err(VaultError::VaultPaused); }
    let user_balance = get_balance(env, caller);
    let total_shares = get_total_shares(env);
    let mut running_shares = total_shares;
    let mut running_assets = get_total_deposited(env);
    let mut total_burned: i128 = 0;
    let mut total_redeemed: i128 = 0;
    let mut redeemed = Vec::new(env);
    for amount in shares.iter() {
        if amount <= 0 { return Err(VaultError::ZeroAmount); }
        total_burned = total_burned.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        if total_burned > user_balance || amount > running_shares {
            return Err(VaultError::InsufficientShares);
        }
        let payout = amount.checked_mul(running_assets)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(running_shares)
            .ok_or(VaultError::MathOverflow)?;
        if payout <= 0 { return Err(VaultError::ZeroAmount); }
        total_redeemed = total_redeemed.checked_add(payout).ok_or(VaultError::MathOverflow)?;
        running_shares = running_shares.checked_sub(amount).ok_or(VaultError::MathOverflow)?;
        running_assets = running_assets.checked_sub(payout).ok_or(VaultError::MathOverflow)?;
        redeemed.push_back(payout);
    }
    let token_address = get_token(env).ok_or(VaultError::NotInitialized)?;
    let token = token::Client::new(env, &token_address);
    let vault_address = env.current_contract_address();
    crate::assert_managed_balance(env, &token)?;
    let threshold = storage::get_withdrawal_queue_threshold(env);
    if threshold > 0 && total_redeemed >= threshold {
        return Err(VaultError::WithdrawalQueued);
    }
    crate::strategy::ensure_liquidity(env, &token, total_redeemed)?;

    // Checks and all payout calculations are complete before state changes.
    set_balance(env, caller, user_balance.checked_sub(total_burned).ok_or(VaultError::MathOverflow)?);
    set_total_shares(env, running_shares);
    set_total_deposited(env, running_assets);
    storage::set_user_checkpoint(env, caller, storage::get_cumulative_yps(env));
    storage::set_user_pending_yield(env, caller, storage::get_user_pending_yield(env, caller));
    storage::bump_persistent(env, caller);
    storage::bump_instance(env);
    let before = token.balance(&vault_address);
    token.transfer(&vault_address, caller, &total_redeemed);
    crate::assert_outgoing_transfer(&token, &vault_address, before, total_redeemed)?;
    env.events().publish(
        (Symbol::new(env, "batch_withdraw"), caller.clone()),
        (shares, redeemed.clone(), total_burned, total_redeemed, running_shares, running_assets),
    );
    Ok(redeemed)
}

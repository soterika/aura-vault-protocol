//! Oracle-guarded exact-input swap deposits.
use soroban_sdk::{contractclient, token, Address, Env, Symbol};

use crate::{
    errors::VaultError,
    storage::{self, get_admin, get_balance, get_token, get_total_deposited, get_total_shares, set_balance, set_total_deposited, set_total_shares},
};

#[contractclient(name = "SwapRouterClient")]
pub trait SwapRouter {
    fn swap_exact_input(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        recipient: Address,
    ) -> i128;
}

#[contractclient(name = "TwapOracleClient")]
pub trait TwapOracle {
    /// Price per token base unit, using the requested lookback window.
    fn twap_price(env: Env, token: Address, lookback_secs: u64) -> (i128, u64);
    /// Current spot reference price, in the same units as `twap_price`.
    fn price(env: Env, token: Address) -> (i128, u64);
}

fn validate_price_pair(
    env: &Env,
    oracle: &TwapOracleClient,
    token: &Address,
    lookback: u64,
    max_age: u64,
    max_deviation_bps: u32,
) -> Result<i128, VaultError> {
    let (twap, twap_time) = oracle.twap_price(token, &lookback);
    let (spot, spot_time) = oracle.price(token);
    crate::validate_oracle_price(env, twap, twap_time, max_age)?;
    crate::validate_oracle_price(env, spot, spot_time, max_age)?;
    let deviation = spot.abs_diff(twap) as i128;
    let lhs = deviation.checked_mul(10_000).ok_or(VaultError::MathOverflow)?;
    let rhs = twap.checked_mul(max_deviation_bps as i128).ok_or(VaultError::MathOverflow)?;
    if lhs > rhs { return Err(VaultError::OraclePriceTooHigh); }
    Ok(twap)
}

pub fn deposit_with_swap(
    env: &Env,
    caller: &Address,
    token_in: &Address,
    amount_in: i128,
    min_shares: i128,
) -> Result<i128, VaultError> {
    caller.require_auth();
    if amount_in <= 0 || min_shares <= 0 { return Err(VaultError::ZeroAmount); }
    if get_admin(env).is_none() { return Err(VaultError::NotInitialized); }
    if storage::is_paused(env) { return Err(VaultError::VaultPaused); }
    if storage::get_whitelist_enabled(env) && !storage::is_whitelisted(env, caller) {
        return Err(VaultError::NotWhitelisted);
    }
    let underlying = get_token(env).ok_or(VaultError::NotInitialized)?;
    if underlying == *token_in { return Err(VaultError::InvalidAddress); }
    let router_address = storage::get_swap_router(env).ok_or(VaultError::NotInitialized)?;
    let oracle_address = storage::get_oracle_address(env).ok_or(VaultError::NotInitialized)?;
    let router = SwapRouterClient::new(env, &router_address);
    let oracle = TwapOracleClient::new(env, &oracle_address);
    let lookback = storage::get_twap_window_secs(env);
    let max_age = storage::get_oracle_max_age(env);
    let max_deviation = storage::get_max_oracle_deviation_bps(env);
    let input_price = validate_price_pair(env, &oracle, token_in, lookback, max_age, max_deviation)?;
    let output_price = validate_price_pair(env, &oracle, &underlying, lookback, max_age, max_deviation)?;

    let expected_out = amount_in.checked_mul(input_price)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(output_price)
        .ok_or(VaultError::MathOverflow)?;
    let slippage = storage::get_max_swap_slippage_bps(env);
    let min_out = expected_out.checked_mul((10_000 - slippage) as i128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)?;
    if min_out <= 0 { return Err(VaultError::ZeroAmount); }

    let input_client = token::Client::new(env, token_in);
    let output_client = token::Client::new(env, &underlying);
    crate::assert_managed_balance(env, &output_client)?;
    let vault = env.current_contract_address();
    let input_before = input_client.balance(&vault);
    input_client.transfer(caller, &vault, &amount_in);
    crate::assert_incoming_transfer(&input_client, &vault, input_before, amount_in)?;
    input_client.transfer(&vault, &router_address, &amount_in);

    let output_before = output_client.balance(&vault);
    let reported_out = router.swap_exact_input(
        token_in,
        &underlying,
        &amount_in,
        &min_out,
        &vault,
    );
    let output_after = output_client.balance(&vault);
    let actual_out = output_after.checked_sub(output_before).ok_or(VaultError::TransferFailed)?;
    if reported_out != actual_out || actual_out < min_out {
        return Err(VaultError::OraclePriceTooHigh);
    }

    let minimum = storage::get_min_deposit(env);
    if minimum > 0 && actual_out < minimum { return Err(VaultError::BelowMinDeposit); }
    let old_assets = get_total_deposited(env);
    let new_assets = old_assets.checked_add(actual_out).ok_or(VaultError::MathOverflow)?;
    let cap = storage::get_tvl_cap(env);
    if cap > 0 && new_assets > cap { return Err(VaultError::TvlCapExceeded); }
    let shares = if get_total_shares(env) == 0 || old_assets == 0 {
        actual_out
    } else {
        actual_out.checked_mul(get_total_shares(env))
            .ok_or(VaultError::MathOverflow)?
            .checked_div(old_assets)
            .ok_or(VaultError::MathOverflow)?
    };
    if shares < min_shares || shares <= 0 { return Err(VaultError::ZeroAmount); }

    crate::strategy::deposit(env, &output_client, actual_out)?;
    let new_balance = get_balance(env, caller).checked_add(shares).ok_or(VaultError::MathOverflow)?;
    let new_total_shares = get_total_shares(env).checked_add(shares).ok_or(VaultError::MathOverflow)?;
    set_balance(env, caller, new_balance);
    storage::set_user_checkpoint(env, caller, storage::get_cumulative_yps(env));
    storage::set_user_pending_yield(env, caller, storage::get_user_pending_yield(env, caller));
    set_total_shares(env, new_total_shares);
    set_total_deposited(env, new_assets);
    storage::bump_persistent(env, caller);
    storage::bump_instance(env);
    env.events().publish(
        (Symbol::new(env, "deposit_with_swap"), caller.clone(), token_in.clone()),
        (amount_in, actual_out, shares, input_price, output_price),
    );
    Ok(shares)
}

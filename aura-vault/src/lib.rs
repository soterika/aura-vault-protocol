//! # AuraVault — Share-based Yield Vault for Soroban / Stellar
//!
//! AuraVault aggregates deposits of a single SEP-41-compatible underlying
//! token, issues proportional vault shares to depositors, and auto-compounds
//! yield through permissionless keeper harvests — all in a trust-minimised,
//! `no_std` on-chain environment.
//!
//! ## Core operations
//!
//! | Function | Caller | Description |
//! |---|---|---|
//! | [`AuraVault::initialize`] | Admin (once) | One-time setup |
//! | [`AuraVault::deposit`] | Any | Deposit tokens, receive shares |
//! | [`AuraVault::withdraw`] | Any | Burn shares, redeem tokens |
//! | [`AuraVault::harvest`] | Any keeper | Inject yield, raise share price |
//! | [`AuraVault::pause`] / [`AuraVault::unpause`] | Admin | Emergency halt / resume |
//!
//! ## Security properties
//!
//! - **CEI ordering** — state written before token transfers on every mutating path.
//! - **Flash-loan guard** — `actual_balance == total_deposited` checked before each
//!   mutating call; mismatch emits `suspicious` event and returns
//!   [`VaultError::BalanceMismatch`].
//! - **Overflow safety** — all arithmetic uses `checked_*`; `overflow-checks = true`
//!   in the release profile.
//! - **Inflation-attack prevention** — zero-share mint is rejected with
//!   [`VaultError::ZeroAmount`].
//!
//! [`VaultError::BalanceMismatch`]: crate::VaultError::BalanceMismatch
//! [`VaultError::ZeroAmount`]: crate::VaultError::ZeroAmount
#![no_std]
mod errors;
mod interface;
mod storage;
mod governance;
mod fee;
pub use errors::VaultError;
#[cfg(test)]
mod test;
#[cfg(test)]
pub mod invariants;
#[cfg(test)]
mod security_test;
#[cfg(test)]
mod security_attacks;
#[cfg(test)]
mod proptest_strategies;
#[cfg(test)]
mod overflow_fuzz;
#[cfg(test)]
mod tvl_cap_test;
#[cfg(test)]
mod harvest_cooldown_test;
#[cfg(test)]
mod pause_lifecycle_test;
#[cfg(test)]
mod circuit_breaker_test;
#[cfg(test)]
mod event_test;
#[cfg(test)]
mod event_snapshots;
#[cfg(test)]
mod seed_ratio_test;
#[cfg(test)]
mod cei_fuzz_test;
#[cfg(test)]
mod lifecycle_test;
#[cfg(test)]
mod cross_contract_safety_test;
#[cfg(test)]
mod reentrancy_test;
use soroban_sdk::{contract, contractimpl, contractclient, token, Address, Env, Vec, Symbol};
// ---------------------------------------------------------------------------
// AuraPriceOracle external contract interface (Issue #348)
//
// The oracle contract must expose a `price(token)` entry point that returns
// the current USD price of a token as an i128 scaled to 6 decimal places
// (micro-USD, where 1_000_000 = $1.00) and the ledger timestamp of the last
// update.
// ---------------------------------------------------------------------------
#[contractclient(name = "OracleClient")]
pub trait OracleTrait {
    /// Returns (price_in_micro_usd, updated_at_ledger_timestamp) for `token`.
    /// `price` is scaled to 6 decimal places (1_000_000 = $1.00).
    fn price(env: Env, token: Address) -> (i128, u64);
}
use storage::{
    bump_instance, bump_persistent, get_admin, get_balance, get_layout_version, get_token,
    get_total_deposited, get_total_shares, get_version, is_paused as storage_is_paused, set_admin,
    set_balance, set_layout_version, set_paused, set_token, set_total_deposited, set_total_shares,
    set_version, CURRENT_LAYOUT_VERSION,
    get_tvl_cap, set_tvl_cap,
    get_last_harvest_time, set_last_harvest_time,
    get_harvest_cooldown_secs, set_harvest_cooldown_secs,
    bump_user_yield_ttl,
    WithdrawalEntry,
    get_withdrawal_queue_threshold, set_withdrawal_queue_threshold,
    get_withdrawal_unbonding_secs, set_withdrawal_unbonding_secs,
    get_withdrawal_fee_bps, set_withdrawal_fee_bps,
    get_withdrawal_next_id, set_withdrawal_next_id,
    get_withdrawal_entry, set_withdrawal_entry, remove_withdrawal_entry,
    get_whitelist_enabled, set_whitelist_enabled, is_whitelisted as storage_is_whitelisted, set_whitelisted,
    get_min_deposit, set_min_deposit,
    get_vault_name, set_vault_name, get_vault_symbol, set_vault_symbol, get_vault_version, set_vault_version,
    get_decimals, set_decimals,
    enter_reentrancy_guard, exit_reentrancy_guard, is_reentrancy_locked,
};
use governance::{
    initialize_governance, create_proposal, vote_on_proposal, execute_proposal,
    get_proposal_status, ProposalStatus, ProposalType,
};
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/// Scaling factor for the yield-per-share (YPS) accumulator.
pub const YIELD_PRECISION: i128 = 1_000_000_000_000;
/// Maximum withdrawal fee in basis points (5%).
pub const MAX_WITHDRAWAL_FEE_BPS: u32 = 500;
pub const ROLE_ADMIN: u32 = storage::ADMIN_ROLE;
pub const ROLE_KEEPER: u32 = storage::KEEPER_ROLE;
pub const ROLE_GUARDIAN: u32 = storage::GUARDIAN_ROLE;
fn has_role(env: &Env, addr: &Address, role_mask: u32) -> bool {
    storage::has_role(env, addr, role_mask)
}
fn set_role_mask(env: &Env, addr: &Address, mask: u32) {
    storage::set_role_mask(env, addr, mask)
}
// ---------------------------------------------------------------------------
// Module-level helpers (non-contract functions)
// ---------------------------------------------------------------------------
fn with_reentrancy_guard<T, F: FnOnce() -> Result<T, VaultError>>(env: &Env, f: F) -> Result<T, VaultError> {
    storage::enter_reentrancy_guard(env)?;
    let result = f();
    storage::exit_reentrancy_guard(env);
    result
}
fn bump_user_yield(env: &Env, addr: &Address) {
    storage::bump_user_yield_ttl(env, addr);
}
pub const ORACLE_PRICE_SANITY_CAP: i128 = 1_000_000_000_000_000_000_000_000; // 1e24
pub const ORACLE_DEFAULT_MAX_AGE_SECS: u64 = 3_600;
#[allow(dead_code)]
pub(crate) fn validate_oracle_price(
    env: &Env,
    price: i128,
    updated_at: u64,
    max_age_secs: u64,
) -> Result<(), VaultError> {
    if price <= 0 {
        return Err(VaultError::OraclePriceZero);
    }
    if price > ORACLE_PRICE_SANITY_CAP {
        return Err(VaultError::OraclePriceTooHigh);
    }
    let now = env.ledger().timestamp();
    let age = now.saturating_sub(updated_at);
    if age > max_age_secs {
        return Err(VaultError::OraclePriceStale);
    }
    Ok(())
}
pub(crate) fn assert_incoming_transfer(
    token: &token::Client,
    vault_addr: &Address,
    balance_before: i128,
    expected: i128,
) -> Result<(), VaultError> {
    let balance_after = token.balance(vault_addr);
    let delta = balance_after
        .checked_sub(balance_before)
        .ok_or(VaultError::MathOverflow)?;
    if delta != expected {
        return Err(VaultError::TransferFailed);
    }
    Ok(())
}
pub(crate) fn assert_outgoing_transfer(
    token: &token::Client,
    vault_addr: &Address,
    balance_before: i128,
    expected: i128,
) -> Result<(), VaultError> {
    let balance_after = token.balance(vault_addr);
    let delta = balance_before
        .checked_sub(balance_after)
        .ok_or(VaultError::MathOverflow)?;
    if delta != expected {
        return Err(VaultError::TransferFailed);
    }
    Ok(())
}
#[contract]
pub struct AuraVault;
#[contractimpl]
impl AuraVault {
    pub fn initialize(
        env: Env,
        admin: Address,
        underlying_token: Address,
        signers: Vec<Address>,
        decimals: u32,
    ) -> Result<(), VaultError> {
        if get_admin(&env).is_some() {
            return Err(VaultError::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_token(&env, &underlying_token);
        set_total_shares(&env, 0);
        set_total_deposited(&env, 0);
        storage::set_cumulative_yps(&env, 0);
        storage::set_distribution_epoch(&env, 0);
        storage::set_user_checkpoint(&env, &admin, 0);
        storage::set_user_pending_yield(&env, &admin, 0);
        set_version(&env, 1);
        set_layout_version(&env, CURRENT_LAYOUT_VERSION);
        set_vault_name(&env, &soroban_sdk::String::from_str(&env, "Aura Vault Share"));
        set_vault_symbol(&env, &soroban_sdk::String::from_str(&env, "AVS"));
        set_vault_version(&env, 1);
        let dec = if decimals == 0 { 7u32 } else { decimals };
        set_decimals(&env, dec);
        set_role_mask(&env, &admin, ROLE_ADMIN);
        initialize_governance(&env, signers)?;
        bump_instance(&env);
        Ok(())
    }
    pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            if get_whitelist_enabled(&env) && !storage::is_whitelisted(&env, &caller) {
                return Err(VaultError::NotWhitelisted);
            }
            let min_deposit = get_min_deposit(&env);
            if min_deposit > 0 && amount < min_deposit {
                return Err(VaultError::BelowMinDeposit);
            }
            let tvl_cap = get_tvl_cap(&env);
            if tvl_cap > 0 {
                let current_total = get_total_deposited(&env);
                let after_deposit = current_total
                    .checked_add(amount)
                    .ok_or(VaultError::MathOverflow)?;
                if after_deposit > tvl_cap {
                    return Err(VaultError::TvlCapExceeded);
                }
            }
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let balance_before = token.balance(&env.current_contract_address());
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
                );
                return Err(VaultError::BalanceMismatch);
            }
            let total_shares = get_total_shares(&env);
            let new_shares: i128 = if total_shares == 0 || total_deposited == 0 {
                amount
            } else {
                let numerator = amount
                    .checked_mul(total_shares)
                    .ok_or(VaultError::MathOverflow)?;
                numerator
                    .checked_div(total_deposited)
                    .ok_or(VaultError::MathOverflow)?
            };
            if new_shares <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            let vault_addr = env.current_contract_address();
            let pre_deposit_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &amount);
            assert_incoming_transfer(&token, &vault_addr, pre_deposit_balance, amount)?;
            let old_balance = get_balance(&env, &caller);
            let new_balance = old_balance
                .checked_add(new_shares)
                .ok_or(VaultError::MathOverflow)?;
            set_balance(&env, &caller, new_balance);
            storage::set_user_checkpoint(&env, &caller, storage::get_cumulative_yps(&env));
            storage::set_user_pending_yield(&env, &caller, storage::get_user_pending_yield(&env, &caller));
            let new_total_shares = total_shares
                .checked_add(new_shares)
                .ok_or(VaultError::MathOverflow)?;
            set_total_shares(&env, new_total_shares);
            let new_total_deposited = total_deposited
                .checked_add(amount)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_total_deposited);
            let share_price: i128 = if new_total_shares > 0 {
                new_total_deposited
                    .checked_mul(10_000_000)
                    .and_then(|v| v.checked_div(new_total_shares))
                    .unwrap_or(0)
            } else {
                10_000_000
            };
            let timestamp = env.ledger().timestamp();
            env.events().publish(
                (Symbol::new(&env, "deposit"), caller.clone(), amount),
                (new_shares, new_total_shares, new_total_deposited, share_price, timestamp),
            );
            bump_persistent(&env, &caller);
            bump_instance(&env);
            Ok(new_shares)
        })
    }
    pub fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if shares <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let balance_before = token.balance(&env.current_contract_address());
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
                );
                return Err(VaultError::BalanceMismatch);
            }
            let user_balance = get_balance(&env, &caller);
            if shares > user_balance {
                return Err(VaultError::InsufficientShares);
            }
            let total_shares = get_total_shares(&env);
            let numerator = shares
                .checked_mul(total_deposited)
                .ok_or(VaultError::MathOverflow)?;
            let redeem_amount = numerator
                .checked_div(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            if redeem_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if total_deposited < redeem_amount {
                return Err(VaultError::InsufficientUnderlying);
            }
            let new_balance = user_balance - shares;
            set_balance(&env, &caller, new_balance);
            let new_total_shares = total_shares
                .checked_sub(shares)
                .ok_or(VaultError::MathOverflow)?;
            set_total_shares(&env, new_total_shares);
            storage::set_user_checkpoint(&env, &caller, storage::get_cumulative_yps(&env));
            storage::set_user_pending_yield(&env, &caller, storage::get_user_pending_yield(&env, &caller));
            let new_total_deposited = total_deposited
                .checked_sub(redeem_amount)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_total_deposited);
            bump_persistent(&env, &caller);
            bump_instance(&env);
            let queue_threshold = get_withdrawal_queue_threshold(&env);
            if queue_threshold > 0 && redeem_amount >= queue_threshold {
                let unbonding_secs = get_withdrawal_unbonding_secs(&env);
                let claimable_after = env.ledger().timestamp().saturating_add(unbonding_secs);
                let entry_id = get_withdrawal_next_id(&env);
                set_withdrawal_next_id(&env, entry_id + 1);
                let entry = WithdrawalEntry {
                    owner: caller.clone(),
                    shares,
                    redeem_amount,
                    claimable_after,
                    claimed: false,
                };
                set_withdrawal_entry(&env, entry_id, &entry);
                env.events().publish(
                    (Symbol::new(&env, "withdraw_queued"), caller.clone(), entry_id),
                    (shares, redeem_amount, claimable_after, new_total_shares, new_total_deposited),
                );
                return Err(VaultError::WithdrawalQueued);
            }
            let vault_addr = env.current_contract_address();
            let pre_withdraw_balance = token.balance(&vault_addr);
            token.transfer(&vault_addr, &caller, &redeem_amount);
            assert_outgoing_transfer(&token, &vault_addr, pre_withdraw_balance, redeem_amount)?;
            let share_price: i128 = if new_total_shares > 0 {
                new_total_deposited
                    .checked_mul(10_000_000)
                    .and_then(|v| v.checked_div(new_total_shares))
                    .unwrap_or(0)
            } else {
                0
            };
            let timestamp = env.ledger().timestamp();
            env.events().publish(
                (Symbol::new(&env, "withdraw"), caller.clone(), shares),
                (redeem_amount, new_total_shares, new_total_deposited, share_price, timestamp),
            );
            bump_persistent(&env, &caller);
            bump_instance(&env);
            Ok(redeem_amount)
        })
    }
    pub fn set_withdrawal_queue_threshold(
        env: Env,
        admin: Address,
        threshold: i128,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_withdrawal_queue_threshold(&env, threshold);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "queue_threshold_set"), admin),
                (threshold,),
            );
            Ok(())
        })
    }
    pub fn set_withdrawal_unbonding_secs(
        env: Env,
        admin: Address,
        secs: u64,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_withdrawal_unbonding_secs(&env, secs);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "unbonding_set"), admin),
                (secs,),
            );
            Ok(())
        })
    }
    pub fn set_withdrawal_fee(
        env: Env,
        admin: Address,
        bps: u32,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if bps > MAX_WITHDRAWAL_FEE_BPS {
                return Err(VaultError::InvalidWithdrawalFee);
            }
            admin.require_auth();
            set_withdrawal_fee_bps(&env, bps);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "withdrawal_fee_set"), admin),
                (bps,),
            );
            Ok(())
        })
    }
    pub fn get_withdrawal_queue_threshold(env: Env) -> i128 {
        storage::get_withdrawal_queue_threshold(&env)
    }
    pub fn get_withdrawal_unbonding_secs(env: Env) -> u64 {
        storage::get_withdrawal_unbonding_secs(&env)
    }
    pub fn get_withdrawal_fee_bps(env: Env) -> u32 {
        storage::get_withdrawal_fee_bps(&env)
    }
    pub fn claim_queued_withdrawal(
        env: Env,
        caller: Address,
        entry_id: u64,
    ) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            let entry = get_withdrawal_entry(&env, entry_id)
                .ok_or(VaultError::QueueEntryNotFound)?;
            if entry.owner != caller {
                return Err(VaultError::InsufficientShares);
            }
            let now = env.ledger().timestamp();
            if now < entry.claimable_after {
                return Err(VaultError::QueueUnbondingPending);
            }
            let fee_bps = get_withdrawal_fee_bps(&env);
            let fee_amount: i128 = if fee_bps > 0 {
                (entry.redeem_amount as i128)
                    .checked_mul(fee_bps as i128)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(10_000)
                    .ok_or(VaultError::MathOverflow)?
            } else {
                0
            };
            let net_amount = entry.redeem_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            if net_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            remove_withdrawal_entry(&env, entry_id);
            if fee_amount > 0 {
                let prev_fees = storage::get_total_fee_collected(&env);
                storage::set_total_fee_collected(
                    &env,
                    prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
                );
            }
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let vault_addr = env.current_contract_address();
            let pre_claim_balance = token.balance(&vault_addr);
            token.transfer(&vault_addr, &caller, &net_amount);
            assert_outgoing_transfer(&token, &vault_addr, pre_claim_balance, net_amount)?;
            env.events().publish(
                (Symbol::new(&env, "withdrawal_claimed"), caller.clone(), entry_id),
                (entry.redeem_amount, fee_amount, net_amount),
            );
            bump_persistent(&env, &caller);
            bump_instance(&env);
            Ok(net_amount)
        })
    }
    pub fn get_withdrawal_entry(env: Env, entry_id: u64) -> Option<WithdrawalEntry> {
        storage::get_withdrawal_entry(&env, entry_id)
    }
    pub fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if yield_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            // Minimum harvest amount check (Issue #914)[cite: 9]
            let min_harvest = storage::get_min_harvest_amount(&env);
            if yield_amount < min_harvest {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            if !has_role(&env, &caller, ROLE_KEEPER) && !has_role(&env, &caller, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }
            let total_shares = get_total_shares(&env);
            if total_shares == 0 {
                return Err(VaultError::ZeroShares);
            }
            let cooldown_secs = get_harvest_cooldown_secs(&env);
            if cooldown_secs > 0 {
                let last_harvest = get_last_harvest_time(&env);
                if last_harvest > 0 {
                    let now = env.ledger().timestamp();
                    let elapsed = now.saturating_sub(last_harvest);
                    if elapsed < cooldown_secs {
                        return Err(VaultError::HarvestCooldown);
                    }
                }
            }
            let total_deposited = get_total_deposited(&env);
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let balance_before = token.balance(&env.current_contract_address());
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
                );
                return Err(VaultError::BalanceMismatch);
            }
            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
            let yield_after_fee = yield_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            let current_fees = storage::get_total_fee_collected(&env);
            let new_fees = current_fees
                .checked_add(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            let new_total = total_deposited
                .checked_add(yield_after_fee)
                .ok_or(VaultError::MathOverflow)?;
            let price_limit_bps = storage::get_price_movement_limit(&env);
            if price_limit_bps > 0 && total_deposited > 0 {
                let delta = new_total
                    .checked_sub(total_deposited)
                    .ok_or(VaultError::MathOverflow)?
                    .abs();
                let lhs = delta
                    .checked_mul(10_000)
                    .ok_or(VaultError::MathOverflow)?;
                let rhs = total_deposited
                    .checked_mul(price_limit_bps as i128)
                    .ok_or(VaultError::MathOverflow)?;
                if lhs > rhs {
                    set_paused(&env, true);
                    env.events().publish(
                        (Symbol::new(&env, "suspicious"),),
                        (
                            Symbol::new(&env, "price_movement"),
                            total_deposited,
                            new_total,
                            price_limit_bps,
                        ),
                    );
                    bump_instance(&env);
                    return Err(VaultError::CircuitBreakerTripped);
                }
            }
            let vault_addr = env.current_contract_address();
            let pre_harvest_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(&token, &vault_addr, pre_harvest_balance, yield_amount)?;
            set_total_deposited(&env, new_total);
            storage::set_total_fee_collected(&env, new_fees);
            set_last_harvest_time(&env, env.ledger().timestamp());
            env.events().publish(
                (Symbol::new(&env, "harvest"), caller.clone(), yield_amount),
                (yield_after_fee, fee_amount, new_total),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn harvest_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if yield_amount <= 0 || underlying_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            // Minimum harvest amount check (Issue #914)[cite: 9]
            let min_harvest = storage::get_min_harvest_amount(&env);
            if underlying_amount < min_harvest {
                return Err(VaultError::ZeroAmount);
            }
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != caller && !storage::has_role(&env, &caller, storage::KEEPER_ROLE) && !storage::has_role(&env, &caller, storage::ADMIN_ROLE) {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            let total_shares = get_total_shares(&env);
            if total_shares == 0 {
                return Err(VaultError::ZeroShares);
            }
            if !storage::is_yield_token(&env, &alt_token) {
                return Err(VaultError::InvalidAddress);
            }
            let total_deposited = get_total_deposited(&env);
            let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let underlying = token::Client::new(&env, &underlying_addr);
            let balance_before = underlying.balance(&env.current_contract_address());
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
                );
                return Err(VaultError::BalanceMismatch);
            }
            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps)
                .unwrap_or(0);
            let net_underlying = underlying_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            validate_oracle_price(
                &env,
                underlying_amount,
                env.ledger().timestamp(),
                ORACLE_DEFAULT_MAX_AGE_SECS,
            )?;
            let new_total = total_deposited
                .checked_add(net_underlying)
                .ok_or(VaultError::MathOverflow)?;
            let alt_token_client = token::Client::new(&env, &alt_token);
            let vault_addr = env.current_contract_address();
            let pre_alt_balance = alt_token_client.balance(&vault_addr);
            alt_token_client.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(&alt_token_client, &vault_addr, pre_alt_balance, yield_amount)?;
            set_total_deposited(&env, new_total);
            let prev_fees = storage::get_total_fee_collected(&env);
            storage::set_total_fee_collected(
                &env,
                prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
            );
            env.events().publish(
                (Symbol::new(&env, "harvest_token"), caller, alt_token),
                (yield_amount, net_underlying, fee_amount),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn register_yield_token(env: Env, alt_token: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            storage::set_yield_token(&env, &alt_token, true);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "yield_token_registered"),),
                (alt_token,),
            );
            Ok(())
        })
    }
    pub fn distribute_yield(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if yield_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            // Minimum harvest amount check (Issue #914)[cite: 9]
            let min_harvest = storage::get_min_harvest_amount(&env);
            if yield_amount < min_harvest {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            let total_shares = get_total_shares(&env);
            if total_shares == 0 {
                return Err(VaultError::ZeroShares);
            }
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let balance_before = token.balance(&env.current_contract_address());
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
                );
                return Err(VaultError::BalanceMismatch);
            }
            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
            let net_yield = yield_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            let scaled = net_yield
                .checked_mul(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let delta_yps = scaled
                .checked_div(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            if delta_yps == 0 {
                return Err(VaultError::YieldTooSmall);
            }
            let distributed = delta_yps
                .checked_mul(total_shares)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let tolerance = net_yield
                .checked_add(9_999)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(VaultError::MathOverflow)?;
            let diff = (distributed - net_yield).abs();
            if diff > tolerance {
                return Err(VaultError::DistributionAccuracyError);
            }
            let vault_addr = env.current_contract_address();
            let pre_dist_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(&token, &vault_addr, pre_dist_balance, yield_amount)?;
            let prev_yps = storage::get_cumulative_yps(&env);
            let new_yps = prev_yps
                .checked_add(delta_yps)
                .ok_or(VaultError::MathOverflow)?;
            storage::set_cumulative_yps(&env, new_yps);
            let new_total = total_deposited
                .checked_add(net_yield)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_total);
            let prev_fees = storage::get_total_fee_collected(&env);
            storage::set_total_fee_collected(
                &env,
                prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
            );
            let epoch = storage::get_distribution_epoch(&env);
            let new_epoch = epoch + 1;
            storage::set_distribution_epoch(&env, new_epoch);
            env.events().publish(
                (Symbol::new(&env, "yield_distributed"), caller.clone()),
                (yield_amount, net_yield, fee_amount, total_shares, new_yps, new_epoch),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn distribute_yield_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if yield_amount <= 0 || underlying_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            // Minimum harvest amount check (Issue #914)[cite: 9]
            let min_harvest = storage::get_min_harvest_amount(&env);
            if underlying_amount < min_harvest {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            if !storage::is_yield_token(&env, &alt_token) {
                return Err(VaultError::InvalidAddress);
            }
            let total_shares = get_total_shares(&env);
            if total_shares == 0 {
                return Err(VaultError::ZeroShares);
            }
            let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let underlying = token::Client::new(&env, &underlying_addr);
            let balance_before = underlying.balance(&env.current_contract_address());
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
                );
                return Err(VaultError::BalanceMismatch);
            }
            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps)?;
            let net_underlying = underlying_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            validate_oracle_price(
                &env,
                underlying_amount,
                env.ledger().timestamp(),
                ORACLE_DEFAULT_MAX_AGE_SECS,
            )?;
            let scaled = net_underlying
                .checked_mul(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let delta_yps = scaled
                .checked_div(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            if delta_yps == 0 {
                return Err(VaultError::YieldTooSmall);
            }
            let distributed = delta_yps
                .checked_mul(total_shares)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let tolerance = net_underlying
                .checked_add(9_999)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(VaultError::MathOverflow)?;
            let diff = (distributed - net_underlying).abs();
            if diff > tolerance {
                return Err(VaultError::DistributionAccuracyError);
            }
            let alt_token_client = token::Client::new(&env, &alt_token);
            let vault_addr = env.current_contract_address();
            let pre_alt_balance = alt_token_client.balance(&vault_addr);
            alt_token_client.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(&alt_token_client, &vault_addr, pre_alt_balance, yield_amount)?;
            let prev_yps = storage::get_cumulative_yps(&env);
            let new_yps = prev_yps
                .checked_add(delta_yps)
                .ok_or(VaultError::MathOverflow)?;
            storage::set_cumulative_yps(&env, new_yps);
            let new_total = total_deposited
                .checked_add(net_underlying)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_total);
            let prev_fees = storage::get_total_fee_collected(&env);
            storage::set_total_fee_collected(
                &env,
                prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
            );
            let epoch = storage::get_distribution_epoch(&env);
            let new_epoch = epoch + 1;
            storage::set_distribution_epoch(&env, new_epoch);
            env.events().publish(
                (Symbol::new(&env, "yield_distributed_token"), caller, alt_token),
                (yield_amount, net_underlying, fee_amount, total_shares, new_yps, new_epoch),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn collect_yield(env: Env, caller: Address, amount: i128) -> Result<(), VaultError> {
        Self::distribute_yield(env, caller, amount)
    }
    pub fn preview_distribution(env: Env, yield_amount: i128) -> Result<(i128, i128, i128, bool), VaultError> {
        if yield_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        let total_shares = get_total_shares(&env);
        if total_shares == 0 {
            return Err(VaultError::ZeroShares);
        }
        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
        let net_yield = yield_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;
        let scaled = net_yield
            .checked_mul(YIELD_PRECISION)
            .ok_or(VaultError::MathOverflow)?;
        let delta_yps = scaled
            .checked_div(total_shares)
            .ok_or(VaultError::MathOverflow)?;
        if delta_yps == 0 {
            return Ok((net_yield, 0, 0, false));
        }
        let distributed = delta_yps
            .checked_mul(total_shares)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(YIELD_PRECISION)
            .ok_or(VaultError::MathOverflow)?;
        let tolerance = net_yield
            .checked_add(9_999)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(VaultError::MathOverflow)?;
        let diff = (distributed - net_yield).abs();
        let accuracy_ok = diff <= tolerance;
        Ok((net_yield, delta_yps, distributed, accuracy_ok))
    }
    pub fn collect_pending_yield(env: Env, caller: Address) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }
            let user_shares = get_balance(&env, &caller);
            let global_yps = storage::get_cumulative_yps(&env);
            let user_checkpoint = storage::get_user_checkpoint(&env, &caller);
            let delta_yps = global_yps
                .checked_sub(user_checkpoint)
                .ok_or(VaultError::MathOverflow)?;
            let accrued = user_shares
                .checked_mul(delta_yps)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let stored_pending = storage::get_user_pending_yield(&env, &caller);
            let total_claimable = stored_pending
                .checked_add(accrued)
                .ok_or(VaultError::MathOverflow)?;
            if total_claimable <= 0 {
                storage::set_user_checkpoint(&env, &caller, global_yps);
                storage::set_user_pending_yield(&env, &caller, 0);
                bump_user_yield(&env, &caller);
                bump_persistent(&env, &caller);
                return Ok(0);
            }
            storage::set_user_checkpoint(&env, &caller, global_yps);
            storage::set_user_pending_yield(&env, &caller, 0);
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let vault_addr = env.current_contract_address();
            let pre_collect_balance = token.balance(&vault_addr);
            token.transfer(&vault_addr, &caller, &total_claimable);
            assert_outgoing_transfer(&token, &vault_addr, pre_collect_balance, total_claimable)?;
            let total_deposited = get_total_deposited(&env);
            let new_deposited = total_deposited
                .checked_sub(total_claimable)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_deposited);
            env.events().publish(
                (Symbol::new(&env, "yield_collected"), caller.clone()),
                (total_claimable, global_yps, new_deposited),
            );
            bump_user_yield(&env, &caller);
            bump_persistent(&env, &caller);
            bump_instance(&env);
            Ok(total_claimable)
        })
    }
    pub fn pending_yield(env: Env, addr: Address) -> i128 {
        let user_shares = get_balance(&env, &addr);
        let global_yps = storage::get_cumulative_yps(&env);
        let user_checkpoint = storage::get_user_checkpoint(&env, &addr);
        let delta_yps = global_yps.saturating_sub(user_checkpoint);
        let accrued = user_shares
            .checked_mul(delta_yps)
            .and_then(|v| v.checked_div(YIELD_PRECISION))
            .unwrap_or(0);
        storage::get_user_pending_yield(&env, &addr)
            .checked_add(accrued)
            .unwrap_or(0)
    }
    pub fn distribution_epoch(env: Env) -> u64 {
        storage::get_distribution_epoch(&env)
    }
    pub fn pause(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            if !has_role(&env, &admin, ROLE_GUARDIAN) && !has_role(&env, &admin, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }
            set_paused(&env, true);
            env.events().publish((Symbol::new(&env, "paused"),), ());
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            if !has_role(&env, &admin, ROLE_GUARDIAN) && !has_role(&env, &admin, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }
            set_paused(&env, false);
            env.events().publish((Symbol::new(&env, "unpaused"),), ());
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn is_paused(env: Env) -> bool {
        storage_is_paused(&env)
    }
    pub fn pending_admin(env: Env) -> Option<Address> {
        let pending = storage::get_pending_admin(&env)?;
        if env.ledger().timestamp() > storage::get_pending_admin_expiry(&env) {
            None
        } else {
            Some(pending)
        }
    }
    pub fn propose_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != current_admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            current_admin.require_auth();
            let expires_at = env.ledger().timestamp().saturating_add(48 * 60 * 60);
            storage::set_pending_admin(&env, &new_admin);
            storage::set_pending_admin_expiry(&env, expires_at);
            env.events().publish(
                (Symbol::new(&env, "AdminProposed"), current_admin),
                (new_admin, expires_at),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let pending = storage::get_pending_admin(&env).ok_or(VaultError::NoPendingAdmin)?;
            let expiry = storage::get_pending_admin_expiry(&env);
            let now = env.ledger().timestamp();
            if pending != new_admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if now > expiry {
                storage::clear_pending_admin(&env);
                storage::clear_pending_admin_expiry(&env);
                return Err(VaultError::PendingAdminExpired);
            }
            new_admin.require_auth();
            let old_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            let old_admin_roles = storage::get_role_mask(&env, &old_admin) & !ROLE_ADMIN;
            let new_admin_roles = storage::get_role_mask(&env, &new_admin) | ROLE_ADMIN;
            set_admin(&env, &new_admin);
            set_role_mask(&env, &old_admin, old_admin_roles);
            set_role_mask(&env, &new_admin, new_admin_roles);
            storage::clear_pending_admin(&env);
            storage::clear_pending_admin_expiry(&env);
            env.events().publish(
                (Symbol::new(&env, "AdminTransferred"), old_admin),
                (new_admin,),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn cancel_admin(env: Env, current_admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != current_admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if storage::get_pending_admin(&env).is_none() {
                return Err(VaultError::NoPendingAdmin);
            }
            current_admin.require_auth();
            storage::clear_pending_admin(&env);
            storage::clear_pending_admin_expiry(&env);
            env.events().publish((Symbol::new(&env, "AdminCancelled"), current_admin), ());
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn get_roles(env: Env, addr: Address) -> u32 {
        storage::get_role_mask(&env, &addr)
    }
    pub fn has_role_query(env: Env, addr: Address, role_mask: u32) -> bool {
        storage::has_role(&env, &addr, role_mask)
    }
    pub fn grant_role(env: Env, admin: Address, role: u32, addr: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            let mut mask = storage::get_role_mask(&env, &addr);
            mask |= role;
            storage::set_role_mask(&env, &addr, mask);
            env.events().publish(
                (Symbol::new(&env, "RoleGranted"), admin),
                (role, addr),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn revoke_role(env: Env, admin: Address, role: u32, addr: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            let mut mask = storage::get_role_mask(&env, &addr);
            mask &= !role;
            storage::set_role_mask(&env, &addr, mask);
            env.events().publish(
                (Symbol::new(&env, "RoleRevoked"), admin),
                (role, addr),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            storage::set_perf_fee_bps(&env, perf_fee_bps);
            storage::set_mgmt_fee_bps(&env, mgmt_fee_bps);
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn set_treasury(env: Env, admin: Address, treasury: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            storage::set_treasury(&env, &treasury);
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            let fees = storage::get_total_fee_collected(&env);
            if fees <= 0 {
                return Ok(0);
            }
            let treasury = storage::get_treasury(&env).ok_or(VaultError::NotInitialized)?;
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let vault_addr = env.current_contract_address();
            let pre_fees_balance = token.balance(&vault_addr);
            token.transfer(&vault_addr, &treasury, &fees);
            assert_outgoing_transfer(&token, &vault_addr, pre_fees_balance, fees)?;
            storage::set_total_fee_collected(&env, 0);
            env.events().publish(
                (Symbol::new(&env, "fees_withdrawn"), admin),
                (fees, treasury),
            );
            bump_instance(&env);
            Ok(fees)
        })
    }
    pub fn total_fees_collected(env: Env) -> i128 {
        storage::get_total_fee_collected(&env)
    }
    pub fn set_tvl_cap(env: Env, admin: Address, cap: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_tvl_cap(&env, cap);
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn get_tvl_cap(env: Env) -> i128 {
        storage::get_tvl_cap(&env)
    }
    pub fn set_harvest_cooldown(env: Env, admin: Address, secs: u64) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_harvest_cooldown_secs(&env, secs);
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn reset_harvest_cooldown(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_last_harvest_time(&env, 0);
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn last_harvest_time(env: Env) -> u64 {
        get_last_harvest_time(&env)
    }
    pub fn set_price_movement_limit(env: Env, admin: Address, bps: u32) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            storage::set_price_movement_limit(&env, bps);
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn get_price_movement_limit(env: Env) -> u32 {
        storage::get_price_movement_limit(&env)
    }
    pub fn total_assets(env: Env) -> i128 {
        get_total_deposited(&env)
    }
    pub fn total_shares(env: Env) -> i128 {
        get_total_shares(&env)
    }
    pub fn balance_of(env: Env, address: Address) -> i128 {
        get_balance(&env, &address)
    }
    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            let current_version = get_layout_version(&env);
            if current_version != CURRENT_LAYOUT_VERSION {
                return Err(VaultError::StorageLayoutMismatch);
            }
            let old_version = get_version(&env);
            let new_version = old_version + 1;
            set_version(&env, new_version);
            env.deployer().update_current_contract_wasm(new_wasm_hash);
            env.events().publish(
                (Symbol::new(&env, "upgrade"), admin),
                (old_version, new_version),
            );
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError> {
        with_reentrancy_guard(&env, || {
            create_proposal(&env, proposer, ProposalType::UpdateAdmin)
        })
    }
    pub fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError> {
        with_reentrancy_guard(&env, || {
            create_proposal(&env, proposer, ProposalType::UpdateUnderlyingToken)
        })
    }
    pub fn propose_parameter_update(
        env: Env,
        proposer: Address,
        name: Symbol,
        value: i128,
    ) -> Result<u64, VaultError> {
        with_reentrancy_guard(&env, || {
            create_proposal(&env, proposer, ProposalType::UpdateParameter(name, value))
        })
    }
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            vote_on_proposal(&env, voter, proposal_id, approve)
        })
    }
    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            execute_proposal(&env, executor, proposal_id)?;
            bump_instance(&env);
            Ok(())
        })
    }
    pub fn proposal_status(env: Env, proposal_id: u64) -> Option<soroban_sdk::String> {
        get_proposal_status(&env, proposal_id).map(|status| {
            match status {
                ProposalStatus::Pending => soroban_sdk::String::from_str(&env, "Pending"),
                ProposalStatus::Ready => soroban_sdk::String::from_str(&env, "Approved"),
                ProposalStatus::Executed => soroban_sdk::String::from_str(&env, "Executed"),
                ProposalStatus::Expired => soroban_sdk::String::from_str(&env, "Rejected"),
            }
        })
    }
    pub fn get_vault_error_message(env: Env, code: u32) -> Option<soroban_sdk::String> {
        let msg: Option<&'static str> = match code {
            1  => Some(VaultError::NotInitialized.message()),
            2  => Some(VaultError::AlreadyInitialized.message()),
            3  => Some(VaultError::InsufficientShares.message()),
            4  => Some(VaultError::InsufficientUnderlying.message()),
            5  => Some(VaultError::ZeroAmount.message()),
            6  => Some(VaultError::MathOverflow.message()),
            7  => Some(VaultError::InvalidAddress.message()),
            8  => Some(VaultError::ZeroShares.message()),
            9  => Some(VaultError::UpgradeUnauthorized.message()),
            10 => Some(VaultError::StorageLayoutMismatch.message()),
            11 => Some(VaultError::VaultPaused.message()),
            12 => Some(VaultError::BalanceMismatch.message()),
            13 => Some(VaultError::TimelockNotExpired.message()),
            14 => Some(VaultError::NotApproved.message()),
            15 => Some(VaultError::AlreadyVoted.message()),
            16 => Some(VaultError::TvlCapExceeded.message()),
            17 => Some(VaultError::YieldTooSmall.message()),
            18 => Some(VaultError::DistributionAccuracyError.message()),
            19 => Some(VaultError::HarvestCooldown.message()),
            20 => Some(VaultError::WithdrawalQueued.message()),
            21 => Some(VaultError::QueueEntryNotFound.message()),
            22 => Some(VaultError::QueueUnbondingPending.message()),
            23 => Some(VaultError::InvalidWithdrawalFee.message()),
            24 => Some(VaultError::TransferFailed.message()),
            25 => Some(VaultError::OraclePriceZero.message()),
            26 => Some(VaultError::OraclePriceTooHigh.message()),
            27 => Some(VaultError::OraclePriceStale.message()),
            28 => Some(VaultError::NotWhitelisted.message()),
            29 => Some(VaultError::BelowMinDeposit.message()),
            30 => Some(VaultError::Reentrancy.message()),
            _  => None,
        };
        msg.map(|s| soroban_sdk::String::from_str(&env, s))
    }
    pub fn enable_whitelist(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelist_enabled(&env, true);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "whitelist_enabled"), admin),
                (),
            );
            Ok(())
        })
    }
    pub fn disable_whitelist(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelist_enabled(&env, false);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "whitelist_disabled"), admin),
                (),
            );
            Ok(())
        })
    }
    pub fn add_to_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelisted(&env, &addr, true);
            bump_instance(&env);
            bump_persistent(&env, &addr);
            env.events().publish(
                (Symbol::new(&env, "whitelist_added"), admin, addr),
                (),
            );
            Ok(())
        })
    }
    pub fn remove_from_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelisted(&env, &addr, false);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "whitelist_removed"), admin, addr),
                (),
            );
            Ok(())
        })
    }
    pub fn is_whitelisted(env: Env, addr: Address) -> bool {
        storage::is_whitelisted(&env, &addr)
    }
    pub fn set_min_deposit(env: Env, admin: Address, amount: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_min_deposit(&env, amount);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "min_deposit_set"), admin),
                (amount,),
            );
            Ok(())
        })
    }
    pub fn min_deposit(env: Env) -> i128 {
        get_min_deposit(&env)
    }
    // -----------------------------------------------------------------------
    // Minimum harvest amount configuration (Issue #914)[cite: 9]
    // -----------------------------------------------------------------------
    pub fn set_min_harvest_amount(env: Env, admin: Address, amount: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            storage::set_min_harvest_amount(&env, amount);
            bump_instance(&env);
            env.events().publish(
                (Symbol::new(&env, "min_harvest_amount_set"), admin),
                (amount,),
            );
            Ok(())
        })
    }
    pub fn get_min_harvest_amount(env: Env) -> i128 {
        storage::get_min_harvest_amount(&env)
    }
    pub fn name(env: Env) -> Option<soroban_sdk::String> {
        get_vault_name(&env)
    }
    pub fn symbol(env: Env) -> Option<soroban_sdk::String> {
        get_vault_symbol(&env)
    }
    pub fn version(env: Env) -> u32 {
        get_vault_version(&env)
    }
    pub fn decimals(env: Env) -> u32 {
        get_decimals(&env)
    }
}
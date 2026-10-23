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
mod fee;
mod governance;
mod interface;
mod storage;

pub use errors::VaultError;
pub use storage::VaultState;

#[cfg(test)]
mod cei_fuzz_test;
#[cfg(test)]
mod circuit_breaker_test;
#[cfg(test)]
mod cross_contract_safety_test;
#[cfg(test)]
mod mutation_regression_test;
#[cfg(test)]
mod security_attacks;
#[cfg(test)]
mod event_test;
#[cfg(test)]
mod harvest_cooldown_test;
#[cfg(test)]
pub mod invariants;
#[cfg(test)]
mod lifecycle_test;
#[cfg(test)]
mod yield_smoothing_test;
#[cfg(test)]
mod pause_lifecycle_test;
#[cfg(test)]
mod pause_lifecycle_test;
#[cfg(test)]
mod proptest_strategies;
#[cfg(test)]
mod reentrancy_test;
#[cfg(test)]
mod security_attacks;
#[cfg(test)]
mod security_test;
#[cfg(test)]
mod seed_ratio_test;
#[cfg(test)]
mod test;
#[cfg(test)]
mod reentrancy_test;
#[cfg(test)]
mod issue_1212_1214_1216_1217_test;

use soroban_sdk::{contract, contractclient, contractimpl, token, Address, Env, Symbol, Vec};

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

/// DEX router contract expected by `deposit_with_swap`.
#[contractclient(name = "DexRouterClient")]
pub trait DexRouterInterface {
    /// Swap `amount_in` from `caller` and deliver at least `min_amount_out`
    /// units of `output_token` to `recipient`; return the amount delivered.
    fn swap_exact_tokens_for_tokens(
        env: Env,
        caller: Address,
        recipient: Address,
        input_token: Address,
        output_token: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> i128;
}

use storage::{
    bump_instance, bump_persistent, get_admin, get_balance, get_layout_version, get_token,
    get_total_deposited, get_total_shares, get_version, is_paused as storage_is_paused, set_admin,
    set_balance, set_layout_version, set_paused, set_token, set_total_deposited, set_total_shares,
    set_version, CURRENT_LAYOUT_VERSION,
    get_vault_state, set_vault_state, VaultState,
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
    get_dex_router,
    get_min_deposit, set_min_deposit,
    get_vault_name, set_vault_name, get_vault_symbol, set_vault_symbol, get_vault_version, set_vault_version,
    get_decimals, set_decimals,
    enter_reentrancy_guard, exit_reentrancy_guard, is_reentrancy_locked,
};
use governance::{
    initialize_governance, create_proposal, vote_on_proposal, execute_proposal,
    get_proposal_status, get_proposal_view, get_proposal_views, ProposalStatus, ProposalType,
};
pub use governance::{ProposalView, ProposalViewStatus};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Scaling factor for the yield-per-share (YPS) accumulator.
///
/// Using 1_000_000_000_000 (1e12) gives sub-stroop precision for any vault
/// with ≤ 1e12 total shares outstanding.  For context, 1e12 stroops is
/// 100_000 XLM — more than any realistic single-vault TVL at today's prices.
pub const YIELD_PRECISION: i128 = 1_000_000_000_000;

/// Maximum withdrawal fee in basis points (5%).
pub const MAX_WITHDRAWAL_FEE_BPS: u32 = 500;
/// Maximum number of recipients allowed in a single batch_deposit call (Issue #932).
pub const MAX_BATCH_SIZE: u32 = 50;
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

/// Helper to enforce the reentrancy lock on all mutating functions (Issue #345).
/// Enters guard (reverting with VaultError::Reentrancy if already locked)
/// and guarantees the lock is cleared on both Ok and Err paths.
fn with_reentrancy_guard<T, F: FnOnce() -> Result<T, VaultError>>(
    env: &Env,
    f: F,
) -> Result<T, VaultError> {
    storage::enter_reentrancy_guard(env)?;
    let result = f();
    storage::exit_reentrancy_guard(env);
    result
}

fn transfer_shares(env: &Env, from: &Address, to: &Address, shares: i128) -> Result<(), VaultError> {
    if shares <= 0 {
        return Err(VaultError::ZeroAmount);
    }
    let from_balance = get_balance(env, from);
    if from_balance < shares {
        return Err(VaultError::InsufficientShares);
    }
    if from == to {
        env.events().publish(
            (Symbol::new(env, "transfer"), from.clone(), to.clone()),
            shares,
        );
        return Ok(());
    }
    let to_balance = get_balance(env, to);
    let next_to_balance = to_balance.checked_add(shares).ok_or(VaultError::MathOverflow)?;
    let next_from_balance = from_balance.checked_sub(shares).ok_or(VaultError::MathOverflow)?;

    // Settle the sender's share-time yield before moving ownership. This keeps
    // already accrued yield with the sender and starts the recipient at the
    // current global accumulator.
    let global_yps = storage::get_cumulative_yps(env);
    let delta_yps = global_yps
        .checked_sub(storage::get_user_checkpoint(env, from))
        .ok_or(VaultError::MathOverflow)?;
    let sender_accrued = from_balance
        .checked_mul(delta_yps)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(YIELD_PRECISION)
        .ok_or(VaultError::MathOverflow)?;
    let sender_pending = storage::get_user_pending_yield(env, from)
        .checked_add(sender_accrued)
        .ok_or(VaultError::MathOverflow)?;
    let receiver_delta = global_yps
        .checked_sub(storage::get_user_checkpoint(env, to))
        .ok_or(VaultError::MathOverflow)?;
    let receiver_accrued = to_balance
        .checked_mul(receiver_delta)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(YIELD_PRECISION)
        .ok_or(VaultError::MathOverflow)?;
    let receiver_pending = storage::get_user_pending_yield(env, to)
        .checked_add(receiver_accrued)
        .ok_or(VaultError::MathOverflow)?;

    set_balance(env, from, next_from_balance);
    set_balance(env, to, next_to_balance);
    storage::set_user_checkpoint(env, from, global_yps);
    storage::set_user_pending_yield(env, from, sender_pending);
    storage::set_user_checkpoint(env, to, global_yps);
    storage::set_user_pending_yield(env, to, receiver_pending);
    bump_user_yield(env, from);
    bump_user_yield(env, to);
    bump_persistent(env, from);
    bump_persistent(env, to);
    env.events().publish(
        (Symbol::new(env, "transfer"), from.clone(), to.clone()),
        shares,
    );
    Ok(())
}

/// Extend TTL of per-user yield accounting entries (checkpoint + pending).
///
/// Called by `collect_pending_yield` and `distribute_yield` to keep user
/// persistent storage alive for the standard 30-day window.
fn bump_user_yield(env: &Env, addr: &Address) {
    storage::bump_user_yield_ttl(env, addr);
}

fn checkpoint_total_share_seconds(env: &Env, now: u64) -> Result<(), VaultError> {
    let last_update = storage::get_epoch_last_update(env);
    let elapsed = now.saturating_sub(last_update);
    if elapsed > 0 {
        let accrued = get_total_shares(env)
            .checked_mul(elapsed as i128)
            .ok_or(VaultError::MathOverflow)?;
        let total = storage::get_epoch_share_seconds(env)
            .checked_add(accrued)
            .ok_or(VaultError::MathOverflow)?;
        storage::set_epoch_share_seconds(env, total);
    }
    storage::set_epoch_last_update(env, now);
    Ok(())
}

fn checkpoint_user_share_seconds(
    env: &Env,
    addr: &Address,
    shares: i128,
    now: u64,
) -> Result<(), VaultError> {
    let current_epoch = storage::get_harvest_epoch(env);
    let (cursor_time, cursor_epoch) = storage::get_user_epoch_cursor(env, addr)
        .unwrap_or((now, current_epoch));

    if cursor_epoch <= current_epoch {
        for epoch in cursor_epoch..=current_epoch {
            let epoch_start = storage::get_epoch_start_at(env, epoch);
            let start = cursor_time.max(epoch_start);
            let end = if epoch == current_epoch {
                now
            } else {
                storage::get_epoch_end_at(env, epoch).unwrap_or(now)
            };
            let duration = end.saturating_sub(start);
            let mut weight = shares
                .checked_mul(duration as i128)
                .ok_or(VaultError::MathOverflow)?;
            if epoch < current_epoch && epoch_start == end && cursor_time <= epoch_start && shares > 0 {
                weight = shares;
            }
            if weight > 0 {
                let prior = storage::get_user_epoch_share_seconds(env, addr, epoch);
                storage::set_user_epoch_share_seconds(
                    env,
                    addr,
                    epoch,
                    prior.checked_add(weight).ok_or(VaultError::MathOverflow)?,
                );
            }
        }
    }

    storage::set_user_epoch_cursor(env, addr, now, current_epoch);
    Ok(())
}

fn user_harvest_yield(env: &Env, addr: &Address, current_epoch: u64) -> Result<i128, VaultError> {
    let mut claimable = 0_i128;
    for epoch in 0..current_epoch {
        let total_weight = storage::get_epoch_total_share_seconds(env, epoch);
        if total_weight == 0 {
            continue;
        }
        let user_weight = storage::get_user_epoch_share_seconds(env, addr, epoch);
        let epoch_yield = storage::get_epoch_yield(env, epoch);
        let reward = user_weight
            .checked_mul(epoch_yield)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(total_weight)
            .ok_or(VaultError::MathOverflow)?;
        claimable = claimable.checked_add(reward).ok_or(VaultError::MathOverflow)?;
    }
    Ok(claimable)
}

fn reduce_user_closed_epoch_weights(
    env: &Env,
    addr: &Address,
    remaining_shares: i128,
    prior_shares: i128,
    current_epoch: u64,
) -> Result<(), VaultError> {
    for epoch in 0..current_epoch {
        let weight = storage::get_user_epoch_share_seconds(env, addr, epoch);
        let remaining = weight
            .checked_mul(remaining_shares)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(prior_shares)
            .ok_or(VaultError::MathOverflow)?;
        storage::set_user_epoch_share_seconds(env, addr, epoch, remaining);
    }
    Ok(())
}

fn record_harvest_epoch(env: &Env, net_yield: i128, now: u64) -> Result<(), VaultError> {
    checkpoint_total_share_seconds(env, now)?;
    let epoch = storage::get_harvest_epoch(env);
    let total_weight = storage::get_epoch_share_seconds(env);
    let total_weight = if total_weight == 0 {
        get_total_shares(env)
    } else {
        total_weight
    };
    if total_weight <= 0 {
        return Err(VaultError::ZeroShares);
    }

    let outstanding = storage::get_outstanding_harvest_yield(env)
        .checked_add(net_yield)
        .ok_or(VaultError::MathOverflow)?;
    storage::set_epoch_end_at(env, epoch, now);
    storage::set_epoch_total_share_seconds(env, epoch, total_weight);
    storage::set_epoch_yield(env, epoch, net_yield);
    storage::set_outstanding_harvest_yield(env, outstanding);

    let next_epoch = epoch.checked_add(1).ok_or(VaultError::MathOverflow)?;
    storage::set_harvest_epoch(env, next_epoch);
    storage::set_epoch_start(env, now);
    storage::set_epoch_start_at(env, next_epoch, now);
    storage::set_epoch_share_seconds(env, 0);
    storage::set_epoch_last_update(env, now);
    Ok(())
}

/// Maximum oracle price accepted without reverting.
///
/// 1e24 in a 7-decimal token (Soroban stroops) is 1e17 tokens — far above any
/// realistic price for any asset denominated in stroops.  Any value above this
/// is almost certainly a feed misconfiguration or a manipulation attempt.
pub const ORACLE_PRICE_SANITY_CAP: i128 = 1_000_000_000_000_000_000_000_000; // 1e24

/// Maximum age of an oracle price before it is considered stale (seconds).
/// Default: 3 600 s (1 hour).  Admin can narrow this via `set_oracle_max_age`.
pub const ORACLE_DEFAULT_MAX_AGE_SECS: u64 = 3_600;

// ---------------------------------------------------------------------------
// Oracle price validation
// ---------------------------------------------------------------------------

/// Validate an oracle-supplied price:
///
/// 1. Zero price — feed returned 0 (dead feed or manipulation).
/// 2. Sanity cap — price > `ORACLE_PRICE_SANITY_CAP` (unreasonably large).
/// 3. Staleness — `updated_at` is older than `max_age_secs` relative to
///    the current ledger timestamp.
///
/// Called by `harvest_token` and `distribute_yield_token` to guard the
/// `underlying_amount` parameter supplied by the caller.
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
    // saturating_sub prevents underflow if updated_at is somehow in the future
    let age = now.saturating_sub(updated_at);
    if age > max_age_secs {
        return Err(VaultError::OraclePriceStale);
    }
    Ok(())
}

/// Verify liquid plus strategy-managed assets against vault liabilities and
/// accrued fees, allowing configured strategies without weakening the balance guard.
fn assert_managed_balance(env: &Env, token: &token::Client) -> Result<(), VaultError> {
    let actual = strategy::managed_balance(env, token)?;
    let expected = get_total_deposited(env)
        .checked_add(storage::get_total_fee_collected(env))
        .ok_or(VaultError::MathOverflow)?;
    if actual != expected {
        env.events().publish(
            (Symbol::new(env, "suspicious"),),
            (Symbol::new(env, "balance_mismatch"), actual, expected),
        );
        return Err(VaultError::BalanceMismatch);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Post-transfer balance assertions
// ---------------------------------------------------------------------------

/// Assert that an **incoming** transfer (caller → vault) moved exactly
/// `expected` stroops into the vault.
///
/// Reads `balance_after` from the token contract and compares with the
/// caller-supplied `balance_before`.  Returns `TransferFailed` if the delta
/// does not match.
///
/// # Why this is necessary
///
/// Soroban's SEP-41 `transfer` entry point panics on failure rather than
/// returning a bool, so there is no return value to inspect. However, a
/// deflationary or fee-on-transfer token might silently deliver fewer tokens
/// than requested.  Asserting the on-chain balance delta catches this class
/// of silent failure.
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

/// Assert that an **outgoing** transfer (vault → recipient) moved exactly
/// `expected` stroops out of the vault.
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
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------
    /// Initialise the vault.
    ///
    /// Must be called **exactly once** immediately after deployment. Stores the
    /// admin address, the underlying SEP-41 token, zeroes out share/deposit
    /// counters, sets the storage layout version, and initialises the
    /// governance signer list.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment (injected by the runtime).
    /// - `admin` — Address with privileged control over pause, fees, and upgrades.
    /// - `underlying_token` — SEP-41-compatible token contract whose tokens are
    ///   deposited into and redeemed from the vault.
    /// - `signers` — Ordered list of addresses authorised to create and vote on
    ///   governance proposals. Must be non-empty.
    ///
    /// # Errors
    ///
    /// - [`VaultError::AlreadyInitialized`] — `initialize` has already been called.
    pub fn initialize(
        env: Env,
        admin: Address,
        underlying_token: Address,
        signers: Vec<Address>,
        decimals: u32,
    ) -> Result<(), VaultError> {
        // CEI audit: verify initialized flag as the very first read; return AlreadyInitialized before any storage writes
        if is_initialized(&env) || get_admin(&env).is_some() {
            return Err(VaultError::AlreadyInitialized);
        }
        set_initialized(&env);
        set_admin(&env, &admin);
        set_token(&env, &underlying_token);
        set_total_shares(&env, 0);
        set_total_deposited(&env, 0);
        storage::set_yield_vesting_pending(&env, 0);
        storage::set_yield_vesting_start(&env, env.ledger().sequence());
        storage::set_yield_vesting_period(&env, storage::DEFAULT_YIELD_VESTING_PERIOD);
        storage::set_cumulative_yps(&env, 0);
        storage::set_distribution_epoch(&env, 0);
        storage::set_harvest_epoch(&env, 0);
        let epoch_start = env.ledger().timestamp();
        storage::set_epoch_start(&env, epoch_start);
        storage::set_epoch_start_at(&env, 0, epoch_start);
        storage::set_epoch_last_update(&env, epoch_start);
        storage::set_epoch_share_seconds(&env, 0);
        storage::set_outstanding_harvest_yield(&env, 0);
        storage::set_user_checkpoint(&env, &admin, 0);
        storage::set_user_pending_yield(&env, &admin, 0);
        set_version(&env, 1);
        set_layout_version(&env, CURRENT_LAYOUT_VERSION);
        set_vault_name(
            &env,
            &soroban_sdk::String::from_str(&env, "Aura Vault Share"),
        );
        set_vault_symbol(&env, &soroban_sdk::String::from_str(&env, "AVS"));
        set_vault_version(&env, 1);
        let dec = if decimals == 0 { 7u32 } else { decimals };
        set_decimals(&env, dec);
        // Issue #357: grant ADMIN role to the deployer at initialization
        set_role_mask(&env, &admin, ROLE_ADMIN);
        initialize_governance(&env, signers)?;
        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit
    //
    // Issue requirement: Emit Deposit event with indexed user and amount.
    // In Soroban, topics (first tuple) are indexed; data (second value) is not.
    // We place `caller` and `amount` in topics so they can be efficiently
    // filtered by indexers.
    // -----------------------------------------------------------------------
    /// Deposit underlying tokens and receive proportional vault shares.
    ///
    /// Computes the shares to mint using the current exchange rate:
    ///
    /// ```text
    /// // Empty vault: 1-to-1 seed ratio
    /// shares = amount
    ///
    /// // Non-empty vault:
    /// shares = floor(amount × total_shares / total_deposited)
    /// ```
    ///
    /// Enforces the flash-loan guard before executing (actual on-chain balance
    /// must equal `total_deposited`). If `referrer` is `Some(addr)` and
    /// `addr != caller`, the on-chain referral count for `addr` is incremented
    /// and a `deposit_with_referral` event is emitted alongside the standard
    /// `deposit` event. On success, emits a `deposit` event with topics
    /// `(event_name, caller, amount)` and data
    /// `(new_shares, new_total_shares, new_total_deposited)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address depositing tokens; must authorise this call.
    /// - `amount` — Number of underlying tokens to deposit, in the token's
    ///   smallest unit (e.g. stroops for a 7-decimal Stellar token). Must be > 0.
    /// - `nonce` — Per-address replay-protection counter.  Must equal the value
    ///   returned by `get_nonce(caller)`.  Incremented atomically on success.
    ///
    /// # Returns
    ///
    /// The number of vault shares minted for `caller`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `amount <= 0`, or share formula rounds to 0.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow in share formula.
    /// - [`VaultError::InvalidNonce`] — supplied nonce does not match stored nonce.
    pub fn deposit(env: Env, caller: Address, amount: i128, nonce: u64) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();

            // Validate referrer: must not be the same as the depositor.
            if let Some(ref ref_addr) = referrer {
                if ref_addr == &caller {
                    return Err(VaultError::SelfReferral);
                }
            }

            if amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }

            // KYC allowlist mode (Issue #916) is independent of the legacy
            // whitelist mode and is enforced before any token call or state write.
            if storage_is_allowlist_enabled(&env) && !storage_is_allowlisted(&env, &caller) {
                return Err(VaultError::NotApproved);
            }

            // Whitelist check — Issue #349
            if get_whitelist_enabled(&env) && !storage::is_whitelisted(&env, &caller) {
                return Err(VaultError::NotWhitelisted);
            }

            // Minimum deposit check — Issue #355
            let min_deposit = get_min_deposit(&env);
            if min_deposit > 0 && amount < min_deposit {
                return Err(VaultError::BelowMinDeposit);
            }

            // TVL cap check — 0 means unlimited (Issue #467)
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

            // Flash-loan guard: actual token balance must equal tracked state before deposit.
            let balance_before = token.balance(&env.current_contract_address());
            let vault_state = get_vault_state(&env);
            let total_deposited = vault_state.total_assets;
            let total_shares = vault_state.total_shares;
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (
                        Symbol::new(&env, "balance_mismatch"),
                        balance_before,
                        total_deposited,
                    ),
                );
                return Err(VaultError::BalanceMismatch);
            }

            let total_shares = get_total_shares(&env);
            let share_pricing_assets = total_deposited
                .checked_sub(storage::get_outstanding_harvest_yield(&env))
                .ok_or(VaultError::MathOverflow)?;

            // Compute shares to mint (checked arithmetic; overflow returns MathOverflow)
            let priced_assets = total_deposited.saturating_sub(storage::unvested_yield(&env));
            let new_shares: i128 = if total_shares == 0 || priced_assets == 0 {
                amount
            } else {
                let numerator = amount
                    .checked_mul(total_shares)
                    .ok_or(VaultError::MathOverflow)?;
                numerator
                    .checked_div(priced_assets)
                    .ok_or(VaultError::MathOverflow)?
            };

            if new_shares <= 0 {
                return Err(VaultError::ZeroAmount);
            }

            // CEI — Interaction: pull tokens from caller into vault
            let vault_addr = env.current_contract_address();
            let pre_deposit_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &amount);
            assert_incoming_transfer(&token, &vault_addr, pre_deposit_balance, amount)?;
            strategy::deposit(&env, &token, amount)?;

            // Effects: write state after successful transfer
            let old_balance = get_balance(&env, &caller);
            let now = env.ledger().timestamp();
            checkpoint_total_share_seconds(&env, now)?;
            checkpoint_user_share_seconds(&env, &caller, old_balance, now)?;
            let new_balance = old_balance
                .checked_add(new_shares)
                .ok_or(VaultError::MathOverflow)?;
            set_balance(&env, &caller, new_balance);
            storage::set_deposit_metadata(
                &env,
                &caller,
                now,
                storage::get_harvest_epoch(&env),
            );
            storage::set_user_checkpoint(&env, &caller, storage::get_cumulative_yps(&env));
            storage::set_user_pending_yield(
                &env,
                &caller,
                storage::get_user_pending_yield(&env, &caller),
            );
            let new_total_shares = total_shares
                .checked_add(new_shares)
                .ok_or(VaultError::MathOverflow)?;
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
                10_000_000 // 1:1 on empty vault
            };
            let timestamp = env.ledger().timestamp();
            env.events().publish(
                (Symbol::new(&env, "deposit"), caller.clone(), amount),
                (
                    new_shares,
                    new_total_shares,
                    new_total_deposited,
                    share_price,
                    timestamp,
                ),
            );

            bump_persistent(&env, &caller);
            bump_instance(&env);

            Ok(new_shares)
        })
    }

    /// Swap another SEP-41 token through the configured router and deposit
    /// the resulting underlying tokens in one atomic operation.
    pub fn deposit_with_swap(
        env: Env,
        caller: Address,
        input_token: Address,
        input_amount: i128,
        min_shares: i128,
    ) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if input_amount <= 0 || min_shares <= 0 {
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
            let router_addr = get_dex_router(&env).ok_or(VaultError::DexNotConfigured)?;
            let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            if input_token == underlying_addr {
                return Err(VaultError::InvalidAddress);
            }

            let token = token::Client::new(&env, &underlying_addr);
            let vault_addr = env.current_contract_address();
            let balance_before = token.balance(&vault_addr);
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                return Err(VaultError::BalanceMismatch);
            }

            let total_shares = get_total_shares(&env);
            let min_underlying = if total_shares == 0 || total_deposited == 0 {
                min_shares
            } else {
                let numerator = min_shares
                    .checked_mul(total_deposited)
                    .ok_or(VaultError::MathOverflow)?;
                numerator
                    .checked_add(total_shares - 1)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(total_shares)
                    .ok_or(VaultError::MathOverflow)?
            };
            let router = DexRouterClient::new(&env, &router_addr);
            let reported_out = router.swap_exact_tokens_for_tokens(
                &caller,
                &vault_addr,
                &input_token,
                &underlying_addr,
                &input_amount,
                &min_underlying,
            );
            let received = token.balance(&vault_addr)
                .checked_sub(balance_before)
                .ok_or(VaultError::MathOverflow)?;
            if received <= 0 || received != reported_out || received < min_underlying {
                return Err(VaultError::DexSlippageExceeded);
            }

            let min_deposit = get_min_deposit(&env);
            if min_deposit > 0 && received < min_deposit {
                return Err(VaultError::BelowMinDeposit);
            }
            let next_total_deposited = total_deposited
                .checked_add(received)
                .ok_or(VaultError::MathOverflow)?;
            let tvl_cap = get_tvl_cap(&env);
            if tvl_cap > 0 && next_total_deposited > tvl_cap {
                return Err(VaultError::TvlCapExceeded);
            }
            let minted = if total_shares == 0 || total_deposited == 0 {
                received
            } else {
                received.checked_mul(total_shares)
                    .ok_or(VaultError::MathOverflow)?
                    .checked_div(total_deposited)
                    .ok_or(VaultError::MathOverflow)?
            };
            if minted <= 0 || minted < min_shares {
                return Err(VaultError::DexSlippageExceeded);
            }

            let new_balance = get_balance(&env, &caller)
                .checked_add(minted)
                .ok_or(VaultError::MathOverflow)?;
            let next_total_shares = total_shares
                .checked_add(minted)
                .ok_or(VaultError::MathOverflow)?;
            set_balance(&env, &caller, new_balance);
            storage::set_user_checkpoint(&env, &caller, storage::get_cumulative_yps(&env));
            storage::set_user_pending_yield(&env, &caller, storage::get_user_pending_yield(&env, &caller));
            set_total_shares(&env, next_total_shares);
            set_total_deposited(&env, next_total_deposited);
            let share_price = next_total_deposited
                .checked_mul(10_000_000)
                .and_then(|value| value.checked_div(next_total_shares))
                .unwrap_or(0);
            env.events().publish(
                (Symbol::new(&env, "deposit"), caller.clone(), received),
                (minted, next_total_shares, next_total_deposited, share_price, env.ledger().timestamp()),
            );
            bump_persistent(&env, &caller);
            bump_instance(&env);
            Ok(minted)
        })
    }

    // -----------------------------------------------------------------------
    // batch_deposit (Issue #932)
    //
    // Deposits tokens on behalf of multiple recipients in a single call.
    // The caller transfers the total sum upfront; shares are minted
    // individually per recipient using the current exchange rate.
    //
    // Batch size is capped at MAX_BATCH_SIZE (50) to bound gas.
    //
    // Events:
    //   - one ("deposit", recipient, amount) per recipient
    //   - one ("batch_deposit_completed", caller) → (total_amount, recipient_count)
    //
    // Security:
    //   - CEI ordering: total transfer in first, then state updates per recipient
    //   - Flash-loan guard checked once before the transfer
    //   - Reentrancy guard wraps the entire function
    //   - TVL cap checked against total_amount before any transfer
    // -----------------------------------------------------------------------
    /// Deposit tokens on behalf of multiple recipients in a single transaction.
    ///
    /// `caller` transfers the **total sum** of all amounts upfront. Shares are
    /// computed and credited individually for each recipient using the current
    /// exchange rate at call time.
    ///
    /// # Batch limit
    ///
    /// A maximum of **50 recipients** per call is enforced to bound ledger gas.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address that transfers tokens for all recipients.
    ///   Must authorise this call.
    /// - `recipients` — `Vec<(Address, i128)>` of (recipient, amount) pairs.
    ///   Must be non-empty and ≤ 50 entries. Every amount must be > 0.
    ///
    /// # Returns
    ///
    /// `Vec<i128>` of shares minted per recipient, in input order.
    ///
    /// # Errors
    ///
    /// - [`VaultError::BatchEmpty`] — `recipients` is empty.
    /// - [`VaultError::BatchTooLarge`] — more than 50 recipients supplied.
    /// - [`VaultError::ZeroAmount`] — any individual amount ≤ 0, or a share
    ///   formula rounds to zero.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    /// - [`VaultError::TvlCapExceeded`] — total deposit would exceed TVL cap.
    pub fn batch_deposit(
        env: Env,
        caller: Address,
        recipients: Vec<(Address, i128)>,
    ) -> Result<Vec<i128>, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();

            // ---- Checks -------------------------------------------------------

            let recipient_count = recipients.len();

            if recipient_count == 0 {
                return Err(VaultError::BatchEmpty);
            }
            if recipient_count > MAX_BATCH_SIZE {
                return Err(VaultError::BatchTooLarge);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }

            // Validate every amount and compute the total in a single pass.
            let mut total_amount: i128 = 0;
            for i in 0..recipient_count {
                let (_, amount) = recipients.get(i).unwrap();
                if amount <= 0 {
                    return Err(VaultError::ZeroAmount);
                }
                total_amount = total_amount
                    .checked_add(amount)
                    .ok_or(VaultError::MathOverflow)?;
            }

            // TVL cap check (0 = unlimited)
            let tvl_cap = get_tvl_cap(&env);
            if tvl_cap > 0 {
                let current_total = get_total_deposited(&env);
                let after_deposit = current_total
                    .checked_add(total_amount)
                    .ok_or(VaultError::MathOverflow)?;
                if after_deposit > tvl_cap {
                    return Err(VaultError::TvlCapExceeded);
                }
            }

            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let vault_addr = env.current_contract_address();

            // Flash-loan guard: actual balance must match tracked state before deposit.
            let balance_before = token.balance(&vault_addr);
            let total_deposited_before = get_total_deposited(&env);
            if balance_before != total_deposited_before {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited_before),
                );
                return Err(VaultError::BalanceMismatch);
            }

            // ---- Interaction: single transfer of the total amount from caller ----
            let pre_deposit_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &total_amount);
            assert_incoming_transfer(&token, &vault_addr, pre_deposit_balance, total_amount)?;

            // ---- Effects: mint shares per recipient ------------------------------
            //
            // After the transfer we read the global totals once and update them
            // incrementally. We capture total_shares and total_deposited before
            // the loop so every recipient's shares are computed against the
            // same baseline (fair proportional minting across the batch).

            let mut running_total_shares = get_total_shares(&env);
            let mut running_total_deposited = get_total_deposited(&env);

            let mut minted_shares: Vec<i128> = Vec::new(&env);

            for i in 0..recipient_count {
                let (recipient, amount) = recipients.get(i).unwrap();

                // Share formula — same as single deposit()
                let new_shares: i128 = if running_total_shares == 0 || running_total_deposited == 0 {
                    amount
                } else {
                    let numerator = amount
                        .checked_mul(running_total_shares)
                        .ok_or(VaultError::MathOverflow)?;
                    numerator
                        .checked_div(running_total_deposited)
                        .ok_or(VaultError::MathOverflow)?
                };

                if new_shares <= 0 {
                    return Err(VaultError::ZeroAmount);
                }

                // Update recipient balance
                let old_balance = get_balance(&env, &recipient);
                let new_balance = old_balance
                    .checked_add(new_shares)
                    .ok_or(VaultError::MathOverflow)?;
                set_balance(&env, &recipient, new_balance);

                // Update yield checkpoint so new recipients start with no
                // outstanding yield debt from before their deposit.
                storage::set_user_checkpoint(&env, &recipient, storage::get_cumulative_yps(&env));
                storage::set_user_pending_yield(
                    &env,
                    &recipient,
                    storage::get_user_pending_yield(&env, &recipient),
                );

                // Accumulate running totals
                running_total_shares = running_total_shares
                    .checked_add(new_shares)
                    .ok_or(VaultError::MathOverflow)?;
                running_total_deposited = running_total_deposited
                    .checked_add(amount)
                    .ok_or(VaultError::MathOverflow)?;

                // Per-recipient deposit event (matches single deposit() format)
                let share_price: i128 = if running_total_shares > 0 {
                    running_total_deposited
                        .checked_mul(10_000_000)
                        .and_then(|v| v.checked_div(running_total_shares))
                        .unwrap_or(0)
                } else {
                    10_000_000
                };
                let timestamp = env.ledger().timestamp();
                env.events().publish(
                    (Symbol::new(&env, "deposit"), recipient.clone(), amount),
                    (new_shares, running_total_shares, running_total_deposited, share_price, timestamp),
                );

                bump_persistent(&env, &recipient);
                minted_shares.push_back(new_shares);
            }

            // Persist final running totals
            set_total_shares(&env, running_total_shares);
            set_total_deposited(&env, running_total_deposited);

            // Summary event for the whole batch
            env.events().publish(
                (Symbol::new(&env, "batch_deposit_completed"), caller),
                (total_amount, recipient_count as u32),
            );

            bump_instance(&env);

            Ok(minted_shares)
        })
    }

    // -----------------------------------------------------------------------
    // withdraw
    // -----------------------------------------------------------------------
    /// Burn vault shares and redeem the proportional underlying tokens.
    ///
    /// Calculates the redemption amount:
    ///
    /// ```text
    /// redeem_amount = floor(shares × total_deposited / total_shares)
    /// ```
    ///
    /// Follows strict **CEI (Checks-Effects-Interactions)** ordering: shares
    /// are burned and all state is written *before* the token transfer to
    /// prevent reentrancy. Emits a `withdraw` event with topics
    /// `(event_name, caller, shares)` and data
    /// `(redeem_amount, new_total_shares, new_total_deposited)`.
    ///
    /// ## Withdrawal queue
    ///
    /// When a `withdrawal_queue_threshold > 0` is configured by the admin and
    /// `redeem_amount >= threshold`, the withdrawal is **queued** instead of
    /// being processed immediately.  In this case:
    ///
    /// - Shares are burned immediately (CEI: state written before interaction).
    /// - An entry is stored in the queue with a `claimable_after` timestamp.
    /// - The function returns `Err(VaultError::WithdrawalQueued)`.
    /// - The caller must call `claim_queued_withdrawal(entry_id)` once the
    ///   unbonding period has elapsed to receive their tokens.
    /// - The `withdraw_queued` event carries the `entry_id` so callers can
    ///   look it up later.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address redeeming shares; must authorise this call.
    /// - `shares` — Number of vault shares to burn. Must be > 0 and ≤
    ///   `balance_of(caller)`.
    ///
    /// # Returns
    ///
    /// The number of underlying tokens transferred to `caller` (instant path).
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `shares <= 0`, or redemption rounds to 0.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::InsufficientShares`] — caller holds fewer shares than requested.
    /// - [`VaultError::InsufficientUnderlying`] — vault cannot cover the redemption.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    /// - [`VaultError::WithdrawalQueued`] — withdrawal is large and has been
    ///   queued; call `claim_queued_withdrawal` after the unbonding period.
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
            let vault_state = get_vault_state(&env);
            let total_deposited = vault_state.total_assets;
            let total_shares = vault_state.total_shares;
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (
                        Symbol::new(&env, "balance_mismatch"),
                        balance_before,
                        total_deposited,
                    ),
                );
                return Err(VaultError::BalanceMismatch);
            }

            let user_balance = get_balance(&env, &caller);
            if shares > user_balance {
                return Err(VaultError::InsufficientShares);
            }

            let total_shares = get_total_shares(&env);
            let now = env.ledger().timestamp();
            checkpoint_total_share_seconds(&env, now)?;
            checkpoint_user_share_seconds(&env, &caller, user_balance, now)?;

            let priced_assets = total_deposited.saturating_sub(storage::unvested_yield(&env));
            let numerator = shares
                .checked_mul(priced_assets)
                .ok_or(VaultError::MathOverflow)?;
            let base_redeem = base_numerator
                .checked_div(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            let current_epoch = storage::get_harvest_epoch(&env);
            let user_yield = user_harvest_yield(&env, &caller, current_epoch)?;
            let harvested_redeem = user_yield
                .checked_mul(shares)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(user_balance)
                .ok_or(VaultError::MathOverflow)?;
            let redeem_amount = base_redeem
                .checked_add(harvested_redeem)
                .ok_or(VaultError::MathOverflow)?;

            if redeem_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            // CEI — Effects: burn shares before any token transfer
            let new_balance = user_balance - shares;
            reduce_user_closed_epoch_weights(
                &env,
                &caller,
                new_balance,
                user_balance,
                current_epoch,
            )?;
            storage::set_outstanding_harvest_yield(
                &env,
                outstanding_harvest_yield
                    .checked_sub(harvested_redeem)
                    .ok_or(VaultError::MathOverflow)?,
            );
            set_balance(&env, &caller, new_balance);
            let new_total_shares = total_shares
                .checked_sub(shares)
                .ok_or(VaultError::MathOverflow)?;
            storage::set_user_checkpoint(&env, &caller, storage::get_cumulative_yps(&env));
            storage::set_user_pending_yield(
                &env,
                &caller,
                storage::get_user_pending_yield(&env, &caller),
            );
            let new_total_deposited = total_deposited
                .checked_sub(redeem_amount)
                .ok_or(VaultError::MathOverflow)?;
            set_vault_state(&env, &VaultState {
                total_assets: new_total_deposited,
                total_shares: new_total_shares,
            });

            bump_persistent(&env, &caller);
            bump_instance(&env);

            // -----------------------------------------------------------------------
            // Withdrawal queue: if the redemption amount meets or exceeds the
            // configured threshold, queue the withdrawal instead of sending tokens.
            //
            // Shares are already burned above (CEI).  We store an entry and return
            // WithdrawalQueued so the caller knows to call claim_queued_withdrawal.
            // -----------------------------------------------------------------------
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

                // Event: topics = (event_name, caller, entry_id) — indexed.
                env.events().publish(
                    (
                        Symbol::new(&env, "withdraw_queued"),
                        caller.clone(),
                        entry_id,
                    ),
                    (
                        shares,
                        redeem_amount,
                        claimable_after,
                        new_total_shares,
                        new_total_deposited,
                    ),
                );

                return Err(VaultError::WithdrawalQueued);
            }

            // -----------------------------------------------------------------------
            // Instant withdrawal path
            // -----------------------------------------------------------------------

            // Interaction: send tokens to caller after all state is settled
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
                0 // vault is empty after full withdrawal
            };
            let timestamp = env.ledger().timestamp();
            env.events().publish(
                (Symbol::new(&env, "withdraw"), caller.clone(), shares),
                (
                    redeem_amount,
                    new_total_shares,
                    new_total_deposited,
                    share_price,
                    timestamp,
                ),
            );

            bump_persistent(&env, &caller);
            bump_instance(&env);

            Ok(redeem_amount)
        })
    }

    /// Atomically redeem up to `MAX_BATCH_SIZE` share amounts for one caller.
    pub fn batch_withdraw(env: Env, caller: Address, shares: Vec<i128>) -> Result<Vec<i128>, VaultError> {
        with_reentrancy_guard(&env, || batch::withdraw(&env, &caller, shares))
    }

    // -----------------------------------------------------------------------
    // emergency_withdraw — exit path available only while vault is paused
    // -----------------------------------------------------------------------
    /// Burn vault shares and redeem underlying tokens during an emergency pause.
    ///
    /// When the admin pauses the vault, users retain the right to exit via this
    /// function. It is intentionally limited to the paused state so that it
    /// cannot be exploited under normal operating conditions (use [`withdraw`]
    /// when the vault is unpaused).
    ///
    /// Differences from [`withdraw`]:
    /// - **Only callable when paused** — rejects with [`VaultError::VaultNotPaused`]
    ///   if the vault is operating normally.
    /// - **No harvest** — yield is not compounded before redemption.
    /// - **No fees** — the full `redeem_amount` is transferred; no performance
    ///   or withdrawal fee is deducted.
    /// - **Emits `emergency_withdrawal`** event (not `withdraw`).
    /// - **No withdrawal queue** — large redemptions bypass the queue and
    ///   are always processed immediately, giving users a guaranteed exit.
    ///
    /// Follows strict **CEI** ordering: shares are burned and state is written
    /// *before* the token transfer.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address redeeming shares; must authorise this call.
    /// - `shares` — Number of vault shares to burn. Must be > 0 and ≤
    ///   `balance_of(caller)`.
    ///
    /// # Returns
    ///
    /// The number of underlying tokens transferred to `caller`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `shares <= 0`, or redemption rounds to zero.
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::VaultNotPaused`] — vault is not paused; use [`withdraw`].
    /// - [`VaultError::InsufficientShares`] — caller holds fewer shares than requested.
    /// - [`VaultError::InsufficientUnderlying`] — vault cannot cover the redemption.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    ///
    /// [`withdraw`]: AuraVault::withdraw
    pub fn emergency_withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();

            if shares <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            // Emergency withdraw is ONLY allowed while paused.
            // For normal operation, callers must use withdraw().
            if !storage_is_paused(&env) {
                return Err(VaultError::VaultNotPaused);
            }

            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);

            let user_balance = get_balance(&env, &caller);
            if shares > user_balance {
                return Err(VaultError::InsufficientShares);
            }

            let total_deposited = get_total_deposited(&env);
            let total_shares_count = get_total_shares(&env);

            // Compute redemption amount: floor(shares × total_deposited / total_shares)
            let numerator = shares
                .checked_mul(total_deposited)
                .ok_or(VaultError::MathOverflow)?;
            let redeem_amount = numerator
                .checked_div(total_shares_count)
                .ok_or(VaultError::MathOverflow)?;

            if redeem_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if total_deposited < redeem_amount {
                return Err(VaultError::InsufficientUnderlying);
            }

            // CEI — Effects: burn shares and update state before any token transfer.
            let new_balance = user_balance - shares;
            set_balance(&env, &caller, new_balance);
            let new_total_shares = total_shares_count
                .checked_sub(shares)
                .ok_or(VaultError::MathOverflow)?;
            set_total_shares(&env, new_total_shares);
            // Keep yield checkpoints current so the user's accrued yield stays
            // consistent if the vault is unpaused and they later claim it.
            storage::set_user_checkpoint(&env, &caller, storage::get_cumulative_yps(&env));
            storage::set_user_pending_yield(&env, &caller, storage::get_user_pending_yield(&env, &caller));
            let new_total_deposited = total_deposited
                .checked_sub(redeem_amount)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_total_deposited);

            bump_persistent(&env, &caller);
            bump_instance(&env);

            // Interaction: transfer underlying tokens to caller (no fee deducted).
            let vault_addr = env.current_contract_address();
            let pre_withdraw_balance = token.balance(&vault_addr);
            token.transfer(&vault_addr, &caller, &redeem_amount);
            assert_outgoing_transfer(&token, &vault_addr, pre_withdraw_balance, redeem_amount)?;

            // Event: topics = ("emergency_withdrawal", caller, shares) — indexed.
            // data  = (redeem_amount, new_total_shares, new_total_deposited)
            env.events().publish(
                (Symbol::new(&env, "emergency_withdrawal"), caller.clone(), shares),
                (redeem_amount, new_total_shares, new_total_deposited),
            );

            Ok(redeem_amount)
        })
    }

    // -----------------------------------------------------------------------
    // Withdrawal queue configuration — admin-only
    //
    // When a withdrawal request exceeds `withdrawal_queue_threshold`, the
    // vault routes it through the queue instead of processing it immediately.
    // This prevents flash-loan attacks on large redemptions and gives the
    // vault time to source liquidity from yield strategies.
    //
    // Queue lifecycle:
    //   1. caller calls `withdraw()` with shares whose redemption value
    //      exceeds the threshold.
    //   2. `withdraw()` burns shares, records the entry, and returns
    //      VaultError::WithdrawalQueued (the entry ID is in the event).
    //   3. After `unbonding_secs` have elapsed, the caller calls
    //      `claim_queued_withdrawal(id)` to collect their tokens.
    //   4. A `withdrawal_fee_bps` may be charged at claim time; the fee is
    //      added to `total_fee_collected` (goes to the treasury).
    // -----------------------------------------------------------------------

    /// Admin: set the threshold above which withdrawals are queued.
    ///
    /// `threshold = 0` disables the queue (all withdrawals are instant).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
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

    /// Admin: set the unbonding period for queued withdrawals (seconds).
    ///
    /// Queued withdrawals cannot be claimed until `unbonding_secs` have
    /// elapsed from the time the entry was created.  `0` means claimable
    /// immediately (still goes through the queue, just no waiting period).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
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
            env.events()
                .publish((Symbol::new(&env, "unbonding_set"), admin), (secs,));
            Ok(())
        })
    }

    /// Admin: set the withdrawal fee in basis points (0–500, i.e., 0–5%).
    ///
    /// The fee is deducted from the redeemed amount when a queued withdrawal
    /// is claimed. The fee is credited to `total_fee_collected` and flows to
    /// the treasury via `withdraw_fees`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    /// - [`VaultError::InvalidWithdrawalFee`] — `bps > 500`.
    pub fn set_withdrawal_fee(env: Env, admin: Address, bps: u32) -> Result<(), VaultError> {
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
            env.events()
                .publish((Symbol::new(&env, "withdrawal_fee_set"), admin), (bps,));
            Ok(())
        })
    }

    /// Read the current withdrawal queue threshold (0 = queue disabled).
    pub fn get_withdrawal_queue_threshold(env: Env) -> i128 {
        storage::get_withdrawal_queue_threshold(&env)
    }

    /// Read the current unbonding period in seconds.
    pub fn get_withdrawal_unbonding_secs(env: Env) -> u64 {
        storage::get_withdrawal_unbonding_secs(&env)
    }

    /// Read the current withdrawal fee in basis points.
    pub fn get_withdrawal_fee_bps(env: Env) -> u32 {
        storage::get_withdrawal_fee_bps(&env)
    }

    // -----------------------------------------------------------------------
    // claim_queued_withdrawal
    //
    // Process a queued withdrawal entry once its unbonding period has elapsed.
    //
    // Steps:
    //   1. Verify the entry exists and belongs to `caller`.
    //   2. Verify the unbonding period has elapsed.
    //   3. Deduct withdrawal fee (if configured).
    //   4. Transfer net tokens to `caller`.
    //   5. Remove the entry from storage.
    //
    // The shares were already burned in `withdraw()` when the entry was
    // created, so we only need to transfer tokens here.
    //
    // Returns the net token amount transferred to the caller after fees.
    // -----------------------------------------------------------------------
    /// Claim a queued withdrawal after the unbonding period has elapsed.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Must be the owner of the queue entry and authorise this call.
    /// - `entry_id` — The queue entry ID returned in the `withdraw_queued` event.
    ///
    /// # Returns
    ///
    /// The net underlying tokens transferred to `caller` after deducting any
    /// withdrawal fee.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::QueueEntryNotFound`] — no entry exists for `entry_id`.
    /// - [`VaultError::InsufficientShares`] — caller is not the owner of the entry.
    /// - [`VaultError::QueueUnbondingPending`] — unbonding period has not elapsed.
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

            // Load the queue entry
            let entry =
                get_withdrawal_entry(&env, entry_id).ok_or(VaultError::QueueEntryNotFound)?;

            // Verify ownership
            if entry.owner != caller {
                return Err(VaultError::InsufficientShares);
            }

            // Check unbonding period
            let now = env.ledger().timestamp();
            if now < entry.claimable_after {
                return Err(VaultError::QueueUnbondingPending);
            }

            // Calculate fee on the redeem amount
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

            let net_amount = entry
                .redeem_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;

            if net_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }

            // CEI — Effects: remove entry and accrue fee before interaction
            remove_withdrawal_entry(&env, entry_id);
            if fee_amount > 0 {
                let prev_fees = storage::get_total_fee_collected(&env);
                storage::set_total_fee_collected(
                    &env,
                    prev_fees
                        .checked_add(fee_amount)
                        .ok_or(VaultError::MathOverflow)?,
                );
            }

            // Interaction: transfer tokens to caller
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            let vault_addr = env.current_contract_address();
            let pre_claim_balance = token.balance(&vault_addr);
            token.transfer(&vault_addr, &caller, &net_amount);
            assert_outgoing_transfer(&token, &vault_addr, pre_claim_balance, net_amount)?;

            // Event: topics = (event_name, caller, entry_id) — indexed.
            env.events().publish(
                (
                    Symbol::new(&env, "withdrawal_claimed"),
                    caller.clone(),
                    entry_id,
                ),
                (entry.redeem_amount, fee_amount, net_amount),
            );

            bump_persistent(&env, &caller);
            bump_instance(&env);

            Ok(net_amount)
        })
    }

    /// Read a withdrawal queue entry by ID.
    ///
    /// Returns `None` if the entry does not exist (was never created or was
    /// already claimed).
    pub fn get_withdrawal_entry(env: Env, entry_id: u64) -> Option<WithdrawalEntry> {
        storage::get_withdrawal_entry(&env, entry_id)
    }
    // -----------------------------------------------------------------------
    /// Inject underlying-token yield into the vault without minting new shares.
    ///
    /// Any keeper may call this to increase `total_deposited`, which raises the
    /// redemption value of all existing shares (auto-compounding). A performance
    /// fee is deducted from `yield_amount` before the net amount is credited.
    ///
    /// Emits a `harvest` event with topics `(event_name, caller, yield_amount)`
    /// and data `(yield_after_fee, fee_amount, new_total_deposited)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address supplying yield tokens; must authorise this call.
    /// - `yield_amount` — Amount of underlying tokens to inject, in the token's
    ///   smallest unit. Must be > 0.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `yield_amount <= 0`.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::ZeroShares`] — vault has no outstanding shares.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    pub fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();

            if yield_amount <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }

            // Issue #357: harvest requires KEEPER or ADMIN role
            if !has_role(&env, &caller, ROLE_KEEPER) && !has_role(&env, &caller, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }

            let vault_state = get_vault_state(&env);
            let total_shares = vault_state.total_shares;
            let total_deposited = vault_state.total_assets;
            if total_shares == 0 {
                return Err(VaultError::ZeroShares);
            }

            // Harvest cooldown check — Issue #471
            // If a cooldown is configured, reject harvests that arrive too soon.
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
            let priced_assets = total_deposited.saturating_sub(storage::unvested_yield(&env));

            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);

            // Flash-loan guard
            let balance_before = token.balance(&env.current_contract_address());
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (
                        Symbol::new(&env, "balance_mismatch"),
                        balance_before,
                        total_deposited,
                    ),
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

            // -----------------------------------------------------------------------
            // Circuit-breaker check — Issue #371
            //
            // Share price is represented as total_deposited / total_shares (in
            // underlying token units per share).  We compare old_price vs new_price
            // using cross-multiplication to stay integer-only and avoid division.
            //
            //   old_price = total_deposited / total_shares
            //   new_price = new_total       / total_shares
            //
            // A limit of L bps means:
            //   price_delta / old_price > L / 10_000
            //
            // Which is equivalent (via cross-multiplication):
            //   |new_total - total_deposited| * 10_000 > total_deposited * L
            //
            // L == 0 disables the check.
            // -----------------------------------------------------------------------
            let price_limit_bps = storage::get_price_movement_limit(&env);
            if price_limit_bps > 0 && priced_assets > 0 {
                let delta = new_total
                    .checked_sub(total_deposited)
                    .ok_or(VaultError::MathOverflow)?
                    .abs();
                // delta * 10_000 > total_deposited * price_limit_bps
                let lhs = delta
                    .checked_mul(10_000)
                    .ok_or(VaultError::MathOverflow)?;
                let rhs = priced_assets
                    .checked_mul(price_limit_bps as i128)
                    .ok_or(VaultError::MathOverflow)?;
                if lhs > rhs {
                    // Auto-pause and emit event before returning the error.
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

            // Interaction: pull yield tokens into vault
            let vault_addr = env.current_contract_address();
            let pre_harvest_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(&token, &vault_addr, pre_harvest_balance, yield_amount)?;
            keeper::record_harvest(&env, &caller, yield_amount)?;

            // Effects: increase total deposited with net yield; accumulate fees
            set_total_deposited(&env, new_total);
            storage::schedule_yield_vesting(&env, yield_after_fee)?;
            storage::set_total_fee_collected(&env, new_fees);
            let harvest_timestamp = env.ledger().timestamp();
            record_harvest_epoch(&env, yield_after_fee, harvest_timestamp)?;
            // Record harvest timestamp for cooldown enforcement (Issue #471)
            set_last_harvest_time(&env, harvest_timestamp);

            let ledger_timestamp = env.ledger().timestamp();
            let new_rate: i128 = if total_shares > 0 {
                new_total
                    .checked_mul(10_000_000)
                    .and_then(|v| v.checked_div(total_shares))
                    .unwrap_or(0)
            } else {
                10_000_000
            };

            env.events().publish(
                (Symbol::new(&env, "share_price_snapshot"),),
                (new_rate, new_total, total_shares, yield_amount, ledger_timestamp),
            );

            env.events().publish(
                (Symbol::new(&env, "harvest"), caller.clone(), yield_amount),
                (yield_after_fee, fee_amount, new_total),
            );

            bump_instance(&env);

            Ok(())
        })
    }

    /// Harvest yield directly from the configured strategy contract.
    pub fn harvest_strategy(env: Env, caller: Address) -> Result<i128, VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();
            if get_admin(&env).is_none() { return Err(VaultError::NotInitialized); }
            if storage_is_paused(&env) { return Err(VaultError::VaultPaused); }
            if !has_role(&env, &caller, ROLE_KEEPER) && !has_role(&env, &caller, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }
            let cooldown = get_harvest_cooldown_secs(&env);
            let last = get_last_harvest_time(&env);
            if cooldown > 0 && last > 0
                && env.ledger().timestamp().saturating_sub(last) < cooldown
            {
                return Err(VaultError::HarvestCooldown);
            }
            let token_address = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_address);
            let vault = env.current_contract_address();
            let before = token.balance(&vault);
            let gross = strategy::harvest(&env)?;
            if gross <= 0 { return Err(VaultError::ZeroAmount); }
            let received = token.balance(&vault).checked_sub(before).ok_or(VaultError::TransferFailed)?;
            if received != gross { return Err(VaultError::TransferFailed); }

            let fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(gross, fee_bps)?;
            let net = gross.checked_sub(fee_amount).ok_or(VaultError::MathOverflow)?;
            let old_assets = get_total_deposited(&env);
            let new_assets = old_assets.checked_add(net).ok_or(VaultError::MathOverflow)?;
            let old_fees = storage::get_total_fee_collected(&env);
            let new_fees = old_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?;
            let expected = new_assets.checked_add(new_fees).ok_or(VaultError::MathOverflow)?;
            if strategy::managed_balance(&env, &token)? != expected {
                return Err(VaultError::BalanceMismatch);
            }

            let limit = storage::get_price_movement_limit(&env);
            if limit > 0 && old_assets > 0 {
                let delta = net.checked_mul(10_000).ok_or(VaultError::MathOverflow)?;
                let maximum = old_assets.checked_mul(limit as i128).ok_or(VaultError::MathOverflow)?;
                if delta > maximum { return Err(VaultError::CircuitBreakerTripped); }
            }
            set_total_deposited(&env, new_assets);
            storage::set_total_fee_collected(&env, new_fees);
            set_last_harvest_time(&env, env.ledger().timestamp());
            keeper::record_harvest(&env, &caller, gross)?;
            env.events().publish(
                (Symbol::new(&env, "strategy_harvest"), caller),
                (gross, net, fee_amount, new_assets),
            );
            bump_instance(&env);
            Ok(gross)
        })
    }

    // -----------------------------------------------------------------------
    // harvest_token — multi-yield-token entry point (Issue #48)
    // -----------------------------------------------------------------------
    /// Inject yield denominated in an alternative (non-underlying) token.
    ///
    /// Allows keepers to harvest rewards paid in a different token (e.g. a
    /// protocol incentive token). The caller supplies the alt-token yield, and
    /// separately provides `underlying_amount` — the equivalent underlying
    /// value after an off-chain or on-chain swap — which is credited to
    /// `total_deposited` net of the performance fee.
    ///
    /// The `alt_token` must be pre-approved by the admin via
    /// [`register_yield_token`].
    ///
    /// Emits a `harvest_token` event with topics
    /// `(event_name, caller, alt_token)` and data
    /// `(yield_amount, net_underlying, fee_amount)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address supplying alt-token yield; must authorise this call.
    /// - `alt_token` — Contract address of the alternative yield token. Must be
    ///   on the admin whitelist.
    /// - `yield_amount` — Amount of `alt_token` tokens transferred from `caller`.
    ///   Must be > 0.
    /// - `underlying_amount` — Equivalent underlying token value being credited
    ///   to the vault (after swap/conversion). Must be > 0.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — either amount is ≤ 0.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::ZeroShares`] — vault has no outstanding shares.
    /// - [`VaultError::InvalidAddress`] — `alt_token` is not whitelisted.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped on underlying.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    ///
    /// [`register_yield_token`]: AuraVault::register_yield_token
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
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != caller
                && !storage::has_role(&env, &caller, storage::KEEPER_ROLE)
                && !storage::has_role(&env, &caller, storage::ADMIN_ROLE)
            {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if storage_is_paused(&env) {
                return Err(VaultError::VaultPaused);
            }

            let total_shares = get_total_shares(&env);
            if total_shares == 0 {
                return Err(VaultError::ZeroShares);
            }

            // Verify the alt_token is whitelisted
            if !storage::is_yield_token(&env, &alt_token) {
                return Err(VaultError::InvalidAddress);
            }

            let total_deposited = get_total_deposited(&env);

            // Flash-loan guard on underlying token
            let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let underlying = token::Client::new(&env, &underlying_addr);
            let balance_before = underlying.balance(&env.current_contract_address());
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (
                        Symbol::new(&env, "balance_mismatch"),
                        balance_before,
                        total_deposited,
                    ),
                );
                return Err(VaultError::BalanceMismatch);
            }

            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps).unwrap_or(0);
            let net_underlying = underlying_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;

            // Oracle sanity guard: validate the caller-supplied underlying_amount
            // against the oracle price constraints (zero, sanity-cap, staleness).
            validate_oracle_price(
                &env,
                underlying_amount,
                env.ledger().timestamp(),
                ORACLE_DEFAULT_MAX_AGE_SECS,
            )?;

            let new_total = total_deposited
                .checked_add(net_underlying)
                .ok_or(VaultError::MathOverflow)?;

            // Interaction: pull alt-token yield from caller
            let alt_token_client = token::Client::new(&env, &alt_token);
            let vault_addr = env.current_contract_address();
            let pre_alt_balance = alt_token_client.balance(&vault_addr);
            alt_token_client.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(
                &alt_token_client,
                &vault_addr,
                pre_alt_balance,
                yield_amount,
            )?;

            // Effects: credit net underlying value
            set_total_deposited(&env, new_total);
            storage::schedule_yield_vesting(&env, net_underlying)?;
            let prev_fees = storage::get_total_fee_collected(&env);
            storage::set_total_fee_collected(
                &env,
                prev_fees
                    .checked_add(fee_amount)
                    .ok_or(VaultError::MathOverflow)?,
            );
            record_harvest_epoch(&env, net_underlying, env.ledger().timestamp())?;

            env.events().publish(
                (Symbol::new(&env, "harvest_token"), caller, alt_token),
                (yield_amount, net_underlying, fee_amount),
            );

            bump_instance(&env);

            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // register_yield_token — admin-only: whitelist an alt yield token
    // -----------------------------------------------------------------------
    /// Whitelist an alternative yield token for use with [`harvest_token`].
    ///
    /// Admin-only. Emits a `yield_token_registered` event.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `alt_token` — Token contract address to add to the whitelist.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`harvest_token`]: AuraVault::harvest_token
    pub fn register_yield_token(env: Env, alt_token: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            storage::set_yield_token(&env, &alt_token, true);
            bump_instance(&env);
            env.events()
                .publish((Symbol::new(&env, "yield_token_registered"),), (alt_token,));
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // distribute_yield — permissionless keeper entry point
    // -----------------------------------------------------------------------
    pub fn distribute_yield(
        env: Env,
        caller: Address,
        yield_amount: i128,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            caller.require_auth();

            if yield_amount <= 0 {
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

            // --- Flash-loan guard on underlying token ---
            let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let token = token::Client::new(&env, &token_addr);
            assert_managed_balance(&env, &token)?;
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (
                        Symbol::new(&env, "balance_mismatch"),
                        balance_before,
                        total_deposited,
                    ),
                );
                return Err(VaultError::BalanceMismatch);
            }

            // --- Performance fee ---
            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
            let net_yield = yield_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;

            // --- Accuracy guard: net_yield must produce a non-zero delta_yps ---
            let scaled = net_yield
                .checked_mul(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let delta_yps = scaled
                .checked_div(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            if delta_yps == 0 {
                return Err(VaultError::YieldTooSmall);
            }

            // --- Accuracy check: distributed tokens ≈ net_yield within 0.01% ---
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

            // --- CEI: Interaction first — pull tokens ---
            let vault_addr = env.current_contract_address();
            let pre_dist_balance = token.balance(&vault_addr);
            token.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(&token, &vault_addr, pre_dist_balance, yield_amount)?;

            // --- Effects: update global state ---
            let prev_yps = storage::get_cumulative_yps(&env);
            let new_yps = prev_yps
                .checked_add(delta_yps)
                .ok_or(VaultError::MathOverflow)?;
            storage::set_cumulative_yps(&env, new_yps);

            // Credit net yield to total_deposited so share price and withdraw math stay consistent.
            let new_total = total_deposited
                .checked_add(net_yield)
                .ok_or(VaultError::MathOverflow)?;
            set_total_deposited(&env, new_total);

            // Accumulate fees
            let prev_fees = storage::get_total_fee_collected(&env);
            storage::set_total_fee_collected(
                &env,
                prev_fees
                    .checked_add(fee_amount)
                    .ok_or(VaultError::MathOverflow)?,
            );

            // Bump distribution epoch
            let epoch = storage::get_distribution_epoch(&env);
            let new_epoch = epoch + 1;
            storage::set_distribution_epoch(&env, new_epoch);

            // --- Events ---
            env.events().publish(
                (Symbol::new(&env, "yield_distributed"), caller.clone()),
                (
                    yield_amount,
                    net_yield,
                    fee_amount,
                    total_shares,
                    new_yps,
                    new_epoch,
                ),
            );

            bump_instance(&env);
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // distribute_yield_token — distribute a whitelisted alt yield token
    // -----------------------------------------------------------------------
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

            // Flash-loan guard on underlying token
            let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
            let underlying = token::Client::new(&env, &underlying_addr);
            assert_managed_balance(&env, &underlying)?;
            let total_deposited = get_total_deposited(&env);
            if balance_before != total_deposited {
                env.events().publish(
                    (Symbol::new(&env, "suspicious"),),
                    (
                        Symbol::new(&env, "balance_mismatch"),
                        balance_before,
                        total_deposited,
                    ),
                );
                return Err(VaultError::BalanceMismatch);
            }

            // Performance fee on underlying value
            let perf_fee_bps = storage::get_perf_fee_bps(&env);
            let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps)?;
            let net_underlying = underlying_amount
                .checked_sub(fee_amount)
                .ok_or(VaultError::MathOverflow)?;

            // Oracle sanity guard
            validate_oracle_price(
                &env,
                underlying_amount,
                env.ledger().timestamp(),
                ORACLE_DEFAULT_MAX_AGE_SECS,
            )?;

            // Accuracy guard
            let scaled = net_underlying
                .checked_mul(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;
            let delta_yps = scaled
                .checked_div(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            if delta_yps == 0 {
                return Err(VaultError::YieldTooSmall);
            }

            // Accuracy check
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

            // Interaction: pull alt-token yield from caller
            let alt_token_client = token::Client::new(&env, &alt_token);
            let vault_addr = env.current_contract_address();
            let pre_alt_balance = alt_token_client.balance(&vault_addr);
            alt_token_client.transfer(&caller, &vault_addr, &yield_amount);
            assert_incoming_transfer(
                &alt_token_client,
                &vault_addr,
                pre_alt_balance,
                yield_amount,
            )?;

            // Effects
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
                prev_fees
                    .checked_add(fee_amount)
                    .ok_or(VaultError::MathOverflow)?,
            );

            let epoch = storage::get_distribution_epoch(&env);
            let new_epoch = epoch + 1;
            storage::set_distribution_epoch(&env, new_epoch);

            env.events().publish(
                (
                    Symbol::new(&env, "yield_distributed_token"),
                    caller,
                    alt_token,
                ),
                (
                    yield_amount,
                    net_underlying,
                    fee_amount,
                    total_shares,
                    new_yps,
                    new_epoch,
                ),
            );

            bump_instance(&env);
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // collect_yield — keeper / strategy pulls yield into the vault
    // -----------------------------------------------------------------------
    pub fn collect_yield(env: Env, caller: Address, amount: i128) -> Result<(), VaultError> {
        Self::distribute_yield(env, caller, amount)
    }

    // -----------------------------------------------------------------------
    // preview_distribution — read-only accuracy check
    // -----------------------------------------------------------------------
    pub fn preview_distribution(
        env: Env,
        yield_amount: i128,
    ) -> Result<(i128, i128, i128, bool), VaultError> {
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
            // Not enough yield to produce any delta — would revert on-chain.
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

    // -----------------------------------------------------------------------
    // collect_pending_yield — shareholder claims their accrued yield
    // -----------------------------------------------------------------------
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

            // Accrue: new yield since last checkpoint
            let delta_yps = global_yps
                .checked_sub(user_checkpoint)
                .ok_or(VaultError::MathOverflow)?;
            let accrued = user_shares
                .checked_mul(delta_yps)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(YIELD_PRECISION)
                .ok_or(VaultError::MathOverflow)?;

            // Add any previously stored (unsettled) pending yield
            let stored_pending = storage::get_user_pending_yield(&env, &caller);
            let total_claimable = stored_pending
                .checked_add(accrued)
                .ok_or(VaultError::MathOverflow)?;

            if total_claimable <= 0 {
                // Nothing to collect; update checkpoint and return 0.
                storage::set_user_checkpoint(&env, &caller, global_yps);
                storage::set_user_pending_yield(&env, &caller, 0);
                bump_user_yield(&env, &caller);
                bump_persistent(&env, &caller);
                return Ok(0);
            }

            // CEI — Effects: clear pending state before interaction
            storage::set_user_checkpoint(&env, &caller, global_yps);
            storage::set_user_pending_yield(&env, &caller, 0);

            // Interaction: transfer claimable yield to caller
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

    // -----------------------------------------------------------------------
    // pending_yield — read-only: how much yield `addr` can currently claim
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // distribution_epoch — read-only: current distribution epoch counter
    // -----------------------------------------------------------------------
    pub fn distribution_epoch(env: Env) -> u64 {
        storage::get_distribution_epoch(&env)
    }

    /// Return the start timestamp of the current harvest epoch.
    pub fn epoch_start_timestamp(env: Env) -> u64 {
        storage::get_epoch_start(&env)
    }

    /// Return the last recorded deposit timestamp for an address.
    pub fn deposit_timestamp(env: Env, addr: Address) -> u64 {
        storage::get_deposit_timestamp(&env, &addr)
    }

    /// Return the harvest epoch in which an address most recently deposited.
    pub fn deposit_epoch(env: Env, addr: Address) -> u64 {
        storage::get_deposit_epoch(&env, &addr)
    }

    // -----------------------------------------------------------------------
    // pause / unpause — admin-only emergency controls
    // Takes admin address so the client can require_auth on it.
    // -----------------------------------------------------------------------
    /// Halt all mutating vault operations (deposit, withdraw, harvest).
    ///
    /// Admin-only emergency control. Once paused, any call to `deposit`,
    /// `withdraw`, `harvest`, or `harvest_token` returns
    /// [`VaultError::VaultPaused`] until [`unpause`] is called.
    ///
    /// Emits a `paused` event. Safe to call when already paused (idempotent).
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — `admin` does not match stored admin.
    ///
    /// [`unpause`]: AuraVault::unpause
    pub fn pause(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            // Issue #357: pause requires GUARDIAN or ADMIN role
            if !has_role(&env, &admin, ROLE_GUARDIAN) && !has_role(&env, &admin, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }
            set_paused(&env, true);
            env.events().publish((Symbol::new(&env, "paused"),), ());
            bump_instance(&env);
            Ok(())
        })
    }

    /// Resume vault operations after a [`pause`].
    ///
    /// Requires GUARDIAN or ADMIN role. Emits an `unpaused` event.
    /// Safe to call when already unpaused (idempotent).
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must hold GUARDIAN or ADMIN role and authorise this call.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::Unauthorized`] — caller does not hold GUARDIAN or ADMIN role.
    ///
    /// [`pause`]: AuraVault::pause
    pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            get_admin(&env).ok_or(VaultError::NotInitialized)?;
            admin.require_auth();
            // Issue #357: unpause requires GUARDIAN or ADMIN role
            if !has_role(&env, &admin, ROLE_GUARDIAN) && !has_role(&env, &admin, ROLE_ADMIN) {
                return Err(VaultError::Unauthorized);
            }
            set_paused(&env, false);
            env.events().publish((Symbol::new(&env, "unpaused"),), ());
            bump_instance(&env);
            Ok(())
        })
    }

    /// Returns `true` if the vault is currently paused, `false` otherwise.
    ///
    /// Read-only view; no authorisation required.
    pub fn is_paused(env: Env) -> bool {
        storage_is_paused(&env)
    }

    /// Return the pending admin address, if one exists.
    pub fn pending_admin(env: Env) -> Option<Address> {
        let pending = storage::get_pending_admin(&env)?;
        if env.ledger().timestamp() > storage::get_pending_admin_expiry(&env) {
            None
        } else {
            Some(pending)
        }
    }

    /// Propose a new admin address. The current admin must authorize the call.
    pub fn propose_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), VaultError> {
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
            env.events().publish(
                (Symbol::new(&env, "admin_proposed"),),
                (current_admin, new_admin, expires_at),
            );
            bump_instance(&env);
            Ok(())
        })
    }

    /// Accept the pending admin transfer. The pending admin must authorize the call.
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
            env.events().publish(
                (Symbol::new(&env, "admin_transferred"),),
                (new_admin,),
            );
            bump_instance(&env);
            Ok(())
        })
    }

    /// Cancel a pending admin transfer. The current admin must authorize the call.
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
            env.events()
                .publish((Symbol::new(&env, "AdminCancelled"), current_admin), ());
            bump_instance(&env);
            Ok(())
        })
    }

    /// Cancel a pending admin transfer using the explicit transfer API name.
    pub fn cancel_admin_transfer(env: Env, current_admin: Address) -> Result<(), VaultError> {
        Self::cancel_admin(env, current_admin)
    }

    /// Return the pending admin address, if one exists and has not expired.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        Self::pending_admin(env)
    }

    /// Return the role bitmask for an address.
    pub fn get_roles(env: Env, addr: Address) -> u32 {
        storage::get_role_mask(&env, &addr)
    }

    /// Return `true` if the address holds all bits in `role_mask`.
    pub fn has_role_query(env: Env, addr: Address, role_mask: u32) -> bool {
        storage::has_role(&env, &addr, role_mask)
    }

    /// Grant a role to an address. Admin-only.
    pub fn grant_role(
        env: Env,
        admin: Address,
        role: u32,
        addr: Address,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            let mut mask = storage::get_role_mask(&env, &addr);
            mask |= role;
            storage::set_role_mask(&env, &addr, mask);
            env.events()
                .publish((Symbol::new(&env, "RoleGranted"), admin), (role, addr));
            bump_instance(&env);
            Ok(())
        })
    }

    /// Revoke a role from an address. Admin-only.
    pub fn revoke_role(
        env: Env,
        admin: Address,
        role: u32,
        addr: Address,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            let mut mask = storage::get_role_mask(&env, &addr);
            mask &= !role;
            storage::set_role_mask(&env, &addr, mask);
            env.events()
                .publish((Symbol::new(&env, "RoleRevoked"), admin), (role, addr));
            bump_instance(&env);
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // Fee administration — admin-only
    // -----------------------------------------------------------------------

    /// Configure or clear the optional DEX router used for swap deposits.
    /// The router is trusted to execute swaps and must deliver output directly
    /// to this vault; every swap is still checked against the observed token
    /// balance delta and the caller's minimum share amount.
    pub fn set_dex_router(env: Env, admin: Address, router: Option<Address>) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            storage::set_dex_router(&env, router.as_ref());
            env.events().publish((Symbol::new(&env, "dex_router_updated"), admin), router);
            bump_instance(&env);
            Ok(())
        })
    }

    /// Set performance and management fee rates.
    ///
    /// Admin-only. Fees are expressed in basis points where `10_000 bps = 100%`.
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

    /// Set the treasury address where accumulated fees are sent.
    ///
    /// Admin-only. The treasury address must be configured before
    /// [`withdraw_fees`] can succeed.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    /// - `treasury` — Destination address for fee withdrawals.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`withdraw_fees`]: AuraVault::withdraw_fees
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

    /// Transfer all accumulated performance fees to the treasury.
    ///
    /// Admin-only. Resets the internal fee counter to zero after transferring.
    /// Emits a `fees_withdrawn` event with topics `(event_name, admin)` and
    /// data `(fees, treasury)`. Returns `0` if no fees have accumulated.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Returns
    ///
    /// The amount of underlying tokens transferred to the treasury.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault or treasury not initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
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

            // Adjust total_deposited: fees were already excluded from it during harvest,
            // so we just transfer from vault balance.
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

    /// Returns the total accumulated but not-yet-withdrawn performance fees,
    /// in underlying token units.
    ///
    /// Read-only view; no authorisation required.
    pub fn total_fees_collected(env: Env) -> i128 {
        storage::get_total_fee_collected(&env)
    }

    /// Configure the trusted price oracle used by guarded swap deposits.
    pub fn set_oracle_address(env: Env, admin: Address, oracle: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            if get_admin(&env).ok_or(VaultError::NotInitialized)? != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            storage::set_oracle_address(&env, &oracle);
            bump_instance(&env);
            Ok(())
        })
    }

    /// Set the maximum accepted age of oracle prices, between one second and one day.
    pub fn set_oracle_max_age(env: Env, admin: Address, max_age_secs: u64) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            if get_admin(&env).ok_or(VaultError::NotInitialized)? != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if max_age_secs == 0 || max_age_secs > 86_400 {
                return Err(VaultError::InvalidAddress);
            }
            admin.require_auth();
            storage::set_oracle_max_age(&env, max_age_secs);
            bump_instance(&env);
            Ok(())
        })
    }

    /// Return the configured price oracle address, if one has been set.
    pub fn get_oracle_address(env: Env) -> Option<Address> {
        storage::get_oracle_address(&env)
    }

    /// Configure the swap router, maximum slippage, TWAP lookback, and spot deviation.
    pub fn set_swap_config(
        env: Env,
        admin: Address,
        router: Address,
        max_slippage_bps: u32,
        twap_window_secs: u64,
        max_deviation_bps: u32,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            if get_admin(&env).ok_or(VaultError::NotInitialized)? != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            if max_slippage_bps > 2_000
                || !(60..=86_400).contains(&twap_window_secs)
                || max_deviation_bps == 0
                || max_deviation_bps > 500
            {
                return Err(VaultError::InvalidAddress);
            }
            admin.require_auth();
            storage::set_swap_router(&env, &router);
            storage::set_max_swap_slippage_bps(&env, max_slippage_bps);
            storage::set_twap_window_secs(&env, twap_window_secs);
            storage::set_max_oracle_deviation_bps(&env, max_deviation_bps);
            bump_instance(&env);
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // TVL cap — admin-only (Issue #467)
    // -----------------------------------------------------------------------

    /// Set or update the TVL cap. `cap = 0` disables the cap (unlimited deposits).
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

    /// Read the current TVL cap (0 = unlimited).
    pub fn get_tvl_cap(env: Env) -> i128 {
        storage::get_tvl_cap(&env)
    }

    // -----------------------------------------------------------------------
    // Harvest cooldown — admin-only (Issue #471)
    // -----------------------------------------------------------------------

    /// Configure the minimum seconds between harvests. `secs = 0` disables cooldown.
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

    /// Admin override: reset the last-harvest timestamp, bypassing the cooldown.
    /// Useful for emergency re-harvest after a failed yield event.
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

    /// Read the timestamp of the last successful harvest.
    pub fn last_harvest_time(env: Env) -> u64 {
        get_last_harvest_time(&env)
    }

    // -----------------------------------------------------------------------
    // Circuit breaker — share-price movement limit (Issue #371)
    // -----------------------------------------------------------------------

    /// Set the maximum allowed share-price movement per harvest, in basis points.
    ///
    /// Admin-only.  When the price change in a single harvest exceeds this
    /// threshold the vault is automatically paused and a `suspicious` event is
    /// emitted.  The admin must manually call [`unpause`] after reviewing.
    ///
    /// # Basis-point reference
    ///
    /// | `bps` | Meaning |
    /// |---|---|
    /// | `0` | Disabled — no movement check |
    /// | `500` | 5 % movement triggers the circuit breaker |
    /// | `2000` | 20 % movement triggers the circuit breaker |
    ///
    /// The check is symmetric: abnormally large *and* abnormally small price
    /// changes both trip the breaker.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`unpause`]: AuraVault::unpause
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

    /// Read the current share-price movement limit in basis points.
    ///
    /// Returns `0` when the circuit breaker is disabled.
    /// Read-only; no authorization required.
    pub fn get_price_movement_limit(env: Env) -> u32 {
        storage::get_price_movement_limit(&env)
    }

    // -----------------------------------------------------------------------
    // total_assets  (read-only)
    // -----------------------------------------------------------------------
    /// Returns the total underlying tokens currently tracked by the vault.
    ///
    /// Equals the sum of all deposited amounts plus harvested yield (after
    /// fees) minus all withdrawn amounts. Returned in the underlying token's
    /// smallest unit.
    ///
    /// Read-only view; no authorisation required. Gas-efficient: reads a
    /// single instance-storage entry.
    pub fn total_assets(env: Env) -> i128 {
        get_total_deposited(&env).saturating_sub(storage::unvested_yield(&env))
    }

    /// Set the linear yield vesting period in ledgers. Zero is rejected; the
    /// default is seven days (120,960 ledgers).
    pub fn set_yield_vesting_period(
        env: Env,
        admin: Address,
        ledgers: u32,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            if ledgers == 0 {
                return Err(VaultError::ZeroAmount);
            }
            let pending = storage::unvested_yield(&env);
            storage::set_yield_vesting_pending(&env, pending);
            storage::set_yield_vesting_start(&env, env.ledger().sequence());
            storage::set_yield_vesting_period(&env, ledgers);
            bump_instance(&env);
            Ok(())
        })
    }

    /// Returns the configured linear yield vesting period in ledgers.
    pub fn get_yield_vesting_period(env: Env) -> u32 {
        storage::get_yield_vesting_period(&env)
    }

    // -----------------------------------------------------------------------
    // total_shares  (read-only)
    // -----------------------------------------------------------------------
    pub fn total_shares(env: Env) -> i128 {
        get_total_shares(&env)
    }

    // -----------------------------------------------------------------------
    // EIP-4626-style accounting views
    // -----------------------------------------------------------------------

    /// Shares minted for `assets`, rounded down like `deposit`.
    pub fn preview_deposit(env: Env, assets: i128) -> Result<i128, VaultError> {
        if assets < 0 {
            return Err(VaultError::ZeroAmount);
        }
        let assets_total = get_total_deposited(&env);
        let shares_total = get_total_shares(&env);
        if assets_total == 0 || shares_total == 0 {
            return Ok(assets);
        }
        share_math::shares_for_assets(assets, shares_total, assets_total)
            .ok_or(VaultError::MathOverflow)
    }

    /// Assets redeemed for `shares`, rounded down like `withdraw`.
    pub fn preview_withdraw(env: Env, shares: i128) -> Result<i128, VaultError> {
        if shares < 0 {
            return Err(VaultError::ZeroAmount);
        }
        let assets_total = get_total_deposited(&env);
        let shares_total = get_total_shares(&env);
        if shares_total == 0 {
            return Ok(0);
        }
        share_math::assets_for_shares(shares, assets_total, shares_total)
            .ok_or(VaultError::MathOverflow)
    }

    pub fn convert_to_shares(env: Env, assets: i128) -> Result<i128, VaultError> {
        Self::preview_deposit(env, assets)
    }

    pub fn convert_to_assets(env: Env, shares: i128) -> Result<i128, VaultError> {
        Self::preview_withdraw(env, shares)
    }

    /// Maximum amount the caller can deposit without the deposit call failing.
    /// A zero TVL cap means unlimited capacity.
    pub fn max_deposit(env: Env, caller: Address) -> i128 {
        if get_admin(&env).is_none() || storage_is_paused(&env) {
            return 0;
        }
        if get_whitelist_enabled(&env) && !storage::is_whitelisted(&env, &caller) {
            return 0;
        }

        // `deposit` uses checked addition even when no TVL cap is configured.
        let current = get_total_deposited(&env);
        let arithmetic_limit = i128::MAX.saturating_sub(current).max(0);
        let cap = get_tvl_cap(&env);
        let available = if cap > 0 {
            arithmetic_limit.min(cap.saturating_sub(current).max(0))
        } else {
            arithmetic_limit
        };
        let min_deposit = get_min_deposit(&env);
        if available == 0 || (min_deposit > 0 && available < min_deposit) {
            0
        } else {
            available
        }
    }

    /// Maximum underlying asset value represented by the caller's shares.
    pub fn max_withdraw(env: Env, caller: Address) -> Result<i128, VaultError> {
        if get_admin(&env).is_none() || storage_is_paused(&env) {
            return Ok(0);
        }
        let user_shares = get_balance(&env, &caller);
        let shares_total = get_total_shares(&env);
        if shares_total == 0 {
            return Ok(0);
        }
        share_math::assets_for_shares(user_shares, get_total_deposited(&env), shares_total)
            .ok_or(VaultError::MathOverflow)
    }

    // -----------------------------------------------------------------------
    // balance_of  (read-only)
    // -----------------------------------------------------------------------
    /// Returns the vault share balance for the given address.
    ///
    /// Returns `0` for addresses that have never deposited or have fully
    /// redeemed their shares.
    ///
    /// Read-only view; no authorisation required. Gas-efficient: reads a
    /// single persistent-storage entry.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `address` — The Stellar account address to query.
    pub fn balance_of(env: Env, address: Address) -> i128 {
        get_balance(&env, &address)
    }

    /// Transfer vault shares without changing the vault's underlying accounting.
    pub fn transfer(env: Env, from: Address, to: Address, shares: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            from.require_auth();
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            transfer_shares(&env, &from, &to, shares)
        })
    }

    /// Approve `spender` to transfer up to `shares` until `expiration_ledger`.
    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        shares: i128,
        expiration_ledger: u32,
    ) -> Result<(), VaultError> {
        from.require_auth();
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if shares < 0 || expiration_ledger < env.ledger().sequence() {
            return Err(VaultError::InvalidAddress);
        }
        storage::set_share_allowance(&env, &from, &spender, shares, expiration_ledger);
        env.events().publish(
            (Symbol::new(&env, "approve"), from, spender),
            (shares, expiration_ledger),
        );
        Ok(())
    }

    /// Return the currently usable share allowance, or zero after expiry.
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        storage::get_share_allowance(&env, &from, &spender)
    }

    /// Transfer shares using an owner's unexpired allowance.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        shares: i128,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            spender.require_auth();
            if get_admin(&env).is_none() {
                return Err(VaultError::NotInitialized);
            }
            if shares <= 0 {
                return Err(VaultError::ZeroAmount);
            }
            let (available, expires_at) = storage::get_share_allowance_details(&env, &from, &spender)
                .ok_or(VaultError::InsufficientShares)?;
            if available < shares {
                return Err(VaultError::InsufficientShares);
            }
            let remaining = available.checked_sub(shares).ok_or(VaultError::MathOverflow)?;
            storage::set_share_allowance(&env, &from, &spender, remaining, expires_at);
            transfer_shares(&env, &from, &to, shares)
        })
    }

    // -----------------------------------------------------------------------
    // check_invariants — on-chain view health-check (Issue #931)
    // -----------------------------------------------------------------------
    /// Validate all critical AuraVault invariants and return a structured result.
    ///
    /// This is a **view-only** function; it reads state but never writes to it.
    /// Intended to be called automatically in the CI upgrade test suite and by
    /// monitoring infrastructure after every upgrade to verify contract health.
    ///
    /// # Invariants checked (in order)
    ///
    /// 1. **Solvency** — `total_shares > 0` implies `total_assets > 0`.
    ///    An outstanding share supply with no backing assets is a critical
    ///    accounting error.
    ///
    /// 2. **Balance sample** — `admin_balance_of <= total_shares`, where
    ///    `admin_balance_of` is the admin address's current share balance.
    ///    This is a representative sample check that no single address can
    ///    hold more shares than the global total.
    ///
    /// 3. **Initialization consistency** — the vault is either fully
    ///    initialised (admin AND underlying token both set) or completely
    ///    uninitialised (neither set).  A partial state (one set, other not)
    ///    is a storage corruption indicator.
    ///
    /// 4. **Admin presence** — the admin address is set.  An uninitialised
    ///    vault has no admin, which is fine before `initialize`; but after the
    ///    vault is live this invariant must hold.
    ///
    /// 5. **Fee sanity** — `perf_fee_bps <= 10_000` (≤ 100 %).  A fee above
    ///    10 000 bps is impossible to apply correctly and indicates storage
    ///    corruption or an erroneous admin action.
    ///
    /// # Returns
    ///
    /// - [`InvariantCheckResult::AllPassed`] — all invariants pass.
    /// - [`InvariantCheckResult::Failing`] — the first failing invariant with
    ///   a descriptive message.
    ///
    /// # Notes
    ///
    /// - No authorisation is required (read-only view).
    /// - Never reverts: all paths return a result value, even for an
    ///   uninitialised vault.
    pub fn check_invariants(env: Env) -> InvariantCheckResult {
        let total_shares  = get_total_shares(&env);
        let total_assets  = get_total_deposited(&env);
        let admin_opt     = get_admin(&env);
        let token_opt     = get_token(&env);
        let perf_fee_bps  = storage::get_perf_fee_bps(&env);

        // ------------------------------------------------------------------
        // Invariant 1: total_shares > 0 implies total_assets > 0
        //
        // If there are outstanding shares but the vault tracks zero assets,
        // shareholders would redeem nothing — this is a critical solvency
        // invariant.
        // ------------------------------------------------------------------
        if total_shares > 0 && total_assets <= 0 {
            return InvariantCheckResult::Failing(
                soroban_sdk::String::from_str(
                    &env,
                    "INV1: total_shares > 0 but total_assets == 0 (solvency invariant violated)",
                )
            );
        }

        // ------------------------------------------------------------------
        // Invariant 2: sample balance check — admin share balance <= total_shares
        //
        // We cannot iterate all addresses on-chain; we instead sample the
        // admin address as a representative.  If the admin balance is stored,
        // it must not exceed the total.
        // ------------------------------------------------------------------
        if let Some(ref admin) = admin_opt {
            let admin_balance = get_balance(&env, admin);
            if admin_balance > total_shares {
                return InvariantCheckResult::Failing(
                    soroban_sdk::String::from_str(
                        &env,
                        "INV2: admin balance_of > total_shares (balance sample invariant violated)",
                    )
                );
            }
        }

        // ------------------------------------------------------------------
        // Invariant 3: initialization consistency
        //
        // Both admin and token must be set together, or neither.  A partial
        // state indicates storage corruption or a failed initialisation.
        // ------------------------------------------------------------------
        let has_admin = admin_opt.is_some();
        let has_token = token_opt.is_some();
        if has_admin != has_token {
            return InvariantCheckResult::Failing(
                soroban_sdk::String::from_str(
                    &env,
                    "INV3: vault is in partial init state (admin XOR token is set)",
                )
            );
        }

        // ------------------------------------------------------------------
        // Invariant 4: admin address is present
        //
        // Once the vault is live (both admin and token set), the admin must
        // always be present to allow governance, pause, and upgrades.
        // We only check this when the vault is fully initialised.
        // ------------------------------------------------------------------
        if has_token && admin_opt.is_none() {
            return InvariantCheckResult::Failing(
                soroban_sdk::String::from_str(
                    &env,
                    "INV4: vault token is set but admin address is missing",
                )
            );
        }

        // ------------------------------------------------------------------
        // Invariant 5: perf_fee_bps <= 10_000 (cannot exceed 100%)
        //
        // Any value above 10 000 basis points is mathematically invalid —
        // it would claim more than 100 % of yield.  The maximum configured
        // in fee.rs is MAX_PERF_FEE_BPS = 2 000 (20 %); values above that
        // are also suspicious but we apply the absolute mathematical limit
        // here since that is what the issue spec requires.
        // ------------------------------------------------------------------
        if perf_fee_bps > 10_000 {
            return InvariantCheckResult::Failing(
                soroban_sdk::String::from_str(
                    &env,
                    "INV5: perf_fee_bps > 10000 (fee exceeds 100%, fee sanity invariant violated)",
                )
            );
        }

        // All invariants passed.
        InvariantCheckResult::AllPassed
    }

    // -----------------------------------------------------------------------
    // get_nonce  (read-only)
    // -----------------------------------------------------------------------
    /// Returns the current deposit nonce for `address`.
    ///
    /// The caller must pass this value as the `nonce` parameter of the next
    /// `deposit` call to prove freshness.  The nonce starts at `0` for every
    /// new address and is incremented atomically on each successful deposit.
    ///
    /// Read-only view; no authorisation required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `address` — The Stellar account address to query.
    pub fn get_nonce(env: Env, address: Address) -> u64 {
        storage::get_nonce(&env, &address)
    }

    // -----------------------------------------------------------------------
    // Upgrade
    // -----------------------------------------------------------------------
    /// Upgrade the contract's Wasm binary to a new version.
    ///
    /// Admin-only. Validates that the current on-chain storage layout version
    /// matches [`CURRENT_LAYOUT_VERSION`] before applying the upgrade (guards
    /// against deploying a Wasm that expects a different storage schema).
    /// Increments the contract version counter, replaces the Wasm, and emits
    /// an `upgrade` event with topics `(event_name, admin)` and data
    /// `(old_version, new_version)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `new_wasm_hash` — 32-byte SHA-256 hash of the replacement Wasm binary,
    ///   previously uploaded via `stellar contract upload`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — admin `require_auth` failed.
    /// - [`VaultError::StorageLayoutMismatch`] — on-chain layout version ≠
    ///   `CURRENT_LAYOUT_VERSION`.
    ///
    /// [`CURRENT_LAYOUT_VERSION`]: crate::storage::CURRENT_LAYOUT_VERSION
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

    // -----------------------------------------------------------------------
    // Governance Methods
    // -----------------------------------------------------------------------

    /// Create a governance proposal to replace the admin address.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Returns
    ///
    /// A unique proposal ID for use with [`vote`] and [`execute`].
    ///
    /// [`vote`]: AuraVault::vote
    /// [`execute`]: AuraVault::execute
    pub fn propose_update_admin(
        env: Env,
        proposer: Address,
        new_admin: Address,
    ) -> Result<u64, VaultError> {
        with_reentrancy_guard(&env, || {
            create_proposal(&env, proposer, ProposalType::UpdateAdminAddress(new_admin))
        })
    }

    /// Create a governance proposal to replace the underlying token address.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
    pub fn propose_update_token(
        env: Env,
        proposer: Address,
        new_token: Address,
    ) -> Result<u64, VaultError> {
        with_reentrancy_guard(&env, || {
            create_proposal(&env, proposer, ProposalType::UpdateUnderlyingTokenAddress(new_token))
        })
    }

    /// Create a governance proposal to update a named protocol parameter.
    ///
    /// `proposer` must be in the governance signer whitelist.
    ///
    /// # Parameters
    ///
    /// - `name` — Symbolic parameter name (e.g. `Symbol::new(&env, "perf_fee_bps")`).
    /// - `value` — Proposed new `i128` value.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
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

    /// Propose an active strategy change through the multi-signer governance flow.
    pub fn propose_strategy_update(
        env: Env,
        proposer: Address,
        strategy_address: Address,
    ) -> Result<u64, VaultError> {
        with_reentrancy_guard(&env, || {
            propose_operation(&env, proposer, OpType::SetStrategy(strategy_address))
        })
    }

    /// Vote to approve or reject an open governance proposal.
    ///
    /// `voter` must be in the governance signer whitelist and must not have
    /// already voted on this proposal.
    ///
    /// # Parameters
    ///
    /// - `voter` — Authorised signer; must authorise this call.
    /// - `proposal_id` — ID returned by a `propose_*` function.
    /// - `approve` — `true` to vote in favour; `false` to vote against.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || vote_on_proposal(&env, voter, proposal_id, approve))
    }

    /// Execute an approved governance proposal after its timelock has elapsed.
    ///
    /// The proposal must be in `Approved` status. On success the status moves
    /// to `Executed` and the proposed change takes effect.
    ///
    /// # Parameters
    ///
    /// - `executor` — Any whitelisted signer may execute an approved proposal.
    /// - `proposal_id` — ID of the proposal to execute.
    pub fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let proposal_type = execute_proposal(&env, executor, proposal_id)?;
            if let ProposalType::UpdateParameter(name, value) = proposal_type {
                if name == Symbol::new(&env, "set_allowlist_enabled") {
                    let enabled = match value {
                        0 => false,
                        1 => true,
                        _ => return Err(VaultError::InvalidAddress),
                    };
                    set_allowlist_enabled(&env, enabled);
                }
            }
            bump_instance(&env);
            Ok(())
        })
    }

    /// Cancel a pending proposal before it executes. Only its proposer may cancel it.
    pub fn cancel_proposal(
        env: Env,
        proposer: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            cancel_multisig_op(&env, proposer, proposal_id)?;
            bump_instance(&env);
            Ok(())
        })
    }

    /// Returns the status of a governance proposal as a human-readable string,
    /// or `None` if the proposal ID does not exist.
    ///
    /// Possible values: `"Pending"`, `"Approved"`, `"Executed"`, `"Rejected"`.
    ///
    /// Read-only view; no authorisation required.
    pub fn proposal_status(env: Env, proposal_id: u64) -> Option<soroban_sdk::String> {
        get_proposal_status(&env, proposal_id).map(|status| match status {
            ProposalStatus::Pending => soroban_sdk::String::from_str(&env, "Pending"),
            ProposalStatus::Ready => soroban_sdk::String::from_str(&env, "Approved"),
            ProposalStatus::Executed => soroban_sdk::String::from_str(&env, "Executed"),
            ProposalStatus::Expired => soroban_sdk::String::from_str(&env, "Rejected"),
        })
    }

    /// Return all governance proposals that have not expired.
    ///
    /// This read-only view is intended for governance dashboards. Each item
    /// includes its action parameters, signer count, threshold, execution
    /// status, and the earliest execution timestamp when available.
    pub fn get_proposals(env: Env) -> soroban_sdk::Vec<ProposalView> {
        get_proposal_views(&env)
    }

    /// Return one governance proposal, or `None` when the ID is unknown.
    pub fn get_proposal(env: Env, id: u64) -> Option<ProposalView> {
        get_proposal_view(&env, id)
    }

    // -----------------------------------------------------------------------
    // get_vault_error_message — ABI-exposed error string lookup (Issue #370)
    // -----------------------------------------------------------------------

    /// Return the human-readable English message for a given [`VaultError`]
    /// discriminant, or `None` if the code is not a known variant.
    ///
    /// Included in the contract ABI so that wallet and explorer UIs can query
    /// error descriptions directly without bundling a separate message table.
    /// The returned string is identical to [`VaultError::message`] for the
    /// corresponding variant.
    ///
    /// Read-only view; no authorisation required.
    ///
    /// # Parameters
    ///
    /// - `code` — Numeric discriminant of a [`VaultError`] variant.
    ///
    /// # Returns
    ///
    /// `Some(message)` for a recognised code, `None` otherwise.
    pub fn get_vault_error_message(env: Env, code: u32) -> Option<soroban_sdk::String> {
        let msg: Option<&'static str> = match code {
            1 => Some(VaultError::NotInitialized.message()),
            2 => Some(VaultError::AlreadyInitialized.message()),
            3 => Some(VaultError::InsufficientShares.message()),
            4 => Some(VaultError::InsufficientUnderlying.message()),
            5 => Some(VaultError::ZeroAmount.message()),
            6 => Some(VaultError::MathOverflow.message()),
            7 => Some(VaultError::InvalidAddress.message()),
            8 => Some(VaultError::ZeroShares.message()),
            9 => Some(VaultError::UpgradeUnauthorized.message()),
            10 => Some(VaultError::StorageLayoutMismatch.message()),
            11 => Some(VaultError::VaultPaused.message()),
            12 => Some(VaultError::BalanceMismatch.message()),
            13 => Some(VaultError::TimelockNotExpired.message()),
            14 => Some(VaultError::NotApproved.message()),
            15 => Some(VaultError::AlreadyVoted.message()),
            16 => Some(VaultError::TvlCapExceeded.message()),
            17 => Some(VaultError::YieldTooSmall.message()),
            18 => Some(VaultError::DistributionAccuracyError.message()),
            19 => Some(VaultError::InvalidNonce.message()),
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
            31 => Some(VaultError::NoPendingAdmin.message()),
            32 => Some(VaultError::PendingAdminExpired.message()),
            33 => Some(VaultError::Unauthorized.message()),
            34 => Some(VaultError::CircuitBreakerTripped.message()),
            35 => Some(VaultError::NotASigner.message()),
            36 => Some(VaultError::OperationNotFound.message()),
            37 => Some(VaultError::OperationAlreadyExecuted.message()),
            38 => Some(VaultError::OperationExpired.message()),
            39 => Some(VaultError::OperationAlreadySigned.message()),
            40 => Some(VaultError::ThresholdNotMet.message()),
            41 => Some(VaultError::InvalidThreshold.message()),
            42 => Some(VaultError::DexSlippageExceeded.message()),
            43 => Some(VaultError::DexNotConfigured.message()),
            _  => None,
        };
        msg.map(|s| soroban_sdk::String::from_str(&env, s))
    }

    // -----------------------------------------------------------------------
    // Whitelist-only deposit mode (Issue #349)
    // -----------------------------------------------------------------------

    /// Admin: enable whitelist-only deposit mode.
    pub fn enable_whitelist(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelist_enabled(&env, true);
            bump_instance(&env);
            env.events()
                .publish((Symbol::new(&env, "whitelist_enabled"), admin), ());
            Ok(())
        })
    }

    /// Admin: disable whitelist-only deposit mode.
    pub fn disable_whitelist(env: Env, admin: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelist_enabled(&env, false);
            bump_instance(&env);
            env.events()
                .publish((Symbol::new(&env, "whitelist_disabled"), admin), ());
            Ok(())
        })
    }

    /// Admin: add an address to the whitelist.
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
            env.events()
                .publish((Symbol::new(&env, "whitelist_added"), admin, addr), ());
            Ok(())
        })
    }

    /// Admin: remove an address from the whitelist.
    pub fn remove_from_whitelist(
        env: Env,
        admin: Address,
        addr: Address,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_whitelisted(&env, &addr, false);
            bump_instance(&env);
            env.events()
                .publish((Symbol::new(&env, "whitelist_removed"), admin, addr), ());
            Ok(())
        })
    }

    /// Query whether an address is whitelisted. Read-only, no auth required.
    pub fn is_whitelisted(env: Env, addr: Address) -> bool {
        storage::is_whitelisted(&env, &addr)
    }

    // -----------------------------------------------------------------------
    // Governance-controlled KYC deposit allowlist (Issue #916)
    // -----------------------------------------------------------------------

    /// Add a depositor to the KYC allowlist. Admin-only; the mode itself is
    /// enabled or disabled exclusively through a multisig governance proposal.
    pub fn add_to_allowlist(env: Env, admin: Address, address: Address) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            if !storage_is_allowlisted(&env, &address) {
                set_allowlisted(&env, &address, true);
                env.events().publish(
                    (Symbol::new(&env, "allowlist_address_added"), address),
                    (),
                );
            }
            bump_instance(&env);
            Ok(())
        })
    }

    /// Remove a depositor from the KYC allowlist. Admin-only.
    pub fn remove_from_allowlist(
        env: Env,
        admin: Address,
        address: Address,
    ) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            if storage_is_allowlisted(&env, &address) {
                set_allowlisted(&env, &address, false);
                env.events().publish(
                    (Symbol::new(&env, "allowlist_address_removed"), address),
                    (),
                );
            }
            bump_instance(&env);
            Ok(())
        })
    }

    /// Read-only KYC allowlist membership query.
    pub fn is_allowlisted(env: Env, address: Address) -> bool {
        storage_is_allowlisted(&env, &address)
    }

    /// Read-only view of the governance-controlled KYC allowlist mode.
    pub fn allowlist_enabled(env: Env) -> bool {
        storage_is_allowlist_enabled(&env)
    }

    // -----------------------------------------------------------------------
    // Minimum deposit amount (Issue #355)
    // -----------------------------------------------------------------------

    /// Admin: set the minimum deposit amount.
    pub fn set_min_deposit(env: Env, admin: Address, amount: i128) -> Result<(), VaultError> {
        with_reentrancy_guard(&env, || {
            let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
            if stored_admin != admin {
                return Err(VaultError::UpgradeUnauthorized);
            }
            admin.require_auth();
            set_min_deposit(&env, amount);
            bump_instance(&env);
            env.events()
                .publish((Symbol::new(&env, "min_deposit_set"), admin), (amount,));
            Ok(())
        })
    }

    /// Query the minimum deposit amount. Read-only, no auth required.
    pub fn min_deposit(env: Env) -> i128 {
        get_min_deposit(&env)
    }

    // -----------------------------------------------------------------------
    // Referral tracking
    // -----------------------------------------------------------------------

    /// Return the number of deposits attributed to `referrer`.
    ///
    /// Incremented each time a depositor passes `Some(referrer)` to
    /// [`deposit`]. Intended for off-chain reward calculation; no on-chain
    /// bonus is distributed by this contract.
    ///
    /// Read-only; no authorization required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `referrer` — The address whose referral count to query.
    pub fn get_referral_count(env: Env, referrer: Address) -> u32 {
        storage::get_referral_count(&env, &referrer)
    }

    // -----------------------------------------------------------------------
    // Contract metadata (Issue #350)
    // -----------------------------------------------------------------------

    /// Returns the vault name. Read-only, no auth required.
    pub fn name(env: Env) -> soroban_sdk::String {
        get_vault_name(&env)
            .unwrap_or_else(|| soroban_sdk::String::from_str(&env, "Aura Vault Share"))
    }

    /// Returns the vault share symbol. Read-only, no auth required.
    pub fn symbol(env: Env) -> soroban_sdk::String {
        get_vault_symbol(&env)
            .unwrap_or_else(|| soroban_sdk::String::from_str(&env, "AVS"))
    }

    /// Returns the contract version integer. Read-only, no auth required.
    pub fn version(env: Env) -> u32 {
        get_vault_version(&env)
    }

    /// Return the layout version stored by the deployed instance.
    pub fn storage_layout_version(env: Env) -> u32 {
        get_layout_version(&env)
    }

    /// Validate that the deployed instance matches this Wasm's expected layout.
    pub fn validate_storage_layout_version(env: Env) -> Result<(), VaultError> {
        if get_layout_version(&env) == CURRENT_LAYOUT_VERSION {
            Ok(())
        } else {
            Err(VaultError::StorageLayoutMismatch)
        }
    }

    /// Returns the number of decimal places used by vault shares (e.g. 7 for Stellar standard).
    /// Set during `initialize` and immutable thereafter.
    /// Read-only, no auth required.
    pub fn decimals(env: Env) -> u32 {
        get_decimals(&env)
    }

    // -----------------------------------------------------------------------
    // TVL cap governance — admin-only setter, public getter
    // -----------------------------------------------------------------------

    /// Set the soft and hard TVL caps.  Pass `None` to disable a cap.
    ///
    /// - `soft`: when `total_assets + deposit > soft` a `tvl_soft_cap_warning`
    ///   event is emitted but the deposit proceeds.
    /// - `hard`: when `total_assets + deposit > hard` the deposit reverts with
    ///   `TvlCapExceeded`.
    ///
    /// When both caps are set the soft cap must be ≤ the hard cap.
    /// Only the admin may call this.
    pub fn set_tvl_caps(
        env: Env,
        soft: Option<i128>,
        hard: Option<i128>,
    ) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        // Validate: individual caps must be positive when provided.
        if let Some(s) = soft {
            if s <= 0 {
                return Err(VaultError::ZeroAmount);
            }
        }
        if let Some(h) = hard {
            if h <= 0 {
                return Err(VaultError::ZeroAmount);
            }
        }
        // Soft cap must not exceed hard cap when both are present.
        if let (Some(s), Some(h)) = (soft, hard) {
            if s > h {
                return Err(VaultError::MathOverflow);
            }
        }

        set_soft_tvl_cap(&env, soft);
        set_hard_tvl_cap(&env, hard);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "tvl_caps_set"),),
            (soft, hard),
        );

        Ok(())
    }

    /// Return the current `(soft_cap, hard_cap)` pair.  `None` means the cap
    /// is not set for that tier.
    pub fn get_tvl_caps(env: Env) -> (Option<i128>, Option<i128>) {
        (get_soft_tvl_cap(&env), get_hard_tvl_cap(&env))
    }
}

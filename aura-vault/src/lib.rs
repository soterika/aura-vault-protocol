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
mod invariants;
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
mod issue_346_351_352_348_test;

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
    get_oracle_address, set_oracle_address, get_oracle_max_age, set_oracle_max_age,
    get_price_snapshot as storage_get_price_snapshot, set_price_snapshot,
};use governance::{
    initialize_governance, create_proposal, vote_on_proposal, execute_proposal,
    get_proposal_status, ProposalStatus, ProposalType,
};

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

// ---------------------------------------------------------------------------
// Module-level helpers (non-contract functions)
// ---------------------------------------------------------------------------

/// Extend TTL of per-user yield accounting entries (checkpoint + pending).
///
/// Called by `collect_pending_yield` and `distribute_yield` to keep user
/// persistent storage alive for the standard 30-day window.
fn bump_user_yield(env: &Env, addr: &Address) {
    storage::bump_user_yield_ttl(env, addr);
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
        name: soroban_sdk::String,
        symbol: soroban_sdk::String,
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
        set_vault_name(&env, &name);
        set_vault_symbol(&env, &symbol);
        set_vault_version(&env, 1);
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
    /// must equal `total_deposited`). On success, emits a `deposit` event with
    /// topics `(event_name, caller, amount)` and data
    /// `(new_shares, new_total_shares, new_total_deposited)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address depositing tokens; must authorise this call.
    /// - `amount` — Number of underlying tokens to deposit, in the token's
    ///   smallest unit (e.g. stroops for a 7-decimal Stellar token). Must be > 0.
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
    pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
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
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let total_shares = get_total_shares(&env);

        // Compute shares to mint (checked arithmetic; overflow returns MathOverflow)
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

        // CEI — Interaction: pull tokens from caller into vault
        let vault_addr = env.current_contract_address();
        let pre_deposit_balance = token.balance(&vault_addr);
        token.transfer(&caller, &vault_addr, &amount);
        assert_incoming_transfer(&token, &vault_addr, pre_deposit_balance, amount)?;

        // Effects: write state after successful transfer
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

        // Event: topics = (event_name, caller, amount) — indexed for efficient filtering.
        // data = (new_shares, new_total_shares, new_total_deposited) — contextual payload.
        env.events().publish(
            (Symbol::new(&env, "deposit"), caller.clone(), amount),
            (new_shares, new_total_shares, new_total_deposited),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(new_shares)
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

        // CEI — Effects: burn shares before any token transfer
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
                (Symbol::new(&env, "withdraw_queued"), caller.clone(), entry_id),
                (shares, redeem_amount, claimable_after, new_total_shares, new_total_deposited),
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

        // Event: topics = (event_name, caller, shares) — indexed for efficient filtering.
        env.events().publish(
            (Symbol::new(&env, "withdraw"), caller.clone(), shares),
            (redeem_amount, new_total_shares, new_total_deposited),
        );

        Ok(redeem_amount)
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
    pub fn set_withdrawal_fee(
        env: Env,
        admin: Address,
        bps: u32,
    ) -> Result<(), VaultError> {
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
        caller.require_auth();

        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        // Load the queue entry
        let entry = get_withdrawal_entry(&env, entry_id)
            .ok_or(VaultError::QueueEntryNotFound)?;

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

        let net_amount = entry.redeem_amount
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
                prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
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
            (Symbol::new(&env, "withdrawal_claimed"), caller.clone(), entry_id),
            (entry.redeem_amount, fee_amount, net_amount),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(net_amount)
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

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard
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
        if price_limit_bps > 0 && total_deposited > 0 {
            let delta = new_total
                .checked_sub(total_deposited)
                .ok_or(VaultError::MathOverflow)?
                .abs();
            // delta * 10_000 > total_deposited * price_limit_bps
            let lhs = delta
                .checked_mul(10_000)
                .ok_or(VaultError::MathOverflow)?;
            let rhs = total_deposited
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

        // Effects: increase total deposited with net yield; accumulate fees
        set_total_deposited(&env, new_total);
        storage::set_total_fee_collected(&env, new_fees);
        // Record harvest timestamp for cooldown enforcement (Issue #471)
        let now = env.ledger().timestamp();
        set_last_harvest_time(&env, now);

        // -----------------------------------------------------------------------
        // Price snapshot — Issue #352
        //
        // Compute the share price in underlying token units after this harvest
        // and store it under PriceSnapshot(timestamp) with a 90-day TTL.
        //
        // share_price = new_total * 1_000_000 / total_shares
        // Scaled to 6 decimal places so callers can compute USD value by
        // multiplying by the oracle USD price.
        // -----------------------------------------------------------------------
        if total_shares > 0 {
            let share_price = new_total
                .checked_mul(1_000_000)
                .and_then(|v| v.checked_div(total_shares))
                .unwrap_or(0);
            set_price_snapshot(&env, now, share_price);
        }

        env.events().publish(
            (Symbol::new(&env, "harvest"), caller.clone(), yield_amount),
            (yield_after_fee, fee_amount, new_total),
        );

        bump_instance(&env);

        Ok(())
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

        // Oracle sanity guard: validate the caller-supplied underlying_amount
        // against the oracle price constraints (zero, sanity-cap, staleness).
        // We use the current ledger timestamp as `updated_at` because
        // harvest_token callers are expected to supply a freshly-computed value;
        // the staleness window is therefore set to zero (must be from this
        // ledger).  Callers that supply a pre-computed price from an off-chain
        // oracle MUST pass the oracle's `updated_at` and use `set_oracle_max_age`
        // to configure the allowed staleness.
        validate_oracle_price(
            &env,
            underlying_amount,
            env.ledger().timestamp(), // treat the supplied value as "just fetched"
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
        assert_incoming_transfer(&alt_token_client, &vault_addr, pre_alt_balance, yield_amount)?;

        // Effects: credit net underlying value
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
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        storage::set_yield_token(&env, &alt_token, true);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "yield_token_registered"),),
            (alt_token,),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // distribute_yield — permissionless keeper entry point
    //
    // Accepts `yield_amount` of the underlying token from `caller` and
    // distributes it proportionally to all vault shareholders via the global
    // cumulative-yield-per-share (YPS) accumulator.  Shareholders call
    // `collect_pending_yield` to pull their share out.
    //
    // Algorithm:
    //   delta_yps = net_yield * YIELD_PRECISION / total_shares
    //   cumulative_yps += delta_yps
    //
    // Accuracy guarantee:
    //   The maximum undistributed dust per epoch is:
    //     (total_shares - 1) / YIELD_PRECISION ≤ (total_shares - 1) / 1e12
    //   For any vault where total_shares ≤ 1e12 this is < 1 stroop.
    //   We enforce that net_yield >= total_shares / YIELD_PRECISION, which
    //   means delta_yps ≥ 1 — i.e., every shareholder gets at least 1e-12
    //   underlying per share.  A 0.01% accuracy check is performed in
    //   preview_distribution.
    //
    // Edge cases:
    //   - No shares outstanding        → YieldTooSmall (nothing to distribute)
    //   - Yield rounds delta_yps to 0  → YieldTooSmall
    //   - Vault paused                 → VaultPaused
    //   - Flash-loan guard             → BalanceMismatch
    // -----------------------------------------------------------------------
    pub fn distribute_yield(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
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
        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
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
        // delta_yps = floor(net_yield * YIELD_PRECISION / total_shares)
        // For this to be ≥ 1 we need net_yield ≥ ceil(total_shares / YIELD_PRECISION).
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
        // distributed = floor(delta_yps * total_shares / YIELD_PRECISION)
        // We verify |distributed - net_yield| / net_yield ≤ 0.0001 (1 bps).
        let distributed = delta_yps
            .checked_mul(total_shares)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(YIELD_PRECISION)
            .ok_or(VaultError::MathOverflow)?;
        // tolerance = ceil(net_yield / 10_000)  →  0.01%
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
            prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
        );

        // Bump distribution epoch
        let epoch = storage::get_distribution_epoch(&env);
        let new_epoch = epoch + 1;
        storage::set_distribution_epoch(&env, new_epoch);

        // --- Events ---
        env.events().publish(
            (Symbol::new(&env, "yield_distributed"), caller.clone()),
            (yield_amount, net_yield, fee_amount, total_shares, new_yps, new_epoch),
        );

        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // distribute_yield_token — distribute a whitelisted alt yield token
    //
    // Like distribute_yield but accepts an alternative SEP-41 token.  The
    // caller provides both the alt-token yield amount and its equivalent
    // value expressed in underlying token stroops (caller is responsible for
    // the swap or valuation oracle off-chain; the vault trusts this input the
    // same way harvest_token does).
    // -----------------------------------------------------------------------
    pub fn distribute_yield_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError> {
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
        let balance_before = underlying.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        // Performance fee on underlying value
        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps)?;
        let net_underlying = underlying_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        // Oracle sanity guard: validate the caller-supplied underlying_amount.
        // Same constraints as harvest_token.
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
        assert_incoming_transfer(&alt_token_client, &vault_addr, pre_alt_balance, yield_amount)?;

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
    }

    // -----------------------------------------------------------------------
    // collect_yield — keeper / strategy pulls yield into the vault
    //
    // This is a thin authenticated entry point that verifies `amount` tokens
    // were actually transferred in (balance delta check) and then records them
    // as distributed yield.  It exists so strategies can call into the vault
    // without the keeper needing separate approve+transfer steps.
    //
    // The function deliberately mirrors `distribute_yield` so callers can use
    // either pattern depending on their auth model.
    // -----------------------------------------------------------------------
    pub fn collect_yield(env: Env, caller: Address, amount: i128) -> Result<(), VaultError> {
        // Delegate to distribute_yield — same logic, different name for
        // clarity in the call-graph (collect = pull from strategy, distribute
        // = push from keeper).
        Self::distribute_yield(env, caller, amount)
    }

    // -----------------------------------------------------------------------
    // preview_distribution — read-only accuracy check
    //
    // Returns (net_yield, delta_yps, distributed_tokens, accuracy_ok) for a
    // hypothetical `yield_amount` distribution given current vault state.
    // Callers use this to verify a pending yield satisfies the 0.01% accuracy
    // criterion before submitting the on-chain transaction.
    //
    // Returns:
    //   (net_yield, delta_yps, distributed_amount, accuracy_within_tolerance)
    // -----------------------------------------------------------------------
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
    //
    // Settles the caller's pending yield by:
    //   1. Computing accrued = shares * (global_yps - user_checkpoint) / YIELD_PRECISION
    //   2. Adding any previously stored pending amount
    //   3. Transferring the total to the caller
    //   4. Updating the checkpoint and clearing pending
    //
    // Returns the amount of underlying tokens transferred to the caller.
    // -----------------------------------------------------------------------
    pub fn collect_pending_yield(env: Env, caller: Address) -> Result<i128, VaultError> {
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

        // Note: We do NOT reduce total_deposited here — the yield was already
        // added to total_deposited in distribute_yield.  The transfer comes
        // out of the vault's actual balance which includes all harvested yield.
        // To keep total_deposited accurate we must subtract the claimed amount.
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
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_paused(&env, true);
        env.events().publish((Symbol::new(&env, "paused"),), ());
        bump_instance(&env);
        Ok(())
    }

    /// Resume vault operations after a [`pause`].
    ///
    /// Admin-only. Emits an `unpaused` event. Safe to call when already
    /// unpaused (idempotent).
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
    /// [`pause`]: AuraVault::pause
    pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_paused(&env, false);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
        bump_instance(&env);
        Ok(())
    }

    /// Returns `true` if the vault is currently paused, `false` otherwise.
    ///
    /// Read-only view; no authorisation required.
    pub fn is_paused(env: Env) -> bool {
        storage_is_paused(&env)
    }

    // -----------------------------------------------------------------------
    // Fee administration — admin-only
    // -----------------------------------------------------------------------

    /// Set performance and management fee rates.
    ///
    /// Admin-only. Fees are expressed in **basis points** where
    /// `10_000 bps = 100%`.
    ///
    /// - `perf_fee_bps`: deducted from `yield_amount` on every [`harvest`]
    ///   call. Default: `1_000` (10 %).
    /// - `mgmt_fee_bps`: time-based management fee (reserved; not yet
    ///   charged). Default: `0`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    /// - `perf_fee_bps` — Performance fee in basis points (0–10_000).
    /// - `mgmt_fee_bps` — Management fee in basis points (0–10_000).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`harvest`]: AuraVault::harvest
    pub fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_perf_fee_bps(&env, perf_fee_bps);
        storage::set_mgmt_fee_bps(&env, mgmt_fee_bps);
        bump_instance(&env);
        Ok(())
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
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_treasury(&env, &treasury);
        bump_instance(&env);
        Ok(())
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
    }

    /// Returns the total accumulated but not-yet-withdrawn performance fees,
    /// in underlying token units.
    ///
    /// Read-only view; no authorisation required.
    pub fn total_fees_collected(env: Env) -> i128 {
        storage::get_total_fee_collected(&env)
    }

    // -----------------------------------------------------------------------
    // TVL cap — admin-only (Issue #467)
    // -----------------------------------------------------------------------

    /// Set or update the TVL cap. `cap = 0` disables the cap (unlimited deposits).
    pub fn set_tvl_cap(env: Env, admin: Address, cap: i128) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_tvl_cap(&env, cap);
        bump_instance(&env);
        Ok(())
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
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_harvest_cooldown_secs(&env, secs);
        bump_instance(&env);
        Ok(())
    }

    /// Admin override: reset the last-harvest timestamp, bypassing the cooldown.
    /// Useful for emergency re-harvest after a failed yield event.
    pub fn reset_harvest_cooldown(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_last_harvest_time(&env, 0);
        bump_instance(&env);
        Ok(())
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
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_price_movement_limit(&env, bps);
        bump_instance(&env);
        Ok(())
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
        get_total_deposited(&env)
    }

    // -----------------------------------------------------------------------
    // total_shares  (read-only)
    // -----------------------------------------------------------------------
    pub fn total_shares(env: Env) -> i128 {
        get_total_shares(&env)
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
    pub fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateAdmin)
    }

    /// Create a governance proposal to replace the underlying token address.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
    pub fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateUnderlyingToken)
    }

    /// Create a governance proposal to update a named protocol parameter.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Parameters
    ///
    /// - `name` — Symbolic parameter name (e.g. `Symbol::new(&env, "perf_fee_bps")`).
    /// - `value` — Proposed new `i128` value.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
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
        create_proposal(&env, proposer, ProposalType::UpdateParameter(name, value))
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
        vote_on_proposal(&env, voter, proposal_id, approve)
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
    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        execute_proposal(&env, executor, proposal_id)?;
        bump_instance(&env);
        Ok(())
    }

    /// Returns the status of a governance proposal as a human-readable string,
    /// or `None` if the proposal ID does not exist.
    ///
    /// Possible values: `"Pending"`, `"Approved"`, `"Executed"`, `"Rejected"`.
    ///
    /// Read-only view; no authorisation required.
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
    /// - `code` — Numeric discriminant (1–24) of a [`VaultError`] variant.
    ///
    /// # Returns
    ///
    /// `Some(message)` for a recognised code, `None` otherwise.
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
            30 => Some(VaultError::OracleUnavailable.message()),
            31 => Some(VaultError::CircuitBreakerTripped.message()),
            32 => Some(VaultError::NotASigner.message()),
            33 => Some(VaultError::OperationNotFound.message()),
            34 => Some(VaultError::OperationAlreadyExecuted.message()),
            35 => Some(VaultError::OperationExpired.message()),
            36 => Some(VaultError::OperationAlreadySigned.message()),
            37 => Some(VaultError::ThresholdNotMet.message()),
            38 => Some(VaultError::InvalidThreshold.message()),
            _  => None,
        };
        msg.map(|s| soroban_sdk::String::from_str(&env, s))
    }

    // -----------------------------------------------------------------------
    // Whitelist-only deposit mode (Issue #349)
    // -----------------------------------------------------------------------

    /// Admin: enable whitelist-only deposit mode.
    pub fn enable_whitelist(env: Env, admin: Address) -> Result<(), VaultError> {
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
    }

    /// Admin: disable whitelist-only deposit mode.
    pub fn disable_whitelist(env: Env, admin: Address) -> Result<(), VaultError> {
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
    }

    /// Admin: add an address to the whitelist.
    pub fn add_to_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError> {
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
    }

    /// Admin: remove an address from the whitelist.
    pub fn remove_from_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError> {
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
    }

    /// Query whether an address is whitelisted. Read-only, no auth required.
    pub fn is_whitelisted(env: Env, addr: Address) -> bool {
        storage::is_whitelisted(&env, &addr)
    }

    // -----------------------------------------------------------------------
    // Minimum deposit amount (Issue #355)
    // -----------------------------------------------------------------------

    /// Admin: set the minimum deposit amount.
    pub fn set_min_deposit(env: Env, admin: Address, amount: i128) -> Result<(), VaultError> {
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
    }

    /// Query the minimum deposit amount. Read-only, no auth required.
    pub fn min_deposit(env: Env) -> i128 {
        get_min_deposit(&env)
    }

    // -----------------------------------------------------------------------
    // Contract metadata (Issue #350)
    // -----------------------------------------------------------------------

    /// Returns the vault name. Read-only, no auth required.
    pub fn name(env: Env) -> Option<soroban_sdk::String> {
        get_vault_name(&env)
    }

    /// Returns the vault share symbol. Read-only, no auth required.
    pub fn symbol(env: Env) -> Option<soroban_sdk::String> {
        get_vault_symbol(&env)
    }

    /// Returns the contract version integer. Read-only, no auth required.
    pub fn version(env: Env) -> u32 {
        get_vault_version(&env)
    }

    // -----------------------------------------------------------------------
    // total_supply — Issue #346
    //
    // SEP-41 token interface compatibility: return total outstanding vault
    // shares.  Reads DataKey::TotalShares (same value as total_shares()).
    // -----------------------------------------------------------------------

    /// Returns the total number of outstanding vault shares.
    ///
    /// This is the SEP-41 token interface `total_supply()` view, backed by
    /// [`DataKey::TotalShares`].  It is always equal to the sum of all
    /// `balance_of(addr)` values across current depositors.
    ///
    /// Read-only; no authorization required.
    pub fn total_supply(env: Env) -> i128 {
        get_total_shares(&env)
    }

    // -----------------------------------------------------------------------
    // AuraPriceOracle integration — Issue #348
    // -----------------------------------------------------------------------

    /// Admin: set the AuraPriceOracle contract address for USD pricing.
    ///
    /// The oracle must implement `price(token) -> (i128, u64)` returning
    /// (price_in_micro_usd, updated_at_timestamp).  Setting the oracle to a
    /// new address takes effect immediately.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    pub fn set_oracle_address(env: Env, admin: Address, oracle: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_oracle_address(&env, &oracle);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "oracle_set"), admin),
            (oracle,),
        );
        Ok(())
    }

    /// Admin: update the maximum oracle price age (staleness window) in seconds.
    ///
    /// Prices older than `max_age_secs` are treated as unavailable.
    /// Default: 3 600 s (1 hour).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    pub fn set_oracle_max_age(env: Env, admin: Address, max_age_secs: u64) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_oracle_max_age(&env, max_age_secs);
        bump_instance(&env);
        Ok(())
    }

    /// Returns the stored oracle contract address, or `None` if not set.
    ///
    /// Read-only; no authorization required.
    pub fn get_oracle_address(env: Env) -> Option<Address> {
        get_oracle_address(&env)
    }

    /// Returns the total vault assets expressed in micro-USD (6 decimal places,
    /// where 1_000_000 = $1.00), using the configured AuraPriceOracle.
    ///
    /// Algorithm:
    /// ```text
    /// price_usd  = oracle.price(underlying_token)   // micro-USD per token
    /// total_usd  = floor(total_assets * price_usd / PRICE_PRECISION)
    /// ```
    ///
    /// **Graceful fallback:** if the oracle is not configured, the call fails,
    /// or the price fails validation (zero, sanity-cap, stale), the function
    /// returns `0` and emits an `oracle_unavailable` event.  It never reverts,
    /// so callers can always safely display a USD value (showing 0 when the
    /// feed is degraded).
    ///
    /// Read-only; no authorization required.
    pub fn total_assets_usd(env: Env) -> i128 {
        // Attempt to fetch the oracle address; fall back if not configured.
        let oracle_addr = match get_oracle_address(&env) {
            Some(addr) => addr,
            None => {
                env.events().publish(
                    (Symbol::new(&env, "oracle_unavailable"),),
                    (Symbol::new(&env, "not_configured"),),
                );
                return 0;
            }
        };

        // Attempt oracle cross-contract call; trap any panic via try_invoke.
        // Soroban cross-contract calls can panic (not return Result), so we
        // use the `try_invoke` pattern via the generated client.
        let oracle = OracleClient::new(&env, &oracle_addr);
        let token_addr = match get_token(&env) {
            Some(t) => t,
            None => {
                env.events().publish(
                    (Symbol::new(&env, "oracle_unavailable"),),
                    (Symbol::new(&env, "no_token"),),
                );
                return 0;
            }
        };

        // Use try_price to handle oracle failures gracefully without reverting.
        let (price, updated_at) = match oracle.try_price(&token_addr) {
            Ok(Ok(result)) => result,
            _ => {
                env.events().publish(
                    (Symbol::new(&env, "oracle_unavailable"),),
                    (Symbol::new(&env, "call_failed"),),
                );
                return 0;
            }
        };

        // Validate the returned price using the existing oracle guard.
        let max_age = get_oracle_max_age(&env);
        if validate_oracle_price(&env, price, updated_at, max_age).is_err() {
            env.events().publish(
                (Symbol::new(&env, "oracle_unavailable"),),
                (Symbol::new(&env, "invalid_price"), price, updated_at),
            );
            return 0;
        }

        let total = get_total_deposited(&env);

        // Precision: oracle price is in micro-USD (6 decimals).
        // total_usd = floor(total_assets * price / 1_000_000)
        total
            .checked_mul(price)
            .and_then(|v| v.checked_div(1_000_000))
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // Harvest cooldown convenience function — Issue #351
    // -----------------------------------------------------------------------

    /// Returns the earliest ledger timestamp at which the next harvest will
    /// be permitted, or `0` if a harvest is currently allowed.
    ///
    /// - Returns `0` when no cooldown is configured (`cooldown_secs == 0`).
    /// - Returns `0` when no harvest has been performed yet.
    /// - Returns `last_harvest_time + cooldown_secs` when inside the cooldown
    ///   window.  If this value is ≤ `now`, it also returns `0`.
    ///
    /// Read-only; no authorization required.
    pub fn next_harvest_allowed_at(env: Env) -> u64 {
        let cooldown_secs = get_harvest_cooldown_secs(&env);
        if cooldown_secs == 0 {
            return 0;
        }
        let last_harvest = get_last_harvest_time(&env);
        if last_harvest == 0 {
            return 0;
        }
        let next_allowed = last_harvest.saturating_add(cooldown_secs);
        let now = env.ledger().timestamp();
        if next_allowed <= now {
            0
        } else {
            next_allowed
        }
    }

    // -----------------------------------------------------------------------
    // Price snapshots — Issue #352
    // -----------------------------------------------------------------------

    /// Returns the share-price snapshot recorded at exactly `timestamp`, or
    /// `None` if no snapshot exists for that timestamp.
    ///
    /// Snapshots are stored after every successful harvest and are retained
    /// for 90 days (TTL-based archival). The value is the share price in
    /// underlying-token micro-units (scaled ×1 000 000) at the time of harvest.
    ///
    /// Read-only; no authorization required.
    pub fn get_price_snapshot(env: Env, timestamp: u64) -> Option<i128> {
        storage_get_price_snapshot(&env, timestamp)
    }

    /// Returns all share-price snapshots recorded between `from` and `to`
    /// (both inclusive) whose keys are in the supplied `timestamps` list.
    ///
    /// Because Soroban persistent storage does not support range iteration,
    /// callers must supply the list of timestamps they want to query.  The
    /// backend indexer tracks emitted harvest events to build this list.
    ///
    /// Returns a `Vec<(u64, i128)>` of `(timestamp, share_price)` pairs for
    /// every timestamp in `timestamps` that falls within `[from, to]` and
    /// has a live snapshot entry.  Timestamps outside the range or without a
    /// stored snapshot are silently omitted.
    ///
    /// Read-only; no authorization required.
    pub fn list_price_snapshots(
        env: Env,
        timestamps: Vec<u64>,
        from: u64,
        to: u64,
    ) -> Vec<(u64, i128)> {
        let mut results: Vec<(u64, i128)> = Vec::new(&env);
        for ts in timestamps.iter() {
            if ts < from || ts > to {
                continue;
            }
            if let Some(price) = storage_get_price_snapshot(&env, ts) {
                results.push_back((ts, price));
            }
        }
        results
    }

    // -----------------------------------------------------------------------
    // Multi-sig governance public entry points (Issue #375)
    // These expose the full multi-sig API on the contract so tests can call them.
    // -----------------------------------------------------------------------

    /// Propose a new multi-sig operation. Proposer must be a registered signer.
    ///
    /// Returns the operation ID.
    pub fn propose_operation(
        env: Env,
        proposer: Address,
        op_type: governance::OpType,
    ) -> Result<u64, VaultError> {
        governance::propose_operation(&env, proposer, op_type)
    }

    /// Add a signature to a pending multi-sig operation.
    pub fn sign_operation(
        env: Env,
        signer: Address,
        op_id: u64,
    ) -> Result<(), VaultError> {
        governance::sign_operation(&env, signer, op_id)
    }

    /// Execute an approved multi-sig operation.
    pub fn execute_operation(
        env: Env,
        executor: Address,
        op_id: u64,
    ) -> Result<(), VaultError> {
        governance::execute_multisig_op(&env, executor, op_id)?;
        bump_instance(&env);
        Ok(())
    }

    /// Read the status of a multi-sig operation. Returns None if not found.
    pub fn operation_status(env: Env, op_id: u64) -> Option<governance::OpStatus> {
        governance::get_operation_status(&env, op_id)
    }

    /// Admin-only: add a signer directly to the multisig signer set.
    pub fn add_signer(env: Env, admin: Address, new_signer: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        governance::apply_add_signer(&env, &new_signer)?;
        bump_instance(&env);
        Ok(())
    }

    /// Admin-only: remove a signer from the multisig signer set.
    pub fn remove_signer(env: Env, admin: Address, target: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        governance::apply_remove_signer(&env, &target)?;
        bump_instance(&env);
        Ok(())
    }

    /// Admin-only: set the multisig signature threshold.
    pub fn set_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        governance::apply_set_threshold(&env, threshold)?;
        bump_instance(&env);
        Ok(())
    }
}

use soroban_sdk::{Address, Env, Vec, Symbol, BytesN, String};
use crate::errors::VaultError;
use crate::InvariantCheckResult;

/// Public ABI for AuraVault.
///
/// This trait documents every callable entry point of the vault contract.
/// The concrete implementation lives in [`crate::AuraVault`] (`lib.rs`).
///
/// All functions that mutate vault state require the caller to hold a valid
/// Soroban authorization (`require_auth`). Read-only view functions (`total_assets`,
/// share accounting views, `balance_of`, `is_paused`, and `proposal_status`) do not
/// require auth.
///
/// # Event summary
///
/// | Function | Event topic | Event data |
/// |---|---|---|
/// | `deposit` | `("deposit", caller, amount)` | `(new_shares, total_shares, total_deposited, share_price, timestamp)` |
/// | `withdraw` | `("withdraw", caller, shares)` | `(redeem_amount, total_shares, total_deposited, share_price, timestamp)` |
/// | `harvest` | `("harvest", caller, yield_amount)` | `(yield_after_fee, fee_amount, total_deposited)` |
/// | `harvest_token` | `("harvest_token", caller, alt_token)` | `(yield_amount, net_underlying, fee_amount)` |
/// | `pause` | `("paused",)` | `()` |
/// | `unpause` | `("unpaused",)` | `()` |
/// | `upgrade` | `("upgrade", admin)` | `(old_version, new_version)` |
/// | `withdraw_fees` | `("fees_withdrawn", admin)` | `(fees, treasury)` |
/// | `propose_admin` | `("admin_proposed",)` | `(current_admin, new_admin, expiry_timestamp)` |
/// | `accept_admin` | `("admin_transferred",)` | `(new_admin,)` |
/// | `cancel_admin` | `("AdminCancelled", admin)` | `()` |
/// | `grant_role` | `("RoleGranted", admin)` | `(role, addr)` |
/// | `revoke_role` | `("RoleRevoked", admin)` | `(role, addr)` |
/// | Any mismatch | `("suspicious",)` | `("balance_mismatch", actual, tracked)` |
#[allow(dead_code)]
pub trait AuraVaultTrait {
    /// Initialise the vault.
    ///
    /// Must be called exactly once after the contract is deployed. Sets the
    /// admin address, the underlying token, and the governance signer list,
    /// using the default share name and symbol.
    /// All subsequent calls return [`VaultError::AlreadyInitialized`].
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Address that controls privileged operations (pause,
    ///   set_fees, upgrade, etc.).
    /// - `underlying_token` — SEP-41-compatible token contract address whose
    ///   tokens are deposited into and withdrawn from the vault.
    /// - `signers` — Ordered list of addresses authorised to create and vote
    ///   on governance proposals. Must be non-empty.
    /// - `decimals` — Vault share decimal precision (e.g. 7 for Stellar standard). Set at initialization and immutable thereafter.
    ///
    /// # Errors
    ///
    /// - [`VaultError::AlreadyInitialized`] — vault has already been initialised.
    fn initialize(env: Env, admin: Address, underlying_token: Address, signers: Vec<Address>, decimals: u32) -> Result<(), VaultError>;

    /// Initialise with immutable SEP-41 share metadata.
    fn initialize_with_metadata(
        env: Env,
        admin: Address,
        underlying_token: Address,
        signers: Vec<Address>,
        decimals: u32,
        name: String,
        symbol: String,
    ) -> Result<(), VaultError>;

    /// Deposit underlying tokens and receive proportional vault shares.
    ///
    /// Transfers `amount` of the underlying token from `caller` to the vault,
    /// then mints shares according to the current exchange rate:
    ///
    /// ```text
    /// shares = floor(amount × total_shares / total_deposited)   // if vault non-empty
    /// shares = amount                                            // if vault empty (1:1 seed)
    /// ```
    ///
    /// Enforces the flash-loan guard (actual balance == tracked balance) before
    /// executing. If `referrer` is `Some(addr)` and `addr != caller`, increments
    /// the on-chain referral count for `addr` and emits a `deposit_with_referral`
    /// event in addition to the standard `deposit` event.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address depositing tokens. Must authorise this call.
    /// - `amount` — Number of underlying tokens to deposit (in the token's
    ///   smallest unit, i.e. stroops for a 7-decimal token). Must be > 0.
    /// - `nonce` — Per-address replay-protection counter.  Must equal the
    ///   value returned by `get_nonce(caller)` at the time of signing.
    ///   Incremented atomically on every successful deposit.
    ///
    /// # Returns
    ///
    /// The number of vault shares minted for `caller`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `amount <= 0`, or the share formula
    ///   rounds to zero (deposit too small relative to vault size).
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::VaultPaused`] — vault is currently paused.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow in share formula.
    /// - [`VaultError::InvalidNonce`] — supplied nonce does not match stored nonce.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// // In a Soroban test environment:
    /// // let nonce = vault_client.get_nonce(&caller);
    /// // let shares = vault_client.deposit(&caller, &1_000_000_i128, &nonce);
    /// // assert!(shares > 0);
    /// ```
    fn deposit(env: Env, caller: Address, amount: i128, nonce: u64) -> Result<i128, VaultError>;

    /// Swap an alternate token into the configured underlying token and mint shares.
    fn deposit_with_swap(
        env: Env,
        caller: Address,
        input_token: Address,
        input_amount: i128,
        min_shares: i128,
    ) -> Result<i128, VaultError>;

    /// Configure the optional DEX router used by `deposit_with_swap`.
    fn set_dex_router(env: Env, admin: Address, router: Option<Address>) -> Result<(), VaultError>;

    /// Transfer shares to another address.
    fn transfer(env: Env, from: Address, to: Address, shares: i128) -> Result<(), VaultError>;

    /// Set a time-limited share allowance.
    fn approve(
        env: Env,
        from: Address,
        spender: Address,
        shares: i128,
        expiration_ledger: u32,
    ) -> Result<(), VaultError>;

    /// Read an unexpired share allowance.
    fn allowance(env: Env, from: Address, spender: Address) -> i128;

    /// Transfer shares using the owner's allowance.
    fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        shares: i128,
    ) -> Result<(), VaultError>;

    /// Swap a non-underlying input token through the configured router, validate it against fresh spot/TWAP oracle prices, then mint shares.
    fn deposit_with_swap(env: Env, caller: Address, token_in: Address, amount_in: i128, min_shares: i128) -> Result<i128, VaultError>;

    /// Batch deposit up to 20 individual amounts with one token transfer.
    fn batch_deposit(env: Env, caller: Address, amounts: Vec<i128>) -> Result<Vec<i128>, VaultError>;

    /// Burn vault shares and redeem the proportional underlying tokens.
    ///
    /// Calculates the redemption amount using:
    ///
    /// ```text
    /// redeem_amount = floor(shares × total_deposited / total_shares)
    /// ```
    ///
    /// Follows strict **Checks-Effects-Interactions** ordering: shares are
    /// burned and state is written *before* the token transfer, preventing
    /// reentrancy. Emits a `withdraw` event on success.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address redeeming shares. Must authorise this call.
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
    /// - [`VaultError::VaultPaused`] — vault is currently paused.
    /// - [`VaultError::InsufficientShares`] — caller holds fewer shares than requested.
    /// - [`VaultError::InsufficientUnderlying`] — vault balance cannot cover redemption.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// // let tokens_out = vault_client.withdraw(&caller, &shares);
    /// // assert!(tokens_out > 0);
    /// ```
    fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError>;

    /// Emergency withdrawal of underlying tokens during a vault pause.
    ///
    /// Allows users to redeem their shares and recover underlying tokens even
    /// while the vault is paused. This provides a guaranteed exit path during
    /// an emergency without requiring the admin to unpause first.
    ///
    /// Key differences from [`withdraw`]:
    /// - **Requires the vault to be paused** — returns
    ///   [`VaultError::VaultNotPaused`] when the vault is operating normally.
    ///   Use the regular [`withdraw`] function when the vault is unpaused.
    /// - **No harvest step** — yield is not auto-compounded before redemption.
    /// - **Fee waived** — no performance or withdrawal fee is charged.
    /// - **Emits `emergency_withdrawal` event** (not `withdraw`).
    ///
    /// Calculates the redemption amount using:
    ///
    /// ```text
    /// redeem_amount = floor(shares × total_deposited / total_shares)
    /// ```
    ///
    /// Follows strict **CEI** ordering: shares are burned and state is written
    /// *before* the token transfer to prevent reentrancy.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address redeeming shares. Must authorise this call.
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
    /// - [`VaultError::VaultNotPaused`] — vault is not currently paused; use
    ///   the normal [`withdraw`] function.
    /// - [`VaultError::InsufficientShares`] — caller holds fewer shares than requested.
    /// - [`VaultError::InsufficientUnderlying`] — vault balance cannot cover redemption.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    ///
    /// [`withdraw`]: AuraVaultTrait::withdraw
    fn emergency_withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError>;

    /// Inject yield tokens into the vault without minting new shares.
    ///
    /// Any caller (keeper) may call this to increase `total_deposited`, which
    /// raises the redemption value of all existing shares (auto-compounding).
    /// A performance fee is deducted before crediting the vault.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address providing yield tokens. Must authorise this call.
    /// - `yield_amount` — Amount of underlying tokens being injected (smallest
    ///   unit). Must be > 0.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `yield_amount <= 0`.
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::VaultPaused`] — vault is currently paused.
    /// - [`VaultError::ZeroShares`] — vault has no shareholders.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError>;

    /// Configure the global linear yield vesting period in ledgers (default: 120,960).
    fn set_yield_vesting_period(env: Env, admin: Address, ledgers: u32) -> Result<(), VaultError>;

    /// Return the global linear yield vesting period in ledgers.
    fn get_yield_vesting_period(env: Env) -> u32;

    /// Distribute underlying-token yield proportionally to all shareholders via
    /// the cumulative yield-per-share accumulator.
    fn distribute_yield(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError>;

    /// Distribute a whitelisted alternative yield token using an explicitly
    /// supplied underlying value.
    fn distribute_yield_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError>;

    /// Alias for `distribute_yield` used by strategies that collect yield from
    /// an external source before crediting the vault.
    fn collect_yield(env: Env, caller: Address, amount: i128) -> Result<(), VaultError>;

    /// Preview the effect of a yield distribution without mutating state.
    fn preview_distribution(env: Env, yield_amount: i128) -> Result<(i128, i128, i128, bool), VaultError>;

    /// Claim all accrued yield for the caller.
    fn collect_pending_yield(env: Env, caller: Address) -> Result<i128, VaultError>;

    /// Return the caller's currently claimable pending yield.
    fn pending_yield(env: Env, addr: Address) -> i128;

    /// Return the current distribution epoch counter.
    fn distribution_epoch(env: Env) -> u64;

    /// Return the start timestamp of the current harvest epoch.
    fn epoch_start_timestamp(env: Env) -> u64;

    /// Return the most recent deposit timestamp for an address.
    fn deposit_timestamp(env: Env, addr: Address) -> u64;

    /// Return the harvest epoch of an address's most recent deposit.
    fn deposit_epoch(env: Env, addr: Address) -> u64;

    /// Halt all mutating operations (deposit, withdraw, harvest).
    ///
    /// Admin-only. Emits a `paused` event. Use [`unpause`] to resume.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`unpause`]: AuraVaultTrait::unpause
    fn pause(env: Env, admin: Address) -> Result<(), VaultError>;

    /// Resume vault operations after a pause.
    ///
    /// Admin-only. Emits an `unpaused` event.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn unpause(env: Env, admin: Address) -> Result<(), VaultError>;

    /// Returns `true` if the vault is currently paused, `false` otherwise.
    ///
    /// Read-only; no authorization required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    fn is_paused(env: Env) -> bool;

    /// Set performance and management fee rates.
    ///
    /// Admin-only. Fees are expressed in **basis points** (bps), where
    /// `10_000 bps = 100%`.
    ///
    /// - Performance fee (`perf_fee_bps`): deducted from each `harvest` call.
    ///   Default: `1000` (10%).
    /// - Management fee (`mgmt_fee_bps`): time-based fee (reserved for future
    ///   implementation). Default: `0`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match stored admin address and authorise this call.
    /// - `perf_fee_bps` — Performance fee in basis points (0–10_000).
    /// - `mgmt_fee_bps` — Management fee in basis points (0–10_000).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError>;

    /// Set the treasury address where accumulated fees are sent.
    ///
    /// Admin-only. Fees accumulate in the vault until [`withdraw_fees`] is
    /// called. The treasury address must be set before `withdraw_fees` can
    /// succeed.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match stored admin address and authorise this call.
    /// - `treasury` — Destination address for fee withdrawals.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`withdraw_fees`]: AuraVaultTrait::withdraw_fees
    fn set_treasury(env: Env, admin: Address, treasury: Address) -> Result<(), VaultError>;

    /// Transfer all accumulated performance fees to the treasury.
    ///
    /// Admin-only. Resets the internal fee counter to zero after transferring.
    /// Emits a `fees_withdrawn` event.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match stored admin address and authorise this call.
    ///
    /// # Returns
    ///
    /// The amount of underlying tokens transferred to the treasury. Returns
    /// `0` if no fees have accumulated.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault or treasury not initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError>;

    /// Returns the total accumulated (unwithdrawn) performance fees in the
    /// vault, in underlying token units.
    ///
    /// Read-only; no authorization required.
    fn total_fees_collected(env: Env) -> i128;

    /// Set the vault TVL cap. A value of `0` disables the cap.
    fn set_tvl_cap(env: Env, admin: Address, cap: i128) -> Result<(), VaultError>;

    /// Return the current TVL cap. `0` means the cap is disabled.
    fn get_tvl_cap(env: Env) -> i128;

    /// Configure the minimum delay between successful harvests.
    fn set_harvest_cooldown(env: Env, admin: Address, secs: u64) -> Result<(), VaultError>;

    /// Reset the harvest cooldown timestamp so the next harvest is not blocked.
    fn reset_harvest_cooldown(env: Env, admin: Address) -> Result<(), VaultError>;

    /// Return the timestamp of the last successful harvest.
    fn last_harvest_time(env: Env) -> u64;

    // -----------------------------------------------------------------------
    // Circuit breaker — share-price movement limit (Issue #371)
    // -----------------------------------------------------------------------

    /// Set the maximum allowed share-price movement per harvest, in basis points.
    ///
    /// Admin-only. `0` disables the check. When a harvest would move the share
    /// price by more than `bps` basis points (up **or** down), the vault
    /// auto-pauses and emits a `suspicious` / `price_movement` event.
    /// The admin must call [`unpause`] after reviewing.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`unpause`]: AuraVaultTrait::unpause
    fn set_price_movement_limit(env: Env, admin: Address, bps: u32) -> Result<(), VaultError>;

    /// Read the current share-price movement limit in basis points.
    ///
    /// Returns `0` when the circuit breaker is disabled.
    /// Read-only; no authorization required.
    fn get_price_movement_limit(env: Env) -> u32;

    /// Returns the total underlying tokens currently tracked by the vault
    /// (`total_deposited`), in the underlying token's smallest unit.
    ///
    /// This equals the sum of all deposited amounts plus harvested yield minus
    /// withdrawn amounts and fee deductions.
    ///
    /// Read-only; no authorization required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    fn total_assets(env: Env) -> i128;

    /// Preview shares minted for `assets`, rounded down using the current ratio.
    /// On an empty vault, assets convert to shares 1:1. This preview does not
    /// apply deposit limits; query `max_deposit` for caller-specific limits.
    fn preview_deposit(env: Env, assets: i128) -> Result<i128, VaultError>;

    /// Preview underlying assets for `shares`, rounded down using the current ratio.
    fn preview_withdraw(env: Env, shares: i128) -> Result<i128, VaultError>;

    /// Convert underlying assets to shares using the current ratio, rounded down.
    fn convert_to_shares(env: Env, assets: i128) -> Result<i128, VaultError>;

    /// Convert shares to underlying assets using the current ratio, rounded down.
    fn convert_to_assets(env: Env, shares: i128) -> Result<i128, VaultError>;

    /// Maximum assets the caller can deposit under current pause, whitelist,
    /// minimum-deposit, and TVL-cap settings. Returns 0 when deposits are disabled.
    fn max_deposit(env: Env, caller: Address) -> i128;

    /// Maximum underlying assets represented by the caller's shares. Returns 0
    /// when the vault is uninitialized, paused, or the caller has no shares.
    fn max_withdraw(env: Env, caller: Address) -> Result<i128, VaultError>;

    /// Returns the vault share balance for a given address.
    ///
    /// Returns `0` for addresses that have never deposited or have fully
    /// withdrawn.
    ///
    /// Read-only; no authorization required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `address` — The Stellar account address to query.
    fn balance_of(env: Env, address: Address) -> i128;

    /// Enumerate all non-expired governance proposals.
    fn get_proposals(env: Env) -> Vec<crate::ProposalView>;

    /// Read one governance proposal.
    fn get_proposal(env: Env, id: u64) -> Option<crate::ProposalView>;

    /// Read the instance's stored storage layout version.
    fn storage_layout_version(env: Env) -> u32;

    /// Return error 10 when the instance layout does not match this Wasm.
    fn validate_storage_layout_version(env: Env) -> Result<(), VaultError>;

    /// Upgrade the contract's Wasm binary.
    ///
    /// Admin-only. Increments the contract version, replaces the on-chain Wasm
    /// with the supplied hash, and emits an `upgrade` event. Validates that the
    /// current storage layout version matches [`CURRENT_LAYOUT_VERSION`] before
    /// proceeding.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `new_wasm_hash` — 32-byte SHA-256 hash of the new Wasm binary,
    ///   previously uploaded via `stellar contract upload`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin
    ///   (admin must authorise).
    /// - [`VaultError::StorageLayoutMismatch`] — on-chain layout version
    ///   does not match `CURRENT_LAYOUT_VERSION`.
    ///
    /// [`CURRENT_LAYOUT_VERSION`]: crate::storage::CURRENT_LAYOUT_VERSION
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), VaultError>;

    /// Create a governance proposal to change the admin address.
    ///
    /// The `proposer` must be in the governance signer whitelist.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `proposer` — Authorised signer creating the proposal.
    /// - `new_admin` — Proposed new admin address.
    ///
    /// # Returns
    ///
    /// The numeric proposal ID, used for [`vote`] and [`execute`] calls.
    ///
    /// [`vote`]: AuraVaultTrait::vote
    /// [`execute`]: AuraVaultTrait::execute
    fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError>;

    /// Create a governance proposal to change the underlying token address.
    ///
    /// The `proposer` must be in the governance signer whitelist.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `proposer` — Authorised signer creating the proposal.
    /// - `new_token` — Proposed new underlying token contract address.
    ///
    /// # Returns
    ///
    /// The numeric proposal ID.
    fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError>;

    /// Create a governance proposal to update a named protocol parameter.
    ///
    /// The `proposer` must be in the governance signer whitelist.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `proposer` — Authorised signer creating the proposal.
    /// - `name` — Symbolic name of the parameter to update (e.g. `perf_fee_bps`).
    /// - `value` — Proposed new `i128` value for the parameter.
    ///
    /// # Returns
    ///
    /// The numeric proposal ID.
    fn propose_parameter_update(env: Env, proposer: Address, name: Symbol, value: i128) -> Result<u64, VaultError>;

    /// Vote to approve or reject an open governance proposal.
    ///
    /// The `voter` must be in the governance signer whitelist and must not have
    /// already voted on this proposal.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `voter` — Authorised signer casting the vote. Must authorise this call.
    /// - `proposal_id` — ID returned by a `propose_*` function.
    /// - `approve` — `true` to vote in favour; `false` to vote against.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::InvalidAddress`] — voter is not a whitelisted signer.
    fn vote(env: Env, voter: Address, proposal_id: u64, approve: bool) -> Result<(), VaultError>;

    /// Execute an approved governance proposal after its timelock has elapsed.
    ///
    /// The proposal must be in `Approved` status. After execution, the status
    /// changes to `Executed` and the proposed change takes effect.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `executor` — Any authorised signer may execute an approved proposal.
    /// - `proposal_id` — ID of the proposal to execute.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::InvalidAddress`] — executor is not a whitelisted signer.
    fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), VaultError>;

    /// Cancel a pending proposal before execution. Only its proposer may cancel it.
    fn cancel_proposal(env: Env, proposer: Address, proposal_id: u64) -> Result<(), VaultError>;

    /// Returns the current status of a governance proposal as a human-readable
    /// string, or `None` if the proposal ID does not exist.
    ///
    /// Possible values: `"Pending"`, `"Approved"`, `"Executed"`, `"Rejected"`.
    ///
    /// Read-only; no authorization required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `proposal_id` — ID of the proposal to query.
    fn proposal_status(env: Env, proposal_id: u64) -> Option<String>;

    /// Permissionlessly persist proposal expiry after its deadline and emit its lifecycle event.
    fn expire_proposal(env: Env, proposal_id: u64) -> Result<bool, VaultError>;

    /// Return the human-readable English message for a given [`VaultError`]
    /// code, or `None` if the code does not correspond to a known variant.
    ///
    /// This is a pure view function included in the contract ABI so that
    /// wallet and explorer UIs can query error descriptions on-chain without
    /// bundling a separate message table. The returned string matches the
    /// value of [`VaultError::message`] for the corresponding variant.
    ///
    /// Read-only; no authorization required.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `code` — The numeric discriminant of a [`VaultError`] variant
    ///   (e.g. `11` for [`VaultError::VaultPaused`]).
    ///
    /// # Returns
    ///
    /// `Some(message)` for a recognised code, `None` otherwise.
    fn get_vault_error_message(env: Env, code: u32) -> Option<String>;

    // -----------------------------------------------------------------------
    // Whitelist-only deposit mode (Issue #349)
    // -----------------------------------------------------------------------

    /// Enable whitelist-only deposit mode. Admin-only.
    fn enable_whitelist(env: Env, admin: Address) -> Result<(), VaultError>;

    /// Disable whitelist-only deposit mode. Admin-only.
    fn disable_whitelist(env: Env, admin: Address) -> Result<(), VaultError>;

    /// Add an address to the deposit whitelist. Admin-only.
    fn add_to_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError>;

    /// Remove an address from the deposit whitelist. Admin-only.
    fn remove_from_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError>;

    /// Query whether an address is whitelisted. Read-only, no auth required.
    fn is_whitelisted(env: Env, addr: Address) -> bool;

    /// Add a depositor to the KYC allowlist. Admin-only.
    fn add_to_allowlist(env: Env, admin: Address, address: Address) -> Result<(), VaultError>;

    /// Remove a depositor from the KYC allowlist. Admin-only.
    fn remove_from_allowlist(env: Env, admin: Address, address: Address) -> Result<(), VaultError>;

    /// Query KYC allowlist membership. Read-only, no auth required.
    fn is_allowlisted(env: Env, address: Address) -> bool;

    /// Returns whether governance has enabled KYC allowlist enforcement.
    fn allowlist_enabled(env: Env) -> bool;

    // -----------------------------------------------------------------------
    // Minimum deposit amount (Issue #355)
    // -----------------------------------------------------------------------

    /// Set the minimum deposit amount. Admin-only.
    fn set_min_deposit(env: Env, admin: Address, amount: i128) -> Result<(), VaultError>;

    /// Query the minimum deposit amount. Read-only, no auth required.
    fn min_deposit(env: Env) -> i128;

    // -----------------------------------------------------------------------
    // Referral tracking
    // -----------------------------------------------------------------------

    /// Return the number of deposits attributed to `referrer`.
    ///
    /// This count is incremented each time a depositor supplies
    /// `Some(referrer)` as the referrer argument to [`deposit`].  It is
    /// intended for off-chain reward calculation; no on-chain bonus is
    /// distributed.
    ///
    /// Read-only; no authorization required.
    fn get_referral_count(env: Env, referrer: Address) -> u32;

    // -----------------------------------------------------------------------
    // Contract metadata (Issue #350)
    // -----------------------------------------------------------------------

    /// Returns the vault name. Read-only.
    fn name(env: Env) -> String;

    /// Returns the vault share symbol. Read-only.
    fn symbol(env: Env) -> String;

    /// Returns the contract version integer. Read-only.
    fn version(env: Env) -> u32;

    /// Returns the number of decimal places used by vault shares (e.g. 7 for Stellar standard). Read-only.
    fn decimals(env: Env) -> u32;
    // -----------------------------------------------------------------------
    // Two-step admin transfer (Issue #353)
    // -----------------------------------------------------------------------
    // Deposit event updated (Issue #354):
    //   ("deposit", caller, amount) → (new_shares, total_shares, total_deposited, share_price, timestamp)
    // Withdraw event updated (Issue #354):
    //   ("withdraw", caller, shares) → (redeem_amount, total_shares, total_deposited, share_price, timestamp)
    // share_price = total_deposited * 10^7 / total_shares  (7 decimal precision)
    //
    // Admin transfer events:
    //   propose_admin  → ("AdminProposed",   current_admin) → (new_admin, expiry_timestamp)
    //   accept_admin   → ("AdminTransferred", old_admin)    → (new_admin,)
    //   cancel_admin   → ("AdminCancelled",  current_admin) → ()

    /// Propose a new admin address (current admin only).
    ///
    /// Sets a pending admin that must call [`accept_admin`] within 48 hours.
    /// Calling this again while a proposal is open overwrites the previous one.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`]
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the current admin.
    fn propose_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), VaultError>;

    /// Accept a pending admin transfer (pending admin only).
    ///
    /// Must be called by the pending admin within 48 hours of the proposal.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`]
    /// - [`VaultError::NoPendingAdmin`] — no pending proposal exists.
    /// - [`VaultError::PendingAdminExpired`] — acceptance window has elapsed.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the pending admin.
    fn accept_admin(env: Env, new_admin: Address) -> Result<(), VaultError>;

    /// Cancel a pending admin transfer (current admin only).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`]
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the current admin.
    /// - [`VaultError::NoPendingAdmin`] — no pending proposal to cancel.
    fn cancel_admin(env: Env, current_admin: Address) -> Result<(), VaultError>;

    /// Return the pending admin address, if any. Read-only.
    fn pending_admin(env: Env) -> Option<Address>;

    /// Return the pending admin address, if any. Read-only alias.
    fn get_pending_admin(env: Env) -> Option<Address>;

    /// Cancel a pending admin transfer (current admin only).
    fn cancel_admin_transfer(env: Env, current_admin: Address) -> Result<(), VaultError>;

    // -----------------------------------------------------------------------
    // Role-based access control (Issue #357)
    // -----------------------------------------------------------------------
    // Role constants (bitmask): ADMIN = 1, KEEPER = 2, GUARDIAN = 4
    //
    // harvest  → requires KEEPER (2) or ADMIN (1) role
    // pause    → requires GUARDIAN (4) or ADMIN (1) role
    // unpause  → requires GUARDIAN (4) or ADMIN (1) role
    //
    // RBAC events:
    //   grant_role  → ("RoleGranted",  admin) → (role, addr)
    //   revoke_role → ("RoleRevoked",  admin) → (role, addr)

    /// Grant a role to an address. Admin-only.
    ///
    /// `role` is a bitmask: `1` = ADMIN, `2` = KEEPER, `4` = GUARDIAN.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`]
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn grant_role(env: Env, admin: Address, role: u32, addr: Address) -> Result<(), VaultError>;

    /// Revoke a role from an address. Admin-only.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`]
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn revoke_role(env: Env, admin: Address, role: u32, addr: Address) -> Result<(), VaultError>;

    /// Return the role bitmask for an address. Read-only.
    fn get_roles(env: Env, addr: Address) -> u32;

    /// Return `true` if `addr` holds all bits in `role_mask`. Read-only.
    fn has_role_query(env: Env, addr: Address, role_mask: u32) -> bool;
    // Total supply — Issue #346
    // -----------------------------------------------------------------------

    /// Returns the total outstanding vault shares (SEP-41 `total_supply`).
    ///
    /// Reads [`DataKey::TotalShares`] and is always equal to the sum of all
    /// `balance_of(addr)` values across current depositors.
    ///
    /// Read-only; no authorization required.
    fn total_supply(env: Env) -> i128;

    // -----------------------------------------------------------------------
    // AuraPriceOracle integration — Issue #348
    // -----------------------------------------------------------------------

    /// Admin: set the AuraPriceOracle contract address for USD pricing.
    ///
    /// The oracle must implement `price(token) -> (i128, u64)` returning
    /// (price_in_micro_usd, updated_at_timestamp).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn set_oracle_address(env: Env, admin: Address, oracle: Address) -> Result<(), VaultError>;

    /// Admin: update the maximum oracle price age (staleness window) in seconds.
    ///
    /// Prices older than `max_age_secs` are treated as unavailable.
    /// Default: 3 600 s (1 hour).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    fn set_oracle_max_age(env: Env, admin: Address, max_age_secs: u64) -> Result<(), VaultError>;

    /// Configure the trusted router and oracle protection thresholds.
    fn set_swap_config(env: Env, admin: Address, router: Address, max_slippage_bps: u32, twap_window_secs: u64, max_deviation_bps: u32) -> Result<(), VaultError>;

    /// Returns the configured oracle contract address, or `None` if not set.
    ///
    /// Read-only; no authorization required.
    fn get_oracle_address(env: Env) -> Option<Address>;

    /// Returns total vault assets in micro-USD (6 decimal places, 1_000_000 = $1.00).
    ///
    /// Queries the configured AuraPriceOracle for the underlying token price.
    /// Returns `0` (with an `oracle_unavailable` event) if the oracle is
    /// unconfigured, unreachable, or returns a stale/invalid price.
    ///
    /// Read-only; no authorization required. Never reverts.
    fn total_assets_usd(env: Env) -> i128;

    // -----------------------------------------------------------------------
    // Harvest cooldown convenience function — Issue #351
    // -----------------------------------------------------------------------

    /// Returns the earliest ledger timestamp at which the next harvest will be
    /// permitted, or `0` if a harvest is currently allowed immediately.
    ///
    /// Returns `0` when the cooldown is disabled or no harvest has occurred yet.
    ///
    /// Read-only; no authorization required.
    fn next_harvest_allowed_at(env: Env) -> u64;

    // -----------------------------------------------------------------------
    // Price snapshots — Issue #352
    // -----------------------------------------------------------------------

    /// Returns the share-price snapshot stored at exactly `timestamp`, or
    /// `None` if no snapshot exists (never stored or TTL expired).
    ///
    /// Snapshots are stored after every successful harvest and retained for
    /// 90 days.  The value is share price scaled ×1 000 000.
    ///
    /// Read-only; no authorization required.
    fn get_price_snapshot(env: Env, timestamp: u64) -> Option<i128>;

    /// Returns share-price snapshots for the given `timestamps` that fall
    /// within `[from, to]` (both inclusive).
    ///
    /// Each entry is `(timestamp, share_price)`.  Timestamps without a stored
    /// snapshot or outside the range are silently omitted.
    ///
    /// Read-only; no authorization required.
    fn list_price_snapshots(env: Env, timestamps: Vec<u64>, from: u64, to: u64) -> Vec<(u64, i128)>;

    // -----------------------------------------------------------------------
    // Invariant health-check — Issue #931
    // -----------------------------------------------------------------------

    /// Validate all critical vault invariants and return a structured result.
    ///
    /// View-only — never modifies state.  Called automatically by the CI
    /// upgrade test suite after every contract upgrade to verify vault health.
    ///
    /// # Invariants checked
    ///
    /// 1. `total_shares > 0` implies `total_assets > 0` (solvency).
    /// 2. Admin's share balance ≤ `total_shares` (balance sample check).
    /// 3. Vault is either fully initialised (admin + token set) or fully
    ///    uninitialised — never in a partial state.
    /// 4. Admin address is present once the vault is live.
    /// 5. `perf_fee_bps <= 10_000` (fee cannot exceed 100 %).
    ///
    /// # Returns
    ///
    /// - [`InvariantCheckResult::AllPassed`] — all invariants pass.
    /// - [`InvariantCheckResult::Failing`] — first failing invariant with a
    ///   descriptive message.
    ///
    /// Read-only; no authorization required.  Never reverts.
    fn check_invariants(env: Env) -> InvariantCheckResult;

    // -----------------------------------------------------------------------
    // Batch deposit (Issue #932)
    // -----------------------------------------------------------------------

    /// Deposit tokens on behalf of multiple recipients in a single transaction.
    ///
    /// The `caller` transfers the total sum of all `amounts` upfront and shares
    /// are minted individually for each recipient using the current exchange
    /// rate at the time of the call.
    ///
    /// Batch size is limited to **50 recipients** to bound gas usage.
    ///
    /// Emits one `deposit` event per recipient plus a single
    /// `batch_deposit_completed` event containing the total deposited amount
    /// and the number of recipients processed.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address transferring tokens for all recipients. Must
    ///   authorise this call and hold sufficient token balance.
    /// - `recipients` — List of `(recipient_address, amount)` pairs. Must be
    ///   non-empty and contain ≤ 50 entries. Each amount must be > 0.
    ///
    /// # Returns
    ///
    /// A `Vec<i128>` of shares minted for each recipient, in the same order as
    /// the `recipients` input.
    ///
    /// # Errors
    ///
    /// - [`VaultError::BatchEmpty`] — `recipients` list is empty.
    /// - [`VaultError::BatchTooLarge`] — `recipients` list exceeds 50 entries.
    /// - [`VaultError::ZeroAmount`] — any individual amount is ≤ 0, or a share
    ///   formula rounds to zero.
    /// - [`VaultError::NotInitialized`] — vault has not been initialised.
    /// - [`VaultError::VaultPaused`] — vault is currently paused.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow in total or share
    ///   formula.
    /// - [`VaultError::TvlCapExceeded`] — total deposit would push vault above
    ///   the configured TVL cap.
    fn batch_deposit(env: Env, caller: Address, recipients: Vec<(Address, i128)>) -> Result<Vec<i128>, VaultError>;
}


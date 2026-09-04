use soroban_sdk::{Address, Env, Vec, Symbol, BytesN, String};
use crate::errors::VaultError;

/// Public ABI for AuraVault.
///
/// This trait documents every callable entry point of the vault contract.
/// The concrete implementation lives in [`crate::AuraVault`] (`lib.rs`).
///
/// All functions that mutate vault state require the caller to hold a valid
/// Soroban authorization (`require_auth`). Read-only view functions (`total_assets`,
/// `balance_of`, `is_paused`, `proposal_status`) do not require auth and are
/// free to call.
///
/// # Event summary
///
/// | Function | Event topic | Event data |
/// |---|---|---|
/// | `deposit` | `("deposit", caller, amount)` | `(new_shares, total_shares, total_deposited)` |
/// | `withdraw` | `("withdraw", caller, shares)` | `(redeem_amount, total_shares, total_deposited)` |
/// | `harvest` | `("harvest", caller, yield_amount)` | `(yield_after_fee, fee_amount, total_deposited)` |
/// | `harvest_token` | `("harvest_token", caller, alt_token)` | `(yield_amount, net_underlying, fee_amount)` |
/// | `pause` | `("paused",)` | `()` |
/// | `unpause` | `("unpaused",)` | `()` |
/// | `upgrade` | `("upgrade", admin)` | `(old_version, new_version)` |
/// | `withdraw_fees` | `("fees_withdrawn", admin)` | `(fees, treasury)` |
/// | Any mismatch | `("suspicious",)` | `("balance_mismatch", actual, tracked)` |
#[allow(dead_code)]
pub trait AuraVaultTrait {
    /// Initialise the vault.
    ///
    /// Must be called exactly once after the contract is deployed. Sets the
    /// admin address, the underlying token, and the governance signer list.
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
    ///
    /// # Errors
    ///
    /// - [`VaultError::AlreadyInitialized`] — vault has already been initialised.
    fn initialize(env: Env, admin: Address, underlying_token: Address, signers: Vec<Address>) -> Result<(), VaultError>;

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
    /// executing. Emits a `deposit` event on success.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address depositing tokens. Must authorise this call.
    /// - `amount` — Number of underlying tokens to deposit (in the token's
    ///   smallest unit, i.e. stroops for a 7-decimal token). Must be > 0.
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
    ///
    /// # Examples
    ///
    /// ```no_run
    /// // In a Soroban test environment:
    /// // let shares = vault_client.deposit(&caller, &1_000_000_i128);
    /// // assert!(shares > 0);
    /// ```
    fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError>;

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

    // -----------------------------------------------------------------------
    // Minimum deposit amount (Issue #355)
    // -----------------------------------------------------------------------

    /// Set the minimum deposit amount. Admin-only.
    fn set_min_deposit(env: Env, admin: Address, amount: i128) -> Result<(), VaultError>;

    /// Query the minimum deposit amount. Read-only, no auth required.
    fn min_deposit(env: Env) -> i128;

    // -----------------------------------------------------------------------
    // Contract metadata (Issue #350)
    // -----------------------------------------------------------------------

    /// Returns the vault name. Read-only.
    fn name(env: Env) -> Option<String>;

    /// Returns the vault share symbol. Read-only.
    fn symbol(env: Env) -> Option<String>;

    /// Returns the contract version integer. Read-only.
    fn version(env: Env) -> u32;

    // -----------------------------------------------------------------------
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
    // Role management — Issue #357
    // -----------------------------------------------------------------------
    
    /// Grant a role to an address. Admin-only.
    fn grant_role(env: Env, admin: Address, role: u32, account: Address) -> Result<(), VaultError>;

    /// Revoke a role from an address. Admin-only.
    fn revoke_role(env: Env, admin: Address, role: u32, account: Address) -> Result<(), VaultError>;
}

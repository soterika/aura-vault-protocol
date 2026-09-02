#![allow(unused)]

use soroban_sdk::contracterror;

/// All error codes that AuraVault contract functions may return.
///
/// Errors are represented as `u32` discriminants and are part of the public
/// ABI — changing a discriminant value is a **breaking change** that requires a
/// storage-layout version bump and a governance upgrade proposal.
///
/// # Mapping to HTTP-style categories
///
/// | Range | Category |
/// |---|---|
/// | 1–2   | Initialisation errors |
/// | 3–6   | Input / arithmetic errors |
/// | 7–8   | State precondition errors |
/// | 9–12  | Authorization / invariant errors |
/// | 13–15 | Governance errors |
/// | 16–19 | Operational / configuration errors |
/// | 20–23 | Withdrawal queue errors |
/// | 24    | Circuit-breaker errors |
///
/// # ABI metadata
///
/// Each variant exposes a human-readable string through [`VaultError::message`]
/// which is included in the contract ABI metadata and can be surfaced directly
/// by wallet and explorer UIs without additional localisation lookup.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    // -----------------------------------------------------------------------
    // 1–2: Initialisation errors
    // -----------------------------------------------------------------------

    /// The vault has not yet been initialised via [`initialize`].
    ///
    /// **Trigger:** Any function that reads vault state is called before
    /// `initialize` has been called on this contract instance.
    ///
    /// **Resolution:** Call `initialize(admin, underlying_token, signers)`
    /// first, or connect to the correct contract address.
    ///
    /// [`initialize`]: crate::AuraVault::initialize
    NotInitialized = 1,

    /// [`initialize`] has already been called on this contract instance.
    ///
    /// **Trigger:** A second call to `initialize` after the vault has already
    /// been set up. The vault can only be initialised once.
    ///
    /// **Resolution:** No action needed — the vault is already active. If you
    /// intended to change parameters, use the appropriate admin setter instead.
    ///
    /// [`initialize`]: crate::AuraVault::initialize
    AlreadyInitialized = 2,

    // -----------------------------------------------------------------------
    // 3–6: Input / arithmetic errors
    // -----------------------------------------------------------------------

    /// The caller does not hold enough vault shares to fulfil the withdrawal.
    ///
    /// **Trigger:** `withdraw(shares)` called when `shares > balance_of(caller)`.
    ///
    /// **Resolution:** Reduce the number of shares to withdraw, or check your
    /// current share balance with `balance_of(your_address)`.
    ///
    /// [`withdraw`]: crate::AuraVault::withdraw
    InsufficientShares = 3,

    /// The vault's tracked underlying balance cannot cover the redemption.
    ///
    /// **Trigger:** `withdraw` would pay out more tokens than the vault holds.
    /// This should not occur under normal circumstances; it implies a
    /// discrepancy between share accounting and the underlying balance.
    ///
    /// **Resolution:** Contact the vault admin immediately. The vault should be
    /// paused and audited before any further withdrawals.
    ///
    /// [`withdraw`]: crate::AuraVault::withdraw
    InsufficientUnderlying = 4,

    /// The supplied amount is zero or would produce zero output.
    ///
    /// **Trigger:**
    /// - `deposit(amount)` called with `amount <= 0`.
    /// - `withdraw(shares)` called with `shares <= 0`.
    /// - `harvest(yield_amount)` called with `yield_amount <= 0`.
    /// - A deposit is so small relative to the vault size that the share
    ///   formula rounds to zero shares.
    ///
    /// **Resolution:** Increase the input amount. If depositing, the minimum
    /// viable deposit is approximately `total_deposited / total_shares` tokens.
    ZeroAmount = 5,

    /// An arithmetic operation overflowed the `i128` range.
    ///
    /// **Trigger:** The share formula or fee calculation produced a value that
    /// cannot be represented as a 128-bit signed integer. This can occur with
    /// extremely large vault balances or very large input amounts.
    ///
    /// **Resolution:** Reduce the transaction amount. If the error persists at
    /// normal amounts, contact the vault admin — it may indicate a bug.
    MathOverflow = 6,

    // -----------------------------------------------------------------------
    // 7–8: State precondition errors
    // -----------------------------------------------------------------------

    /// An address argument failed validation, or is not on the required whitelist.
    ///
    /// **Trigger:**
    /// - An alternative yield token passed to `harvest_token` or
    ///   `distribute_yield_token` has not been registered via
    ///   `register_yield_token`.
    /// - A governance operation was attempted by an address not in the signer
    ///   whitelist.
    ///
    /// **Resolution:** Use a whitelisted token address, or ensure the caller
    /// address has been added to the governance signer list.
    InvalidAddress = 7,

    /// A harvest was attempted but the vault has no outstanding shares.
    ///
    /// **Trigger:** `harvest` or `distribute_yield` called when
    /// `total_shares == 0`, meaning there are no depositors to receive yield.
    ///
    /// **Resolution:** Wait until at least one depositor has joined the vault
    /// before harvesting yield.
    ZeroShares = 8,

    // -----------------------------------------------------------------------
    // 9–12: Authorization / invariant errors
    // -----------------------------------------------------------------------

    /// The caller is not authorised to perform this admin-only operation.
    ///
    /// **Trigger:** A privileged function (`pause`, `unpause`, `set_fees`,
    /// `upgrade`, `set_tvl_cap`, `set_harvest_cooldown`, etc.) was called by
    /// an address that does not match the stored admin.
    ///
    /// **Resolution:** Only the vault admin can call this function. Connect
    /// with the admin keypair and try again.
    UpgradeUnauthorized = 9,

    /// The on-chain storage layout version does not match the compiled code.
    ///
    /// **Trigger:** `upgrade` was attempted but the stored layout version
    /// differs from `CURRENT_LAYOUT_VERSION`. This guards against running new
    /// code against an incompatible storage schema.
    ///
    /// **Resolution:** Perform any required storage migration first, then
    /// retry the upgrade.
    StorageLayoutMismatch = 10,

    /// All mutating operations are halted because the vault is paused.
    ///
    /// **Trigger:** `deposit`, `withdraw`, or `harvest` called while the admin
    /// has activated the emergency pause.
    ///
    /// **Resolution:** Wait for the vault admin to call `unpause()`. Follow
    /// official Aura Vault channels for status updates.
    VaultPaused = 11,

    /// The vault's actual token balance does not match its tracked state.
    ///
    /// **Trigger:** The flash-loan guard detected that the vault's real on-chain
    /// token balance differs from `total_deposited`. This indicates a potential
    /// flash-loan attack or an accounting bug.
    ///
    /// **Resolution:** The vault has emitted a `suspicious` event. Contact the
    /// vault admin immediately. Do not interact until the discrepancy has been
    /// investigated.
    BalanceMismatch = 12,

    // -----------------------------------------------------------------------
    // 13–15: Governance errors
    // -----------------------------------------------------------------------

    /// A governance proposal cannot be executed because its timelock has not
    /// yet expired.
    ///
    /// **Trigger:** `execute(proposal_id)` called before the required waiting
    /// period after approval has elapsed.
    ///
    /// **Resolution:** Wait for the timelock period to expire, then retry.
    TimelockNotExpired = 13,

    /// A governance proposal has not received enough approval votes to execute.
    ///
    /// **Trigger:** `execute(proposal_id)` called on a proposal that has not
    /// yet reached the required signature threshold.
    ///
    /// **Resolution:** Collect more approval votes from whitelisted signers
    /// before executing.
    NotApproved = 14,

    /// This signer has already voted on this governance proposal.
    ///
    /// **Trigger:** `vote(proposal_id, approve)` called by an address that
    /// already cast a vote on the same proposal.
    ///
    /// **Resolution:** Each signer may only vote once per proposal. No further
    /// action is needed if the vote was already recorded.
    AlreadyVoted = 15,

    // -----------------------------------------------------------------------
    // 16–19: Operational / configuration errors
    // -----------------------------------------------------------------------

    /// The deposit would push the vault's total assets above the configured cap.
    ///
    /// **Trigger:** `deposit(amount)` would make `total_assets > tvl_cap` when
    /// a non-zero TVL cap is set.
    ///
    /// **Resolution:** Deposit a smaller amount, or wait for other users to
    /// withdraw. Admins can raise or remove the cap with `set_tvl_cap`.
    TvlCapExceeded = 16,

    /// The yield amount is too small to distribute: it rounds to zero per share.
    ///
    /// **Trigger:** `distribute_yield` or `distribute_yield_token` called with
    /// a `yield_amount` so small that `yield_amount * YIELD_PRECISION /
    /// total_shares == 0`.
    ///
    /// **Resolution:** Accumulate more yield before distributing, or wait for
    /// the vault to grow in share count.
    YieldTooSmall = 17,

    /// Yield distribution accuracy check failed (rounding error exceeds 0.01%).
    ///
    /// **Trigger:** After computing the per-share yield increment, the
    /// re-derived total distributed amount differs from the net yield by more
    /// than 0.01%. This guards against precision loss on very large or very
    /// uneven vaults.
    ///
    /// **Resolution:** This is an internal safeguard; adjust the yield amount
    /// slightly or contact the vault admin if it persists.
    DistributionAccuracyError = 18,
    /// Harvest attempted before the configured cooldown period has elapsed
    HarvestCooldown        = 19,
    /// Withdrawal is queued and will be processed after the unbonding period
    WithdrawalQueued       = 20,
    /// Withdrawal queue entry does not exist or has already been processed
    QueueEntryNotFound     = 21,
    /// Withdrawal queue entry is still within the unbonding period
    QueueUnbondingPending  = 22,
    /// Withdrawal fee rate exceeds the allowed maximum
    InvalidWithdrawalFee   = 23,
    /// A token.transfer cross-contract call did not move the expected amount
    /// (post-transfer balance assertion failed).
    TransferFailed         = 24,
    /// Oracle price is zero — feed returned a nonsensical value.
    OraclePriceZero        = 25,
    /// Oracle price exceeds the sanity-cap (unreasonably large value that
    /// may indicate a manipulation attempt or mis-configured feed).
    OraclePriceTooHigh     = 26,
    /// Oracle data is stale: the `updated_at` timestamp is older than the
    /// configured maximum age.
    OraclePriceStale       = 27,
    /// Deposit attempted by an address not on the whitelist while whitelist-only
    /// mode is enabled.
    NotWhitelisted         = 28,
    /// Deposit amount is below the configured minimum deposit threshold.
    BelowMinDeposit        = 29,
    /// Oracle contract call failed or returned an unexpected error; the vault
    /// has fallen back to returning 0 for the USD value.  This error is only
    /// used in events, not returned from `total_assets_usd`.
    OracleUnavailable      = 30,
    /// Share-price movement exceeded the configured circuit-breaker threshold.
    /// The vault auto-pauses when this occurs.
    CircuitBreakerTripped  = 31,

    // -----------------------------------------------------------------------
    // 32–38: Multi-sig governance errors (Issue #375)
    // -----------------------------------------------------------------------

    /// Caller is not in the registered multisig signer set.
    NotASigner             = 32,
    /// The referenced multisig operation does not exist.
    OperationNotFound      = 33,
    /// The multisig operation has already been executed.
    OperationAlreadyExecuted = 34,
    /// The multisig operation's validity period has passed.
    OperationExpired       = 35,
    /// Signer has already signed this multisig operation.
    OperationAlreadySigned = 36,
    /// Not enough signatures to execute the multisig operation.
    ThresholdNotMet        = 37,
    /// Proposed threshold is zero or exceeds the signer count.
    InvalidThreshold       = 38,
}

impl VaultError {
    /// Return a short human-readable English description for this error code.
    ///
    /// Used by [`AuraVault::get_vault_error_message`] to expose descriptions
    /// on-chain so wallet and explorer UIs can display them without a
    /// separate message table.
    pub fn message(self) -> &'static str {
        match self {
            VaultError::NotInitialized            => "Vault not initialized",
            VaultError::AlreadyInitialized        => "Vault already initialized",
            VaultError::InsufficientShares        => "Insufficient share balance",
            VaultError::InsufficientUnderlying    => "Insufficient underlying balance",
            VaultError::ZeroAmount                => "Amount must be greater than zero",
            VaultError::MathOverflow              => "Arithmetic overflow",
            VaultError::InvalidAddress            => "Invalid or unwhitelisted address",
            VaultError::ZeroShares                => "No shares outstanding",
            VaultError::UpgradeUnauthorized       => "Caller is not the admin",
            VaultError::StorageLayoutMismatch     => "Storage layout version mismatch",
            VaultError::VaultPaused               => "Vault is paused",
            VaultError::BalanceMismatch           => "Balance mismatch (flash-loan guard)",
            VaultError::TimelockNotExpired        => "Governance timelock not expired",
            VaultError::NotApproved               => "Proposal not approved",
            VaultError::AlreadyVoted              => "Already voted on this proposal",
            VaultError::TvlCapExceeded            => "TVL cap exceeded",
            VaultError::YieldTooSmall             => "Yield too small to distribute",
            VaultError::DistributionAccuracyError => "Distribution accuracy check failed",
            VaultError::HarvestCooldown           => "Harvest cooldown not elapsed",
            VaultError::WithdrawalQueued          => "Withdrawal queued; await unbonding",
            VaultError::QueueEntryNotFound        => "Queue entry not found",
            VaultError::QueueUnbondingPending     => "Unbonding period not elapsed",
            VaultError::InvalidWithdrawalFee      => "Withdrawal fee exceeds maximum",
            VaultError::TransferFailed            => "Token transfer assertion failed",
            VaultError::OraclePriceZero           => "Oracle price is zero",
            VaultError::OraclePriceTooHigh        => "Oracle price exceeds sanity cap",
            VaultError::OraclePriceStale          => "Oracle price is stale",
            VaultError::NotWhitelisted            => "Address not on deposit whitelist",
            VaultError::BelowMinDeposit           => "Deposit below minimum amount",
            VaultError::OracleUnavailable         => "Oracle unavailable; returning fallback value",
            VaultError::CircuitBreakerTripped     => "Circuit breaker tripped: share price moved too much",
            VaultError::NotASigner                => "Caller is not a governance signer",
            VaultError::OperationNotFound         => "Multisig operation not found",
            VaultError::OperationAlreadyExecuted  => "Multisig operation already executed",
            VaultError::OperationExpired          => "Multisig operation has expired",
            VaultError::OperationAlreadySigned    => "Signer has already signed this operation",
            VaultError::ThresholdNotMet           => "Signature threshold not met",
            VaultError::InvalidThreshold          => "Invalid signature threshold",
        }
    }
}

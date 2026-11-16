use soroban_sdk::contracterror;

/// All error codes that `VaultMigrator` contract functions may return.
///
/// Error discriminants are stable ABI — do not reorder or reuse values.
///
/// | Code | Variant | Trigger |
/// |---|---|---|
/// | 1 | `NotInitialized` | `migrate` called before `initialize` |
/// | 2 | `AlreadyInitialized` | `initialize` called more than once |
/// | 3 | `Expired` | The 30-day migration window has closed |
/// | 4 | `ZeroShares` | `user_shares` argument is zero or negative |
/// | 5 | `SlippageExceeded` | Tokens redeemed or shares minted fell below the caller's minimum |
/// | 6 | `MathOverflow` | Arithmetic overflow in slippage check |
/// | 7 | `InvalidAddress` | `old_vault` and `new_vault` are the same address |
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MigrationError {
    /// The migrator contract has not yet been initialized.
    ///
    /// **Trigger:** `migrate` called before `initialize` has been invoked.
    ///
    /// **Resolution:** Call `initialize(old_vault, new_vault, expiry_timestamp)`
    /// first.
    NotInitialized = 1,

    /// `initialize` has already been called on this contract instance.
    ///
    /// **Trigger:** A second call to `initialize`.
    ///
    /// **Resolution:** The migrator is already active. No further setup needed.
    AlreadyInitialized = 2,

    /// The migration window has closed.
    ///
    /// **Trigger:** The current ledger timestamp is past the `expiry_timestamp`
    /// that was set during `initialize`. By default, the deployer sets this to
    /// 30 days (2 592 000 seconds) after deployment.
    ///
    /// **Resolution:** Deploy a new migration contract with a fresh window.
    Expired = 3,

    /// The `user_shares` argument must be greater than zero.
    ///
    /// **Trigger:** `migrate` called with `user_shares <= 0`.
    ///
    /// **Resolution:** Provide a positive share count to migrate.
    ZeroShares = 4,

    /// The migration would produce tokens or new shares below the caller's
    /// slippage tolerance.
    ///
    /// **Trigger:** Either:
    /// - The underlying tokens redeemed from the old vault are less than
    ///   `min_underlying_out`, or
    /// - The new vault shares minted are less than `min_new_shares_out`.
    ///
    /// **Resolution:** Widen the slippage tolerance (use `0` to disable the
    /// check) or migrate a smaller share quantity to improve price impact.
    SlippageExceeded = 5,

    /// Arithmetic overflow in the slippage comparison.
    ///
    /// **Trigger:** Extremely large token amounts that overflow `i128`.
    ///
    /// **Resolution:** Migrate a smaller share quantity.
    MathOverflow = 6,

    /// The old vault and new vault addresses are identical.
    ///
    /// **Trigger:** `initialize` called with `old_vault == new_vault`.
    ///
    /// **Resolution:** Supply two distinct vault contract addresses.
    InvalidAddress = 7,
}

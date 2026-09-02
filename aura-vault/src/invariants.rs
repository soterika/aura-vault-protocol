/// Invariant assertion helpers for AuraVault.
///
/// These helpers are compiled only in test builds (`#[cfg(test)]`).  Call
/// `assert_invariants` after every mutating operation in a test to verify the
/// vault is in a consistent state.  Use `snapshot_share_price` /
/// `assert_share_price_not_decreased` around a harvest call to verify the
/// monotone share-price invariant.
///
/// # Invariants checked by `assert_invariants`
///
/// 1. `total_assets >= 0`  — the tracked deposit amount is never negative.
/// 2. `total_shares >= 0`  — the tracked share supply is never negative.
/// 3. If `total_shares == 0` then `total_assets == 0`  — an empty share
///    supply implies an empty vault (no stranded assets).
/// 4. `sum(balance_of(u) for u in users) == total_shares`  — the sum of all
///    individual share balances equals the recorded total.
///
/// # Invariant checked separately
///
/// 5. Share price never decreases after a harvest.  Because this invariant
///    spans two points in time you must snapshot the price *before* the
///    harvest and assert *after*:
///
/// ```text
/// let price_before = snapshot_share_price(&vault);
/// vault.harvest(&keeper, &yield_amount);
/// assert_invariants(&env, &vault, &users);
/// assert_share_price_not_decreased(price_before, &vault);
/// ```
#[cfg(test)]
pub mod invariants {
    extern crate std;

    use soroban_sdk::{Address, Env};
    use crate::AuraVaultClient;

    // -----------------------------------------------------------------------
    // Public types
    // -----------------------------------------------------------------------

    /// An opaque snapshot of the vault's share price, captured before a
    /// harvest and consumed by [`assert_share_price_not_decreased`].
    ///
    /// The price is stored as a fixed-point rational `(numerator,
    /// denominator)` — i.e. `total_assets / total_shares` — so that no
    /// precision is lost by converting to a floating-point value.
    ///
    /// A zero-denominator price (empty vault) is represented as `(0, 1)`.
    #[derive(Debug, Clone, Copy)]
    pub struct SharePrice {
        pub numerator: i128,   // total_assets at snapshot time
        pub denominator: i128, // total_shares at snapshot time (never 0)
    }

    impl SharePrice {
        /// Returns `true` when `self >= other`, comparing as rationals:
        /// `a/b >= c/d  ↔  a*d >= c*b`  (all values are non-negative).
        pub fn at_least(&self, other: &SharePrice) -> bool {
            // Safe: both values fit in i128; cross-multiply with i128
            // arithmetic.  For the scale of values used in tests this will
            // not overflow, but we use checked_mul to be explicit.
            let lhs = self
                .numerator
                .checked_mul(other.denominator)
                .expect("share-price comparison: overflow in lhs");
            let rhs = other
                .numerator
                .checked_mul(self.denominator)
                .expect("share-price comparison: overflow in rhs");
            lhs >= rhs
        }
    }

    // -----------------------------------------------------------------------
    // Core invariant helper
    // -----------------------------------------------------------------------

    /// Assert that the vault satisfies all structural invariants (1–4).
    ///
    /// # Arguments
    ///
    /// * `env`   — the current test environment.
    /// * `vault` — a live client for the vault under test.
    /// * `users` — every address that has ever deposited or could hold shares.
    ///             The sum of `balance_of(u)` for each address in this slice
    ///             must equal `total_shares`.  Pass an empty slice to skip
    ///             invariant 4 (useful for early initialisation tests).
    ///
    /// # Panics
    ///
    /// Panics (causing the test to fail with a descriptive message) if any
    /// invariant is violated.
    pub fn assert_invariants(
        _env: &Env,
        vault: &AuraVaultClient,
        users: &[Address],
    ) {
        let total_assets = vault.total_assets();
        let total_shares = vault.total_shares();

        // ------------------------------------------------------------------
        // Invariant 1: total_assets >= 0
        // ------------------------------------------------------------------
        assert!(
            total_assets >= 0,
            "INVARIANT 1 VIOLATED: total_assets is negative: {}",
            total_assets
        );

        // ------------------------------------------------------------------
        // Invariant 2: total_shares >= 0
        // ------------------------------------------------------------------
        assert!(
            total_shares >= 0,
            "INVARIANT 2 VIOLATED: total_shares is negative: {}",
            total_shares
        );

        // ------------------------------------------------------------------
        // Invariant 3: if total_shares == 0 then total_assets == 0
        // ------------------------------------------------------------------
        if total_shares == 0 {
            assert!(
                total_assets == 0,
                "INVARIANT 3 VIOLATED: total_shares is 0 but total_assets is non-zero: {}",
                total_assets
            );
        }

        // ------------------------------------------------------------------
        // Invariant 4: sum of all user balances == total_shares
        // (skipped when the caller passes an empty user list)
        // ------------------------------------------------------------------
        if !users.is_empty() {
            let balance_sum: i128 = users
                .iter()
                .map(|addr| vault.balance_of(addr))
                .sum();

            assert!(
                balance_sum == total_shares,
                "INVARIANT 4 VIOLATED: sum of user balances ({}) != total_shares ({})",
                balance_sum,
                total_shares
            );
        }
    }

    // -----------------------------------------------------------------------
    // Share-price helpers (invariant 5)
    // -----------------------------------------------------------------------

    /// Capture the current share price *before* a harvest.
    ///
    /// Returns a [`SharePrice`] that can be passed to
    /// [`assert_share_price_not_decreased`] after the harvest completes.
    ///
    /// If the vault is empty (`total_shares == 0`) the price is defined as
    /// zero and the post-harvest assertion will trivially pass.
    pub fn snapshot_share_price(vault: &AuraVaultClient) -> SharePrice {
        let numerator = vault.total_assets();
        let denominator = vault.total_shares();

        if denominator == 0 {
            SharePrice { numerator: 0, denominator: 1 }
        } else {
            SharePrice { numerator, denominator }
        }
    }

    /// Assert that the share price has not decreased since `price_before` was
    /// captured (invariant 5).
    ///
    /// # Panics
    ///
    /// Panics with a descriptive message when the current price is strictly
    /// less than `price_before`.
    pub fn assert_share_price_not_decreased(
        price_before: SharePrice,
        vault: &AuraVaultClient,
    ) {
        let price_after = snapshot_share_price(vault);

        assert!(
            price_after.at_least(&price_before),
            "INVARIANT 5 VIOLATED: share price decreased after harvest. \
             Before: {}/{}, After: {}/{}",
            price_before.numerator,
            price_before.denominator,
            price_after.numerator,
            price_after.denominator,
        );
    }
}

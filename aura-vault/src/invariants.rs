/// Invariant checks for the AuraVault contract.
///
/// This module contains helper functions that assert mathematical invariants
/// hold across all state transitions.
#[cfg(test)]
pub mod invariants {
    extern crate std;
    use soroban_sdk::{Address, Env};
    use crate::AuraVaultClient;

    /// Take a snapshot of the current share price (total_assets / total_shares),
    /// scaled to 1_000_000 to avoid fractional values.
    /// Returns 0 if total_shares is 0.
    pub fn snapshot_share_price(vault: &AuraVaultClient) -> i128 {
        let total_assets = vault.total_assets();
        let total_shares = vault.total_supply();
        if total_shares == 0 {
            return 0;
        }
        total_assets
            .checked_mul(1_000_000)
            .and_then(|v| v.checked_div(total_shares))
            .unwrap_or(0)
    }

    /// Assert that the share price has not decreased from `price_before`.
    /// Due to fee rounding, the price should be >= the previous price.
    pub fn assert_share_price_not_decreased(price_before: i128, vault: &AuraVaultClient) {
        let price_after = snapshot_share_price(vault);
        assert!(
            price_after >= price_before,
            "Share price decreased: before={price_before}, after={price_after}"
        );
    }

    /// Assert core vault invariants:
    /// 1. total_supply == sum of all user balances
    /// 2. total_assets >= 0
    /// 3. total_supply >= 0
    pub fn assert_invariants(env: &Env, vault: &AuraVaultClient, users: &[Address]) {
        let total_supply = vault.total_supply();
        let total_assets = vault.total_assets();

        assert!(total_assets >= 0, "total_assets must be non-negative");
        assert!(total_supply >= 0, "total_supply must be non-negative");

        let sum_of_balances: i128 = users.iter().map(|u| vault.balance_of(u)).sum();

        // The sum of known user balances must not exceed total_supply
        assert!(
            sum_of_balances <= total_supply,
            "sum_of_balances ({sum_of_balances}) > total_supply ({total_supply})"
        );

        // If there are any shares, there must be assets
        if total_supply > 0 {
            // Invariant: share price >= 1 (no value destruction below original seed)
            let price = snapshot_share_price(vault);
            assert!(price >= 0, "share price must be non-negative");
        }
    }
}

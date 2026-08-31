/// Tests for TVL cap enforcement in deposit — Issue #467
///
/// Acceptance criteria:
///   ✓ deposit within cap succeeds
///   ✓ deposit that would exceed cap fails with TvlCapExceeded
///   ✓ partial deposit up to cap (if cap allows) works correctly
///   ✓ cap of 0 means unlimited
///   ✓ admin update cap → new limit enforced immediately
#[cfg(test)]
mod tvl_cap_tests {
    extern crate std;

    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient, VaultError};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        let signers: Vec<Address> = Vec::new(&env);
        vault.initialize(&admin, &token_addr, &signers, &0_u32);
        vault.set_fees(&admin, &0_u32, &0_u32);
        (env, vault, admin, token_addr)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    // -----------------------------------------------------------------------
    // Test: cap = 0 → unlimited deposits
    // -----------------------------------------------------------------------

    /// When no TVL cap is set (default 0), any deposit succeeds.
    #[test]
    fn test_tvl_cap_zero_means_unlimited() {
        let (env, vault, admin, token) = setup();

        // Confirm default cap is 0
        assert_eq!(vault.get_tvl_cap(), 0);

        // Deposit a large amount — should succeed without any cap check
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000_000);
        let minted = vault.deposit(&user, &1_000_000_000);
        assert_eq!(minted, 1_000_000_000);
        assert_eq!(vault.total_assets(), 1_000_000_000);
    }

    // -----------------------------------------------------------------------
    // Test: deposit within cap succeeds
    // -----------------------------------------------------------------------

    /// A deposit that keeps total_assets ≤ cap must succeed.
    #[test]
    fn test_deposit_within_tvl_cap_succeeds() {
        let (env, vault, admin, token) = setup();

        // Set a cap of 2_000_000
        vault.set_tvl_cap(&admin, &2_000_000);
        assert_eq!(vault.get_tvl_cap(), 2_000_000);

        // Deposit 1_000_000 — within cap
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        let minted = vault.deposit(&user, &1_000_000);
        assert_eq!(minted, 1_000_000);
        assert_eq!(vault.total_assets(), 1_000_000);
    }

    /// A deposit that lands exactly on the cap must succeed.
    #[test]
    fn test_deposit_exactly_at_cap_succeeds() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &5_000_000);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 5_000_000);
        let minted = vault.deposit(&user, &5_000_000);
        assert_eq!(minted, 5_000_000);
        assert_eq!(vault.total_assets(), 5_000_000);
    }

    // -----------------------------------------------------------------------
    // Test: deposit that would exceed cap fails with TvlCapExceeded
    // -----------------------------------------------------------------------

    /// A deposit that would push total_assets above the cap fails.
    #[test]
    fn test_deposit_exceeding_tvl_cap_returns_error() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &1_000_000);

        // First deposit fills the vault to exactly the cap
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 1_000_000);
        vault.deposit(&alice, &1_000_000);
        assert_eq!(vault.total_assets(), 1_000_000);

        // Second deposit of any amount exceeds the cap
        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &bob, 1);
        let result = vault.try_deposit(&bob, &1);
        assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));
    }

    /// Even a tiny deposit (1 stroop) fails when the cap is already reached.
    #[test]
    fn test_deposit_one_stroop_over_full_vault_fails() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &500_000);

        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 500_000);
        vault.deposit(&alice, &500_000);

        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &bob, 1);
        let result = vault.try_deposit(&bob, &1);
        assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));
    }

    /// A deposit larger than the cap is rejected even when vault is empty.
    #[test]
    fn test_deposit_larger_than_cap_on_empty_vault_fails() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &1_000_000);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 2_000_000);
        let result = vault.try_deposit(&user, &2_000_000);
        assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));
    }

    // -----------------------------------------------------------------------
    // Test: partial deposit up to cap works correctly
    // -----------------------------------------------------------------------

    /// Two sequential deposits where only the first fits under the cap.
    #[test]
    fn test_partial_deposits_up_to_cap_work() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &3_000_000);

        // Deposit 2_000_000 — within cap
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 2_000_000);
        vault.deposit(&alice, &2_000_000);
        assert_eq!(vault.total_assets(), 2_000_000);

        // Deposit 500_000 — still within cap (2_000_000 + 500_000 = 2_500_000 ≤ 3_000_000)
        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &bob, 500_000);
        vault.deposit(&bob, &500_000);
        assert_eq!(vault.total_assets(), 2_500_000);

        // Deposit 600_000 — would exceed cap (2_500_000 + 600_000 = 3_100_000 > 3_000_000)
        let carol = Address::generate(&env);
        mint(&env, &token, &admin, &carol, 600_000);
        let result = vault.try_deposit(&carol, &600_000);
        assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));

        // Deposit exactly the remaining space (500_000) — must succeed
        let dave = Address::generate(&env);
        mint(&env, &token, &admin, &dave, 500_000);
        vault.deposit(&dave, &500_000);
        assert_eq!(vault.total_assets(), 3_000_000);
    }

    // -----------------------------------------------------------------------
    // Test: admin update cap → new limit enforced immediately
    // -----------------------------------------------------------------------

    /// Lowering the cap below current total_assets does not affect existing
    /// depositors, but new deposits are rejected.
    #[test]
    fn test_admin_lower_cap_blocks_new_deposits_immediately() {
        let (env, vault, admin, token) = setup();

        // Start uncapped — deposit freely
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 5_000_000);
        vault.deposit(&alice, &5_000_000);
        assert_eq!(vault.total_assets(), 5_000_000);

        // Admin lowers cap to 3_000_000 (below current total_assets)
        vault.set_tvl_cap(&admin, &3_000_000);
        assert_eq!(vault.get_tvl_cap(), 3_000_000);

        // Any new deposit is now rejected
        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &bob, 1);
        let result = vault.try_deposit(&bob, &1);
        assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));
    }

    /// Raising the cap allows previously-rejected amounts to succeed.
    #[test]
    fn test_admin_raise_cap_allows_deposits() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &1_000_000);

        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 1_000_000);
        vault.deposit(&alice, &1_000_000);

        // Bob is blocked under old cap
        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &bob, 1_000_000);
        let result = vault.try_deposit(&bob, &1_000_000);
        assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));

        // Admin raises cap to 2_000_000
        vault.set_tvl_cap(&admin, &2_000_000);

        // Bob's deposit succeeds now
        vault.deposit(&bob, &1_000_000);
        assert_eq!(vault.total_assets(), 2_000_000);
    }

    /// Admin can disable the cap entirely by setting it to 0.
    #[test]
    fn test_admin_disable_cap_by_setting_zero() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &100_000);

        // Vault full at 100_000
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 100_000);
        vault.deposit(&alice, &100_000);

        // Bob is blocked
        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &bob, 1);
        assert_eq!(vault.try_deposit(&bob, &1), Err(Ok(VaultError::TvlCapExceeded)));

        // Admin disables the cap
        vault.set_tvl_cap(&admin, &0);
        assert_eq!(vault.get_tvl_cap(), 0);

        // Bob's deposit now succeeds
        vault.deposit(&bob, &1);
        assert_eq!(vault.total_assets(), 100_001);
    }

    /// Non-admin cannot set the TVL cap.
    #[test]
    fn test_non_admin_cannot_set_tvl_cap() {
        let (env, vault, admin, token) = setup();
        let intruder = Address::generate(&env);
        let result = vault.try_set_tvl_cap(&intruder, &999);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    // -----------------------------------------------------------------------
    // Test: TVL cap does not affect withdrawals
    // -----------------------------------------------------------------------

    /// Existing depositors can always withdraw even if vault is above cap.
    #[test]
    fn test_tvl_cap_does_not_block_withdrawals() {
        let (env, vault, admin, token) = setup();
        vault.set_tvl_cap(&admin, &1_000_000);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Withdraw all shares — must succeed regardless of cap
        let shares = vault.balance_of(&user);
        let redeemed = vault.withdraw(&user, &shares);
        assert_eq!(redeemed, 1_000_000);
        assert_eq!(vault.total_assets(), 0);
    }
}

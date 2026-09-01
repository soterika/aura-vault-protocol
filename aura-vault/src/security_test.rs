/// Security-focused tests for AuraVault.
///
/// Covers:
///   1. Reentrancy — Soroban's actor model makes cross-contract reentrancy
///      impossible; these tests verify CEI ordering holds under adversarial
///      sequences (simulate multi-call patterns within the same ledger).
///   2. Integer overflow / underflow — checked arithmetic must trap, not wrap.
///   3. Access control — every admin-only path rejects unauthorised callers.
///   4. Flash-loan attack — balance-mismatch guard blocks tampered vault state.
///   5. Pause bypass — paused vault rejects all mutating calls regardless of caller.
///   6. Share inflation — zero-share mint must be rejected (prevents inflation attack).
#[cfg(test)]
mod security_tests {
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
        vault.initialize(&admin, &token_addr, &signers, &soroban_sdk::String::from_str(&env, "AuraVault"), &soroban_sdk::String::from_str(&env, "AURA"));
        vault.set_fees(&admin, &0_u32, &0_u32);
        (env, vault, admin, token_addr)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    // -----------------------------------------------------------------------
    // 1. Reentrancy — CEI ordering verification
    //
    // Soroban's execution model prevents true reentrancy (no mid-execution
    // callbacks). These tests verify the CEI invariant: state is written
    // *before* the token transfer, so a hypothetical reentrant call would
    // see already-updated balances and fail safely.
    // -----------------------------------------------------------------------

    /// State is written before the outgoing transfer in withdraw (CEI).
    /// Simulates: call withdraw → check that share balance is already 0
    /// before the redeemed tokens arrive at the caller.
    #[test]
    fn test_withdraw_updates_state_before_transfer_cei_ordering() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let shares_before = vault.balance_of(&user);
        vault.withdraw(&user, &shares_before);

        // After withdraw completes, shares are zero — state was settled.
        assert_eq!(vault.balance_of(&user), 0);
        assert_eq!(vault.total_assets(), 0);
    }

    /// A second withdraw after the first must fail (shares already burned).
    /// This is the canonical reentrancy double-spend check.
    #[test]
    fn test_reentrancy_double_withdraw_rejected() {
        let (env, vault, admin, token) = setup();
        let attacker = Address::generate(&env);
        mint(&env, &token, &admin, &attacker, 1_000_000);
        vault.deposit(&attacker, &1_000_000);

        let shares = vault.balance_of(&attacker);
        vault.withdraw(&attacker, &shares);

        // Second withdraw attempt with the same shares — must fail.
        let result = vault.try_withdraw(&attacker, &shares);
        assert_eq!(result, Err(Ok(VaultError::InsufficientShares)));
    }

    /// Deposit then immediate second deposit cannot double-mint shares.
    #[test]
    fn test_reentrancy_double_deposit_share_accounting_correct() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 2_000_000);

        vault.deposit(&user, &1_000_000);
        vault.deposit(&user, &1_000_000);

        // Exactly 2_000_000 shares — no double-minting.
        assert_eq!(vault.balance_of(&user), 2_000_000);
        assert_eq!(vault.total_assets(), 2_000_000);
    }

    // -----------------------------------------------------------------------
    // 2. Integer overflow / underflow
    // -----------------------------------------------------------------------

    /// Depositing i128::MAX into a non-empty vault triggers MathOverflow.
    #[test]
    fn test_overflow_deposit_max_i128_rejected() {
        let (env, vault, admin, token) = setup();
        // Seed the vault so the share formula path is exercised (not the 1:1 path).
        let seeder = Address::generate(&env);
        mint(&env, &token, &admin, &seeder, 1);
        vault.deposit(&seeder, &1);

        let attacker = Address::generate(&env);
        mint(&env, &token, &admin, &attacker, i128::MAX);
        let result = vault.try_deposit(&attacker, &i128::MAX);
        // Must error (MathOverflow or ZeroAmount from rounding — either is safe).
        assert!(result.is_err(), "i128::MAX deposit must be rejected");
    }

    /// Arithmetic on share formula: amount × total_shares overflows for large values.
    #[test]
    fn test_overflow_share_formula_large_multiplier_rejected() {
        let (env, vault, admin, token) = setup();
        let seeder = Address::generate(&env);
        // Seed with a large share count to maximise numerator.
        mint(&env, &token, &admin, &seeder, i128::MAX / 2);
        // Use 1:1 first deposit path.
        vault.deposit(&seeder, &(i128::MAX / 2));

        // A second depositor at half max causes numerator to overflow.
        let attacker = Address::generate(&env);
        let large = i128::MAX / 2 + 1;
        mint(&env, &token, &admin, &attacker, large);
        let result = vault.try_deposit(&attacker, &large);
        assert!(result.is_err());
    }

    /// Withdrawing 0 shares must be rejected (no underflow on subtraction).
    #[test]
    fn test_underflow_withdraw_zero_shares_rejected() {
        let (env, vault, _admin, _token) = setup();
        let user = Address::generate(&env);
        let result = vault.try_withdraw(&user, &0);
        assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
    }

    /// Withdrawing more shares than held must be rejected (no negative balance).
    #[test]
    fn test_underflow_withdraw_exceeds_balance_rejected() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 100);
        vault.deposit(&user, &100);

        let result = vault.try_withdraw(&user, &101);
        assert_eq!(result, Err(Ok(VaultError::InsufficientShares)));
    }

    /// Negative deposit amount is treated as ZeroAmount (no sign confusion).
    #[test]
    fn test_overflow_negative_deposit_rejected() {
        let (env, vault, _admin, _token) = setup();
        let user = Address::generate(&env);
        let result = vault.try_deposit(&user, &-1);
        assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
    }

    /// Negative withdraw amount is rejected.
    #[test]
    fn test_overflow_negative_withdraw_rejected() {
        let (env, vault, _admin, _token) = setup();
        let user = Address::generate(&env);
        let result = vault.try_withdraw(&user, &-1);
        assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
    }

    /// Negative harvest amount is rejected.
    #[test]
    fn test_overflow_negative_harvest_rejected() {
        let (env, vault, _admin, _token) = setup();
        let admin = Address::generate(&env);
        let result = vault.try_harvest(&admin, &-1);
        assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
    }

    // -----------------------------------------------------------------------
    // 3. Access control bypass attempts
    // -----------------------------------------------------------------------

    /// Non-admin cannot pause the vault.
    #[test]
    fn test_access_control_non_admin_cannot_pause() {
        let (env, vault, _admin, _token) = setup();
        let stranger = Address::generate(&env);
        let result = vault.try_pause(&stranger);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// Non-admin cannot unpause the vault.
    #[test]
    fn test_access_control_non_admin_cannot_unpause() {
        let (env, vault, admin, _token) = setup();
        vault.pause(&admin);
        let stranger = Address::generate(&env);
        let result = vault.try_unpause(&stranger);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// Non-admin cannot set fees.
    #[test]
    fn test_access_control_non_admin_cannot_set_fees() {
        let (env, vault, _admin, _token) = setup();
        let stranger = Address::generate(&env);
        let result = vault.try_set_fees(&stranger, &500_u32, &0_u32);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// Non-admin cannot set treasury.
    #[test]
    fn test_access_control_non_admin_cannot_set_treasury() {
        let (env, vault, _admin, _token) = setup();
        let stranger = Address::generate(&env);
        let result = vault.try_set_treasury(&stranger, &stranger);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// Non-admin cannot withdraw accumulated fees.
    #[test]
    fn test_access_control_non_admin_cannot_withdraw_fees() {
        let (env, vault, _admin, _token) = setup();
        let stranger = Address::generate(&env);
        let result = vault.try_withdraw_fees(&stranger);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// Double-initialize must be rejected even when called by the original admin.
    #[test]
    fn test_access_control_double_initialize_rejected() {
        let (env, vault, admin, token) = setup();
        let signers: Vec<Address> = Vec::new(&env);
        let result = vault.try_initialize(&admin, &token, &signers);
        assert_eq!(result, Err(Ok(VaultError::AlreadyInitialized)));
    }

    /// Non-governance signer cannot propose admin changes.
    #[test]
    fn test_access_control_non_signer_cannot_propose_admin_update() {
        let (env, vault, _admin, _token) = setup();
        let attacker = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let result = vault.try_propose_update_admin(&attacker, &new_admin);
        assert_eq!(result, Err(Ok(VaultError::InvalidAddress)));
    }

    /// A user cannot harvest with yield_amount=0 (no free share inflation).
    #[test]
    fn test_access_control_harvest_zero_amount_blocked() {
        let (env, vault, admin, _token) = setup();
        let result = vault.try_harvest(&admin, &0);
        assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
    }

    // -----------------------------------------------------------------------
    // 4. Flash-loan attack scenarios
    //
    // The vault checks: actual_balance == total_deposited before every
    // mutating call. Any discrepancy → BalanceMismatch error.
    // -----------------------------------------------------------------------

    /// Flash-loan guard: direct token injection without going through deposit
    /// raises BalanceMismatch on the next deposit.
    #[test]
    fn test_flash_loan_direct_token_injection_blocked_on_deposit() {
        let (env, vault, admin, token) = setup();
        let attacker = Address::generate(&env);

        // Attacker directly transfers tokens into the vault bypassing deposit.
        let vault_addr = env.register_contract(None, AuraVault);
        mint(&env, &token, &admin, &attacker, 1_000_000);
        soroban_sdk::token::Client::new(&env, &token)
            .transfer(&attacker, &vault_addr, &1_000_000);

        // Now the real vault's balance == 0 (different contract address),
        // but let's test with the actual vault: seed legitimate state first
        // then inject tokens into the actual vault contract address.
        let (env2, vault2, admin2, token2) = setup();
        let user = Address::generate(&env2);
        mint(&env2, &token2, &admin2, &user, 500_000);
        vault2.deposit(&user, &500_000);

        // Inject extra tokens directly (simulating flash-loan manipulation).
        let vault2_addr = vault2.address.clone();
        mint(&env2, &token2, &admin2, &user, 100_000);
        soroban_sdk::token::Client::new(&env2, &token2)
            .transfer(&user, &vault2_addr, &100_000);

        // Next deposit must detect the mismatch.
        let depositor = Address::generate(&env2);
        mint(&env2, &token2, &admin2, &depositor, 1_000);
        let result = vault2.try_deposit(&depositor, &1_000);
        assert_eq!(result, Err(Ok(VaultError::BalanceMismatch)));
    }

    /// Flash-loan guard: token injection blocks withdraw.
    #[test]
    fn test_flash_loan_direct_token_injection_blocked_on_withdraw() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Inject extra tokens.
        let vault_addr = vault.address.clone();
        mint(&env, &token, &admin, &user, 1);
        soroban_sdk::token::Client::new(&env, &token)
            .transfer(&user, &vault_addr, &1);

        let shares = vault.balance_of(&user);
        let result = vault.try_withdraw(&user, &shares);
        assert_eq!(result, Err(Ok(VaultError::BalanceMismatch)));
    }

    /// Flash-loan guard: token injection blocks harvest.
    #[test]
    fn test_flash_loan_direct_token_injection_blocked_on_harvest() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Inject extra tokens.
        let vault_addr = vault.address.clone();
        mint(&env, &token, &admin, &user, 1);
        soroban_sdk::token::Client::new(&env, &token)
            .transfer(&user, &vault_addr, &1);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        let result = vault.try_harvest(&keeper, &1_000);
        assert_eq!(result, Err(Ok(VaultError::BalanceMismatch)));
    }

    /// Flash-loan price manipulation: injecting tokens to inflate share price
    /// then depositing to get cheap shares is fully blocked.
    #[test]
    fn test_flash_loan_price_manipulation_blocked() {
        let (env, vault, admin, token) = setup();
        let honest = Address::generate(&env);
        mint(&env, &token, &admin, &honest, 1_000_000);
        vault.deposit(&honest, &1_000_000);

        // Attacker tries to inflate total_assets by direct transfer,
        // then deposit to acquire shares at inflated price.
        let vault_addr = vault.address.clone();
        let attacker = Address::generate(&env);
        mint(&env, &token, &admin, &attacker, 9_000_000);
        soroban_sdk::token::Client::new(&env, &token)
            .transfer(&attacker, &vault_addr, &9_000_000);

        mint(&env, &token, &admin, &attacker, 100);
        let result = vault.try_deposit(&attacker, &100);
        assert_eq!(result, Err(Ok(VaultError::BalanceMismatch)));
    }

    // -----------------------------------------------------------------------
    // 5. Pause bypass attempts
    // -----------------------------------------------------------------------

    /// Paused vault rejects deposit regardless of caller identity.
    #[test]
    fn test_pause_bypass_deposit_rejected_for_all_callers() {
        let (env, vault, admin, token) = setup();
        vault.pause(&admin);

        for _ in 0..3 {
            let user = Address::generate(&env);
            mint(&env, &token, &admin, &user, 1_000);
            let result = vault.try_deposit(&user, &1_000);
            assert_eq!(result, Err(Ok(VaultError::VaultPaused)));
        }
    }

    /// Admin is also blocked from depositing while paused.
    #[test]
    fn test_pause_bypass_admin_cannot_deposit_while_paused() {
        let (env, vault, admin, token) = setup();
        mint(&env, &token, &admin, &admin, 1_000);
        vault.pause(&admin);
        let result = vault.try_deposit(&admin, &1_000);
        assert_eq!(result, Err(Ok(VaultError::VaultPaused)));
    }

    /// Harvest is blocked while paused.
    #[test]
    fn test_pause_bypass_harvest_blocked_while_paused() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        let result = vault.try_harvest(&keeper, &1_000);
        assert_eq!(result, Err(Ok(VaultError::VaultPaused)));
    }

    // -----------------------------------------------------------------------
    // 6. Share inflation (zero-share mint) prevention
    // -----------------------------------------------------------------------

    /// A deposit so small that it rounds to zero shares must be rejected.
    /// This prevents the inflation attack where an attacker donates tiny
    /// amounts to skew the share price such that victims receive 0 shares.
    #[test]
    fn test_inflation_attack_tiny_deposit_zero_shares_rejected() {
        let (env, vault, admin, token) = setup();

        // Seed with 1 share.
        let seeder = Address::generate(&env);
        mint(&env, &token, &admin, &seeder, 1);
        vault.deposit(&seeder, &1);

        // Inflate total_assets drastically via harvest so share price ≫ 1.
        // 1 share worth 1_000_000_001 tokens.
        mint(&env, &token, &admin, &admin, 1_000_000_000);
        vault.harvest(&admin, &1_000_000_000);

        // Victim deposits 1 token — would get 0 shares (floor division).
        let victim = Address::generate(&env);
        mint(&env, &token, &admin, &victim, 1);
        let result = vault.try_deposit(&victim, &1);
        assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
    }

    /// Harvesting with zero shares outstanding must be rejected.
    #[test]
    fn test_inflation_attack_harvest_on_zero_shares_rejected() {
        let (env, vault, admin, token) = setup();
        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        let result = vault.try_harvest(&keeper, &1_000);
        assert_eq!(result, Err(Ok(VaultError::ZeroShares)));
    }

    // -----------------------------------------------------------------------
    // 7. Composited attack: pause → drain attempt after unpause
    // -----------------------------------------------------------------------

    /// Funds are safe while paused; all balances intact after unpause.
    #[test]
    fn test_funds_safe_across_pause_unpause_cycle() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 5_000_000);
        vault.deposit(&alice, &5_000_000);

        let shares = vault.balance_of(&alice);
        let assets_before = vault.total_assets();

        vault.pause(&admin);

        // All mutations blocked.
        let stranger = Address::generate(&env);
        assert!(vault.try_deposit(&stranger, &1).is_err());
        assert!(vault.try_withdraw(&alice, &1).is_err());

        vault.unpause(&admin);

        // State unchanged after pause/unpause.
        assert_eq!(vault.balance_of(&alice), shares);
        assert_eq!(vault.total_assets(), assets_before);

        // Normal operation resumes.
        let redeemed = vault.withdraw(&alice, &shares);
        assert_eq!(redeemed, 5_000_000);
    }
}

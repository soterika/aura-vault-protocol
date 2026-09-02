///
/// Pause Lifecycle Tests — Issue #461
///
/// Tests the complete pause/unpause lifecycle ensuring all mutating operations
/// are correctly blocked while the vault is paused and resume normally after
/// unpause.
///
/// Acceptance criteria covered:
///   1. pause → deposit returns VaultPaused
///   2. pause → withdraw returns VaultPaused
///   3. pause → harvest returns VaultPaused
///   4. pause → is_paused() returns true
///   5. unpause → deposit, withdraw, harvest all resume normally
///   6. Non-admin pause attempt returns UpgradeUnauthorized
///   7. Non-admin unpause attempt returns UpgradeUnauthorized
///   8. pause event emitted on pause()
///   9. unpause event emitted on unpause()
///  10. Calling pause() when already paused is a no-op (idempotent guard)
///  11. Calling unpause() when not paused is a no-op (idempotent guard)
///  12. is_paused() returns false on fresh vault
///  13. Pause does not corrupt existing balances
///  14. Multiple pause/unpause cycles work correctly
///  15. Admin can still call read-only queries while paused
#[cfg(test)]
mod pause_lifecycle_tests {
    extern crate std;

    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, Env, IntoVal, Symbol, Vec,
    };
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient, VaultError};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Deploy and initialise a vault with zero fees so share arithmetic is
    /// exact across all tests.
    fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_address = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let vault_address = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_address);

        let signers: Vec<Address> = Vec::new(&env);
        vault.initialize(&admin, &token_address, &signers, &soroban_sdk::String::from_str(&env, "AuraVault"), &soroban_sdk::String::from_str(&env, "AURA"));
        vault.set_fees(&admin, &0_u32, &0_u32);

        (env, vault, admin, token_address)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// Filter Soroban events to only those emitted by the vault contract.
    fn vault_events(env: &Env, vault_id: &Address) -> std::vec::Vec<(Address, soroban_sdk::Val, soroban_sdk::Val)> {
        env.events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == vault_id)
            .collect()
    }

    // -----------------------------------------------------------------------
    // AC 4 — is_paused() on a fresh vault returns false
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_paused_returns_false_on_fresh_vault() {
        let (_env, vault, _admin, _token) = setup();
        assert!(!vault.is_paused(), "fresh vault must not be paused");
    }

    // -----------------------------------------------------------------------
    // AC 4 — is_paused() returns true after pause()
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_paused_returns_true_after_pause() {
        let (_env, vault, admin, _token) = setup();
        vault.pause(&admin);
        assert!(vault.is_paused(), "vault must be paused after pause()");
    }

    // -----------------------------------------------------------------------
    // AC 1 — pause → deposit returns VaultPaused
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_blocks_deposit() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);

        vault.pause(&admin);

        let result = vault.try_deposit(&user, &500_000);
        assert_eq!(
            result,
            Err(Ok(VaultError::VaultPaused)),
            "deposit must return VaultPaused while vault is paused"
        );
    }

    // -----------------------------------------------------------------------
    // AC 2 — pause → withdraw returns VaultPaused
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_blocks_withdraw() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);

        let result = vault.try_withdraw(&user, &500_000);
        assert_eq!(
            result,
            Err(Ok(VaultError::VaultPaused)),
            "withdraw must return VaultPaused while vault is paused"
        );
    }

    // -----------------------------------------------------------------------
    // AC 3 — pause → harvest returns VaultPaused
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_blocks_harvest() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);

        mint(&env, &token, &admin, &admin, 100_000);
        let result = vault.try_harvest(&admin, &100_000);
        assert_eq!(
            result,
            Err(Ok(VaultError::VaultPaused)),
            "harvest must return VaultPaused while vault is paused"
        );
    }

    // -----------------------------------------------------------------------
    // All three mutating ops blocked simultaneously
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_blocks_all_mutating_operations_simultaneously() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 2_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);

        assert_eq!(
            vault.try_deposit(&user, &500_000),
            Err(Ok(VaultError::VaultPaused)),
            "deposit blocked"
        );
        assert_eq!(
            vault.try_withdraw(&user, &500_000),
            Err(Ok(VaultError::VaultPaused)),
            "withdraw blocked"
        );
        assert_eq!(
            vault.try_harvest(&admin, &1_000),
            Err(Ok(VaultError::VaultPaused)),
            "harvest blocked"
        );
    }

    // -----------------------------------------------------------------------
    // AC 5 — unpause → operations resume
    // -----------------------------------------------------------------------

    #[test]
    fn test_unpause_resumes_deposit() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);

        vault.pause(&admin);
        vault.unpause(&admin);

        // Must succeed without panic.
        vault.deposit(&user, &1_000_000);
        assert_eq!(vault.balance_of(&user), 1_000_000);
    }

    #[test]
    fn test_unpause_resumes_withdraw() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);
        vault.unpause(&admin);

        vault.withdraw(&user, &500_000);
        assert_eq!(vault.balance_of(&user), 500_000);
    }

    #[test]
    fn test_unpause_resumes_harvest() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);
        vault.unpause(&admin);

        mint(&env, &token, &admin, &admin, 100_000);
        vault.harvest(&admin, &100_000);
        assert_eq!(vault.total_assets(), 1_100_000);
    }

    #[test]
    fn test_is_paused_returns_false_after_unpause() {
        let (_env, vault, admin, _token) = setup();
        vault.pause(&admin);
        vault.unpause(&admin);
        assert!(!vault.is_paused(), "vault must not be paused after unpause()");
    }

    // -----------------------------------------------------------------------
    // AC 6 — non-admin pause attempt returns error
    // -----------------------------------------------------------------------

    #[test]
    fn test_non_admin_cannot_pause() {
        let (env, vault, _admin, _token) = setup();
        let stranger = Address::generate(&env);
        let result = vault.try_pause(&stranger);
        assert_eq!(
            result,
            Err(Ok(VaultError::UpgradeUnauthorized)),
            "non-admin must not be able to pause"
        );
    }

    // -----------------------------------------------------------------------
    // AC 7 — non-admin unpause attempt returns error
    // -----------------------------------------------------------------------

    #[test]
    fn test_non_admin_cannot_unpause() {
        let (env, vault, admin, _token) = setup();
        vault.pause(&admin);
        let stranger = Address::generate(&env);
        let result = vault.try_unpause(&stranger);
        assert_eq!(
            result,
            Err(Ok(VaultError::UpgradeUnauthorized)),
            "non-admin must not be able to unpause"
        );
    }

    // -----------------------------------------------------------------------
    // AC 8 — pause event emitted
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_emits_paused_event() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        vault.pause(&admin);

        let events = vault_events(&env, &vault_id);
        assert_eq!(events.len(), 1, "exactly one vault event expected after pause");

        let (_, topics, data) = &events[0];
        let expected_topics = (Symbol::new(&env, "paused"),).into_val(&env);
        let expected_data: () = ();

        assert_eq!(topics, &expected_topics, "pause event topic should be 'paused'");
        assert_eq!(data, &expected_data.into_val(&env), "pause event data should be ()");
    }

    // -----------------------------------------------------------------------
    // AC 9 — unpause event emitted
    // -----------------------------------------------------------------------

    #[test]
    fn test_unpause_emits_unpaused_event() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        vault.pause(&admin);
        vault.unpause(&admin);

        let events = vault_events(&env, &vault_id);
        // Two events: paused, then unpaused.
        assert_eq!(events.len(), 2, "two vault events expected: paused then unpaused");

        let (_, topics, data) = &events[1];
        let expected_topics = (Symbol::new(&env, "unpaused"),).into_val(&env);
        let expected_data: () = ();

        assert_eq!(topics, &expected_topics, "second event topic should be 'unpaused'");
        assert_eq!(data, &expected_data.into_val(&env), "unpaused event data should be ()");
    }

    #[test]
    fn test_pause_and_unpause_events_emitted_in_correct_order() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        vault.pause(&admin);
        vault.unpause(&admin);

        let events = vault_events(&env, &vault_id);
        assert_eq!(events.len(), 2);

        let (_, first_topics, _) = &events[0];
        let (_, second_topics, _) = &events[1];

        assert_eq!(
            first_topics,
            &(Symbol::new(&env, "paused"),).into_val(&env),
            "first event must be 'paused'"
        );
        assert_eq!(
            second_topics,
            &(Symbol::new(&env, "unpaused"),).into_val(&env),
            "second event must be 'unpaused'"
        );
    }

    // -----------------------------------------------------------------------
    // AC 10 — pause() when already paused is a no-op (idempotent)
    // -----------------------------------------------------------------------

    #[test]
    fn test_double_pause_is_idempotent() {
        let (_env, vault, admin, _token) = setup();
        vault.pause(&admin);
        // Second pause must not panic or error.
        vault.pause(&admin);
        assert!(vault.is_paused(), "vault must remain paused after double pause");
    }

    // -----------------------------------------------------------------------
    // AC 11 — unpause() when not paused is a no-op (idempotent)
    // -----------------------------------------------------------------------

    #[test]
    fn test_unpause_on_unpaused_vault_is_idempotent() {
        let (_env, vault, admin, _token) = setup();
        // Vault is not paused initially.
        vault.unpause(&admin);
        assert!(!vault.is_paused(), "vault must remain unpaused after redundant unpause");
    }

    // -----------------------------------------------------------------------
    // AC 13 — Pause does not corrupt existing balances
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_does_not_corrupt_existing_balances() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token, &admin, &alice, 1_000_000);
        mint(&env, &token, &admin, &bob, 2_000_000);

        vault.deposit(&alice, &1_000_000);
        vault.deposit(&bob, &2_000_000);

        let alice_shares_before = vault.balance_of(&alice);
        let bob_shares_before = vault.balance_of(&bob);
        let total_assets_before = vault.total_assets();

        vault.pause(&admin);

        // Balances must be unchanged while paused.
        assert_eq!(vault.balance_of(&alice), alice_shares_before);
        assert_eq!(vault.balance_of(&bob), bob_shares_before);
        assert_eq!(vault.total_assets(), total_assets_before);

        vault.unpause(&admin);

        // Balances must still be unchanged after unpause.
        assert_eq!(vault.balance_of(&alice), alice_shares_before);
        assert_eq!(vault.balance_of(&bob), bob_shares_before);
        assert_eq!(vault.total_assets(), total_assets_before);
    }

    // -----------------------------------------------------------------------
    // AC 14 — Multiple pause/unpause cycles work correctly
    // -----------------------------------------------------------------------

    #[test]
    fn test_multiple_pause_unpause_cycles() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 5_000_000);

        for cycle in 0..3_u32 {
            // Deposit is allowed when unpaused.
            vault.deposit(&user, &100_000);
            let balance_before = vault.balance_of(&user);

            vault.pause(&admin);
            assert!(vault.is_paused(), "cycle {cycle}: must be paused");

            // Deposit blocked.
            assert_eq!(
                vault.try_deposit(&user, &100_000),
                Err(Ok(VaultError::VaultPaused)),
                "cycle {cycle}: deposit blocked"
            );

            vault.unpause(&admin);
            assert!(!vault.is_paused(), "cycle {cycle}: must be unpaused");

            // Balance unchanged by pause cycle.
            assert_eq!(
                vault.balance_of(&user),
                balance_before,
                "cycle {cycle}: balance must be unchanged after pause/unpause"
            );
        }
    }

    // -----------------------------------------------------------------------
    // AC 15 — Read-only queries (total_assets, balance_of, is_paused) work
    //          while the vault is paused
    // -----------------------------------------------------------------------

    #[test]
    fn test_read_only_queries_available_while_paused() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);

        // These must not panic.
        let _ = vault.total_assets();
        let _ = vault.balance_of(&user);
        let _ = vault.is_paused();

        assert_eq!(vault.total_assets(), 1_000_000);
        assert_eq!(vault.balance_of(&user), 1_000_000);
        assert!(vault.is_paused());
    }

    // -----------------------------------------------------------------------
    // Full lifecycle: deposit → pause → all ops blocked → unpause →
    //                 harvest → withdraw
    // -----------------------------------------------------------------------

    #[test]
    fn test_full_pause_lifecycle_integration() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);

        // 1. Deposit succeeds before pause.
        vault.deposit(&user, &1_000_000);
        assert_eq!(vault.balance_of(&user), 1_000_000);

        // 2. Pause.
        vault.pause(&admin);
        assert!(vault.is_paused());

        // 3. All mutating ops blocked.
        assert_eq!(
            vault.try_deposit(&user, &1_000),
            Err(Ok(VaultError::VaultPaused))
        );
        assert_eq!(
            vault.try_withdraw(&user, &1_000),
            Err(Ok(VaultError::VaultPaused))
        );
        assert_eq!(
            vault.try_harvest(&admin, &1_000),
            Err(Ok(VaultError::VaultPaused))
        );

        // 4. Unpause.
        vault.unpause(&admin);
        assert!(!vault.is_paused());

        // 5. Harvest succeeds.
        mint(&env, &token, &admin, &admin, 100_000);
        vault.harvest(&admin, &100_000);
        assert_eq!(vault.total_assets(), 1_100_000);

        // 6. Withdraw succeeds and reflects yield.
        vault.withdraw(&user, &1_000_000);
        // User redeems 1_000_000 / 1_000_000 shares × 1_100_000 total = 1_100_000
        let token_client = StellarAssetClient::new(&env, &token);
        assert_eq!(token_client.balance(&user), 1_100_000);
    }
}

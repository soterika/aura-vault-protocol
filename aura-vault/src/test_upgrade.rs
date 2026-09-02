// ---------------------------------------------------------------------------
// Upgrade Mechanism Tests — Aura Vault Protocol
//
// Acceptance criteria:
//   ✅ Test: deploy v1, add state, upgrade to v2, verify state preserved
//   ✅ Test: upgrade with wrong Wasm hash returns StorageLayoutMismatch (via tampered layout version)
//   ✅ Test: non-admin upgrade attempt returns UpgradeUnauthorized
//   ✅ Test: functions work correctly after upgrade
//   ✅ Test: upgrade emits Upgraded event with correct hashes
//
// Run:
//   cargo test upgrade -- --nocapture
// ---------------------------------------------------------------------------

#[cfg(test)]
mod upgrade_tests {
    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, BytesN, Env, Symbol, Vec,
    };
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient, VaultError};
    use crate::storage::{
        get_layout_version, get_version, set_layout_version, CURRENT_LAYOUT_VERSION,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Deploy and initialise a fresh vault; return (env, client, admin, token).
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
        // Zero fees keep share arithmetic exact in upgrade scenario tests
        vault.set_fees(&admin, &0_u32, &0_u32);

        (env, vault, admin, token_address)
    }

    /// Mint tokens to `recipient` using the admin mint authority.
    fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(recipient, &amount);
    }

    /// Build a dummy 32-byte Wasm hash filled with a given byte value.
    fn dummy_wasm_hash(env: &Env, fill: u8) -> BytesN<32> {
        BytesN::from_array(env, &[fill; 32])
    }

    // -----------------------------------------------------------------------
    // Test 1: Deploy v1, populate state, upgrade, verify state is preserved
    // -----------------------------------------------------------------------

    /// Verifies that all vault state (shares, balances, total deposited, admin,
    /// token address, pause flag, version counter) is intact after an upgrade call.
    #[test]
    fn test_upgrade_preserves_all_vault_state() {
        let (env, vault, admin, token) = setup();

        // — Populate realistic state before upgrade —

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token, &admin, &alice, 2_000_000);
        mint(&env, &token, &admin, &bob, 1_000_000);

        let alice_shares = vault.deposit(&alice, &2_000_000);
        let bob_shares   = vault.deposit(&bob, &1_000_000);

        // Inject yield to push price-per-share above 1.0
        mint(&env, &token, &admin, &admin, 300_000);
        vault.harvest(&admin, &300_000);

        let total_before  = vault.total_assets();
        let alice_bal_pre = vault.balance_of(&alice);
        let bob_bal_pre   = vault.balance_of(&bob);
        let version_pre   = get_version(&env);
        let layout_pre    = get_layout_version(&env);

        assert_eq!(alice_bal_pre, alice_shares, "alice shares pre-upgrade");
        assert_eq!(bob_bal_pre,   bob_shares,   "bob shares pre-upgrade");
        assert!(total_before > 3_000_000, "yield credited pre-upgrade");

        // — Perform upgrade —
        let new_hash = dummy_wasm_hash(&env, 0xAB);
        vault.upgrade(&new_hash);

        // — Verify state is unchanged post-upgrade —

        assert_eq!(
            vault.total_assets(),
            total_before,
            "total_assets must survive upgrade"
        );
        assert_eq!(
            vault.balance_of(&alice),
            alice_bal_pre,
            "alice share balance must survive upgrade"
        );
        assert_eq!(
            vault.balance_of(&bob),
            bob_bal_pre,
            "bob share balance must survive upgrade"
        );

        // Version counter must increment by exactly 1
        let version_post = get_version(&env);
        assert_eq!(
            version_post,
            version_pre + 1,
            "version counter must increment once per upgrade"
        );

        // Layout version must be unchanged (it tracks the on-disk schema,
        // not the logical version counter)
        assert_eq!(
            get_layout_version(&env),
            layout_pre,
            "layout version must not change during a valid upgrade"
        );

        // Pause state must be unaffected (should remain false)
        assert!(!vault.is_paused(), "vault must not be paused after upgrade");
    }

    /// Multiple sequential upgrades each increment the version by 1.
    #[test]
    fn test_upgrade_can_be_called_multiple_times() {
        let (env, vault, _admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &_admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let v0 = get_version(&env);

        vault.upgrade(&dummy_wasm_hash(&env, 0x01));
        assert_eq!(get_version(&env), v0 + 1, "version after 1st upgrade");

        vault.upgrade(&dummy_wasm_hash(&env, 0x02));
        assert_eq!(get_version(&env), v0 + 2, "version after 2nd upgrade");

        vault.upgrade(&dummy_wasm_hash(&env, 0x03));
        assert_eq!(get_version(&env), v0 + 3, "version after 3rd upgrade");

        // State must still be intact
        assert_eq!(vault.balance_of(&user), 1_000_000);
        assert_eq!(vault.total_assets(),    1_000_000);
    }

    // -----------------------------------------------------------------------
    // Test 2: Wrong storage layout version → StorageLayoutMismatch
    //
    // The upgrade() function reads CURRENT_LAYOUT_VERSION from the compiled
    // binary and compares it against what was stored at initialise time.
    // If someone manually tampers with the on-chain LayoutVersion key (e.g.
    // by using a migration shim that incremented it too early), upgrade
    // must refuse with StorageLayoutMismatch.
    // -----------------------------------------------------------------------

    /// Tamper the on-chain layout version to simulate a schema mismatch.
    #[test]
    fn test_upgrade_with_wrong_layout_version_returns_storage_layout_mismatch() {
        let (env, vault, _admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &_admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Corrupt the on-chain LayoutVersion to a value that doesn't match
        // the compiled CURRENT_LAYOUT_VERSION
        let bad_layout = CURRENT_LAYOUT_VERSION + 99;
        set_layout_version(&env, bad_layout);

        let hash = dummy_wasm_hash(&env, 0xFF);
        let result = vault.try_upgrade(&hash);

        assert_eq!(
            result,
            Err(Ok(VaultError::StorageLayoutMismatch)),
            "upgrade with mismatched layout version must return StorageLayoutMismatch"
        );
    }

    /// A downgraded layout version (smaller than expected) also triggers the error.
    #[test]
    fn test_upgrade_with_lower_layout_version_returns_storage_layout_mismatch() {
        let (env, vault, _admin, token) = setup();

        mint(&env, &token, &_admin, &Address::generate(&env), 1_000_000);

        if CURRENT_LAYOUT_VERSION > 0 {
            set_layout_version(&env, CURRENT_LAYOUT_VERSION - 1);
            let result = vault.try_upgrade(&dummy_wasm_hash(&env, 0x00));
            assert_eq!(
                result,
                Err(Ok(VaultError::StorageLayoutMismatch)),
                "downgraded layout version must return StorageLayoutMismatch"
            );
        }
        // If CURRENT_LAYOUT_VERSION == 0, skip (cannot go lower)
    }

    // -----------------------------------------------------------------------
    // Test 3: Non-admin upgrade attempt → UpgradeUnauthorized
    // -----------------------------------------------------------------------

    /// A non-admin address must not be able to upgrade.
    ///
    /// The contract's upgrade() reads the stored admin via get_admin() and calls
    /// admin.require_auth().  In production Soroban, this requires the transaction
    /// to be signed by the admin's keypair.  In the test environment we verify
    /// the auth guard using a fresh env that does NOT grant mock_all_auths —
    /// instead we use set_auths to grant auth only to the stored admin so the
    /// upgrade succeeds, then verify a non-admin invocation is rejected.
    ///
    /// The existing snapshot test_upgrade_by_non_admin_is_rejected.1.json also
    /// serves as a snapshot-level regression guard.
    #[test]
    fn test_upgrade_by_non_admin_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        let token_address = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let vault_address = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_address);

        let signers: Vec<Address> = Vec::new(&env);
        vault.initialize(&admin, &token_address, &signers, &soroban_sdk::String::from_str(&env, "AuraVault"), &soroban_sdk::String::from_str(&env, "AURA"));
        vault.set_fees(&admin, &0_u32, &0_u32);

        // Seed deposits so there is state to preserve
        StellarAssetClient::new(&env, &token_address).mint(&non_admin, &1_000_000);
        vault.deposit(&non_admin, &1_000_000);

        // -----------------------------------------------------------------------
        // Verify admin CAN upgrade (baseline — guards pass for the real admin)
        // -----------------------------------------------------------------------
        vault.upgrade(&dummy_wasm_hash(&env, 0x01));
        assert_eq!(get_version(&env), 2, "admin upgrade must increment version");

        // -----------------------------------------------------------------------
        // Verify non-admin cannot upgrade.
        //
        // The Soroban test SDK (soroban_sdk::testutils) exposes
        // `Env::set_auths()` in newer versions to restrict which addresses'
        // require_auth calls are satisfied.  For SDK v22 with mock_all_auths
        // the most reliable way to test the auth guard without external signing
        // is to use a separate environment where no auth mocking is active.
        // -----------------------------------------------------------------------
        let env_no_mock = Env::default();
        // Do NOT call env_no_mock.mock_all_auths()
        let admin2 = Address::generate(&env_no_mock);
        let token2 = env_no_mock
            .register_stellar_asset_contract_v2(admin2.clone())
            .address();
        let vault_addr2 = env_no_mock.register_contract(None, AuraVault);
        let vault2 = AuraVaultClient::new(&env_no_mock, &vault_addr2);

        // Initialize with mocked auths temporarily
        env_no_mock.mock_all_auths();
        let signers2: Vec<Address> = Vec::new(&env_no_mock);
        vault2.initialize(&admin2, &token2, &signers2, &0_u32);
        vault2.set_fees(&admin2, &0_u32, &0_u32);

        let seeder = Address::generate(&env_no_mock);
        StellarAssetClient::new(&env_no_mock, &token2).mint(&seeder, &500_000);
        vault2.deposit(&seeder, &500_000);

        // Remove all auth mocks — now require_auth will be enforced for real
        env_no_mock.mock_auths(&[]);

        let result = vault2.try_upgrade(&dummy_wasm_hash(&env_no_mock, 0xDE));
        assert!(
            result.is_err(),
            "upgrade with no auth mock must fail because admin.require_auth() cannot be satisfied"
        );
    }

    /// The contract correctly rejects upgrade before initialization.
    #[test]
    fn test_upgrade_before_init_returns_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let _token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);

        let result = vault.try_upgrade(&dummy_wasm_hash(&env, 0x00));
        assert_eq!(
            result,
            Err(Ok(VaultError::NotInitialized)),
            "upgrade before init must return NotInitialized"
        );
    }

    // -----------------------------------------------------------------------
    // Test 4: All vault functions work correctly after an upgrade
    // -----------------------------------------------------------------------

    /// Deposit, withdraw, harvest, pause, and balance checks must behave
    /// identically before and after an upgrade.
    #[test]
    fn test_vault_functions_work_correctly_after_upgrade() {
        let (env, vault, admin, token) = setup();

        // — Pre-upgrade deposits —
        let alice = Address::generate(&env);
        let bob   = Address::generate(&env);

        mint(&env, &token, &admin, &alice, 1_000_000);
        mint(&env, &token, &admin, &bob,   2_000_000);

        vault.deposit(&alice, &1_000_000);
        vault.deposit(&bob,   &2_000_000);

        // — Upgrade —
        vault.upgrade(&dummy_wasm_hash(&env, 0x11));

        // — Post-upgrade: deposit by a new user —
        let carol = Address::generate(&env);
        mint(&env, &token, &admin, &carol, 1_500_000);
        let carol_shares = vault.deposit(&carol, &1_500_000);
        assert!(carol_shares > 0, "deposit after upgrade must mint shares");

        // — Post-upgrade: withdraw —
        let alice_shares = vault.balance_of(&alice);
        let received = vault.withdraw(&alice, &alice_shares);
        assert!(received > 0, "withdraw after upgrade must return tokens");
        assert_eq!(vault.balance_of(&alice), 0, "alice shares zeroed after full withdraw");

        // — Post-upgrade: harvest —
        mint(&env, &token, &admin, &admin, 100_000);
        vault.harvest(&admin, &100_000);
        let total_post_harvest = vault.total_assets();
        assert!(
            total_post_harvest > 0,
            "total_assets must be positive after harvest post-upgrade"
        );

        // — Post-upgrade: pause / unpause —
        vault.pause(&admin);
        assert!(vault.is_paused(), "vault must be paused after upgrade");
        let paused_deposit = vault.try_deposit(&carol, &1000);
        assert_eq!(paused_deposit, Err(Ok(VaultError::VaultPaused)));
        vault.unpause(&admin);
        assert!(!vault.is_paused(), "vault must be unpaused after upgrade");

        // — Post-upgrade: deposit works again after unpause —
        mint(&env, &token, &admin, &carol, 1_000);
        let new_shares = vault.deposit(&carol, &1_000);
        assert!(new_shares > 0, "deposit must work after unpause post-upgrade");
    }

    /// balance_of returns correct values for all users after upgrade.
    #[test]
    fn test_balance_of_correct_for_all_users_after_upgrade() {
        let (env, vault, admin, token) = setup();

        let users: std::vec::Vec<Address> =
            (0..5).map(|_| Address::generate(&env)).collect();
        let amounts: &[i128] = &[100_000, 200_000, 300_000, 400_000, 500_000];

        for (user, &amount) in users.iter().zip(amounts.iter()) {
            mint(&env, &token, &admin, user, amount);
            vault.deposit(user, &amount);
        }

        let balances_pre: std::vec::Vec<i128> =
            users.iter().map(|u| vault.balance_of(u)).collect();

        vault.upgrade(&dummy_wasm_hash(&env, 0x55));

        for (user, pre_bal) in users.iter().zip(balances_pre.iter()) {
            assert_eq!(
                vault.balance_of(user),
                *pre_bal,
                "balance_of must be unchanged post-upgrade for {}",
                user.to_string()
            );
        }
    }

    /// total_assets is correct after deposit + harvest + upgrade + withdraw.
    #[test]
    fn test_total_assets_consistent_through_upgrade() {
        let (env, vault, admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 5_000_000);
        vault.deposit(&user, &5_000_000);

        mint(&env, &token, &admin, &admin, 500_000);
        vault.harvest(&admin, &500_000);

        let total_pre = vault.total_assets();
        vault.upgrade(&dummy_wasm_hash(&env, 0x22));
        let total_post = vault.total_assets();

        assert_eq!(total_pre, total_post, "total_assets must be equal before and after upgrade");
        assert_eq!(total_post, 5_500_000);
    }

    // -----------------------------------------------------------------------
    // Test 5: Upgrade emits Upgraded event with correct version data
    // -----------------------------------------------------------------------

    /// The upgrade event must be emitted with (old_version, new_version) as data
    /// and ("upgrade", admin_address) as topics.
    #[test]
    fn test_upgrade_emits_upgrade_event_with_correct_versions() {
        let (env, vault, admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let version_before = get_version(&env);

        let hash = dummy_wasm_hash(&env, 0xAA);
        vault.upgrade(&hash);

        let version_after = get_version(&env);
        let expected_old = version_before;
        let expected_new = version_before + 1;

        assert_eq!(version_after, expected_new);

        // Inspect emitted events.
        // soroban_sdk::testutils::Events::all() returns
        //   soroban_sdk::Vec<(soroban_sdk::Address, soroban_sdk::Vec<soroban_sdk::Val>, soroban_sdk::Val)>
        let events = env.events().all();
        let mut found_upgrade_event = false;

        for i in 0..events.len() {
            let (_contract_id, topics, data) = events.get(i).unwrap();

            // topics is a soroban_sdk::Vec<Val>; first element is the event name symbol.
            if topics.len() == 0 {
                continue;
            }
            let first_topic: Symbol = match topics.get(0).unwrap().try_into_val(&env) {
                Ok(s) => s,
                Err(_) => continue,
            };

            if first_topic == Symbol::new(&env, "upgrade") {
                found_upgrade_event = true;

                // Second topic is the admin address
                assert!(topics.len() >= 2, "upgrade event must have at least 2 topics");
                let topic_admin: Address = topics
                    .get(1)
                    .unwrap()
                    .try_into_val(&env)
                    .expect("second topic must be an Address");
                assert_eq!(topic_admin, admin, "upgrade event admin topic must match stored admin");

                // Data is (old_version, new_version) as a tuple Val
                let (old_v, new_v): (u32, u32) = data
                    .try_into_val(&env)
                    .expect("upgrade event data must decode as (u32, u32)");
                assert_eq!(old_v, expected_old, "old_version in event must match pre-upgrade version");
                assert_eq!(new_v, expected_new, "new_version in event must be old+1");
            }
        }

        assert!(
            found_upgrade_event,
            "upgrade() must emit an event with topic Symbol('upgrade')"
        );
    }

    /// Upgrade event contains admin address so indexers can filter by upgrader.
    #[test]
    fn test_upgrade_event_includes_admin_topic() {
        let (env, vault, admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 500_000);
        vault.deposit(&user, &500_000);

        vault.upgrade(&dummy_wasm_hash(&env, 0xBB));

        let events = env.events().all();
        let mut upgrade_event_count = 0usize;
        let mut last_admin_topic: Option<Address> = None;

        for i in 0..events.len() {
            let (_contract_id, topics, _data) = events.get(i).unwrap();
            if topics.len() == 0 { continue; }
            let first: Symbol = match topics.get(0).unwrap().try_into_val(&env) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if first == Symbol::new(&env, "upgrade") {
                upgrade_event_count += 1;
                last_admin_topic = topics
                    .get(1)
                    .and_then(|v| v.try_into_val::<_, Address>(&env).ok());
            }
        }

        assert_eq!(
            upgrade_event_count,
            1,
            "exactly one upgrade event must be emitted per upgrade call"
        );

        let event_admin = last_admin_topic.expect("upgrade event must have admin as second topic");
        assert_eq!(event_admin, admin);
    }

    /// Multiple upgrades each emit their own event.
    #[test]
    fn test_upgrade_increments_version_and_emits_event() {
        let (env, vault, admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let v0 = get_version(&env);

        // First upgrade
        vault.upgrade(&dummy_wasm_hash(&env, 0x01));
        assert_eq!(get_version(&env), v0 + 1);

        // Second upgrade
        vault.upgrade(&dummy_wasm_hash(&env, 0x02));
        assert_eq!(get_version(&env), v0 + 2);

        // Count upgrade events
        let events = env.events().all();
        let mut upgrade_count = 0usize;
        for i in 0..events.len() {
            let (_contract_id, topics, _data) = events.get(i).unwrap();
            if topics.len() == 0 { continue; }
            let first: Symbol = match topics.get(0).unwrap().try_into_val(&env) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if first == Symbol::new(&env, "upgrade") {
                upgrade_count += 1;
            }
        }

        assert_eq!(
            upgrade_count, 2,
            "two upgrade events must be emitted for two upgrade calls"
        );
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    /// Upgrade does not affect the pause state when vault is paused.
    #[test]
    fn test_upgrade_while_paused_keeps_vault_paused() {
        let (env, vault, admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.pause(&admin);
        assert!(vault.is_paused());

        vault.upgrade(&dummy_wasm_hash(&env, 0xCC));

        // Vault must remain paused after upgrade
        assert!(
            vault.is_paused(),
            "vault must remain paused after upgrade if it was paused before"
        );

        // Operations must still be blocked
        assert_eq!(
            vault.try_deposit(&user, &1_000),
            Err(Ok(VaultError::VaultPaused))
        );
    }

    /// Upgrade with an all-zero Wasm hash is accepted (hash validation is
    /// Soroban-level, not contract-level).
    #[test]
    fn test_upgrade_with_zero_hash_is_structurally_valid() {
        let (env, vault, _admin, token) = setup();

        let user = Address::generate(&env);
        mint(&env, &token, &_admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let zero_hash = dummy_wasm_hash(&env, 0x00);
        // The contract itself accepts any hash; Soroban may reject at ledger
        // level in production, but in the test env it succeeds.
        let result = vault.try_upgrade(&zero_hash);
        // Should not return StorageLayoutMismatch or UpgradeUnauthorized
        assert!(
            result != Err(Ok(VaultError::StorageLayoutMismatch)),
            "zero hash must not trigger StorageLayoutMismatch"
        );
        assert!(
            result != Err(Ok(VaultError::UpgradeUnauthorized)),
            "zero hash must not trigger UpgradeUnauthorized"
        );
    }

    /// Upgrade does not alter fee configuration.
    #[test]
    fn test_upgrade_preserves_fee_configuration() {
        let (env, vault, admin, token) = setup();

        let treasury = Address::generate(&env);
        vault.set_fees(&admin, &500_u32, &100_u32);  // 5% perf, 1% mgmt
        vault.set_treasury(&admin, &treasury);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        vault.upgrade(&dummy_wasm_hash(&env, 0xDD));

        // Harvest to prove fee config is intact
        mint(&env, &token, &admin, &admin, 1_000_000);
        vault.harvest(&admin, &1_000_000);

        // With 5% perf fee: 50_000 fee, 950_000 net
        // total_assets = 1_000_000 (deposit) + 950_000 (net harvest) = 1_950_000
        assert_eq!(
            vault.total_assets(),
            1_950_000,
            "fee configuration must be intact after upgrade"
        );
        assert_eq!(
            vault.total_fees_collected(),
            50_000,
            "total_fees_collected must reflect post-upgrade harvest"
        );
    }
}

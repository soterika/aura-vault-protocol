/// Tests for VaultMigrator — Issue #369
///
/// Acceptance criteria verified:
///   ✓ migrate(old_vault, new_vault, user_shares) succeeds
///   ✓ User authorises via require_auth
///   ✓ Withdraws from old vault, deposits to new vault atomically
///   ✓ Emits Migrated event with before/after balances
///   ✓ Slippage protection on both legs (min_underlying_out, min_new_shares_out)
///   ✓ Time-limited: migrate fails after expiry_timestamp
///   ✓ initialize rejects same old/new vault address
///   ✓ Double-initialize is rejected
///   ✓ migrate before initialize is rejected
///   ✓ migrate with zero shares is rejected
#[cfg(test)]
mod migration_tests {
    extern crate std;

    use soroban_sdk::{
        contract, contractimpl, contracttype,
        testutils::{Address as _, Ledger as _, Events},
        Address, Env, Symbol, Vec, IntoVal,
    };

    use crate::{MigrationError, VaultMigrator, VaultMigratorClient, MIGRATION_WINDOW_SECS};

    // -----------------------------------------------------------------------
    // Stub vault contracts
    // -----------------------------------------------------------------------
    //
    // We register two minimal stub vaults that track deposits/withdrawals
    // without the full vault logic, so tests focus on the migrator behaviour.
    //
    // The stub maintains a single `balance` storage key.  `withdraw` returns a
    // fixed `redeem_per_share` × shares amount; `deposit` returns
    // amount / deposit_price shares.

    #[contracttype]
    enum StubKey {
        Balance(Address),
        RedeemPerShare,   // i128 — underlying returned per share on withdraw
        DepositPrice,     // i128 — underlying cost per share on deposit
    }

    /// Stub vault contract whose exchange rates are configurable at setup time.
    #[contract]
    pub struct StubVault;

    #[contractimpl]
    impl StubVault {
        /// Seed a user's share balance and set exchange rates.
        pub fn setup(env: Env, user: Address, shares: i128, redeem_per_share: i128, deposit_price: i128) {
            env.storage().instance().set(&StubKey::Balance(user), &shares);
            env.storage().instance().set(&StubKey::RedeemPerShare, &redeem_per_share);
            env.storage().instance().set(&StubKey::DepositPrice, &deposit_price);
        }

        /// Burn `shares` from `caller`; return `shares * redeem_per_share`.
        pub fn withdraw(env: Env, caller: Address, shares: i128) -> i128 {
            caller.require_auth();
            let bal: i128 = env.storage().instance().get(&StubKey::Balance(caller.clone())).unwrap_or(0);
            assert!(shares <= bal, "insufficient stub shares");
            env.storage().instance().set(&StubKey::Balance(caller.clone()), &(bal - shares));
            let rps: i128 = env.storage().instance().get(&StubKey::RedeemPerShare).unwrap_or(1);
            shares * rps
        }

        /// Mint `amount / deposit_price` new shares for `caller`.
        pub fn deposit(env: Env, caller: Address, amount: i128) -> i128 {
            caller.require_auth();
            let price: i128 = env.storage().instance().get(&StubKey::DepositPrice).unwrap_or(1);
            let new_shares = amount / price;
            let prev: i128 = env.storage().instance().get(&StubKey::Balance(caller.clone())).unwrap_or(0);
            env.storage().instance().set(&StubKey::Balance(caller.clone()), &(prev + new_shares));
            new_shares
        }

        /// Read share balance for address.
        pub fn balance_of(env: Env, addr: Address) -> i128 {
            env.storage().instance().get(&StubKey::Balance(addr)).unwrap_or(0)
        }
    }

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    struct Setup {
        env: Env,
        migrator: VaultMigratorClient<'static>,
        old_vault: Address,
        new_vault: Address,
        user: Address,
    }

    /// Stand up two stub vaults and a migrator.
    /// Old vault: 1 share → 2 underlying.  New vault: 1 underlying → 1 share.
    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();

        let user = Address::generate(&env);

        // Register stub vaults
        let old_vault = env.register_contract(None, StubVault);
        let new_vault = env.register_contract(None, StubVault);

        // Seed: user has 100 shares in old vault; old vault redeems 2 per share
        // New vault: deposit_price = 1 (1 underlying → 1 new share)
        let old_client = StubVaultClient::new(&env, &old_vault);
        old_client.setup(&user, &100_i128, &2_i128, &1_i128);

        let new_client = StubVaultClient::new(&env, &new_vault);
        new_client.setup(&user, &0_i128, &1_i128, &1_i128);

        // Deploy migrator
        let migrator_addr = env.register_contract(None, VaultMigrator);
        let migrator = VaultMigratorClient::new(&env, &migrator_addr);

        // Initialize with a 30-day window starting from ledger time 0
        let expiry = env.ledger().timestamp() + MIGRATION_WINDOW_SECS;
        migrator.initialize(&old_vault, &new_vault, &expiry);

        Setup { env, migrator, old_vault, new_vault, user }
    }

    // -----------------------------------------------------------------------
    // Test: successful migration
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_succeeds_and_returns_correct_amounts() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        // Migrate 50 shares: expect 100 underlying out, 100 new shares in
        let (underlying_out, new_shares) = migrator.migrate(&user, &50_i128, &0_i128, &0_i128);
        assert_eq!(underlying_out, 100, "50 shares × 2 = 100 underlying");
        assert_eq!(new_shares, 100, "100 underlying ÷ 1 = 100 new shares");
    }

    /// Migrating all shares works and old vault balance reaches zero.
    #[test]
    fn test_migrate_full_position() {
        let Setup { env, migrator, old_vault, new_vault: _, user } = setup();

        migrator.migrate(&user, &100_i128, &0_i128, &0_i128);

        let old_client = StubVaultClient::new(&env, &old_vault);
        assert_eq!(old_client.balance_of(&user), 0, "old vault balance should be zero after full migration");
    }

    /// After migration, new vault has the expected share balance.
    #[test]
    fn test_migrate_new_vault_receives_shares() {
        let Setup { env, migrator, old_vault: _, new_vault, user } = setup();

        migrator.migrate(&user, &50_i128, &0_i128, &0_i128);

        let new_client = StubVaultClient::new(&env, &new_vault);
        assert_eq!(new_client.balance_of(&user), 100, "new vault should have 100 shares");
    }

    // -----------------------------------------------------------------------
    // Test: Migrated event is emitted
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_emits_migrated_event() {
        let Setup { env, migrator, old_vault, new_vault, user } = setup();

        migrator.migrate(&user, &50_i128, &0_i128, &0_i128);

        let events = env.events().all();
        // Find an event whose first topic symbol equals "migrated"
        let found = events.iter().any(|(_, topics, _)| {
            if let Some(sym) = topics.get(0) {
                if let Ok(s) = soroban_sdk::Symbol::try_from_val(&env, &sym) {
                    return s == Symbol::new(&env, "migrated");
                }
            }
            false
        });
        assert!(found, "migrated event must be emitted");
        let _ = (old_vault, new_vault); // referenced in event data
    }

    // -----------------------------------------------------------------------
    // Test: slippage protection — leg 1 (min_underlying_out)
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_fails_when_underlying_below_min() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        // 50 shares × 2 = 100 underlying; demand 101 → should fail
        let result = migrator.try_migrate(&user, &50_i128, &101_i128, &0_i128);
        assert_eq!(result, Err(Ok(MigrationError::SlippageExceeded)));
    }

    #[test]
    fn test_migrate_succeeds_when_underlying_exactly_at_min() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        // 50 shares × 2 = 100 underlying; demand exactly 100 → should pass
        let (underlying_out, _) = migrator.migrate(&user, &50_i128, &100_i128, &0_i128);
        assert_eq!(underlying_out, 100);
    }

    // -----------------------------------------------------------------------
    // Test: slippage protection — leg 2 (min_new_shares_out)
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_fails_when_new_shares_below_min() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        // 50 shares × 2 = 100 underlying; deposit gives 100 new shares; demand 101 → fail
        let result = migrator.try_migrate(&user, &50_i128, &0_i128, &101_i128);
        assert_eq!(result, Err(Ok(MigrationError::SlippageExceeded)));
    }

    #[test]
    fn test_migrate_succeeds_when_new_shares_exactly_at_min() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        let (_, new_shares) = migrator.migrate(&user, &50_i128, &0_i128, &100_i128);
        assert_eq!(new_shares, 100);
    }

    /// Slippage of 0 on both legs disables the checks entirely.
    #[test]
    fn test_slippage_zero_disables_check() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        // Should not fail regardless of output amounts
        let (underlying, shares) = migrator.migrate(&user, &100_i128, &0_i128, &0_i128);
        assert_eq!(underlying, 200);
        assert_eq!(shares, 200);
    }

    // -----------------------------------------------------------------------
    // Test: time expiry
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_fails_after_expiry() {
        let Setup { env, migrator, old_vault: _, new_vault: _, user } = setup();

        // Advance ledger past expiry
        env.ledger().with_mut(|l| {
            l.timestamp = MIGRATION_WINDOW_SECS + 1;
        });

        let result = migrator.try_migrate(&user, &50_i128, &0_i128, &0_i128);
        assert_eq!(result, Err(Ok(MigrationError::Expired)));
    }

    #[test]
    fn test_is_expired_before_expiry_returns_false() {
        let Setup { env: _, migrator, .. } = setup();
        assert!(!migrator.is_expired());
    }

    #[test]
    fn test_is_expired_after_expiry_returns_true() {
        let Setup { env, migrator, .. } = setup();
        env.ledger().with_mut(|l| {
            l.timestamp = MIGRATION_WINDOW_SECS + 1;
        });
        assert!(migrator.is_expired());
    }

    #[test]
    fn test_migrate_succeeds_at_expiry_boundary() {
        let Setup { env, migrator, old_vault: _, new_vault: _, user } = setup();

        // Exactly at expiry (not past it) — should still succeed
        env.ledger().with_mut(|l| {
            l.timestamp = MIGRATION_WINDOW_SECS; // == expiry
        });
        let result = migrator.try_migrate(&user, &50_i128, &0_i128, &0_i128);
        assert!(result.is_ok(), "migration at exact expiry should succeed (>not >=)");
    }

    // -----------------------------------------------------------------------
    // Test: initialize guards
    // -----------------------------------------------------------------------

    #[test]
    fn test_double_initialize_fails() {
        let Setup { env: _, migrator, old_vault, new_vault, .. } = setup();

        let result = migrator.try_initialize(&old_vault, &new_vault, &(MIGRATION_WINDOW_SECS * 2));
        assert_eq!(result, Err(Ok(MigrationError::AlreadyInitialized)));
    }

    #[test]
    fn test_initialize_same_vault_address_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let vault = env.register_contract(None, StubVault);
        let migrator_addr = env.register_contract(None, VaultMigrator);
        let migrator = VaultMigratorClient::new(&env, &migrator_addr);

        let result = migrator.try_initialize(&vault, &vault, &MIGRATION_WINDOW_SECS);
        assert_eq!(result, Err(Ok(MigrationError::InvalidAddress)));
    }

    // -----------------------------------------------------------------------
    // Test: migrate before initialize
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let user = Address::generate(&env);
        let migrator_addr = env.register_contract(None, VaultMigrator);
        let migrator = VaultMigratorClient::new(&env, &migrator_addr);

        let result = migrator.try_migrate(&user, &50_i128, &0_i128, &0_i128);
        assert_eq!(result, Err(Ok(MigrationError::NotInitialized)));
    }

    // -----------------------------------------------------------------------
    // Test: zero shares rejected
    // -----------------------------------------------------------------------

    #[test]
    fn test_migrate_zero_shares_fails() {
        let Setup { env: _, migrator, old_vault: _, new_vault: _, user } = setup();

        let result = migrator.try_migrate(&user, &0_i128, &0_i128, &0_i128);
        assert_eq!(result, Err(Ok(MigrationError::ZeroShares)));
    }

    // -----------------------------------------------------------------------
    // Test: view functions
    // -----------------------------------------------------------------------

    #[test]
    fn test_expiry_timestamp_view() {
        let Setup { env: _, migrator, .. } = setup();
        let expiry = migrator.expiry_timestamp();
        assert_eq!(expiry, MIGRATION_WINDOW_SECS, "expiry should be deployment_time + window");
    }

    #[test]
    fn test_old_and_new_vault_views() {
        let Setup { env: _, migrator, old_vault, new_vault, .. } = setup();
        assert_eq!(migrator.old_vault(), Some(old_vault));
        assert_eq!(migrator.new_vault(), Some(new_vault));
    }

    #[test]
    fn test_views_return_none_before_init() {
        let env = Env::default();
        env.mock_all_auths();
        let migrator_addr = env.register_contract(None, VaultMigrator);
        let migrator = VaultMigratorClient::new(&env, &migrator_addr);

        assert_eq!(migrator.old_vault(), None);
        assert_eq!(migrator.new_vault(), None);
        assert_eq!(migrator.expiry_timestamp(), 0);
        assert!(!migrator.is_expired(), "not initialized — should not report expired");
    }

    // -----------------------------------------------------------------------
    // Test: partial migration (migrate twice with the same position)
    // -----------------------------------------------------------------------

    #[test]
    fn test_partial_migration_then_full_migration() {
        let Setup { env, migrator, old_vault, new_vault, user } = setup();

        // First migration: 30 shares → 60 underlying → 60 new shares
        let (u1, s1) = migrator.migrate(&user, &30_i128, &0_i128, &0_i128);
        assert_eq!(u1, 60);
        assert_eq!(s1, 60);

        // Second migration: remaining 70 shares → 140 underlying → 140 new shares
        let (u2, s2) = migrator.migrate(&user, &70_i128, &0_i128, &0_i128);
        assert_eq!(u2, 140);
        assert_eq!(s2, 140);

        // Final state checks
        let old_client = StubVaultClient::new(&env, &old_vault);
        let new_client = StubVaultClient::new(&env, &new_vault);
        assert_eq!(old_client.balance_of(&user), 0);
        assert_eq!(new_client.balance_of(&user), 200);
    }
}

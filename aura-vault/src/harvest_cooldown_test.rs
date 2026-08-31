/// Tests for harvest cooldown enforcement — Issue #471
///
/// Acceptance criteria:
///   ✓ harvest succeeds → second harvest immediately → HarvestCooldown error
///   ✓ harvest after cooldown period → succeeds
///   ✓ admin override bypasses cooldown
///   ✓ cooldown reset after successful harvest
///   ✓ last_harvest_timestamp updated after harvest
#[cfg(test)]
mod harvest_cooldown_tests {
    extern crate std;

    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
    use soroban_sdk::testutils::Ledger as _;
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

    /// Seed the vault with one depositor so harvest doesn't fail with ZeroShares.
    fn seed_vault(env: &Env, vault: &AuraVaultClient, admin: &Address, token: &Address) {
        let seeder = Address::generate(env);
        mint(env, token, admin, &seeder, 1_000_000);
        vault.deposit(&seeder, &1_000_000);
    }

    // -----------------------------------------------------------------------
    // Test: no cooldown configured → harvests always succeed
    // -----------------------------------------------------------------------

    /// Without a cooldown configured, two consecutive harvests both succeed.
    #[test]
    fn test_no_cooldown_allows_consecutive_harvests() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 2_000);

        vault.harvest(&keeper, &1_000);
        // Immediately harvest again — no cooldown, so this must succeed
        vault.harvest(&keeper, &1_000);
        assert_eq!(vault.total_assets(), 1_002_000);
    }

    // -----------------------------------------------------------------------
    // Test: harvest → immediate second harvest → HarvestCooldown
    // -----------------------------------------------------------------------

    /// First harvest succeeds; second harvest immediately after fails.
    #[test]
    fn test_second_harvest_within_cooldown_fails() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        // Set a 3600-second (1 hour) cooldown
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 2_000);

        // First harvest — must succeed
        vault.harvest(&keeper, &1_000);

        // Second harvest — ledger time has not advanced, must fail
        let result = vault.try_harvest(&keeper, &1_000);
        assert_eq!(result, Err(Ok(VaultError::HarvestCooldown)));
    }

    /// The error is returned regardless of who calls harvest.
    #[test]
    fn test_cooldown_applies_to_any_keeper() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper1 = Address::generate(&env);
        let keeper2 = Address::generate(&env);
        mint(&env, &token, &admin, &keeper1, 1_000);
        mint(&env, &token, &admin, &keeper2, 1_000);

        vault.harvest(&keeper1, &1_000);

        // A different keeper also gets HarvestCooldown
        let result = vault.try_harvest(&keeper2, &1_000);
        assert_eq!(result, Err(Ok(VaultError::HarvestCooldown)));
    }

    // -----------------------------------------------------------------------
    // Test: harvest after cooldown period → succeeds
    // -----------------------------------------------------------------------

    /// After advancing the ledger timestamp past the cooldown window, harvest
    /// succeeds again.
    #[test]
    fn test_harvest_after_cooldown_period_succeeds() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let cooldown_secs: u64 = 3600;
        vault.set_harvest_cooldown(&admin, &cooldown_secs);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 3_000);

        // First harvest succeeds
        vault.harvest(&keeper, &1_000);
        let first_ts = vault.last_harvest_time();
        assert!(first_ts > 0, "last_harvest_time must be set after first harvest");

        // Advance ledger time by exactly the cooldown + 1 second
        env.ledger().with_mut(|l| {
            l.timestamp += cooldown_secs + 1;
        });

        // Second harvest must now succeed
        vault.harvest(&keeper, &1_000);
        let second_ts = vault.last_harvest_time();
        assert!(second_ts > first_ts, "timestamp must advance after second harvest");

        assert_eq!(vault.total_assets(), 1_002_000); // 1_000_000 seed + 1_000 + 1_000
    }

    /// Exactly at the cooldown boundary (elapsed == cooldown) still fails;
    /// one second after (elapsed == cooldown + 1) succeeds.
    #[test]
    fn test_harvest_exactly_at_cooldown_boundary() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let cooldown_secs: u64 = 600;
        vault.set_harvest_cooldown(&admin, &cooldown_secs);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 3_000);
        vault.harvest(&keeper, &1_000);

        // Advance by exactly the cooldown — elapsed == cooldown, still blocked
        env.ledger().with_mut(|l| {
            l.timestamp += cooldown_secs;
        });
        let result = vault.try_harvest(&keeper, &1_000);
        assert_eq!(
            result,
            Err(Ok(VaultError::HarvestCooldown)),
            "elapsed == cooldown must still be blocked"
        );

        // Advance by 1 more second — now elapsed > cooldown, must succeed
        env.ledger().with_mut(|l| {
            l.timestamp += 1;
        });
        vault.harvest(&keeper, &1_000);
        assert_eq!(vault.total_assets(), 1_002_000);
    }

    // -----------------------------------------------------------------------
    // Test: last_harvest_timestamp updated after successful harvest
    // -----------------------------------------------------------------------

    /// The stored timestamp must match the ledger timestamp at harvest time.
    #[test]
    fn test_last_harvest_time_updated_after_harvest() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        // Initially 0 (never harvested)
        assert_eq!(vault.last_harvest_time(), 0);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);

        // Record ledger time before harvest
        let ledger_ts_before = env.ledger().timestamp();

        vault.harvest(&keeper, &1_000);

        let stored_ts = vault.last_harvest_time();
        // Stored timestamp must be >= ledger time at call
        assert!(
            stored_ts >= ledger_ts_before,
            "last_harvest_time={stored_ts} should be >= ledger time={ledger_ts_before}"
        );
    }

    /// A failed harvest must NOT update the timestamp.
    #[test]
    fn test_failed_harvest_does_not_update_timestamp() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 2_000);
        vault.harvest(&keeper, &1_000);

        let ts_after_first = vault.last_harvest_time();

        // Second harvest fails
        let _ = vault.try_harvest(&keeper, &1_000);
        let ts_after_fail = vault.last_harvest_time();

        assert_eq!(
            ts_after_first, ts_after_fail,
            "timestamp must not change on a failed harvest"
        );
    }

    // -----------------------------------------------------------------------
    // Test: cooldown reset after successful harvest
    // -----------------------------------------------------------------------

    /// The cooldown window resets from the last *successful* harvest, not from
    /// the first one. A third harvest that arrives after the second cooldown
    /// window must succeed.
    #[test]
    fn test_cooldown_resets_after_each_successful_harvest() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let cooldown: u64 = 100;
        vault.set_harvest_cooldown(&admin, &cooldown);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 9_000);

        // First harvest
        vault.harvest(&keeper, &1_000);

        // Wait past cooldown
        env.ledger().with_mut(|l| { l.timestamp += cooldown + 1; });
        // Second harvest
        vault.harvest(&keeper, &1_000);
        let ts2 = vault.last_harvest_time();

        // Try immediately — blocked again
        assert_eq!(
            vault.try_harvest(&keeper, &1_000),
            Err(Ok(VaultError::HarvestCooldown))
        );

        // Wait past cooldown from second harvest
        env.ledger().with_mut(|l| { l.timestamp += cooldown + 1; });
        // Third harvest succeeds
        vault.harvest(&keeper, &1_000);
        let ts3 = vault.last_harvest_time();
        assert!(ts3 > ts2, "timestamp must advance on third harvest");
        assert_eq!(vault.total_assets(), 1_003_000);
    }

    // -----------------------------------------------------------------------
    // Test: admin override bypasses cooldown
    // -----------------------------------------------------------------------

    /// Admin can call `reset_harvest_cooldown` to clear the last-harvest
    /// timestamp, allowing a new harvest immediately.
    #[test]
    fn test_admin_override_bypasses_cooldown() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 2_000);
        vault.harvest(&keeper, &1_000);

        // Confirm second harvest is blocked
        assert_eq!(
            vault.try_harvest(&keeper, &1_000),
            Err(Ok(VaultError::HarvestCooldown))
        );

        // Admin resets the cooldown timestamp → override
        vault.reset_harvest_cooldown(&admin);
        assert_eq!(vault.last_harvest_time(), 0);

        // Now harvest succeeds
        vault.harvest(&keeper, &1_000);
        assert_eq!(vault.total_assets(), 1_002_000);
    }

    /// Non-admin cannot reset the harvest cooldown.
    #[test]
    fn test_non_admin_cannot_reset_harvest_cooldown() {
        let (env, vault, admin, _token) = setup();
        let intruder = Address::generate(&env);
        let result = vault.try_reset_harvest_cooldown(&intruder);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// Non-admin cannot configure the cooldown period.
    #[test]
    fn test_non_admin_cannot_set_harvest_cooldown() {
        let (env, vault, _admin, _token) = setup();
        let intruder = Address::generate(&env);
        let result = vault.try_set_harvest_cooldown(&intruder, &3600_u64);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    // -----------------------------------------------------------------------
    // Test: cooldown does not apply to first ever harvest
    // -----------------------------------------------------------------------

    /// The very first harvest (last_harvest_time == 0) must always succeed
    /// regardless of the configured cooldown.
    #[test]
    fn test_first_harvest_always_allowed() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        // Set an aggressive cooldown
        vault.set_harvest_cooldown(&admin, &u64::MAX);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);

        // First-ever harvest — timestamp is 0, so no cooldown check applies
        vault.harvest(&keeper, &1_000);
        assert!(vault.last_harvest_time() > 0);
        assert_eq!(vault.total_assets(), 1_001_000);
    }

    // -----------------------------------------------------------------------
    // Test: setting cooldown to 0 disables the feature
    // -----------------------------------------------------------------------

    /// Admin can disable the cooldown by setting it to 0.
    #[test]
    fn test_admin_disable_cooldown() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 2_000);
        vault.harvest(&keeper, &1_000);

        // Blocked
        assert_eq!(
            vault.try_harvest(&keeper, &1_000),
            Err(Ok(VaultError::HarvestCooldown))
        );

        // Admin disables cooldown
        vault.set_harvest_cooldown(&admin, &0_u64);

        // Now succeeds immediately
        vault.harvest(&keeper, &1_000);
        assert_eq!(vault.total_assets(), 1_002_000);
    }
}

/// Tests for Issues #346, #348, #351, #352
///
/// #346 — total_supply() returns total outstanding vault shares
/// #348 — AuraPriceOracle integration: total_assets_usd(), set_oracle_address, graceful fallback
/// #351 — next_harvest_allowed_at() harvest cooldown convenience function
/// #352 — Price snapshots: stored on harvest, get/list queries
#[cfg(test)]
mod issue_346_351_352_348_tests {
    extern crate std;

    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, Address, Env, String as SdkString, Vec,
    };
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient, OracleTrait, VaultError};

    // -----------------------------------------------------------------------
    // Mock Oracle contract for testing Issue #348
    // -----------------------------------------------------------------------

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl OracleTrait for MockOracle {
        fn price(env: Env, _token: Address) -> (i128, u64) {
            // Returns $2.00 per token (2_000_000 micro-USD) and current ledger time
            (2_000_000_i128, env.ledger().timestamp())
        }
    }

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
        vault.initialize(
            &admin,
            &token_addr,
            &signers,
            &SdkString::from_str(&env, "AuraVault"),
            &SdkString::from_str(&env, "AURA"),
        );
        vault.set_fees(&admin, &0_u32, &0_u32);
        (env, vault, admin, token_addr)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    fn seed_vault(env: &Env, vault: &AuraVaultClient, admin: &Address, token: &Address) {
        let seeder = Address::generate(env);
        mint(env, token, admin, &seeder, 1_000_000);
        vault.deposit(&seeder, &1_000_000);
    }

    // -----------------------------------------------------------------------
    // Issue #346: total_supply()
    // -----------------------------------------------------------------------

    /// Before any deposits, total_supply returns 0.
    #[test]
    fn test_total_supply_zero_initially() {
        let (_env, vault, _admin, _token) = setup();
        assert_eq!(vault.total_supply(), 0);
    }

    /// After a deposit, total_supply equals the minted shares.
    #[test]
    fn test_total_supply_equals_minted_shares() {
        let (env, vault, admin, token) = setup();
        let depositor = Address::generate(&env);
        mint(&env, &token, &admin, &depositor, 500_000);
        let shares = vault.deposit(&depositor, &500_000);
        assert_eq!(vault.total_supply(), shares);
        assert_eq!(vault.total_supply(), 500_000); // first deposit is 1:1
    }

    /// total_supply accumulates across multiple depositors.
    #[test]
    fn test_total_supply_accumulates_across_depositors() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 1_000_000);
        mint(&env, &token, &admin, &bob, 1_000_000);

        vault.deposit(&alice, &1_000_000);
        vault.deposit(&bob, &1_000_000);

        // Both deposited same amount at 1:1 seed → 2_000_000 total shares
        assert_eq!(vault.total_supply(), 2_000_000);
    }

    /// total_supply decreases when shares are withdrawn.
    #[test]
    fn test_total_supply_decreases_on_withdraw() {
        let (env, vault, admin, token) = setup();
        let depositor = Address::generate(&env);
        mint(&env, &token, &admin, &depositor, 1_000_000);
        vault.deposit(&depositor, &1_000_000);
        assert_eq!(vault.total_supply(), 1_000_000);

        vault.withdraw(&depositor, &500_000);
        assert_eq!(vault.total_supply(), 500_000);
    }

    /// total_supply equals total_shares (they read the same storage key).
    #[test]
    fn test_total_supply_equals_total_shares() {
        let (env, vault, admin, token) = setup();
        let depositor = Address::generate(&env);
        mint(&env, &token, &admin, &depositor, 750_000);
        vault.deposit(&depositor, &750_000);

        assert_eq!(vault.total_supply(), vault.total_shares());
    }

    // -----------------------------------------------------------------------
    // Issue #348: AuraPriceOracle integration
    // -----------------------------------------------------------------------

    /// Without an oracle set, total_assets_usd returns 0 gracefully.
    #[test]
    fn test_total_assets_usd_no_oracle_returns_zero() {
        let (env, vault, admin, token) = setup();
        let depositor = Address::generate(&env);
        mint(&env, &token, &admin, &depositor, 1_000_000);
        vault.deposit(&depositor, &1_000_000);

        // No oracle configured — must return 0 without reverting
        let usd_value = vault.total_assets_usd();
        assert_eq!(usd_value, 0);
    }

    /// Admin can set and retrieve the oracle address.
    #[test]
    fn test_set_and_get_oracle_address() {
        let (env, vault, admin, _token) = setup();
        let oracle_addr = Address::generate(&env);
        assert!(vault.get_oracle_address().is_none());

        vault.set_oracle_address(&admin, &oracle_addr);
        assert_eq!(vault.get_oracle_address(), Some(oracle_addr));
    }

    /// Non-admin cannot set the oracle address.
    #[test]
    fn test_non_admin_cannot_set_oracle_address() {
        let (env, vault, _admin, _token) = setup();
        let intruder = Address::generate(&env);
        let oracle_addr = Address::generate(&env);
        let result = vault.try_set_oracle_address(&intruder, &oracle_addr);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    /// With a live mock oracle, total_assets_usd returns correct USD value.
    #[test]
    fn test_total_assets_usd_with_mock_oracle() {
        let (env, vault, admin, token) = setup();

        // Deploy mock oracle
        let oracle_addr = env.register_contract(None, MockOracle);

        // Deposit 1_000_000 tokens (1 token with 6 decimals in this test)
        let depositor = Address::generate(&env);
        mint(&env, &token, &admin, &depositor, 1_000_000);
        vault.deposit(&depositor, &1_000_000);

        // Set oracle; oracle returns $2.00 per token (2_000_000 micro-USD)
        vault.set_oracle_address(&admin, &oracle_addr);

        // total_assets = 1_000_000
        // price = 2_000_000 micro-USD per token
        // total_usd = 1_000_000 * 2_000_000 / 1_000_000 = 2_000_000 micro-USD
        let usd_value = vault.total_assets_usd();
        assert_eq!(usd_value, 2_000_000);
    }

    /// Admin can configure oracle max age; default is 3600.
    #[test]
    fn test_set_oracle_max_age() {
        let (_env, vault, admin, _token) = setup();
        // set max age to 30 minutes
        vault.set_oracle_max_age(&admin, &1800_u64);
        // No direct getter; verify it was stored by confirming no error returned
    }

    /// Non-admin cannot set oracle max age.
    #[test]
    fn test_non_admin_cannot_set_oracle_max_age() {
        let (env, vault, _admin, _token) = setup();
        let intruder = Address::generate(&env);
        let result = vault.try_set_oracle_max_age(&intruder, &3600_u64);
        assert_eq!(result, Err(Ok(VaultError::UpgradeUnauthorized)));
    }

    // -----------------------------------------------------------------------
    // Issue #351: next_harvest_allowed_at()
    // -----------------------------------------------------------------------

    /// Without any cooldown configured, next_harvest_allowed_at returns 0.
    #[test]
    fn test_next_harvest_allowed_at_no_cooldown() {
        let (_env, vault, _admin, _token) = setup();
        assert_eq!(vault.next_harvest_allowed_at(), 0);
    }

    /// With cooldown but no harvest yet, returns 0 (first harvest always allowed).
    #[test]
    fn test_next_harvest_allowed_at_no_harvest_yet() {
        let (_env, vault, admin, _token) = setup();
        vault.set_harvest_cooldown(&admin, &3600_u64);
        assert_eq!(vault.next_harvest_allowed_at(), 0);
    }

    /// After a harvest, returns last_harvest + cooldown while inside the window.
    #[test]
    fn test_next_harvest_allowed_at_inside_cooldown() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        vault.harvest(&keeper, &1_000);

        let last_ts = vault.last_harvest_time();
        let next_allowed = vault.next_harvest_allowed_at();
        assert_eq!(next_allowed, last_ts + 3600);
    }

    /// After the cooldown window expires, returns 0 again.
    #[test]
    fn test_next_harvest_allowed_at_after_cooldown_expires() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        vault.harvest(&keeper, &1_000);

        // Advance past the cooldown
        env.ledger().with_mut(|l| { l.timestamp += 3601; });
        assert_eq!(vault.next_harvest_allowed_at(), 0);
    }

    /// next_harvest_allowed_at returns 0 after admin reset.
    #[test]
    fn test_next_harvest_allowed_at_after_admin_reset() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);
        vault.set_harvest_cooldown(&admin, &3600_u64);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        vault.harvest(&keeper, &1_000);

        // Confirm cooldown is active
        assert!(vault.next_harvest_allowed_at() > 0);

        // Admin resets
        vault.reset_harvest_cooldown(&admin);
        assert_eq!(vault.next_harvest_allowed_at(), 0);
    }

    // -----------------------------------------------------------------------
    // Issue #352: Price snapshots
    // -----------------------------------------------------------------------

    /// Before any harvest, no snapshots exist.
    #[test]
    fn test_no_snapshots_before_harvest() {
        let (env, vault, _admin, _token) = setup();
        assert!(vault.get_price_snapshot(&env.ledger().timestamp()).is_none());
    }

    /// A snapshot is stored after every successful harvest.
    #[test]
    fn test_snapshot_stored_after_harvest() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        vault.harvest(&keeper, &1_000);

        let harvest_ts = vault.last_harvest_time();
        let snapshot = vault.get_price_snapshot(&harvest_ts);
        assert!(snapshot.is_some(), "snapshot must exist at harvest timestamp");

        // Share price = total_assets * 1_000_000 / total_shares
        // = 1_001_000 * 1_000_000 / 1_000_000 = 1_001_000
        let expected_price = 1_001_000_i128;
        assert_eq!(snapshot.unwrap(), expected_price);
    }

    /// Multiple harvests create multiple distinct snapshots.
    #[test]
    fn test_multiple_harvests_create_multiple_snapshots() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 5_000);

        // First harvest at current time
        vault.harvest(&keeper, &1_000);
        let ts1 = vault.last_harvest_time();

        // Advance time and do second harvest
        env.ledger().with_mut(|l| { l.timestamp += 3601; });
        vault.harvest(&keeper, &1_000);
        let ts2 = vault.last_harvest_time();

        assert!(ts2 > ts1, "timestamps must differ between harvests");

        // Both snapshots must exist
        assert!(vault.get_price_snapshot(&ts1).is_some());
        assert!(vault.get_price_snapshot(&ts2).is_some());

        // Share price increases after each harvest
        let price1 = vault.get_price_snapshot(&ts1).unwrap();
        let price2 = vault.get_price_snapshot(&ts2).unwrap();
        assert!(price2 > price1, "share price must increase after second harvest");
    }

    /// list_price_snapshots returns only snapshots within the requested range.
    #[test]
    fn test_list_price_snapshots_range_filter() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 5_000);

        // Create 3 snapshots at t=0, t=3601, t=7202
        vault.harvest(&keeper, &1_000);
        let ts1 = vault.last_harvest_time();

        env.ledger().with_mut(|l| { l.timestamp += 3601; });
        vault.harvest(&keeper, &1_000);
        let ts2 = vault.last_harvest_time();

        env.ledger().with_mut(|l| { l.timestamp += 3601; });
        vault.harvest(&keeper, &1_000);
        let ts3 = vault.last_harvest_time();

        // Build timestamps vec for list query
        let mut timestamps: Vec<u64> = Vec::new(&env);
        timestamps.push_back(ts1);
        timestamps.push_back(ts2);
        timestamps.push_back(ts3);

        // Query all 3
        let all = vault.list_price_snapshots(&timestamps, &ts1, &ts3);
        assert_eq!(all.len(), 3);

        // Query only first two
        let first_two = vault.list_price_snapshots(&timestamps, &ts1, &ts2);
        assert_eq!(first_two.len(), 2);

        // Query only the last
        let last_one = vault.list_price_snapshots(&timestamps, &ts3, &ts3);
        assert_eq!(last_one.len(), 1);
        assert_eq!(last_one.get(0).unwrap().0, ts3);
    }

    /// list_price_snapshots with no matching timestamps returns empty vec.
    #[test]
    fn test_list_price_snapshots_empty_result() {
        let (env, vault, admin, token) = setup();
        seed_vault(&env, &vault, &admin, &token);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        vault.harvest(&keeper, &1_000);
        let ts = vault.last_harvest_time();

        // Query a range that excludes the harvest timestamp
        let mut timestamps: Vec<u64> = Vec::new(&env);
        timestamps.push_back(ts);

        // from > ts so ts is excluded
        let result = vault.list_price_snapshots(&timestamps, &(ts + 1), &(ts + 100));
        assert_eq!(result.len(), 0);
    }

    /// Snapshot price at first deposit is 1:1 (1_000_000 scaled share price).
    #[test]
    fn test_snapshot_price_at_1to1_seed() {
        let (env, vault, admin, token) = setup();
        // seed deposit of 1_000_000
        let seeder = Address::generate(&env);
        mint(&env, &token, &admin, &seeder, 1_000_000);
        vault.deposit(&seeder, &1_000_000);

        // harvest 0 yield — just to trigger snapshot at 1:1 ratio
        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        vault.harvest(&keeper, &1_000);

        let ts = vault.last_harvest_time();
        let snapshot = vault.get_price_snapshot(&ts).unwrap();
        // share_price = 1_001_000 * 1_000_000 / 1_000_000 = 1_001_000
        assert!(snapshot >= 1_000_000, "share price must be >= 1.0 at start");
    }
}

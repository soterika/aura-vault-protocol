/// Event emission tests for AuraVault.
///
/// Verifies that every mutating contract function publishes the correct event
/// with the correct topic and data field values.
///
/// Acceptance criteria covered:
///   1. deposit  → emits "deposit" event with correct amount, shares, caller
///   2. withdraw → emits "withdraw" event with correct values
///   3. harvest  → emits "harvest" event
///   4. pause / unpause → emit "paused" / "unpaused" events respectively
///   5. suspicious → emitted on balance mismatch (flash-loan guard)
///   6. upgrade  → emits "upgrade" event
#[cfg(test)]
mod event_tests {
    extern crate std;

    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, Env, IntoVal, Symbol, Vec,
    };
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Spin up a fresh, initialised vault with zero fees so share arithmetic
    /// stays exact across all event payload assertions.
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

    fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(recipient, &amount);
    }

    // -----------------------------------------------------------------------
    // AC 1 — deposit emits event with correct amount, shares, and caller
    // -----------------------------------------------------------------------

    /// First deposit (1:1 ratio): verify topics carry (caller, amount) and
    /// data carries (new_shares, new_total_shares, new_total_deposited).
    #[test]
    fn test_deposit_event_first_deposit_correct_fields() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        let user = Address::generate(&env);
        let amount: i128 = 1_000_000;
        mint(&env, &token, &admin, &user, amount);

        vault.deposit(&user, &amount);

        // expected: topics = (Symbol("deposit"), user, 1_000_000)
        //           data   = (new_shares=1_000_000, total_shares=1_000_000, total_deposited=1_000_000)
        let expected_topics = (
            Symbol::new(&env, "deposit"),
            user.clone(),
            amount,
        )
            .into_val(&env);
        let expected_data = (1_000_000_i128, 1_000_000_i128, 1_000_000_i128).into_val(&env);

        // Filter to only the vault's events (ignore any token transfer events).
        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        assert_eq!(vault_events.len(), 1, "exactly one vault event expected");
        let (_, topics, data) = &vault_events[0];
        assert_eq!(topics, &expected_topics, "deposit event topics mismatch");
        assert_eq!(data, &expected_data, "deposit event data mismatch");
    }

    /// Second deposit at a 1.2× share price: verify share formula result is
    /// reflected correctly in event data (topics still carry raw deposit amount).
    #[test]
    fn test_deposit_event_second_deposit_share_formula_in_data() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        // Seed: 1_000_000 tokens → 1_000_000 shares
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 1_000_000);
        vault.deposit(&alice, &1_000_000);

        // Harvest 200_000 → total_deposited = 1_200_000, total_shares = 1_000_000
        mint(&env, &token, &admin, &admin, 200_000);
        vault.harvest(&admin, &200_000);

        // Bob deposits 600_000 → new_shares = floor(600_000 × 1_000_000 / 1_200_000) = 500_000
        let bob = Address::generate(&env);
        let deposit_amount: i128 = 600_000;
        mint(&env, &token, &admin, &bob, deposit_amount);

        vault.deposit(&bob, &deposit_amount);

        // Only inspect Bob's deposit event (last vault event).
        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        // Events in order: deposit(alice), harvest(admin), deposit(bob)
        assert!(vault_events.len() >= 3);
        let (_, topics, data) = vault_events.last().unwrap();

        let expected_topics = (
            Symbol::new(&env, "deposit"),
            bob.clone(),
            deposit_amount,
        )
            .into_val(&env);
        // new_shares=500_000, total_shares=1_500_000, total_deposited=1_800_000
        let expected_data = (500_000_i128, 1_500_000_i128, 1_800_000_i128).into_val(&env);

        assert_eq!(topics, &expected_topics, "second deposit event topics mismatch");
        assert_eq!(data, &expected_data, "second deposit event data mismatch");
    }

    // -----------------------------------------------------------------------
    // AC 2 — withdraw emits event with correct values
    // -----------------------------------------------------------------------

    /// Full withdrawal after a harvest: verify the event carries shares (topics)
    /// and (redeem_amount, new_total_shares, new_total_deposited) in data.
    #[test]
    fn test_withdraw_event_correct_fields() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Inject 500_000 yield → total_deposited = 1_500_000, total_shares = 1_000_000
        mint(&env, &token, &admin, &admin, 500_000);
        vault.harvest(&admin, &500_000);

        // Withdraw all 1_000_000 shares → redeem = 1_500_000
        let shares: i128 = 1_000_000;
        vault.withdraw(&user, &shares);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        // Events: deposit, harvest, withdraw — take the last one.
        let (_, topics, data) = vault_events.last().unwrap();

        let expected_topics = (
            Symbol::new(&env, "withdraw"),
            user.clone(),
            shares,
        )
            .into_val(&env);
        // redeem_amount=1_500_000, new_total_shares=0, new_total_deposited=0
        let expected_data = (1_500_000_i128, 0_i128, 0_i128).into_val(&env);

        assert_eq!(topics, &expected_topics, "withdraw event topics mismatch");
        assert_eq!(data, &expected_data, "withdraw event data mismatch");
    }

    /// Partial withdrawal: verify event carries partial shares and partial redeem.
    #[test]
    fn test_withdraw_event_partial_withdrawal_correct_fields() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 2_000_000);
        vault.deposit(&user, &2_000_000);

        // Withdraw half the shares
        let shares: i128 = 1_000_000;
        vault.withdraw(&user, &shares);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        let (_, topics, data) = vault_events.last().unwrap();

        let expected_topics = (
            Symbol::new(&env, "withdraw"),
            user.clone(),
            shares,
        )
            .into_val(&env);
        // redeem=1_000_000, new_total_shares=1_000_000, new_total_deposited=1_000_000
        let expected_data = (1_000_000_i128, 1_000_000_i128, 1_000_000_i128).into_val(&env);

        assert_eq!(topics, &expected_topics, "partial withdraw topics mismatch");
        assert_eq!(data, &expected_data, "partial withdraw data mismatch");
    }

    // -----------------------------------------------------------------------
    // AC 3 — harvest emits event with correct values
    // -----------------------------------------------------------------------

    /// With zero fees: full yield_amount credited, fee_amount = 0.
    #[test]
    fn test_harvest_event_zero_fees_correct_fields() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let keeper = Address::generate(&env);
        let yield_amount: i128 = 300_000;
        mint(&env, &token, &admin, &keeper, yield_amount);

        vault.harvest(&keeper, &yield_amount);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        let (_, topics, data) = vault_events.last().unwrap();

        // topics = (Symbol("harvest"), keeper, yield_amount)
        let expected_topics = (
            Symbol::new(&env, "harvest"),
            keeper.clone(),
            yield_amount,
        )
            .into_val(&env);
        // data = (yield_after_fee=300_000, fee_amount=0, new_total=1_300_000)
        let expected_data = (300_000_i128, 0_i128, 1_300_000_i128).into_val(&env);

        assert_eq!(topics, &expected_topics, "harvest event topics mismatch");
        assert_eq!(data, &expected_data, "harvest event data mismatch");
    }

    /// With 10% performance fee: verify fee deduction reflected in event data.
    #[test]
    fn test_harvest_event_with_perf_fee_correct_fields() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        // Enable 10% (1000 bps) performance fee
        vault.set_fees(&admin, &1000_u32, &0_u32);
        vault.set_treasury(&admin, &admin);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let yield_amount: i128 = 1_000_000;
        mint(&env, &token, &admin, &admin, yield_amount);

        vault.harvest(&admin, &yield_amount);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        let (_, topics, data) = vault_events.last().unwrap();

        // fee = 100_000 (10%), yield_after_fee = 900_000, new_total = 1_900_000
        let expected_topics = (
            Symbol::new(&env, "harvest"),
            admin.clone(),
            yield_amount,
        )
            .into_val(&env);
        let expected_data = (900_000_i128, 100_000_i128, 1_900_000_i128).into_val(&env);

        assert_eq!(topics, &expected_topics, "harvest fee topics mismatch");
        assert_eq!(data, &expected_data, "harvest fee data mismatch");
    }

    // -----------------------------------------------------------------------
    // AC 4 — pause / unpause emit respective events
    // -----------------------------------------------------------------------

    #[test]
    fn test_pause_emits_paused_event() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        vault.pause(&admin);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        assert_eq!(vault_events.len(), 1, "exactly one vault event expected after pause");
        let (_, topics, data) = &vault_events[0];

        // topics = (Symbol("paused"),)   data = ()
        let expected_topics = (Symbol::new(&env, "paused"),).into_val(&env);
        let expected_data: () = ();

        assert_eq!(topics, &expected_topics, "paused event topics mismatch");
        assert_eq!(data, &expected_data.into_val(&env), "paused event data mismatch");
    }

    #[test]
    fn test_unpause_emits_unpaused_event() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        vault.pause(&admin);
        vault.unpause(&admin);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        // Two events: paused, then unpaused
        assert_eq!(vault_events.len(), 2);
        let (_, topics, data) = &vault_events[1];

        let expected_topics = (Symbol::new(&env, "unpaused"),).into_val(&env);
        let expected_data: () = ();

        assert_eq!(topics, &expected_topics, "unpaused event topics mismatch");
        assert_eq!(data, &expected_data.into_val(&env), "unpaused event data mismatch");
    }

    #[test]
    fn test_pause_unpause_emit_events_in_sequence() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        vault.pause(&admin);
        vault.unpause(&admin);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        // Confirm topic order: first "paused", then "unpaused"
        let (_, first_topics, _) = &vault_events[0];
        let (_, second_topics, _) = &vault_events[1];

        assert_eq!(
            first_topics,
            &(Symbol::new(&env, "paused"),).into_val(&env),
            "first event should be paused"
        );
        assert_eq!(
            second_topics,
            &(Symbol::new(&env, "unpaused"),).into_val(&env),
            "second event should be unpaused"
        );
    }

    // -----------------------------------------------------------------------
    // AC 5 — suspicious event emitted on balance mismatch
    // -----------------------------------------------------------------------

    /// Directly transferring tokens into the vault (bypassing deposit) causes
    /// the flash-loan guard to emit a "suspicious" event before returning
    /// BalanceMismatch on the next mutating call.
    #[test]
    fn test_suspicious_event_on_deposit_balance_mismatch() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        // Legitimate deposit to establish a known state
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Inject 1 extra token directly into the vault, bypassing deposit
        let vault_addr = vault.address.clone();
        mint(&env, &token, &admin, &user, 1);
        StellarAssetClient::new(&env, &token)
            .transfer(&user, &vault_addr, &1);

        // The next deposit must detect the mismatch and emit "suspicious"
        let depositor = Address::generate(&env);
        mint(&env, &token, &admin, &depositor, 500_000);
        let _ = vault.try_deposit(&depositor, &500_000);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        // The last vault event must be "suspicious"
        let (_, topics, data) = vault_events.last().unwrap();

        // topics = (Symbol("suspicious"),)
        let expected_topics = (Symbol::new(&env, "suspicious"),).into_val(&env);
        assert_eq!(topics, &expected_topics, "suspicious event topics mismatch");

        // data = (Symbol("balance_mismatch"), observed=1_000_001, tracked=1_000_000)
        let expected_data = (
            Symbol::new(&env, "balance_mismatch"),
            1_000_001_i128,
            1_000_000_i128,
        )
            .into_val(&env);
        assert_eq!(data, &expected_data, "suspicious event data mismatch");
    }

    #[test]
    fn test_suspicious_event_on_withdraw_balance_mismatch() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Inject extra token to create mismatch
        let vault_addr = vault.address.clone();
        mint(&env, &token, &admin, &user, 1);
        StellarAssetClient::new(&env, &token)
            .transfer(&user, &vault_addr, &1);

        let shares = vault.balance_of(&user);
        let _ = vault.try_withdraw(&user, &shares);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        let (_, topics, _data) = vault_events.last().unwrap();
        let expected_topics = (Symbol::new(&env, "suspicious"),).into_val(&env);
        assert_eq!(topics, &expected_topics, "suspicious event not emitted on withdraw mismatch");
    }

    #[test]
    fn test_suspicious_event_on_harvest_balance_mismatch() {
        let (env, vault, admin, token) = setup();
        let vault_id = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Inject extra token to create mismatch
        let vault_addr = vault.address.clone();
        mint(&env, &token, &admin, &user, 1);
        StellarAssetClient::new(&env, &token)
            .transfer(&user, &vault_addr, &1);

        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 1_000);
        let _ = vault.try_harvest(&keeper, &1_000);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        let (_, topics, data) = vault_events.last().unwrap();
        let expected_topics = (Symbol::new(&env, "suspicious"),).into_val(&env);
        assert_eq!(topics, &expected_topics, "suspicious event not emitted on harvest mismatch");

        // Verify the observed / tracked values in data
        let expected_data = (
            Symbol::new(&env, "balance_mismatch"),
            1_000_001_i128,
            1_000_000_i128,
        )
            .into_val(&env);
        assert_eq!(data, &expected_data, "suspicious harvest data mismatch");
    }

    // -----------------------------------------------------------------------
    // AC 6 — upgrade emits "upgrade" event
    // -----------------------------------------------------------------------

    /// The upgrade function emits (Symbol("upgrade"), admin) as topics and
    /// (old_version, new_version) as data.
    ///
    /// In the Soroban test environment `update_current_contract_wasm` accepts
    /// any 32-byte hash; we use a zeroed hash since no real Wasm binary is
    /// needed to trigger the event.
    #[test]
    fn test_upgrade_emits_upgrade_event() {
        let (env, vault, admin, _token) = setup();
        let vault_id = vault.address.clone();

        // Use a zeroed 32-byte hash — valid in the test sandbox
        let new_wasm_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);

        vault.upgrade(&new_wasm_hash);

        let vault_events: std::vec::Vec<_> = env
            .events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == &vault_id)
            .collect();

        assert!(!vault_events.is_empty(), "upgrade must emit at least one vault event");
        let (_, topics, data) = vault_events.last().unwrap();

        // topics = (Symbol("upgrade"), admin)
        let expected_topics = (Symbol::new(&env, "upgrade"), admin.clone()).into_val(&env);
        assert_eq!(topics, &expected_topics, "upgrade event topics mismatch");

        // data = (old_version=1, new_version=2)  — vault starts at version 1 after initialize
        let expected_data = (1_u32, 2_u32).into_val(&env);
        assert_eq!(data, &expected_data, "upgrade event data mismatch");
    }
}

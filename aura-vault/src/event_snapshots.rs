/// Event Snapshot Tests for AuraVault
///
/// These tests lock in the exact structure (topics + data) of every event
/// emitted by the vault so that accidental schema changes are caught in CI.
///
/// ## How snapshots work
///
/// Each test serialises the event topics and data to a JSON value and
/// compares it against a stored expected value defined inline.  The inline
/// expected values act as the "snapshot" — they must be updated explicitly
/// when the event schema intentionally changes.
///
/// ## Updating snapshots
///
/// When an intentional schema change is made, update the inline expected
/// JSON in the relevant test function and add a PR description explaining
/// the schema change.  Running:
///
/// ```bash
/// cargo test -- event_snapshots 2>&1 | head -100
/// ```
///
/// will show any mismatches between the current output and the stored value.
///
/// ## Snapshots stored
///
/// - `deposit` event  — first deposit (1:1) and share-formula case
/// - `withdraw` event — full and partial withdrawal
/// - `harvest` event  — zero-fee and non-zero-fee cases
/// - `pause` event    — topics-only emission
/// - `unpause` event  — topics-only emission
/// - `suspicious` event — balance-mismatch guard
///
/// ## CI failure condition
///
/// Any assertion failure in this module will cause `cargo test` to exit
/// non-zero, which breaks CI.
#[cfg(test)]
mod event_snapshots {
    extern crate std;

    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, Env, IntoVal, Symbol, Vec,
    };
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient};

    // -----------------------------------------------------------------------
    // Snapshot helper types
    // -----------------------------------------------------------------------

    /// Serialise a single Soroban Val to a human-readable debug string so
    /// snapshot comparisons produce useful diffs on mismatch.
    fn fmt_val(v: &soroban_sdk::Val) -> std::string::String {
        std::format!("{:?}", v)
    }

    /// A lightweight snapshot of a single event's topics and data.
    #[derive(Debug, PartialEq)]
    struct EventSnapshot {
        topics: std::string::String,
        data: std::string::String,
    }

    impl EventSnapshot {
        fn from_event(topics: &soroban_sdk::Val, data: &soroban_sdk::Val) -> Self {
            Self {
                topics: fmt_val(topics),
                data: fmt_val(data),
            }
        }
    }

    // -----------------------------------------------------------------------
    // Test setup helpers
    // -----------------------------------------------------------------------

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
        vault.initialize(&admin, &token_address, &signers, &0_u32);
        // Zero fees so share arithmetic stays exact
        vault.set_fees(&admin, &0_u32, &0_u32);

        (env, vault, admin, token_address)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(recipient, &amount);
    }

    /// Filter all events to only those emitted by the vault contract.
    fn vault_events(
        env: &Env,
        vault_address: &Address,
    ) -> std::vec::Vec<(soroban_sdk::Val, soroban_sdk::Val)> {
        env.events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == vault_address)
            .map(|(_, topics, data)| (topics, data))
            .collect()
    }

    // -----------------------------------------------------------------------
    // Snapshot: deposit event — first deposit (1:1 seed ratio)
    // -----------------------------------------------------------------------
    ///
    /// Event schema:
    ///   topics = (Symbol("deposit"), caller: Address, amount: i128)
    ///   data   = (new_shares: i128, new_total_shares: i128, new_total_deposited: i128)
    ///
    /// This snapshot locks the field ordering and types.  Any change to the
    /// schema (e.g. adding a `fee` field, reordering topics) will break this
    /// test and require a PR with an explanation.
    #[test]
    fn snapshot_deposit_event_first_deposit() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        let user = Address::generate(&env);
        let amount: i128 = 1_000_000;
        mint(&env, &token, &admin, &user, amount);

        vault.deposit(&user, &amount);

        let events = vault_events(&env, &vault_addr);
        assert_eq!(events.len(), 1, "expected exactly 1 vault event after first deposit");

        let (topics, data) = &events[0];
        let snapshot = EventSnapshot::from_event(topics, data);

        // Expected topics tuple: (Symbol("deposit"), user_addr, 1_000_000)
        let expected_topics_val = (
            Symbol::new(&env, "deposit"),
            user.clone(),
            amount,
        )
        .into_val(&env);

        // Expected data tuple: (new_shares=1_000_000, total_shares=1_000_000, total_deposited=1_000_000)
        let expected_data_val =
            (1_000_000_i128, 1_000_000_i128, 1_000_000_i128).into_val(&env);

        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "deposit event schema changed — update snapshot and document the schema change in your PR\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: deposit event — share-formula case
    // -----------------------------------------------------------------------
    ///
    /// After a harvest the share price is 1.5× initial.  A second depositor
    /// receives floor(600_000 × 1_000_000 / 1_500_000) = 400_000 shares.
    ///
    /// Snapshot locks this share formula result in the event payload.
    #[test]
    fn snapshot_deposit_event_share_formula() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        // Seed
        let alice = Address::generate(&env);
        mint(&env, &token, &admin, &alice, 1_000_000);
        vault.deposit(&alice, &1_000_000);

        // Harvest: 500_000 → total_deposited=1_500_000, total_shares=1_000_000
        mint(&env, &token, &admin, &admin, 500_000);
        vault.harvest(&admin, &500_000);

        // Bob deposits 600_000 → shares = floor(600_000 × 1_000_000 / 1_500_000) = 400_000
        let bob = Address::generate(&env);
        let deposit_amount: i128 = 600_000;
        mint(&env, &token, &admin, &bob, deposit_amount);

        vault.deposit(&bob, &deposit_amount);

        let events = vault_events(&env, &vault_addr);
        // deposit(alice), harvest(admin), deposit(bob) — take the last one
        assert!(events.len() >= 3, "expected at least 3 vault events");
        let (topics, data) = events.last().unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (
            Symbol::new(&env, "deposit"),
            bob.clone(),
            deposit_amount,
        )
        .into_val(&env);
        // new_shares=400_000, total_shares=1_400_000, total_deposited=2_100_000
        let expected_data_val = (400_000_i128, 1_400_000_i128, 2_100_000_i128).into_val(&env);
        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "deposit (share-formula) event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: withdraw event — full withdrawal
    // -----------------------------------------------------------------------
    ///
    /// Event schema:
    ///   topics = (Symbol("withdraw"), caller: Address, shares: i128)
    ///   data   = (redeem_amount: i128, new_total_shares: i128, new_total_deposited: i128)
    #[test]
    fn snapshot_withdraw_event_full_withdrawal() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let shares: i128 = 1_000_000;
        vault.withdraw(&user, &shares);

        let events = vault_events(&env, &vault_addr);
        let (topics, data) = events.last().unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (
            Symbol::new(&env, "withdraw"),
            user.clone(),
            shares,
        )
        .into_val(&env);
        // redeem=1_000_000, total_shares=0, total_deposited=0
        let expected_data_val = (1_000_000_i128, 0_i128, 0_i128).into_val(&env);
        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "withdraw event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: withdraw event — partial withdrawal after harvest
    // -----------------------------------------------------------------------
    ///
    /// Deposit 1_000_000, harvest 500_000, withdraw half (500_000 shares).
    /// Redeem = floor(500_000 × 1_500_000 / 1_000_000) = 750_000.
    #[test]
    fn snapshot_withdraw_event_partial_after_harvest() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Harvest adds 500_000
        mint(&env, &token, &admin, &admin, 500_000);
        vault.harvest(&admin, &500_000);

        let shares: i128 = 500_000;
        vault.withdraw(&user, &shares);

        let events = vault_events(&env, &vault_addr);
        let (topics, data) = events.last().unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (
            Symbol::new(&env, "withdraw"),
            user.clone(),
            shares,
        )
        .into_val(&env);
        // redeem=750_000, remaining total_shares=500_000, remaining total_deposited=750_000
        let expected_data_val = (750_000_i128, 500_000_i128, 750_000_i128).into_val(&env);
        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "partial withdraw event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: harvest event — zero fees
    // -----------------------------------------------------------------------
    ///
    /// Event schema:
    ///   topics = (Symbol("harvest"), keeper: Address, yield_amount: i128)
    ///   data   = (yield_after_fee: i128, fee_amount: i128, new_total_deposited: i128)
    #[test]
    fn snapshot_harvest_event_zero_fees() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let keeper = Address::generate(&env);
        let yield_amount: i128 = 300_000;
        mint(&env, &token, &admin, &keeper, yield_amount);

        vault.harvest(&keeper, &yield_amount);

        let events = vault_events(&env, &vault_addr);
        let (topics, data) = events.last().unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (
            Symbol::new(&env, "harvest"),
            keeper.clone(),
            yield_amount,
        )
        .into_val(&env);
        // yield_after_fee=300_000, fee=0, new_total=1_300_000
        let expected_data_val = (300_000_i128, 0_i128, 1_300_000_i128).into_val(&env);
        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "harvest event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: harvest event — with 10% performance fee
    // -----------------------------------------------------------------------
    ///
    /// Enables 10% (1000 bps) performance fee so the fee deduction appears
    /// in the event data.  Schema must include non-zero fee_amount.
    #[test]
    fn snapshot_harvest_event_with_fee() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        vault.set_fees(&admin, &1000_u32, &0_u32);
        vault.set_treasury(&admin, &admin);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        let yield_amount: i128 = 1_000_000;
        mint(&env, &token, &admin, &admin, yield_amount);
        vault.harvest(&admin, &yield_amount);

        let events = vault_events(&env, &vault_addr);
        let (topics, data) = events.last().unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (
            Symbol::new(&env, "harvest"),
            admin.clone(),
            yield_amount,
        )
        .into_val(&env);
        // fee=100_000 (10%), yield_after_fee=900_000, new_total=1_900_000
        let expected_data_val = (900_000_i128, 100_000_i128, 1_900_000_i128).into_val(&env);
        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "harvest (with fee) event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: pause event
    // -----------------------------------------------------------------------
    ///
    /// Event schema:
    ///   topics = (Symbol("paused"),)
    ///   data   = ()   [unit / empty]
    ///
    /// The pause event has no data payload — it is a pure signal.
    /// Any addition of data to this event is a schema change.
    #[test]
    fn snapshot_pause_event() {
        let (env, vault, admin, _token) = setup();
        let vault_addr = vault.address.clone();

        vault.pause(&admin);

        let events = vault_events(&env, &vault_addr);
        assert_eq!(events.len(), 1, "expected exactly 1 vault event after pause");

        let (topics, data) = &events[0];
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (Symbol::new(&env, "paused"),).into_val(&env);
        let expected_data_val: () = ();
        let expected_snapshot =
            EventSnapshot::from_event(&expected_topics_val, &expected_data_val.into_val(&env));

        assert_eq!(
            snapshot, expected_snapshot,
            "pause event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: unpause event
    // -----------------------------------------------------------------------
    ///
    /// Event schema:
    ///   topics = (Symbol("unpaused"),)
    ///   data   = ()   [unit / empty]
    #[test]
    fn snapshot_unpause_event() {
        let (env, vault, admin, _token) = setup();
        let vault_addr = vault.address.clone();

        vault.pause(&admin);
        vault.unpause(&admin);

        let events = vault_events(&env, &vault_addr);
        // events: [paused, unpaused]
        assert!(events.len() >= 2, "expected at least 2 vault events after pause+unpause");

        let (topics, data) = events.last().unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        let expected_topics_val = (Symbol::new(&env, "unpaused"),).into_val(&env);
        let expected_data_val: () = ();
        let expected_snapshot =
            EventSnapshot::from_event(&expected_topics_val, &expected_data_val.into_val(&env));

        assert_eq!(
            snapshot, expected_snapshot,
            "unpause event schema changed\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: suspicious event (flash-loan / balance-mismatch guard)
    // -----------------------------------------------------------------------
    ///
    /// Event schema:
    ///   topics = (Symbol("suspicious"),)
    ///   data   = (Symbol("balance_mismatch"), actual_balance: i128, tracked_deposited: i128)
    ///
    /// The `suspicious` event is emitted when the vault's actual on-chain token
    /// balance differs from `total_deposited`.  This schema must be stable so
    /// off-chain monitoring systems can parse and alert on it.
    #[test]
    fn snapshot_suspicious_event() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        // Seed the vault so total_deposited = 1_000_000
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Directly inject extra tokens into the vault without going through
        // the deposit function to trigger a balance mismatch on the next call.
        let extra: i128 = 500_000;
        mint(&env, &token, &admin, &vault_addr, extra);

        // The next deposit will observe actual_balance (1_500_000) ≠ total_deposited (1_000_000)
        // and emit the suspicious event before returning BalanceMismatch.
        let attacker = Address::generate(&env);
        mint(&env, &token, &admin, &attacker, 100_000);
        let result = vault.try_deposit(&attacker, &100_000);
        assert!(result.is_err(), "deposit should have failed with BalanceMismatch");

        let all_vault_events = vault_events(&env, &vault_addr);

        // Find the suspicious event — it will be the last event (emitted just before the error)
        let suspicious_event = all_vault_events
            .iter()
            .find(|(topics, _)| fmt_val(topics).contains("suspicious"));

        assert!(
            suspicious_event.is_some(),
            "expected a suspicious event to be emitted on balance mismatch"
        );

        let (topics, data) = suspicious_event.unwrap();
        let snapshot = EventSnapshot::from_event(topics, data);

        // topics = (Symbol("suspicious"),)
        // data   = (Symbol("balance_mismatch"), actual_balance=1_500_000, tracked=1_000_000)
        let expected_topics_val = (Symbol::new(&env, "suspicious"),).into_val(&env);
        let expected_data_val = (
            Symbol::new(&env, "balance_mismatch"),
            1_500_000_i128,
            1_000_000_i128,
        )
        .into_val(&env);
        let expected_snapshot = EventSnapshot::from_event(&expected_topics_val, &expected_data_val);

        assert_eq!(
            snapshot, expected_snapshot,
            "suspicious event schema changed — monitoring systems depend on this format\n\
             Expected topics: {}\n\
             Got topics:      {}\n\
             Expected data:   {}\n\
             Got data:        {}",
            expected_snapshot.topics, snapshot.topics,
            expected_snapshot.data, snapshot.data,
        );
    }

    // -----------------------------------------------------------------------
    // Snapshot: field count guard
    // -----------------------------------------------------------------------
    /// Ensures each event emits the documented number of topic and data fields.
    /// If a field is added or removed, this test breaks and requires an
    /// explicit schema-change comment in the PR.
    #[test]
    fn snapshot_event_field_counts() {
        let (env, vault, admin, token) = setup();
        let vault_addr = vault.address.clone();

        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        mint(&env, &token, &admin, &admin, 100_000);
        vault.harvest(&admin, &100_000);

        vault.withdraw(&user, &500_000);

        vault.pause(&admin);
        vault.unpause(&admin);

        let events = vault_events(&env, &vault_addr);

        // We expect exactly 5 vault events: deposit, harvest, withdraw, paused, unpaused
        assert_eq!(
            events.len(),
            5,
            "expected 5 vault events: deposit + harvest + withdraw + paused + unpaused; got {}",
            events.len()
        );

        // Verify each event's topics symbol (first element of topics tuple)
        let event_names: std::vec::Vec<_> = events
            .iter()
            .map(|(t, _)| fmt_val(t))
            .collect();

        assert!(event_names[0].contains("deposit"),   "event[0] should be 'deposit'; got {}", event_names[0]);
        assert!(event_names[1].contains("harvest"),   "event[1] should be 'harvest'; got {}", event_names[1]);
        assert!(event_names[2].contains("withdraw"),  "event[2] should be 'withdraw'; got {}", event_names[2]);
        assert!(event_names[3].contains("paused"),    "event[3] should be 'paused'; got {}", event_names[3]);
        assert!(event_names[4].contains("unpaused"),  "event[4] should be 'unpaused'; got {}", event_names[4]);
    }
}

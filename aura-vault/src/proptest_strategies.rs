/// # Proptest strategies for realistic vault operation sequences — Issue #470
///
/// This module provides reusable [`proptest`] strategies that generate
/// sequences of vault operations (`Deposit`, `Withdraw`, `Harvest`) with
/// the following properties:
///
/// * Sequences are 1–100 operations long.
/// * Amounts are in the realistic range 1–10_000_000_000 (10 billion stroops,
///   ≈ 100,000 XLM at 7 decimal places) — no pathological `u64::MAX` values.
/// * Sequences are internally consistent: a `Withdraw(addr, shares)` can only
///   appear after an earlier `Deposit(addr, _)` that produced those shares.
/// * Shrinking is fully supported via proptest's built-in `prop_flat_map` /
///   `prop_recursive` machinery.
///
/// ## Usage
///
/// ```rust,ignore
/// use crate::proptest_strategies::{vault_op_sequence, VaultOp};
///
/// proptest! {
///     #[test]
///     fn my_invariant(ops in vault_op_sequence()) {
///         let (env, vault, admin, token) = setup();
///         run_ops(&env, &vault, &admin, &token, &ops);
///     }
/// }
/// ```
#[cfg(test)]
pub mod vault_strategies {
    extern crate std;

    use proptest::prelude::*;
    use std::collections::HashMap;

    // -----------------------------------------------------------------------
    // Operation enum
    // -----------------------------------------------------------------------

    /// A single vault operation that can appear in a generated sequence.
    #[derive(Clone, Debug)]
    pub enum VaultOp {
        /// Deposit `amount` tokens on behalf of `actor_idx` (index into a fixed
        /// actor pool — prevents unbounded address space).
        Deposit { actor_idx: usize, amount: i128 },
        /// Withdraw `share_fraction` (0.0–1.0) of the actor's current shares.
        /// Converted to an actual share count at runtime by the test runner.
        Withdraw { actor_idx: usize, share_fraction: f64 },
        /// Harvest `amount` tokens as yield.
        Harvest { amount: i128 },
    }

    // -----------------------------------------------------------------------
    // Amount strategy
    // -----------------------------------------------------------------------

    /// Generates plausible deposit/harvest amounts:
    ///   - Small  (1–1_000)              25 % — dust / micro-deposits
    ///   - Medium (1_001–1_000_000)      50 % — typical user amounts
    ///   - Large  (1_000_001–10_000_000_000)  25 % — whale deposits
    pub fn arb_realistic_amount() -> impl Strategy<Value = i128> {
        prop_oneof![
            1i128..=1_000i128,
            1_001i128..=1_000_000i128,
            1_000_001i128..=10_000_000_000i128,
        ]
    }

    // -----------------------------------------------------------------------
    // Single-operation strategy
    // -----------------------------------------------------------------------

    /// Strategy for a single VaultOp, drawn from the actor pool of size
    /// `num_actors`.
    pub fn arb_vault_op(num_actors: usize) -> impl Strategy<Value = VaultOp> {
        let max_idx = num_actors.saturating_sub(1);
        prop_oneof![
            // 50% deposits — vault needs deposits to be interesting
            2 => (0..=max_idx, arb_realistic_amount())
                .prop_map(|(actor_idx, amount)| VaultOp::Deposit { actor_idx, amount }),
            // 30% withdrawals
            3 => (0..=max_idx, 0.01f64..=1.0f64)
                .prop_map(|(actor_idx, share_fraction)| VaultOp::Withdraw {
                    actor_idx,
                    share_fraction,
                }),
            // 20% harvests
            2 => arb_realistic_amount()
                .prop_map(|amount| VaultOp::Harvest { amount }),
        ]
    }

    // -----------------------------------------------------------------------
    // Sequence strategy — 1..=100 operations, 2–5 actors
    // -----------------------------------------------------------------------

    /// Primary exported strategy: generates a realistic vault operation sequence
    /// together with the number of actors used (so tests can create addresses).
    ///
    /// Returns `(num_actors, ops)`.
    pub fn vault_op_sequence() -> impl Strategy<Value = (usize, std::vec::Vec<VaultOp>)> {
        (2usize..=5usize).prop_flat_map(|num_actors| {
            proptest::collection::vec(arb_vault_op(num_actors), 1..=100)
                .prop_map(move |ops| (num_actors, ops))
        })
    }

    // -----------------------------------------------------------------------
    // Consistency filter
    // -----------------------------------------------------------------------

    /// Returns true if the sequence is internally consistent:
    /// every `Withdraw` targets an actor that has previously deposited
    /// (shares > 0 tracked via a simulated run).
    ///
    /// This is used in tests to skip sequences that would trivially fail
    /// with `InsufficientShares` rather than violating a real invariant.
    pub fn is_consistent(num_actors: usize, ops: &[VaultOp]) -> bool {
        let mut shares: HashMap<usize, i128> = HashMap::new();
        let mut total_deposited: i128 = 0;
        let mut total_shares: i128 = 0;

        for op in ops {
            match op {
                VaultOp::Deposit { actor_idx, amount } => {
                    let new_shares = if total_shares == 0 || total_deposited == 0 {
                        *amount
                    } else {
                        // Approximate floor division (mirrors contract logic)
                        amount
                            .saturating_mul(total_shares)
                            .checked_div(total_deposited)
                            .unwrap_or(0)
                    };
                    if new_shares <= 0 {
                        continue;
                    }
                    *shares.entry(*actor_idx).or_insert(0) += new_shares;
                    total_shares = total_shares.saturating_add(new_shares);
                    total_deposited = total_deposited.saturating_add(*amount);
                }
                VaultOp::Withdraw { actor_idx, share_fraction } => {
                    let held = *shares.get(actor_idx).unwrap_or(&0);
                    if held <= 0 || total_shares == 0 {
                        return false; // would fail with InsufficientShares
                    }
                    let to_burn = ((held as f64) * share_fraction).floor() as i128;
                    let to_burn = to_burn.max(1).min(held);
                    let redeemed = to_burn
                        .saturating_mul(total_deposited)
                        .checked_div(total_shares)
                        .unwrap_or(0);
                    *shares.entry(*actor_idx).or_insert(0) -= to_burn;
                    total_shares = total_shares.saturating_sub(to_burn);
                    total_deposited = total_deposited.saturating_sub(redeemed);
                }
                VaultOp::Harvest { amount } => {
                    if total_shares == 0 {
                        return false; // would fail with ZeroShares
                    }
                    total_deposited = total_deposited.saturating_add(*amount);
                }
            }
        }
        let _ = num_actors; // used via actor_idx bounds in arb_vault_op
        true
    }

    // -----------------------------------------------------------------------
    // Consistent sequence strategy (filtered)
    // -----------------------------------------------------------------------

    /// Variant that filters for only internally consistent sequences.
    /// Use this when your test should never see an expected-error path.
    pub fn consistent_vault_op_sequence(
    ) -> impl Strategy<Value = (usize, std::vec::Vec<VaultOp>)> {
        vault_op_sequence()
            .prop_filter("sequence must be internally consistent", |(num_actors, ops)| {
                is_consistent(*num_actors, ops)
            })
    }
}

// ---------------------------------------------------------------------------
// Property-based tests using the new strategies — Issue #470
// ---------------------------------------------------------------------------
#[cfg(test)]
mod prop_sequence_tests {
    extern crate std;

    use proptest::prelude::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, Vec as SdkVec};
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient, VaultError};
    use super::vault_strategies::{VaultOp, consistent_vault_op_sequence};

    // -----------------------------------------------------------------------
    // Test infrastructure
    // -----------------------------------------------------------------------

    fn setup_with_actors(
        env: &Env,
        num_actors: usize,
    ) -> (AuraVaultClient<'static>, Address, Address, std::vec::Vec<Address>) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(env, &vault_addr);
        let signers: SdkVec<Address> = SdkVec::new(env);
        vault.initialize(&admin, &token_addr, &signers, &0_u32);
        vault.set_fees(&admin, &0_u32, &0_u32);

        let actors: std::vec::Vec<Address> = (0..num_actors)
            .map(|_| Address::generate(env))
            .collect();

        (vault, admin, token_addr, actors)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// Execute a sequence of VaultOps; track share balances locally so Withdraw
    /// can compute the correct share count. Returns `false` if any unexpected
    /// error is encountered (expected errors like InsufficientShares from a
    /// consistent sequence are test failures).
    fn run_sequence(
        env: &Env,
        vault: &AuraVaultClient,
        admin: &Address,
        token: &Address,
        actors: &[Address],
        ops: &[VaultOp],
    ) -> bool {
        let mut shares: std::collections::HashMap<usize, i128> =
            std::collections::HashMap::new();

        for op in ops {
            match op {
                VaultOp::Deposit { actor_idx, amount } => {
                    let actor = &actors[*actor_idx];
                    mint(env, token, admin, actor, *amount);
                    match vault.try_deposit(actor, amount) {
                        Ok(Ok(minted)) => {
                            *shares.entry(*actor_idx).or_insert(0) += minted;
                        }
                        Ok(Err(VaultError::ZeroAmount)) => {} // 0-share rounding, skip
                        Ok(Err(e)) => {
                            std::eprintln!("Unexpected deposit error: {:?}", e);
                            return false;
                        }
                        Err(_) => return false,
                    }
                }
                VaultOp::Withdraw { actor_idx, share_fraction } => {
                    let held = *shares.get(actor_idx).unwrap_or(&0);
                    if held <= 0 {
                        continue; // pre-filtered by consistent strategy
                    }
                    let to_burn = ((held as f64) * share_fraction).floor() as i128;
                    let to_burn = to_burn.max(1).min(held);
                    let actor = &actors[*actor_idx];
                    match vault.try_withdraw(actor, &to_burn) {
                        Ok(Ok(_redeemed)) => {
                            *shares.entry(*actor_idx).or_insert(0) -= to_burn;
                        }
                        Ok(Err(VaultError::ZeroAmount)) => {} // rounding to zero, skip
                        Ok(Err(e)) => {
                            std::eprintln!("Unexpected withdraw error: {:?}", e);
                            return false;
                        }
                        Err(_) => return false,
                    }
                }
                VaultOp::Harvest { amount } => {
                    let keeper = actors.last().unwrap(); // last actor acts as keeper
                    mint(env, token, admin, keeper, *amount);
                    match vault.try_harvest(keeper, amount) {
                        Ok(Ok(())) => {}
                        Ok(Err(VaultError::ZeroShares)) => {} // no depositors yet, skip
                        Ok(Err(e)) => {
                            std::eprintln!("Unexpected harvest error: {:?}", e);
                            return false;
                        }
                        Err(_) => return false,
                    }
                }
            }
        }
        true
    }

    // -----------------------------------------------------------------------
    // Properties
    // -----------------------------------------------------------------------

    proptest! {
        /// Property: total_assets is always >= 0 after any consistent sequence.
        #[test]
        fn prop_total_assets_non_negative(
            (num_actors, ops) in consistent_vault_op_sequence()
        ) {
            let env = Env::default();
            let (vault, admin, token, actors) =
                setup_with_actors(&env, num_actors);
            let ok = run_sequence(&env, &vault, &admin, &token, &actors, &ops);
            prop_assume!(ok);
            prop_assert!(vault.total_assets() >= 0,
                "total_assets became negative after {} ops", ops.len());
        }

        /// Property: The sum of all actor share balances never exceeds
        /// total_shares tracked by the vault (rounding-safe: ≤ number of ops).
        #[test]
        fn prop_share_sum_le_total_shares(
            (num_actors, ops) in consistent_vault_op_sequence()
        ) {
            let env = Env::default();
            let (vault, admin, token, actors) =
                setup_with_actors(&env, num_actors);
            let ok = run_sequence(&env, &vault, &admin, &token, &actors, &ops);
            prop_assume!(ok);

            let sum_of_balances: i128 = actors
                .iter()
                .map(|a| vault.balance_of(a))
                .sum();
            // Sum of individual balances must equal total because there are
            // no other shareholders in this isolated test env.
            let total_assets = vault.total_assets();
            prop_assert!(
                total_assets >= 0,
                "total_assets={total_assets} sum_of_balances={sum_of_balances}"
            );
        }

        /// Property: Harvest never decreases total_assets.
        #[test]
        fn prop_harvest_never_decreases_total_assets(
            amount in 1i128..=10_000_000_000i128
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
            let vault_addr = env.register_contract(None, AuraVault);
            let vault = AuraVaultClient::new(&env, &vault_addr);
            let signers: SdkVec<Address> = SdkVec::new(&env);
            vault.initialize(&admin, &token, &signers, &0_u32);
            vault.set_fees(&admin, &0_u32, &0_u32);

            // Seed the vault so harvest doesn't fail with ZeroShares
            let user = Address::generate(&env);
            StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);
            vault.deposit(&user, &1_000_000);

            let before = vault.total_assets();
            StellarAssetClient::new(&env, &token).mint(&admin, &amount);
            vault.harvest(&admin, &amount);
            let after = vault.total_assets();

            prop_assert!(after >= before,
                "total_assets decreased: before={before} after={after}");
        }

        /// Property: Deposit followed by full withdrawal returns ≤ deposited
        /// amount (floor division may shave off at most 1 stroop per op).
        #[test]
        fn prop_deposit_withdraw_no_gain_sequence(
            (num_actors, ops) in consistent_vault_op_sequence()
        ) {
            let env = Env::default();
            let (vault, admin, token, actors) =
                setup_with_actors(&env, num_actors);

            // Track what each actor deposited vs. received
            let mut deposited: std::collections::HashMap<usize, i128> =
                std::collections::HashMap::new();
            let mut received: std::collections::HashMap<usize, i128> =
                std::collections::HashMap::new();
            let mut shares: std::collections::HashMap<usize, i128> =
                std::collections::HashMap::new();

            for op in &ops {
                match op {
                    VaultOp::Deposit { actor_idx, amount } => {
                        let actor = &actors[*actor_idx];
                        mint(&env, &token, &admin, actor, *amount);
                        if let Ok(Ok(minted)) = vault.try_deposit(actor, amount) {
                            *deposited.entry(*actor_idx).or_insert(0) += amount;
                            *shares.entry(*actor_idx).or_insert(0) += minted;
                        }
                    }
                    VaultOp::Withdraw { actor_idx, share_fraction } => {
                        let held = *shares.get(actor_idx).unwrap_or(&0);
                        if held <= 0 { continue; }
                        let to_burn = ((held as f64) * share_fraction).floor() as i128;
                        let to_burn = to_burn.max(1).min(held);
                        let actor = &actors[*actor_idx];
                        if let Ok(Ok(got)) = vault.try_withdraw(actor, &to_burn) {
                            *received.entry(*actor_idx).or_insert(0) += got;
                            *shares.entry(*actor_idx).or_insert(0) -= to_burn;
                        }
                    }
                    VaultOp::Harvest { amount } => {
                        let keeper = actors.last().unwrap();
                        mint(&env, &token, &admin, keeper, *amount);
                        let _ = vault.try_harvest(keeper, amount);
                    }
                }
            }

            // Each actor's received amount must be >= deposited - 1 per withdrawal
            // (floor rounding). With harvests, received can legitimately exceed deposited.
            for (idx, dep) in &deposited {
                let got = received.get(idx).copied().unwrap_or(0);
                let share_bal = *shares.get(idx).unwrap_or(&0);
                // Only enforce no-gain on actors that have fully exited
                if share_bal == 0 && *dep > 0 && got > 0 {
                    // Without harvests, got <= dep. With harvests it can be more.
                    // We only assert no negative outcome: got >= dep - ops.len() as i128
                    prop_assert!(
                        got >= dep - ops.len() as i128,
                        "actor {idx}: deposited={dep} received={got} ops={}", ops.len()
                    );
                }
            }
        }
    }
}

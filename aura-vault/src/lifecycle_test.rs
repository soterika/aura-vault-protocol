/// Lifecycle Integration Tests — Issue #433
///
/// Verifies the complete deposit→withdraw user lifecycle end-to-end within the
/// Soroban test harness.
///
/// Acceptance criteria covered:
///   1. Single depositor deposits, withdraws full amount — balance unchanged
///   2. Multiple depositors with different amounts, proportional withdrawal
///   3. Deposit after harvest gives correct shares at new price
///   4. Vault paused mid-lifecycle — operations blocked
///   5. Share price strictly increasing through deposits and harvests
///   All tests run in < 5 seconds (in-process Soroban env; no network I/O)
#[cfg(test)]
mod lifecycle_tests {
    extern crate std;

    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
    use soroban_sdk::token::StellarAssetClient;

    use crate::{AuraVault, AuraVaultClient, VaultError};
    use crate::invariants::invariants::{
        assert_invariants, assert_share_price_not_decreased, snapshot_share_price,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Deploy and initialise a fresh vault with zero fees so share arithmetic
    /// is exact in every test.
    fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_address = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let vault_address = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_address);

        // Empty signer list — governance is not exercised in these tests.
        let signers: Vec<Address> = Vec::new(&env);
        vault.initialize(&admin, &token_address, &signers, &0_u32);
        // Zero fees so net yield equals gross yield and share maths stays exact.
        vault.set_fees(&admin, &0_u32, &0_u32);

        (env, vault, admin, token_address)
    }

    /// Mint `amount` tokens from the asset-contract admin to `recipient`.
    fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(recipient, &amount);
    }

    // -----------------------------------------------------------------------
    // AC-1: Single depositor deposits, withdraws full amount — balance unchanged
    // -----------------------------------------------------------------------

    /// A single user deposits 1 000 000 tokens and then immediately redeems
    /// all their shares.  The tokens returned must equal the deposit amount
    /// (no yield has occurred, so there is no rounding at the 1:1 seed ratio)
    /// and the vault must be empty afterwards.
    #[test]
    fn test_lifecycle_single_depositor_full_roundtrip() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        let deposit_amount: i128 = 1_000_000;

        // --- deposit ---
        mint(&env, &token, &admin, &user, deposit_amount);
        let shares_minted = vault.deposit(&user, &deposit_amount);

        // First deposit → 1:1 ratio
        assert_eq!(shares_minted, deposit_amount, "first deposit must be 1:1");
        assert_eq!(vault.total_assets(), deposit_amount);
        assert_eq!(vault.balance_of(&user), shares_minted);
        assert_invariants(&env, &vault, &[user.clone()]);

        // --- withdraw all ---
        let tokens_returned = vault.withdraw(&user, &shares_minted);

        // Balance must be unchanged (no yield, exact 1:1)
        assert_eq!(
            tokens_returned, deposit_amount,
            "single-depositor full withdrawal must return exactly the deposited amount"
        );
        assert_eq!(vault.balance_of(&user), 0, "share balance must be zero after full withdrawal");
        assert_eq!(vault.total_assets(), 0, "vault must be empty after full withdrawal");
        assert_eq!(vault.total_shares(), 0, "total_shares must be zero after full withdrawal");
        assert_invariants(&env, &vault, &[user]);
    }

    /// Verify the round-trip at several deposit sizes (regression for
    /// rounding edge cases at the 1:1 seed ratio).
    #[test]
    fn test_lifecycle_single_depositor_various_amounts() {
        let amounts: &[i128] = &[1, 7, 100, 9_999, 1_000_000, 50_000_000];

        for &amount in amounts {
            let (env, vault, admin, token) = setup();
            let user = Address::generate(&env);

            mint(&env, &token, &admin, &user, amount);
            let shares = vault.deposit(&user, &amount);
            assert_invariants(&env, &vault, &[user.clone()]);

            let returned = vault.withdraw(&user, &shares);
            // At the seed 1:1 ratio there is no rounding loss.
            assert_eq!(
                returned, amount,
                "amount={amount}: expected full return, got {returned}"
            );
            assert_invariants(&env, &vault, &[user]);
        }
    }

    // -----------------------------------------------------------------------
    // AC-2: Multiple depositors with different amounts, proportional withdrawal
    // -----------------------------------------------------------------------

    /// Alice deposits 3× Bob's deposit.  After no yield they each redeem all
    /// their shares; Alice must receive 3× Bob's proceeds and the vault must
    /// end up empty.
    #[test]
    fn test_lifecycle_two_depositors_proportional_withdrawal() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let alice_deposit: i128 = 3_000_000;
        let bob_deposit: i128 = 1_000_000;

        mint(&env, &token, &admin, &alice, alice_deposit);
        mint(&env, &token, &admin, &bob, bob_deposit);

        // Alice deposits first (seed ratio 1:1) → 3_000_000 shares
        let alice_shares = vault.deposit(&alice, &alice_deposit);
        assert_eq!(alice_shares, alice_deposit);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Bob deposits into an existing vault at the same price → 1_000_000 shares
        let bob_shares = vault.deposit(&bob, &bob_deposit);
        assert_eq!(bob_shares, bob_deposit);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Shares should reflect the 3:1 ratio
        assert_eq!(
            alice_shares, 3 * bob_shares,
            "Alice's shares must be 3× Bob's shares"
        );

        // --- proportional redemption ---
        let alice_returned = vault.withdraw(&alice, &alice_shares);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        let bob_returned = vault.withdraw(&bob, &bob_shares);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // No yield occurred → exact return
        assert_eq!(alice_returned, alice_deposit, "Alice must recover her full deposit");
        assert_eq!(bob_returned, bob_deposit, "Bob must recover his full deposit");

        // Proportionality: Alice received exactly 3× Bob
        assert_eq!(alice_returned, 3 * bob_returned);

        // Vault must be empty
        assert_eq!(vault.total_assets(), 0);
        assert_eq!(vault.total_shares(), 0);
    }

    /// Five depositors with different amounts.  Each redeems their shares and
    /// receives back their proportional slice of the total assets.
    #[test]
    fn test_lifecycle_five_depositors_proportional_withdrawal() {
        let (env, vault, admin, token) = setup();
        let deposits: &[i128] = &[500_000, 1_000_000, 2_000_000, 3_000_000, 4_500_000];
        let total: i128 = deposits.iter().sum(); // 11_000_000

        let users: std::vec::Vec<Address> = (0..deposits.len())
            .map(|_| Address::generate(&env))
            .collect();

        // All deposits at the same share price (no yield between them).
        let mut shares_per_user: std::vec::Vec<i128> = std::vec::Vec::new();
        for (i, &amount) in deposits.iter().enumerate() {
            mint(&env, &token, &admin, &users[i], amount);
            let s = vault.deposit(&users[i], &amount);
            shares_per_user.push(s);
            assert_invariants(&env, &vault, &users);
        }

        assert_eq!(vault.total_assets(), total);

        // Each user withdraws and should receive their exact deposit back (no yield).
        for (i, &user_shares) in shares_per_user.iter().enumerate() {
            let returned = vault.withdraw(&users[i], &user_shares);
            assert_eq!(
                returned, deposits[i],
                "user {i}: deposited {}, got back {returned}",
                deposits[i]
            );
            assert_invariants(&env, &vault, &users);
        }

        assert_eq!(vault.total_assets(), 0);
        assert_eq!(vault.total_shares(), 0);
    }

    // -----------------------------------------------------------------------
    // AC-3: Deposit after harvest gives correct shares at new price
    // -----------------------------------------------------------------------

    /// Lifecycle:
    ///   1. Alice deposits 1 000 000 → 1 000 000 shares (seed ratio 1:1).
    ///   2. Keeper harvests 500 000 yield → share price rises to 1.5.
    ///   3. Bob deposits 600 000 at the new price.
    ///      Formula: floor(600_000 × 1_000_000 / 1_500_000) = 400_000 shares.
    ///   4. Bob redeems his 400_000 shares → floor(400_000 × 2_100_000 / 1_400_000)
    ///      = 600_000 tokens (exact in this scenario).
    ///   5. Alice redeems 1 000 000 shares → remaining 1 500 000 tokens.
    #[test]
    fn test_lifecycle_deposit_after_harvest_new_share_price() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Step 1: Alice seeds the vault
        mint(&env, &token, &admin, &alice, 1_000_000);
        let alice_shares = vault.deposit(&alice, &1_000_000);
        assert_eq!(alice_shares, 1_000_000);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Step 2: Harvest — share price becomes 1.5 tokens/share
        mint(&env, &token, &admin, &admin, 500_000);
        let price_before_harvest = snapshot_share_price(&vault);
        vault.harvest(&admin, &500_000);
        assert_eq!(vault.total_assets(), 1_500_000);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);
        assert_share_price_not_decreased(price_before_harvest, &vault);

        // Step 3: Bob deposits 600 000 at the elevated price
        // Expected shares = floor(600_000 × 1_000_000 / 1_500_000) = 400_000
        mint(&env, &token, &admin, &bob, 600_000);
        let bob_shares = vault.deposit(&bob, &600_000);
        assert_eq!(
            bob_shares, 400_000,
            "post-harvest deposit: expected 400_000 shares, got {bob_shares}"
        );
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Sanity: vault now holds 2_100_000 tokens, 1_400_000 total shares
        assert_eq!(vault.total_assets(), 2_100_000);
        assert_eq!(vault.total_shares(), 1_400_000);

        // Step 4: Bob redeems — floor(400_000 × 2_100_000 / 1_400_000) = 600_000
        let bob_returned = vault.withdraw(&bob, &bob_shares);
        assert_eq!(
            bob_returned, 600_000,
            "Bob should recover exactly his deposit (no additional yield accrued)"
        );
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Step 5: Alice redeems — she should get all remaining assets (1_500_000)
        let alice_returned = vault.withdraw(&alice, &alice_shares);
        assert_eq!(
            alice_returned, 1_500_000,
            "Alice should receive her deposit plus her share of the yield"
        );
        assert_invariants(&env, &vault, &[alice, bob]);

        assert_eq!(vault.total_assets(), 0);
        assert_eq!(vault.total_shares(), 0);
    }

    /// Extra: verify that depositing at the new price after multiple harvests
    /// still produces the correct share count.
    #[test]
    fn test_lifecycle_deposit_after_multiple_harvests() {
        let (env, vault, admin, token) = setup();
        let seeder = Address::generate(&env);
        let late_depositor = Address::generate(&env);

        // Seed vault: 1_000_000 tokens → 1_000_000 shares
        mint(&env, &token, &admin, &seeder, 1_000_000);
        vault.deposit(&seeder, &1_000_000);

        // Two successive harvests: +200_000 then +300_000
        // After both: total_assets = 1_500_000, total_shares = 1_000_000
        // Share price = 1.5
        for yield_amount in [200_000_i128, 300_000_i128] {
            mint(&env, &token, &admin, &admin, yield_amount);
            let p = snapshot_share_price(&vault);
            vault.harvest(&admin, &yield_amount);
            assert_share_price_not_decreased(p, &vault);
        }
        assert_eq!(vault.total_assets(), 1_500_000);
        assert_eq!(vault.total_shares(), 1_000_000);

        // Late depositor deposits 750_000 → floor(750_000 × 1_000_000 / 1_500_000) = 500_000
        mint(&env, &token, &admin, &late_depositor, 750_000);
        let late_shares = vault.deposit(&late_depositor, &750_000);
        assert_eq!(late_shares, 500_000);
        assert_invariants(&env, &vault, &[seeder.clone(), late_depositor.clone()]);

        // Late depositor withdraws immediately — no additional yield → gets deposit back
        let returned = vault.withdraw(&late_depositor, &late_shares);
        assert_eq!(returned, 750_000);
        assert_invariants(&env, &vault, &[seeder, late_depositor]);
    }

    // -----------------------------------------------------------------------
    // AC-4: Vault paused mid-lifecycle — operations blocked
    // -----------------------------------------------------------------------

    /// Full mid-lifecycle pause scenario:
    ///   1. Alice deposits successfully (pre-pause).
    ///   2. Admin pauses the vault.
    ///   3. Bob's deposit is rejected with VaultPaused.
    ///   4. Alice's withdrawal is rejected with VaultPaused.
    ///   5. Harvest is rejected with VaultPaused.
    ///   6. Admin unpauses.
    ///   7. Bob deposits and Alice withdraws — both succeed.
    ///   8. Balances are consistent throughout.
    #[test]
    fn test_lifecycle_pause_blocks_mid_lifecycle_operations() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Step 1: normal pre-pause deposit
        mint(&env, &token, &admin, &alice, 1_000_000);
        let alice_shares = vault.deposit(&alice, &1_000_000);
        assert_eq!(alice_shares, 1_000_000);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Step 2: pause
        vault.pause(&admin);
        assert!(vault.is_paused(), "vault must report paused after pause()");

        // Step 3-5: all mutating operations must be blocked
        mint(&env, &token, &admin, &bob, 500_000);
        assert_eq!(
            vault.try_deposit(&bob, &500_000),
            Err(Ok(VaultError::VaultPaused)),
            "deposit must be blocked while paused"
        );
        assert_eq!(
            vault.try_withdraw(&alice, &alice_shares),
            Err(Ok(VaultError::VaultPaused)),
            "withdraw must be blocked while paused"
        );
        mint(&env, &token, &admin, &admin, 1_000);
        assert_eq!(
            vault.try_harvest(&admin, &1_000),
            Err(Ok(VaultError::VaultPaused)),
            "harvest must be blocked while paused"
        );

        // Read-only queries must still work during pause
        assert_eq!(vault.total_assets(), 1_000_000);
        assert_eq!(vault.balance_of(&alice), alice_shares);
        // Balances unchanged (no mutation occurred while paused)
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        // Step 6: unpause
        vault.unpause(&admin);
        assert!(!vault.is_paused(), "vault must report unpaused after unpause()");

        // Step 7: operations resume normally after unpause
        let bob_shares = vault.deposit(&bob, &500_000);
        assert_eq!(bob_shares, 500_000);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone()]);

        let alice_returned = vault.withdraw(&alice, &alice_shares);
        assert_eq!(alice_returned, 1_000_000);
        assert_invariants(&env, &vault, &[alice, bob]);
    }

    /// Pausing preserves all existing balances — no state is corrupted.
    #[test]
    fn test_lifecycle_pause_does_not_corrupt_balances() {
        let (env, vault, admin, token) = setup();
        let users: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(&env)).collect();
        let amounts = [1_000_000_i128, 2_000_000_i128, 3_000_000_i128];

        // All three deposit
        for (i, &amount) in amounts.iter().enumerate() {
            mint(&env, &token, &admin, &users[i], amount);
            vault.deposit(&users[i], &amount);
        }
        assert_invariants(&env, &vault, &users);

        let balances_pre_pause: std::vec::Vec<i128> = users.iter().map(|u| vault.balance_of(u)).collect();
        let assets_pre_pause = vault.total_assets();

        // Pause and unpause without any operations
        vault.pause(&admin);
        vault.unpause(&admin);

        // All balances must be identical after the pause/unpause cycle
        for (i, user) in users.iter().enumerate() {
            assert_eq!(
                vault.balance_of(user),
                balances_pre_pause[i],
                "user {i}: balance changed during pause/unpause cycle"
            );
        }
        assert_eq!(vault.total_assets(), assets_pre_pause);
        assert_invariants(&env, &vault, &users);
    }

    // -----------------------------------------------------------------------
    // AC-5: Share price strictly increasing through deposits and harvests
    // -----------------------------------------------------------------------

    /// A sequence of deposits and harvests is performed; after every harvest
    /// the share price must be strictly greater than the price before the
    /// harvest.  Pure deposits (no yield) must not decrease the price.
    #[test]
    fn test_lifecycle_share_price_strictly_increasing_through_harvests() {
        let (env, vault, admin, token) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);

        // Round 1: seed deposit by Alice
        mint(&env, &token, &admin, &alice, 1_000_000);
        vault.deposit(&alice, &1_000_000);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        // Harvest 1: +200_000 → price 1.2
        mint(&env, &token, &admin, &admin, 200_000);
        let p0 = snapshot_share_price(&vault);
        vault.harvest(&admin, &200_000);
        let p1 = snapshot_share_price(&vault);
        assert_share_price_not_decreased(p0, &vault);
        assert!(
            p1.numerator * p0.denominator > p0.numerator * p1.denominator,
            "share price must STRICTLY increase after harvest 1"
        );
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        // Bob deposits at the new elevated price — should not decrease the price
        mint(&env, &token, &admin, &bob, 600_000);
        let p_before_bob = snapshot_share_price(&vault);
        vault.deposit(&bob, &600_000);
        assert_share_price_not_decreased(p_before_bob, &vault);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        // Harvest 2: +500_000 → price must be strictly greater than before harvest 2
        mint(&env, &token, &admin, &admin, 500_000);
        let p2_before = snapshot_share_price(&vault);
        vault.harvest(&admin, &500_000);
        let p2_after = snapshot_share_price(&vault);
        assert_share_price_not_decreased(p2_before, &vault);
        assert!(
            p2_after.numerator * p2_before.denominator > p2_before.numerator * p2_after.denominator,
            "share price must STRICTLY increase after harvest 2"
        );
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        // Charlie deposits at the doubly-elevated price
        mint(&env, &token, &admin, &charlie, 1_000_000);
        let p_before_charlie = snapshot_share_price(&vault);
        vault.deposit(&charlie, &1_000_000);
        assert_share_price_not_decreased(p_before_charlie, &vault);
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        // Harvest 3: +300_000 → price must again be strictly greater
        mint(&env, &token, &admin, &admin, 300_000);
        let p3_before = snapshot_share_price(&vault);
        vault.harvest(&admin, &300_000);
        assert_share_price_not_decreased(p3_before, &vault);
        let p3_after = snapshot_share_price(&vault);
        assert!(
            p3_after.numerator * p3_before.denominator > p3_before.numerator * p3_after.denominator,
            "share price must STRICTLY increase after harvest 3"
        );
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        // Final redemptions: every depositor must receive MORE than they deposited
        let alice_returned = vault.withdraw(&alice, &vault.balance_of(&alice));
        assert!(alice_returned > 1_000_000, "Alice must earn yield");
        assert_invariants(&env, &vault, &[alice.clone(), bob.clone(), charlie.clone()]);

        let bob_returned = vault.withdraw(&bob, &vault.balance_of(&bob));
        assert!(bob_returned > 600_000, "Bob must earn yield");
        assert_invariants(&env, &vault, &[alice, bob.clone(), charlie.clone()]);

        let charlie_returned = vault.withdraw(&charlie, &vault.balance_of(&charlie));
        assert!(charlie_returned > 0, "Charlie must receive at least something");
        assert_invariants(&env, &vault, &[bob, charlie]);
    }

    /// Confirms the per-harvest price progression precisely:
    ///   Deposit 1_000_000 → price = 1.0
    ///   Harvest +500_000  → price = 1.5   (ratio: 1_500_000 / 1_000_000)
    ///   Harvest +750_000  → price = 2.25  (ratio: 2_250_000 / 1_000_000)
    #[test]
    fn test_lifecycle_share_price_exact_progression() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);

        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Price after seed: 1_000_000 / 1_000_000 = 1.0
        {
            let p = snapshot_share_price(&vault);
            assert_eq!(p.numerator, 1_000_000);
            assert_eq!(p.denominator, 1_000_000);
        }

        // Harvest +500_000 → 1_500_000 / 1_000_000
        mint(&env, &token, &admin, &admin, 500_000);
        let p_before = snapshot_share_price(&vault);
        vault.harvest(&admin, &500_000);
        assert_share_price_not_decreased(p_before, &vault);
        {
            let p = snapshot_share_price(&vault);
            assert_eq!(p.numerator, 1_500_000);
            assert_eq!(p.denominator, 1_000_000);
        }

        // Harvest +750_000 → 2_250_000 / 1_000_000
        mint(&env, &token, &admin, &admin, 750_000);
        let p_before2 = snapshot_share_price(&vault);
        vault.harvest(&admin, &750_000);
        assert_share_price_not_decreased(p_before2, &vault);
        {
            let p = snapshot_share_price(&vault);
            assert_eq!(p.numerator, 2_250_000);
            assert_eq!(p.denominator, 1_000_000);
        }

        // User redeems: should receive 2_250_000
        let returned = vault.withdraw(&user, &vault.balance_of(&user));
        assert_eq!(returned, 2_250_000);
        assert_invariants(&env, &vault, &[user]);
    }
}

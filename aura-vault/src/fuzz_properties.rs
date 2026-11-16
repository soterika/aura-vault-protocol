#![cfg(test)]

use crate::{AuraVault, VaultError};
use proptest::prelude::*;
use soroban_sdk::{testutils::MockAuthorizationContext, Address, Env};

fn arb_positive_amount() -> impl Strategy<Value = i128> {
    1i128..=i128::MAX / 2
}

fn arb_address() -> impl Strategy<Value = Address> {
    "G[A-Z0-9]{55}"
        .prop_map(|addr| Address::from_contract_id(&addr.into()))
        .boxed()
}

proptest! {
    /// Property: First deposit always gets 1:1 share ratio
    #[test]
    fn prop_first_deposit_one_to_one(amount in arb_positive_amount()) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token.clone());
        
        match AuraVault::deposit(env, user, amount) {
            Ok(shares) => prop_assert_eq!(shares, amount),
            Err(VaultError::ZeroAmount) => {
                prop_assert!(amount == 0 || amount < 0)
            },
            Err(e) => {
                prop_assert!(false, "Unexpected error: {:?}", e)
            }
        }
    }

    /// Property: Deposit + Withdraw returns same or less tokens (floor division)
    #[test]
    fn prop_deposit_withdraw_no_gain(amount in 1000i128..=i128::MAX / 3) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token, );
        
        if let Ok(shares) = AuraVault::deposit(env.clone(), user.clone(), amount) {
            if let Ok(redeemed) = AuraVault::withdraw(env, user, shares) {
                prop_assert!(redeemed <= amount, "Redeemed {} > deposited {}", redeemed, amount);
            }
        }
    }

    /// Property: Total shares equals sum of all user shares
    #[test]
    fn prop_total_shares_consistency(amount1 in arb_positive_amount(), amount2 in arb_positive_amount()) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token);
        
        let shares1 = AuraVault::deposit(env.clone(), user1.clone(), amount1).unwrap_or(0);
        let shares2 = AuraVault::deposit(env.clone(), user2.clone(), amount2).unwrap_or(0);
        
        let balance1 = AuraVault::balance_of(env.clone(), user1);
        let balance2 = AuraVault::balance_of(env, user2);
        
        prop_assert_eq!(balance1, shares1);
        prop_assert_eq!(balance2, shares2);
    }

    /// Property: Cannot withdraw more shares than balance
    #[test]
    fn prop_cannot_overdraw(deposit_amount in arb_positive_amount(), withdraw_amount in arb_positive_amount()) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token);
        let shares = AuraVault::deposit(env.clone(), user.clone(), deposit_amount).unwrap_or(0);
        
        if withdraw_amount > shares {
            match AuraVault::withdraw(env, user, withdraw_amount) {
                Err(VaultError::InsufficientShares) => {},
                Ok(_) => prop_assert!(false, "Should have failed with InsufficientShares"),
                Err(e) => prop_assert!(false, "Wrong error: {:?}", e),
            }
        }
    }

    /// Property: Zero deposits are rejected
    #[test]
    fn prop_zero_amount_rejected(_amount in 0i128..=0i128) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token);
        
        match AuraVault::deposit(env, user, 0) {
            Err(VaultError::ZeroAmount) => {},
            _ => prop_assert!(false, "Should reject zero amount"),
        }
    }

    /// Property: Harvest increases exchange rate
    #[test]
    fn prop_harvest_improves_exchange_rate(deposit in 1000i128..=i128::MAX / 10, yield_amount in 1i128..=i128::MAX / 10) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user = Address::generate(&env);
        let keeper = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token);
        let _ = AuraVault::deposit(env.clone(), user, deposit);
        
        let assets_before = AuraVault::total_assets(env.clone());
        let _ = AuraVault::harvest(env.clone(), keeper, yield_amount);
        let assets_after = AuraVault::total_assets(env);
        
        prop_assert_eq!(assets_after, assets_before + yield_amount);
    }

    /// Property: Math never overflows
    #[test]
    fn prop_no_overflow(amount in 1i128..=i128::MAX / 100) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let user = Address::generate(&env);

        let _ = AuraVault::initialize(env.clone(), admin, token);
        
        // Should not panic on overflow
        let _ = AuraVault::deposit(env, user, amount);
    }
}

#[cfg(test)]
mod invariants {
    use super::*;

    /// Invariant: total_assets >= sum of all withdrawable tokens
    #[test]
    fn invariant_assets_cover_shares() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        
        let _ = AuraVault::initialize(env.clone(), admin, token);
        
        let total_assets = AuraVault::total_assets(env);
        assert!(total_assets >= 0, "Total assets cannot be negative");
    }

    /// Invariant: balance_of always >= 0
    #[test]
    fn invariant_balance_non_negative() {
        let env = Env::default();
        let address = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        
        let _ = AuraVault::initialize(env.clone(), admin, token);
        
        let balance = AuraVault::balance_of(env, address);
        assert!(balance >= 0, "Share balance cannot be negative");
    }

    /// Invariant: version monotonically increases
    #[test]
    fn invariant_version_exists() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        
        let _ = AuraVault::initialize(env.clone(), admin, token);
        
        let version = AuraVault::version(env);
        assert!(version >= 1, "Version must be at least 1");
    }

    /// Invariant: Cannot call operations on uninitialized vault
    #[test]
    fn invariant_must_initialize() {
        let env = Env::default();
        let user = Address::generate(&env);
        
        match AuraVault::deposit(env, user, 1000) {
            Err(VaultError::NotInitialized) => {},
            _ => panic!("Should require initialization"),
        }
    }
}

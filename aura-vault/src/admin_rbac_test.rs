//! Tests for two-step admin transfer (Issue #353) and role-based access
//! control (Issue #357).
//!
//! These tests cover:
//!
//! **Two-step admin transfer (#353)**
//! - `propose_admin` sets a pending admin (current admin only)
//! - `accept_admin` completes the transfer when called by the pending admin
//! - Proposal expires after 48 hours
//! - `AdminProposed` and `AdminTransferred` events are emitted
//! - Pending admin can be cancelled by the current admin
//! - Only one pending admin at a time
//!
//! **Role-based access control (#357)**
//! - `grant_role` / `revoke_role` restricted to ADMIN
//! - `harvest` requires KEEPER or ADMIN role
//! - `pause` / `unpause` require GUARDIAN or ADMIN role
//! - `initialize` sets deployer as ADMIN
//! - `RoleGranted` / `RoleRevoked` events are emitted
//! - Roles use bitmask for gas efficiency

#![cfg(test)]

use crate::{AuraVault, VaultError};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, IntoVal, Symbol,
};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/// Initialise a fresh vault, returning (env, admin, token, signers).
fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let signer = Address::generate(&env);

    AuraVault::initialize(
        env.clone(),
        admin.clone(),
        token.clone(),
        vec![&env, signer.clone()],
        soroban_sdk::String::from_str(&env, "Aura Vault"),
        soroban_sdk::String::from_str(&env, "AURA"),
    )
    .expect("initialize should succeed");

    (env, admin, token, signer)
}

// ===========================================================================
// Two-step admin transfer (Issue #353)
// ===========================================================================

#[test]
fn test_propose_admin_sets_pending() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose_admin should succeed");

    let pending = AuraVault::pending_admin(env.clone());
    assert_eq!(pending, Some(new_admin));
}

#[test]
fn test_propose_admin_unauthorized_non_admin() {
    let (env, _admin, _token, _signer) = setup();
    let attacker = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let result = AuraVault::propose_admin(env.clone(), attacker, new_admin);
    assert_eq!(result, Err(VaultError::UpgradeUnauthorized));
}

#[test]
fn test_accept_admin_transfers_admin() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose should succeed");

    AuraVault::accept_admin(env.clone(), new_admin.clone())
        .expect("accept_admin should succeed");

    // Pending admin should be cleared
    assert_eq!(AuraVault::pending_admin(env.clone()), None);

    // New admin should hold ADMIN role (bitmask 1)
    let role = AuraVault::get_roles(env.clone(), new_admin.clone());
    assert_eq!(role & 1, 1, "new_admin should have ADMIN role");
}

#[test]
fn test_accept_admin_wrong_caller_fails() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);
    let impostor = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose should succeed");

    let result = AuraVault::accept_admin(env.clone(), impostor);
    assert_eq!(result, Err(VaultError::UpgradeUnauthorized));
}

#[test]
fn test_accept_admin_no_pending_fails() {
    let (env, _admin, _token, _signer) = setup();
    let random = Address::generate(&env);

    let result = AuraVault::accept_admin(env.clone(), random);
    assert_eq!(result, Err(VaultError::NoPendingAdmin));
}

#[test]
fn test_accept_admin_after_expiry_fails() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose should succeed");

    // Advance ledger time past the 48-hour window
    env.ledger().set_timestamp(env.ledger().timestamp() + 172_801);

    let result = AuraVault::accept_admin(env.clone(), new_admin);
    assert_eq!(result, Err(VaultError::PendingAdminExpired));
    // Pending admin should be cleared after expiry detection
    assert_eq!(AuraVault::pending_admin(env.clone()), None);
}

#[test]
fn test_cancel_admin_clears_pending() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose should succeed");

    AuraVault::cancel_admin(env.clone(), admin.clone())
        .expect("cancel_admin should succeed");

    assert_eq!(AuraVault::pending_admin(env.clone()), None);
}

#[test]
fn test_cancel_admin_unauthorized_fails() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin)
        .expect("propose should succeed");

    let result = AuraVault::cancel_admin(env.clone(), attacker);
    assert_eq!(result, Err(VaultError::UpgradeUnauthorized));
}

#[test]
fn test_cancel_admin_no_pending_fails() {
    let (env, admin, _token, _signer) = setup();

    let result = AuraVault::cancel_admin(env.clone(), admin);
    assert_eq!(result, Err(VaultError::NoPendingAdmin));
}

#[test]
fn test_propose_admin_overwrites_previous() {
    let (env, admin, _token, _signer) = setup();
    let first_pending = Address::generate(&env);
    let second_pending = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), first_pending.clone())
        .expect("first propose should succeed");

    // Second proposal overwrites the first
    AuraVault::propose_admin(env.clone(), admin.clone(), second_pending.clone())
        .expect("second propose should succeed");

    assert_eq!(AuraVault::pending_admin(env.clone()), Some(second_pending));
}

#[test]
fn test_propose_admin_emits_event() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose should succeed");

    let events = env.events().all();
    let has_event = events.iter().any(|(_, topics, _)| {
        // Check that AdminProposed event was emitted
        if let Some(first) = topics.get(0) {
            let sym: Result<Symbol, _> = first.try_into();
            if let Ok(s) = sym {
                return s == Symbol::new(&env, "AdminProposed");
            }
        }
        false
    });
    assert!(has_event, "AdminProposed event should have been emitted");
}

#[test]
fn test_accept_admin_emits_transferred_event() {
    let (env, admin, _token, _signer) = setup();
    let new_admin = Address::generate(&env);

    AuraVault::propose_admin(env.clone(), admin.clone(), new_admin.clone())
        .expect("propose should succeed");

    AuraVault::accept_admin(env.clone(), new_admin.clone())
        .expect("accept should succeed");

    let events = env.events().all();
    let has_event = events.iter().any(|(_, topics, _)| {
        if let Some(first) = topics.get(0) {
            let sym: Result<Symbol, _> = first.try_into();
            if let Ok(s) = sym {
                return s == Symbol::new(&env, "AdminTransferred");
            }
        }
        false
    });
    assert!(has_event, "AdminTransferred event should have been emitted");
}

// ===========================================================================
// Role-based access control (Issue #357)
// ===========================================================================

#[test]
fn test_initialize_sets_admin_role() {
    let (env, admin, _token, _signer) = setup();

    let role = AuraVault::get_roles(env.clone(), admin);
    assert_eq!(role & 1, 1, "Admin should have ROLE_ADMIN (bitmask 1)");
}

#[test]
fn test_grant_role_keeper() {
    let (env, admin, _token, _signer) = setup();
    let keeper = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("grant_role should succeed");

    let role = AuraVault::get_roles(env.clone(), keeper.clone());
    assert_eq!(role & 2, 2, "Keeper should have ROLE_KEEPER (bitmask 2)");

    // has_role_query convenience function
    assert!(AuraVault::has_role_query(env.clone(), keeper, 2));
}

#[test]
fn test_grant_role_guardian() {
    let (env, admin, _token, _signer) = setup();
    let guardian = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 4, guardian.clone())
        .expect("grant_role should succeed");

    assert_eq!(AuraVault::get_roles(env.clone(), guardian) & 4, 4);
}

#[test]
fn test_grant_role_unauthorized_fails() {
    let (env, _admin, _token, _signer) = setup();
    let attacker = Address::generate(&env);
    let victim = Address::generate(&env);

    let result = AuraVault::grant_role(env.clone(), attacker, 2, victim);
    assert_eq!(result, Err(VaultError::UpgradeUnauthorized));
}

#[test]
fn test_revoke_role_keeper() {
    let (env, admin, _token, _signer) = setup();
    let keeper = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("grant should succeed");
    AuraVault::revoke_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("revoke should succeed");

    assert_eq!(AuraVault::get_roles(env.clone(), keeper) & 2, 0);
}

#[test]
fn test_revoke_role_unauthorized_fails() {
    let (env, admin, _token, _signer) = setup();
    let keeper = Address::generate(&env);
    let attacker = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("grant should succeed");

    let result = AuraVault::revoke_role(env.clone(), attacker, 2, keeper);
    assert_eq!(result, Err(VaultError::UpgradeUnauthorized));
}

#[test]
fn test_grant_role_emits_event() {
    let (env, admin, _token, _signer) = setup();
    let keeper = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper)
        .expect("grant_role should succeed");

    let events = env.events().all();
    let has_event = events.iter().any(|(_, topics, _)| {
        if let Some(first) = topics.get(0) {
            let sym: Result<Symbol, _> = first.try_into();
            if let Ok(s) = sym {
                return s == Symbol::new(&env, "RoleGranted");
            }
        }
        false
    });
    assert!(has_event, "RoleGranted event should have been emitted");
}

#[test]
fn test_revoke_role_emits_event() {
    let (env, admin, _token, _signer) = setup();
    let keeper = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("grant should succeed");
    AuraVault::revoke_role(env.clone(), admin.clone(), 2, keeper)
        .expect("revoke should succeed");

    let events = env.events().all();
    let has_event = events.iter().any(|(_, topics, _)| {
        if let Some(first) = topics.get(0) {
            let sym: Result<Symbol, _> = first.try_into();
            if let Ok(s) = sym {
                return s == Symbol::new(&env, "RoleRevoked");
            }
        }
        false
    });
    assert!(has_event, "RoleRevoked event should have been emitted");
}

#[test]
fn test_bitmask_multiple_roles() {
    let (env, admin, _token, _signer) = setup();
    let multi = Address::generate(&env);

    // Grant KEEPER (2) and GUARDIAN (4) to the same address
    AuraVault::grant_role(env.clone(), admin.clone(), 2, multi.clone())
        .expect("grant keeper should succeed");
    AuraVault::grant_role(env.clone(), admin.clone(), 4, multi.clone())
        .expect("grant guardian should succeed");

    let mask = AuraVault::get_roles(env.clone(), multi.clone());
    assert_eq!(mask & 2, 2, "should have KEEPER");
    assert_eq!(mask & 4, 4, "should have GUARDIAN");

    // Revoke KEEPER, GUARDIAN should remain
    AuraVault::revoke_role(env.clone(), admin.clone(), 2, multi.clone())
        .expect("revoke keeper should succeed");

    let mask_after = AuraVault::get_roles(env.clone(), multi);
    assert_eq!(mask_after & 2, 0, "KEEPER should be revoked");
    assert_eq!(mask_after & 4, 4, "GUARDIAN should remain");
}

// ===========================================================================
// RBAC enforcement on harvest / pause / unpause
// ===========================================================================

#[test]
fn test_pause_requires_guardian_or_admin() {
    let (env, admin, _token, _signer) = setup();
    let random = Address::generate(&env);

    // Random address (no role) should not be able to pause
    let result = AuraVault::pause(env.clone(), random.clone());
    assert_eq!(result, Err(VaultError::Unauthorized));

    // Admin can pause (has ADMIN role)
    AuraVault::pause(env.clone(), admin.clone()).expect("admin should pause");
    AuraVault::unpause(env.clone(), admin.clone()).expect("admin should unpause");
}

#[test]
fn test_guardian_can_pause_and_unpause() {
    let (env, admin, _token, _signer) = setup();
    let guardian = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 4, guardian.clone())
        .expect("grant GUARDIAN should succeed");

    AuraVault::pause(env.clone(), guardian.clone())
        .expect("guardian should be able to pause");
    AuraVault::unpause(env.clone(), guardian.clone())
        .expect("guardian should be able to unpause");
}

#[test]
fn test_keeper_cannot_pause() {
    let (env, admin, _token, _signer) = setup();
    let keeper = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("grant KEEPER should succeed");

    let result = AuraVault::pause(env.clone(), keeper);
    assert_eq!(result, Err(VaultError::Unauthorized));
}

#[test]
fn test_keeper_can_harvest() {
    let (env, admin, token, _signer) = setup();
    let keeper = Address::generate(&env);

    AuraVault::grant_role(env.clone(), admin.clone(), 2, keeper.clone())
        .expect("grant KEEPER should succeed");

    // The vault needs a depositor before harvest is meaningful.
    // We can't actually call harvest here without a real token contract,
    // but we verify the role check passes and only fails on the token setup.
    // In the test environment with mock auths we expect ZeroShares (no shares yet),
    // which means the role check passed.
    let result = AuraVault::harvest(env.clone(), keeper, 1_000);
    // ZeroShares = role check passed, vault has no depositors
    assert_eq!(result, Err(VaultError::ZeroShares));
}

#[test]
fn test_unauthorized_address_cannot_harvest() {
    let (env, _admin, _token, _signer) = setup();
    let random = Address::generate(&env);

    let result = AuraVault::harvest(env.clone(), random, 1_000);
    assert_eq!(result, Err(VaultError::Unauthorized));
}

#[test]
fn test_admin_can_harvest() {
    let (env, admin, _token, _signer) = setup();

    // Admin has ROLE_ADMIN so harvest role check passes; fails with ZeroShares
    let result = AuraVault::harvest(env.clone(), admin, 1_000);
    assert_eq!(result, Err(VaultError::ZeroShares));
}

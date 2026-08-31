//! Tests for issues #380, #381, #382, #383.
//!
//! # Coverage
//!
//! - **#383** — `price_precision` in `initialize`; default; `share_price`; `get_price_precision`.
//! - **#382** — Every mutating function calls `require_auth`; spoofed caller rejected.
//! - **#380** — `bump_storage` refreshes TTLs and emits `StorageBumped` event.
//! - **#381** — `export_state` returns a complete `VaultSnapshot`.

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient, VaultError};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Deploy + initialise a vault with an explicit `price_precision`.
/// Returns (env, client, admin, token_address).
fn setup_with_precision(
    precision: u32,
) -> (Env, AuraVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_address, &signers, &precision);
    vault.set_fees(&admin, &0_u32, &0_u32);

    (env, vault, admin, token_address)
}

/// Deploy + initialise a vault with the default precision (pass 0).
fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
    setup_with_precision(0)
}

fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(recipient, &amount);
}

// ===========================================================================
// Issue #383 — Configurable share price precision
// ===========================================================================

/// Initialising with `price_precision = 0` should fall back to `10^7`.
#[test]
fn test_383_default_precision_is_10_pow_7() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.get_price_precision(), 10_000_000_u32);
}

/// Initialising with an explicit precision stores and returns it exactly.
#[test]
fn test_383_explicit_precision_stored() {
    let (_env, vault, _admin, _token) = setup_with_precision(1_000_000);
    assert_eq!(vault.get_price_precision(), 1_000_000_u32);
}

/// `share_price` returns 0 for an empty vault (no division by zero).
#[test]
fn test_383_share_price_empty_vault_is_zero() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.share_price(), 0_i128);
}

/// After the first deposit (1:1 seed ratio) the share price should equal
/// `price_precision` (because `total_deposited == total_shares == amount`).
#[test]
fn test_383_share_price_after_seed_deposit_equals_precision() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 5_000_000);

    vault.deposit(&user, &5_000_000_i128);

    // share_price = total_deposited * precision / total_shares
    //             = 5_000_000 * 10_000_000 / 5_000_000 = 10_000_000
    assert_eq!(vault.share_price(), 10_000_000_i128);
}

/// After a harvest the share price should increase above `price_precision`.
#[test]
fn test_383_share_price_increases_after_harvest() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 5_000_000);
    vault.deposit(&user, &5_000_000_i128);

    let price_before = vault.share_price();

    // Inject 500_000 yield (10 % of deposited)
    mint(&env, &token, &admin, &user, 500_000);
    vault.harvest(&user, &500_000_i128);

    let price_after = vault.share_price();
    assert!(price_after > price_before, "price should increase after harvest");
}

/// Custom 6-decimal precision (`10^6`) is stored and used correctly.
#[test]
fn test_383_custom_6_decimal_precision() {
    let (env, vault, admin, token) = setup_with_precision(1_000_000);
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000_i128);

    // 1:1 seed → share_price = 1_000_000 * 1_000_000 / 1_000_000 = 1_000_000
    assert_eq!(vault.share_price(), 1_000_000_i128);
    assert_eq!(vault.get_price_precision(), 1_000_000_u32);
}

// ===========================================================================
// Issue #382 — Soroban auth context validation
// ===========================================================================

/// `deposit` with a spoofed `caller` that does not authorise the call should
/// be rejected.  We simulate this by disabling mock_all_auths and relying on
/// the Soroban test environment to reject unauthorised calls.
#[test]
fn test_382_deposit_requires_caller_auth() {
    let env = Env::default();
    // Do NOT call env.mock_all_auths() — auths must be explicit.

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let attacker = Address::generate(&env);

    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    // Initialise using mock_all_auths temporarily
    env.mock_all_auths();
    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_address, &signers, &0_u32);
    vault.set_fees(&admin, &0_u32, &0_u32);

    // Mint tokens to `user`
    StellarAssetClient::new(&env, &token_address).mint(&user, &1_000_000);

    // Attempt deposit where the `caller` arg is `user` but authorised by
    // `attacker`.  Soroban requires the authorised address to match `caller`,
    // so this must panic / return an auth error.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &vault_address,
            fn_name: "deposit",
            args: soroban_sdk::vec![
                &env,
                user.clone().into(),
                1_000_000_i128.into(),
            ],
            sub_invokes: &[],
        },
    }]);

    let result = vault.try_deposit(&user, &1_000_000_i128);
    // Should fail — auth provided by attacker, not user.
    assert!(
        result.is_err(),
        "deposit must reject when caller auth is provided by a different address"
    );
}

/// `withdraw` must reject when the caller has not authorised the transaction.
#[test]
fn test_382_withdraw_requires_caller_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_address, &signers, &0_u32);
    vault.set_fees(&admin, &0_u32, &0_u32);

    StellarAssetClient::new(&env, &token_address).mint(&user, &1_000_000);
    vault.deposit(&user, &1_000_000_i128);

    // Attempt withdraw with attacker's auth instead of user's auth.
    let attacker = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &vault_address,
            fn_name: "withdraw",
            args: soroban_sdk::vec![
                &env,
                user.clone().into(),
                1_000_i128.into(),
            ],
            sub_invokes: &[],
        },
    }]);

    let result = vault.try_withdraw(&user, &1_000_i128);
    assert!(
        result.is_err(),
        "withdraw must reject when caller auth is provided by attacker"
    );
}

/// Every admin-gated mutating function must enforce identity via `require_auth`.
/// We verify that calling with a wrong admin address returns an error.
#[test]
fn test_382_admin_functions_reject_non_admin() {
    let (env, vault, _admin, _token) = setup();
    let impersonator = Address::generate(&env);

    // pause — non-admin should be rejected
    let result = vault.try_pause(&impersonator);
    assert!(result.is_err(), "pause must reject non-admin");

    // unpause
    let result2 = vault.try_unpause(&impersonator);
    assert!(result2.is_err(), "unpause must reject non-admin");
}

/// `harvest` requires `caller.require_auth()` — an address that has not
/// granted auth should be rejected.
#[test]
fn test_382_harvest_requires_caller_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_address, &signers, &0_u32);
    vault.set_fees(&admin, &0_u32, &0_u32);

    // Seed the vault
    StellarAssetClient::new(&env, &token_address).mint(&user, &1_000_000);
    vault.deposit(&user, &1_000_000_i128);

    // Try to harvest with attacker auth, not keeper auth
    let attacker = Address::generate(&env);
    StellarAssetClient::new(&env, &token_address).mint(&attacker, &100_000);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &vault_address,
            fn_name: "harvest",
            // caller arg is `user`, but auth is from `attacker` — mismatch.
            args: soroban_sdk::vec![
                &env,
                user.clone().into(),
                100_000_i128.into(),
            ],
            sub_invokes: &[],
        },
    }]);

    let result = vault.try_harvest(&user, &100_000_i128);
    assert!(
        result.is_err(),
        "harvest must reject when auth is from a different address than caller"
    );
}

// ===========================================================================
// Issue #380 — bump_storage keeper function
// ===========================================================================

/// `bump_storage` succeeds on an initialised vault and returns at least 1.
#[test]
fn test_380_bump_storage_returns_positive_count() {
    let (_env, vault, _admin, _token) = setup();
    let result = vault.bump_storage(&None);
    assert!(result >= 1, "bump_storage must report at least the instance bump");
}

/// `bump_storage` with a user hint bumps per-user keys as well.
#[test]
fn test_380_bump_storage_with_user_bumps_more_keys() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000_i128);

    let count_without_user = vault.bump_storage(&None);
    let count_with_user = vault.bump_storage(&Some(user));
    // With user keys existing (Balance + UserCheckpoint + UserPendingYield)
    // we expect more bumps than without.
    assert!(
        count_with_user > count_without_user,
        "bump_storage with user hint should bump more keys"
    );
}

/// `bump_storage` on an uninitialised vault returns `NotInitialized`.
#[test]
fn test_380_bump_storage_uninitialised_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    let result = vault.try_bump_storage(&None);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

/// `bump_storage` is permissionless — any address can call it.
#[test]
fn test_380_bump_storage_permissionless() {
    let (env, vault, _admin, _token) = setup();
    let random = Address::generate(&env);
    // Should not require any auth from `random`
    let _ = vault.bump_storage(&None);
    // Also works when called with a random user
    let count = vault.bump_storage(&Some(random));
    // random has no keys yet, so only instance bump
    assert_eq!(count, 1);
}

// ===========================================================================
// Issue #381 — export_state VaultSnapshot
// ===========================================================================

/// `export_state` returns the correct totals after deposit + harvest.
#[test]
fn test_381_export_state_reflects_current_vault_state() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 2_000_000);
    vault.deposit(&user, &2_000_000_i128);

    // Inject 200_000 yield
    mint(&env, &token, &admin, &user, 200_000);
    vault.harvest(&user, &200_000_i128);

    let snapshot = vault.export_state();

    assert_eq!(snapshot.total_assets, vault.total_assets());
    assert_eq!(snapshot.total_shares, vault.total_shares());
    assert_eq!(snapshot.is_paused, vault.is_paused());
    assert_eq!(snapshot.price_precision, vault.get_price_precision());
}

/// Verify individual snapshot fields more precisely.
#[test]
fn test_381_export_state_fields() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000_i128);

    let snapshot = vault.export_state();

    assert_eq!(snapshot.total_assets, 1_000_000_i128);
    assert_eq!(snapshot.total_shares, 1_000_000_i128);
    assert!(!snapshot.is_paused);
    assert_eq!(snapshot.price_precision, 10_000_000_u32);
    // fee_bps was set to 0 in setup
    assert_eq!(snapshot.fee_bps, 0_u32);
    // version starts at 1
    assert_eq!(snapshot.version, 1_u32);
}

/// `export_state` on uninitialised vault returns `NotInitialized`.
#[test]
fn test_381_export_state_uninitialised_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    let result = vault.try_export_state();
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

/// Pause state is reflected in the snapshot.
#[test]
fn test_381_export_state_reflects_pause() {
    let (_env, vault, admin, _token) = setup();
    vault.pause(&admin);

    let snapshot = vault.export_state();
    assert!(snapshot.is_paused);
}

/// `price_precision` in the snapshot matches what was set in `initialize`.
#[test]
fn test_381_export_state_price_precision_matches_initialize() {
    let (_env, vault, _admin, _token) = setup_with_precision(1_000_000);
    let snapshot = vault.export_state();
    assert_eq!(snapshot.price_precision, 1_000_000_u32);
}

/// TVL cap is included in the snapshot.
#[test]
fn test_381_export_state_tvl_cap() {
    let (_env, vault, admin, _token) = setup();
    vault.set_tvl_cap(&admin, &5_000_000_i128);

    let snapshot = vault.export_state();
    assert_eq!(snapshot.tvl_cap, 5_000_000_i128);
}

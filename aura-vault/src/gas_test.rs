// Gas measurement harness for AuraVault contract functions.
//
// Each test measures CPU-instruction cost for one representative invocation of
// every public entry-point.  Results are written as JSON to the file path given
// by the GAS_OUTPUT environment variable (default: gas-measurements.json in the
// repo root).
//
// Usage:
//   cargo test --test-threads=1 gas_ -- --nocapture 2>/dev/null
//
// The JSON format emitted is:
//   { "function": "<name>", "cpu_instructions": <u64>, "memory_bytes": <u64> }
// One object per line (NDJSON / JSON-lines) so that the compare script can
// stream-parse it.

#![cfg(test)]

extern crate std;

use std::env;
use std::fs::OpenOptions;
use std::io::Write;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Deploy + initialise a fresh vault.
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
    vault.set_fees(&admin, &0_u32, &0_u32);

    (env, vault, admin, token_address)
}

fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(recipient, &amount);
}

/// Reset the budget, run `f`, then record cpu+memory cost.
/// Appends one JSON line to the output file.
fn measure<F: FnOnce()>(env: &Env, name: &str, f: F) {
    // Reset the instruction/memory counter before the call.
    env.cost_estimate().budget().reset_default();

    f();

    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();

    let line = std::format!(
        r#"{{"function":"{}","cpu_instructions":{},"memory_bytes":{}}}"#,
        name, cpu, mem
    );

    // Emit to stdout so `cargo test -- --nocapture` shows raw numbers.
    std::println!("GAS_MEASURE: {}", line);

    // Append to the output file.
    let output_path = env::var("GAS_OUTPUT")
        .unwrap_or_else(|_| "../gas-measurements.json".to_string());

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&output_path)
    {
        let _ = writeln!(file, "{}", line);
    }
}

// ---------------------------------------------------------------------------
// Gas tests — one per public entry-point
// ---------------------------------------------------------------------------

#[test]
fn gas_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let signers: Vec<Address> = Vec::new(&env);

    measure(&env, "initialize", || {
        vault.initialize(&admin, &token, &signers, &0_u32);
    });
}

#[test]
fn gas_deposit() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);

    measure(&env, "deposit", || {
        vault.deposit(&user, &1_000_000);
    });
}

#[test]
fn gas_withdraw() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let shares = vault.balance_of(&user);

    measure(&env, "withdraw", || {
        vault.withdraw(&user, &shares);
    });
}

#[test]
fn gas_harvest() {
    let (env, vault, admin, token) = setup();
    // Need at least one depositor so total_shares > 0.
    let depositor = Address::generate(&env);
    mint(&env, &token, &admin, &depositor, 1_000_000);
    vault.deposit(&depositor, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 500_000);

    measure(&env, "harvest", || {
        vault.harvest(&keeper, &500_000);
    });
}

#[test]
fn gas_harvest_token() {
    let (env, vault, admin, token) = setup();
    // Register an alt yield token.
    let alt_token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    vault.register_yield_token(&alt_token_address);

    // Seed depositor.
    let depositor = Address::generate(&env);
    mint(&env, &token, &admin, &depositor, 1_000_000);
    vault.deposit(&depositor, &1_000_000);

    // Give keeper alt tokens.
    let keeper = Address::generate(&env);
    StellarAssetClient::new(&env, &alt_token_address).mint(&keeper, &500_000);

    measure(&env, "harvest_token", || {
        vault.harvest_token(&keeper, &alt_token_address, &500_000, &500_000);
    });
}

#[test]
fn gas_register_yield_token() {
    let (env, vault, admin, _token) = setup();
    let alt = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    measure(&env, "register_yield_token", || {
        vault.register_yield_token(&alt);
    });
}

#[test]
fn gas_pause() {
    let (env, vault, admin, _token) = setup();

    measure(&env, "pause", || {
        vault.pause(&admin);
    });
}

#[test]
fn gas_unpause() {
    let (env, vault, admin, _token) = setup();
    vault.pause(&admin);

    measure(&env, "unpause", || {
        vault.unpause(&admin);
    });
}

#[test]
fn gas_is_paused() {
    let (env, vault, _admin, _token) = setup();

    measure(&env, "is_paused", || {
        let _ = vault.is_paused();
    });
}

#[test]
fn gas_set_fees() {
    let (env, vault, admin, _token) = setup();

    measure(&env, "set_fees", || {
        vault.set_fees(&admin, &100_u32, &50_u32);
    });
}

#[test]
fn gas_set_treasury() {
    let (env, vault, admin, _token) = setup();
    let treasury = Address::generate(&env);

    measure(&env, "set_treasury", || {
        vault.set_treasury(&admin, &treasury);
    });
}

#[test]
fn gas_withdraw_fees() {
    let (env, vault, admin, token) = setup();
    // Set a fee and perform a harvest to accumulate fees.
    vault.set_fees(&admin, &500_u32, &0_u32); // 5% performance fee
    let treasury = Address::generate(&env);
    vault.set_treasury(&admin, &treasury);

    let depositor = Address::generate(&env);
    mint(&env, &token, &admin, &depositor, 1_000_000);
    vault.deposit(&depositor, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 100_000);
    vault.harvest(&keeper, &100_000);

    measure(&env, "withdraw_fees", || {
        vault.withdraw_fees(&admin);
    });
}

#[test]
fn gas_total_fees_collected() {
    let (env, vault, _admin, _token) = setup();

    measure(&env, "total_fees_collected", || {
        let _ = vault.total_fees_collected();
    });
}

#[test]
fn gas_total_assets() {
    let (env, vault, _admin, _token) = setup();

    measure(&env, "total_assets", || {
        let _ = vault.total_assets();
    });
}

#[test]
fn gas_balance_of() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);

    measure(&env, "balance_of", || {
        let _ = vault.balance_of(&user);
    });
}

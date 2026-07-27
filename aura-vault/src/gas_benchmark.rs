/// Gas benchmark tests for the Aura Vault Protocol.
///
/// Each benchmark isolates a single contract function, resets the Soroban CPU
/// budget before the call, invokes the function, and prints a tagged JSON line:
///
///   GAS_MEASUREMENT: {"function":"deposit","cpu_instructions":<n>,"mem_bytes":<m>}
///
/// The `scripts/measure-gas.sh` script grep-extracts these lines and assembles
/// `gas-report.json`.  The `scripts/compare-gas.py` script diffs against
/// `gas-baselines.json` and exits non-zero if any function regresses by > 10 %.
///
/// Run manually:
///   cd aura-vault
///   cargo test gas_bench -- --nocapture 2>&1 | grep GAS_MEASUREMENT
///
/// Note: Soroban SDK 22 uses `env.cost_estimate().budget()` for budget access.
/// CPU instruction counts are conservative estimates when running natively (not
/// in WASM); they are consistent and therefore still useful for regression
/// detection within the same toolchain.
#[cfg(test)]
mod gas_bench {
    extern crate std;
    use std::println;

    use soroban_sdk::{
        testutils::Address as _,
        token::StellarAssetClient,
        Address, Env, Vec,
    };

    use crate::{AuraVault, AuraVaultClient};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_addr = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);

        let signers: Vec<Address> = Vec::new(&env);
        vault.initialize(&admin, &token_addr, &signers);
        vault.set_fees(&admin, &0_u32, &0_u32);

        (env, vault, admin, token_addr)
    }

    fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// Reset budget, run `f`, emit the measurement JSON line.
    fn measure<F: FnOnce()>(env: &Env, fn_name: &str, f: F) {
        env.cost_estimate().budget().reset_default();
        f();
        let cpu = env.cost_estimate().budget().cpu_instruction_cost();
        let mem = env.cost_estimate().budget().memory_bytes_cost();
        println!(
            "GAS_MEASUREMENT: {{\"function\":\"{}\",\"cpu_instructions\":{},\"mem_bytes\":{}}}",
            fn_name, cpu, mem
        );
    }

    // -----------------------------------------------------------------------
    // Benchmarks — one per public contract entry point
    // -----------------------------------------------------------------------

    /// `initialize` — first-time vault setup.
    #[test]
    fn bench_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_addr = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);

        let signers: Vec<Address> = Vec::new(&env);

        measure(&env, "initialize", || {
            vault.initialize(&admin, &token_addr, &signers);
        });
    }

    /// `deposit` — first depositor (1-to-1 mint ratio).
    #[test]
    fn bench_deposit() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);

        measure(&env, "deposit", || {
            vault.deposit(&user, &1_000_000);
        });
    }

    /// `withdraw` — burn all shares after a single deposit.
    #[test]
    fn bench_withdraw() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);
        let shares = vault.balance_of(&user);

        measure(&env, "withdraw", || {
            vault.withdraw(&user, &shares);
        });
    }

    /// `harvest` — inject yield into a vault that already has deposits.
    #[test]
    fn bench_harvest() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 1_000_000);
        vault.deposit(&user, &1_000_000);

        // Keeper mints yield tokens directly to the vault address
        let vault_addr = vault.address.clone();
        mint(&env, &token, &admin, &vault_addr, 50_000);

        measure(&env, "harvest", || {
            vault.harvest(&admin, &50_000);
        });
    }

    /// `pause` — admin halts the vault.
    #[test]
    fn bench_pause() {
        let (env, vault, admin, _token) = setup();

        measure(&env, "pause", || {
            vault.pause(&admin);
        });
    }

    /// `unpause` — admin resumes the vault.
    #[test]
    fn bench_unpause() {
        let (env, vault, admin, _token) = setup();
        vault.pause(&admin);

        measure(&env, "unpause", || {
            vault.unpause(&admin);
        });
    }

    /// `is_paused` — read-only state check.
    #[test]
    fn bench_is_paused() {
        let (env, vault, _admin, _token) = setup();

        measure(&env, "is_paused", || {
            vault.is_paused();
        });
    }

    /// `total_assets` — read total underlying tokens.
    #[test]
    fn bench_total_assets() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 500_000);
        vault.deposit(&user, &500_000);

        measure(&env, "total_assets", || {
            vault.total_assets();
        });
    }

    /// `balance_of` — read share balance for a specific address.
    #[test]
    fn bench_balance_of() {
        let (env, vault, admin, token) = setup();
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, 500_000);
        vault.deposit(&user, &500_000);

        measure(&env, "balance_of", || {
            vault.balance_of(&user);
        });
    }

    /// `upgrade` — admin performs a contract upgrade (dummy wasm hash; cost
    /// reflects auth + storage reads which are the dominant budget drivers).
    #[test]
    fn bench_upgrade() {
        let (env, vault, admin, _token) = setup();

        measure(&env, "upgrade", || {
            // Upgrading with a zeroed hash will be rejected on-chain but the
            // budget tracking here captures the auth + read overhead.
            let _ = vault
                .try_upgrade(&admin, &soroban_sdk::BytesN::from_array(&env, &[0u8; 32]));
        });
    }

    /// `set_fees` — admin sets protocol fee rates.
    #[test]
    fn bench_set_fees() {
        let (env, vault, admin, _token) = setup();

        measure(&env, "set_fees", || {
            vault.set_fees(&admin, &50_u32, &50_u32);
        });
    }
}

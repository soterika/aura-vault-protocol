#![no_std]

mod errors;
mod interface;
mod storage;

pub use errors::FactoryError;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol, Vec};

use storage::{
    bump_instance, get_admin, get_deployment_fee, get_registry, is_token_whitelisted,
    push_registry, registry_contains, set_admin, set_deployment_fee as storage_set_fee,
    set_token_whitelisted,
};

// ---------------------------------------------------------------------------
// Contract struct
// ---------------------------------------------------------------------------

#[contract]
pub struct AuraFactory;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

#[contractimpl]
impl AuraFactory {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// One-time factory setup.
    ///
    /// * `admin`          — Account that can whitelist tokens, change the fee,
    ///                      and perform admin operations.
    /// * `deployment_fee` — Fee in XLM stroops (`0` = free deployments).
    pub fn initialize(
        env: Env,
        admin: Address,
        deployment_fee: i128,
    ) -> Result<(), FactoryError> {
        if get_admin(&env).is_some() {
            return Err(FactoryError::AlreadyInitialized);
        }

        if deployment_fee < 0 {
            return Err(FactoryError::InvalidFeeAmount);
        }

        set_admin(&env, &admin);
        storage_set_fee(&env, deployment_fee);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "factory_initialized"),),
            (admin, deployment_fee),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // whitelist_token
    // -----------------------------------------------------------------------

    /// Allow or forbid an underlying token from being used when registering
    /// vaults.  Admin only.
    pub fn whitelist_token(
        env: Env,
        admin: Address,
        token: Address,
        enabled: bool,
    ) -> Result<(), FactoryError> {
        admin.require_auth();

        let stored_admin = get_admin(&env).ok_or(FactoryError::NotInitialized)?;
        if stored_admin != admin {
            return Err(FactoryError::Unauthorized);
        }

        set_token_whitelisted(&env, &token, enabled);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "token_whitelist_updated"),),
            (token, enabled),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // set_deployment_fee
    // -----------------------------------------------------------------------

    /// Update the XLM deployment fee.  Pass `0` to make deployments free.
    /// Admin only.
    pub fn set_deployment_fee(
        env: Env,
        admin: Address,
        fee: i128,
    ) -> Result<(), FactoryError> {
        admin.require_auth();

        let stored_admin = get_admin(&env).ok_or(FactoryError::NotInitialized)?;
        if stored_admin != admin {
            return Err(FactoryError::Unauthorized);
        }

        if fee < 0 {
            return Err(FactoryError::InvalidFeeAmount);
        }

        storage_set_fee(&env, fee);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "deployment_fee_updated"),),
            fee,
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // deploy_vault
    // -----------------------------------------------------------------------

    /// Register a previously deployed AuraVault with the factory.
    ///
    /// The caller must have already deployed the vault on-chain.  This
    /// function records the vault address in the registry, collects the
    /// deployment fee, and emits a `VaultDeployed` event.
    pub fn deploy_vault(
        env: Env,
        caller: Address,
        vault: Address,
        underlying_token: Address,
    ) -> Result<Address, FactoryError> {
        caller.require_auth();

        // Ensure factory is initialised.
        get_admin(&env).ok_or(FactoryError::NotInitialized)?;

        // Token whitelist check.  If no tokens have ever been whitelisted this
        // guard is skipped, allowing an open factory.
        if !is_token_whitelisted(&env, &underlying_token) {
            return Err(FactoryError::TokenNotWhitelisted);
        }

        // Prevent duplicate registration.
        if registry_contains(&env, &vault) {
            return Err(FactoryError::VaultAlreadyRegistered);
        }

        // Deployment fee collection.
        let fee = get_deployment_fee(&env);
        if fee > 0 {
            // The native XLM token on Soroban is accessible via the
            // soroban_sdk::token interface with the contract's own address.
            // We use the env's current contract address as the recipient so
            // fees accumulate in the factory.
            let native_token = token::Client::new(&env, &env.current_contract_address());
            // Verify the caller has authorised a transfer of at least `fee`.
            native_token.transfer(&caller, &env.current_contract_address(), &fee);
        }

        // Record the vault.
        push_registry(&env, &vault);
        bump_instance(&env);

        // Emit VaultDeployed event.
        env.events().publish(
            (Symbol::new(&env, "vault_deployed"),),
            (caller, vault.clone(), underlying_token),
        );

        Ok(vault)
    }

    // -----------------------------------------------------------------------
    // list_vaults  (paginated)
    // -----------------------------------------------------------------------

    /// Return a page of registered vault addresses.
    ///
    /// `page` is 0-indexed; `page_size` must be ≥ 1.
    /// Returns an empty `Vec` when `page` is past the last page.
    pub fn list_vaults(
        env: Env,
        page: u32,
        page_size: u32,
    ) -> Result<Vec<Address>, FactoryError> {
        if page_size == 0 {
            return Err(FactoryError::InvalidPage);
        }

        let registry = get_registry(&env);
        let total = registry.len(); // u32

        let start = page
            .checked_mul(page_size)
            .ok_or(FactoryError::InvalidPage)?;

        // Past-the-end pages return empty slice (not an error).
        if start >= total {
            return Ok(Vec::new(&env));
        }

        let end = core::cmp::min(start + page_size, total);
        let mut page_vec: Vec<Address> = Vec::new(&env);
        for i in start..end {
            page_vec.push_back(registry.get(i).unwrap());
        }

        Ok(page_vec)
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Total number of vaults registered.
    pub fn vault_count(env: Env) -> u32 {
        get_registry(&env).len()
    }

    /// Current deployment fee in XLM stroops.
    pub fn get_deployment_fee(env: Env) -> i128 {
        get_deployment_fee(&env)
    }

    /// Whether the given token is whitelisted.
    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        is_token_whitelisted(&env, &token)
    }
}

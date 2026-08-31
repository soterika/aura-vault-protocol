use soroban_sdk::{Address, Env, Vec};
use crate::errors::FactoryError;

/// Public ABI for AuraFactory.
///
/// The factory is a **registry** contract.  Because Soroban does not support
/// deploying sub-contracts from inside a running contract, vault deployment is
/// performed off-chain (via `stellar contract deploy`).  The caller then calls
/// `deploy_vault` to record the new vault's address in the factory registry,
/// pay the deployment fee, and emit the `VaultDeployed` event.
#[allow(dead_code)]
pub trait AuraFactoryTrait {
    // -----------------------------------------------------------------------
    // Admin / setup
    // -----------------------------------------------------------------------

    /// One-time initialisation.  Sets the admin, the required deployment fee
    /// (in XLM stroops, use 0 to disable fee collection), and optionally
    /// whitelists an initial token.
    fn initialize(
        env: Env,
        admin: Address,
        deployment_fee: i128,
    ) -> Result<(), FactoryError>;

    /// Whitelist (or de-list) a token so it can be used as the underlying
    /// asset when registering a new vault.  Admin only.
    fn whitelist_token(
        env: Env,
        admin: Address,
        token: Address,
        enabled: bool,
    ) -> Result<(), FactoryError>;

    /// Update the XLM deployment fee.  Pass `0` to remove the fee.  Admin only.
    fn set_deployment_fee(
        env: Env,
        admin: Address,
        fee: i128,
    ) -> Result<(), FactoryError>;

    // -----------------------------------------------------------------------
    // Core — vault registration
    // -----------------------------------------------------------------------

    /// Register a previously deployed vault with the factory.
    ///
    /// # Parameters
    /// * `caller`            — The address paying the deployment fee and
    ///                         signing the transaction.
    /// * `vault`             — The on-chain contract address of the already-
    ///                         deployed AuraVault instance.
    /// * `underlying_token`  — The SEP-41 token address the vault was
    ///                         initialised with (used for whitelist check).
    ///
    /// # Behaviour
    /// 1. Requires `caller.require_auth()`.
    /// 2. Checks the factory is initialised.
    /// 3. Verifies `underlying_token` is whitelisted (if any whitelist exists).
    /// 4. Transfers `deployment_fee` stroops of XLM from `caller` to this
    ///    contract (no-op when the fee is 0).
    /// 5. Appends `vault` to the registry.
    /// 6. Emits `VaultDeployed` event.
    /// 7. Returns `vault`.
    fn deploy_vault(
        env: Env,
        caller: Address,
        vault: Address,
        underlying_token: Address,
    ) -> Result<Address, FactoryError>;

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Paginated vault registry.
    ///
    /// `page` is **0-indexed**.  Returns at most `page_size` entries.
    /// Returns an empty `Vec` if `page` is beyond the last page.
    fn list_vaults(
        env: Env,
        page: u32,
        page_size: u32,
    ) -> Result<Vec<Address>, FactoryError>;

    /// Total number of vaults registered so far.
    fn vault_count(env: Env) -> u32;

    /// Returns the current deployment fee in XLM stroops.
    fn get_deployment_fee(env: Env) -> i128;

    /// Returns `true` if the given token is whitelisted.
    fn is_token_whitelisted(env: Env, token: Address) -> bool;
}

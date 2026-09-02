#![allow(unused)]

use soroban_sdk::contracterror;

/// Error codes for AuraFactory.
///
/// Codes 1–20 are reserved for factory-specific errors so they don't collide
/// with VaultError codes if the two types are ever combined on the client side.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FactoryError {
    /// Factory has not been initialized via `initialize()`.
    NotInitialized       = 1,
    /// `initialize()` has already been called.
    AlreadyInitialized   = 2,
    /// Caller is not the factory admin.
    Unauthorized         = 3,
    /// The underlying token supplied to `deploy_vault` is not whitelisted.
    TokenNotWhitelisted  = 4,
    /// The XLM deployment fee sent with the call is below the required amount.
    DeploymentFeeTooLow  = 5,
    /// A zero or negative fee amount was provided to `set_deployment_fee`.
    InvalidFeeAmount     = 6,
    /// Pagination arguments are out of range (page or page_size is zero /
    /// exceeds the registry size).
    InvalidPage          = 7,
    /// The vault address being registered was already registered.
    VaultAlreadyRegistered = 8,
}

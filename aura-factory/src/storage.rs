use soroban_sdk::{contracttype, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    /// Factory admin address (instance storage).
    Admin,
    /// Required XLM deployment fee in stroops (instance storage).
    DeploymentFee,
    /// Ordered registry of all deployed vault addresses (instance storage).
    /// Stored as a `Vec<Address>` — appended on every successful `deploy_vault`.
    Registry,
    /// Per-token whitelist flag (instance storage).
    /// `DataKey::TokenWhitelisted(token_addr)` → `bool`
    TokenWhitelisted(Address),
}

// ---------------------------------------------------------------------------
// TTL constants  (match aura-vault for consistency)
// ---------------------------------------------------------------------------

pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const INSTANCE_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;

// ---------------------------------------------------------------------------
// Instance-storage helpers
// ---------------------------------------------------------------------------

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_deployment_fee(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::DeploymentFee)
        .unwrap_or(0)
}

pub fn set_deployment_fee(env: &Env, fee: i128) {
    env.storage().instance().set(&DataKey::DeploymentFee, &fee);
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/// Returns the full vault registry (may be empty).
pub fn get_registry(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Registry)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append a vault to the registry.
pub fn push_registry(env: &Env, vault: &Address) {
    let mut reg = get_registry(env);
    reg.push_back(vault.clone());
    env.storage().instance().set(&DataKey::Registry, &reg);
}

/// Check whether a vault is already in the registry.
pub fn registry_contains(env: &Env, vault: &Address) -> bool {
    let reg = get_registry(env);
    for i in 0..reg.len() {
        if &reg.get(i).unwrap() == vault {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Token whitelist helpers
// ---------------------------------------------------------------------------

pub fn is_token_whitelisted(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::TokenWhitelisted(token.clone()))
        .unwrap_or(false)
}

pub fn set_token_whitelisted(env: &Env, token: &Address, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::TokenWhitelisted(token.clone()), &enabled);
}

// ---------------------------------------------------------------------------
// TTL bump helper
// ---------------------------------------------------------------------------

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

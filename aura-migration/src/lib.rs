//! # AuraMigrator — Vault-to-Vault Migration Helper
//!
//! `VaultMigrator` is a time-limited Soroban contract that atomically moves a
//! user's position from an old `AuraVault` instance to a new one. The user
//! approves the migrator to spend their vault shares; the migrator then
//! withdraws from the old vault and immediately re-deposits the proceeds into
//! the new vault — all in a single transaction.
//!
//! ## Lifecycle
//!
//! ```text
//! deploy VaultMigrator
//!     → initialize(old_vault, new_vault, expiry_timestamp)
//!     → [users call migrate(user, user_shares, min_underlying_out, min_new_shares_out)]
//!     → after expiry_timestamp, migrate() rejects all calls
//! ```
//!
//! ## Security properties
//!
//! - **Time-limited** — `migrate` fails after `expiry_timestamp` (set to 30 days
//!   after deployment in the recommended workflow).
//! - **Slippage protection** — caller may supply minimum acceptable amounts for
//!   both the withdrawal leg (underlying tokens out) and the deposit leg (new
//!   shares out). Either check failing returns `MigrationError::SlippageExceeded`
//!   with no state change.
//! - **User consent via share approval** — the migrator calls the old vault's
//!   `withdraw` function on behalf of the user; the user must have authorised
//!   this call (Soroban `require_auth` on the vault side handles consent).
//! - **Atomic** — both the withdraw and the deposit succeed or the entire
//!   transaction is reverted by the Soroban runtime.
//! - **No custody** — the migrator never holds user funds; underlying tokens
//!   flow directly from the old vault to the new vault within the same
//!   transaction.

#![no_std]

mod errors;

pub use errors::MigrationError;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Storage layout
// ---------------------------------------------------------------------------

/// The 30-day default migration window expressed as seconds.
///
/// Deployers SHOULD pass `env.ledger().timestamp() + MIGRATION_WINDOW_SECS`
/// as the `expiry_timestamp` argument to `initialize`.
pub const MIGRATION_WINDOW_SECS: u64 = 30 * 24 * 60 * 60; // 2 592 000 s

/// TTL constants matching the main vault (30-day lifetime, 7-day threshold).
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
const INSTANCE_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;

#[contracttype]
enum DataKey {
    /// Address of the old (source) vault.
    OldVault,
    /// Address of the new (destination) vault.
    NewVault,
    /// Unix timestamp (ledger seconds) after which migration is no longer
    /// permitted.
    ExpiryTimestamp,
    /// Initialisation guard — present once `initialize` has been called.
    Initialized,
}

// ---------------------------------------------------------------------------
// Cross-contract client stubs
// ---------------------------------------------------------------------------
// We invoke the vault's `withdraw` and `deposit` entry points by name using
// Soroban's `invoke_contract` (via the generated client).  Because we do not
// link against the `aura-vault` crate, we declare the minimal interface here.

/// Thin cross-contract client for an AuraVault instance.
///
/// Only the two entry points used by the migrator are declared.
mod vault_client {
    use soroban_sdk::{contractclient, Address, Env};

    /// Minimal AuraVault interface required by VaultMigrator.
    #[contractclient(name = "AuraVaultClient")]
    pub trait AuraVaultInterface {
        /// Burn `shares` from `caller` and return the redeemed underlying
        /// token amount.
        fn withdraw(env: Env, caller: Address, shares: i128) -> i128;

        /// Deposit `amount` underlying tokens on behalf of `caller` and return
        /// the number of new shares minted.
        fn deposit(env: Env, caller: Address, amount: i128) -> i128;
    }
}

use vault_client::AuraVaultClient;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct VaultMigrator;

#[contractimpl]
impl VaultMigrator {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// One-time setup: record the source and destination vault addresses and
    /// the expiry timestamp.
    ///
    /// # Parameters
    ///
    /// - `old_vault` — Contract address of the vault users are migrating
    ///   **from**. Must differ from `new_vault`.
    /// - `new_vault` — Contract address of the vault users are migrating
    ///   **to**.
    /// - `expiry_timestamp` — Unix timestamp (ledger seconds) after which
    ///   `migrate` will be rejected. Pass
    ///   `env.ledger().timestamp() + MIGRATION_WINDOW_SECS` for a 30-day
    ///   window from deployment time.
    ///
    /// # Errors
    ///
    /// - [`MigrationError::AlreadyInitialized`] — called more than once.
    /// - [`MigrationError::InvalidAddress`] — `old_vault == new_vault`.
    pub fn initialize(
        env: Env,
        old_vault: Address,
        new_vault: Address,
        expiry_timestamp: u64,
    ) -> Result<(), MigrationError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(MigrationError::AlreadyInitialized);
        }
        if old_vault == new_vault {
            return Err(MigrationError::InvalidAddress);
        }

        env.storage().instance().set(&DataKey::OldVault, &old_vault);
        env.storage().instance().set(&DataKey::NewVault, &new_vault);
        env.storage().instance().set(&DataKey::ExpiryTimestamp, &expiry_timestamp);
        env.storage().instance().set(&DataKey::Initialized, &true);

        Self::bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // migrate
    // -----------------------------------------------------------------------

    /// Atomically migrate `user_shares` from the old vault to the new vault.
    ///
    /// ## Steps (all within the same transaction)
    ///
    /// 1. Verify the migrator is initialized and the window has not expired.
    /// 2. Call `old_vault.withdraw(user, user_shares)` → receives
    ///    `underlying_out` tokens.
    /// 3. Check `underlying_out >= min_underlying_out` (slippage guard leg 1).
    /// 4. Call `new_vault.deposit(user, underlying_out)` → receives
    ///    `new_shares` for the user.
    /// 5. Check `new_shares >= min_new_shares_out` (slippage guard leg 2).
    /// 6. Emit a `migrated` event.
    ///
    /// The user must have granted the old vault permission to transfer their
    /// shares on their behalf (Soroban `require_auth` on the vault's
    /// `withdraw` handles consent — the user authorises the entire transaction
    /// when they sign it).
    ///
    /// # Parameters
    ///
    /// - `user` — The account being migrated. Must authorise this call.
    /// - `user_shares` — Number of old-vault shares to convert. Must be > 0.
    /// - `min_underlying_out` — Minimum underlying tokens acceptable from the
    ///   withdrawal leg. Pass `0` to disable the check.
    /// - `min_new_shares_out` — Minimum new-vault shares acceptable from the
    ///   deposit leg. Pass `0` to disable the check.
    ///
    /// # Returns
    ///
    /// `(underlying_out, new_shares)` — the underlying tokens redeemed and the
    /// new vault shares received.
    ///
    /// # Errors
    ///
    /// - [`MigrationError::NotInitialized`] — `initialize` not called yet.
    /// - [`MigrationError::Expired`] — the migration window has closed.
    /// - [`MigrationError::ZeroShares`] — `user_shares <= 0`.
    /// - [`MigrationError::SlippageExceeded`] — either output fell below the
    ///   supplied minimum.
    /// - [`MigrationError::MathOverflow`] — arithmetic overflow.
    pub fn migrate(
        env: Env,
        user: Address,
        user_shares: i128,
        min_underlying_out: i128,
        min_new_shares_out: i128,
    ) -> Result<(i128, i128), MigrationError> {
        user.require_auth();

        // ---- Precondition checks -------------------------------------------

        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(MigrationError::NotInitialized);
        }

        let expiry: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ExpiryTimestamp)
            .unwrap();
        if env.ledger().timestamp() > expiry {
            return Err(MigrationError::Expired);
        }

        if user_shares <= 0 {
            return Err(MigrationError::ZeroShares);
        }

        let old_vault: Address = env
            .storage()
            .instance()
            .get(&DataKey::OldVault)
            .unwrap();
        let new_vault: Address = env
            .storage()
            .instance()
            .get(&DataKey::NewVault)
            .unwrap();

        // ---- Leg 1: Withdraw from old vault --------------------------------
        //
        // The vault's `withdraw` function is called on behalf of `user`.
        // `user.require_auth()` above covers the user's authorisation for this
        // entire transaction; the old vault's own `require_auth` check will be
        // satisfied by the sub-invocation auth context established by the user
        // signing the outer call.
        let old_client = AuraVaultClient::new(&env, &old_vault);
        let underlying_out = old_client.withdraw(&user, &user_shares);

        // Slippage check — leg 1
        if min_underlying_out > 0 {
            if underlying_out < min_underlying_out {
                return Err(MigrationError::SlippageExceeded);
            }
        }

        // ---- Leg 2: Deposit into new vault ----------------------------------
        //
        // At this point the underlying tokens redeemed from the old vault are
        // in `user`'s wallet (the old vault transferred them there via CEI).
        // The new vault's `deposit` pulls them from `user`.
        let new_client = AuraVaultClient::new(&env, &new_vault);
        let new_shares = new_client.deposit(&user, &underlying_out);

        // Slippage check — leg 2
        if min_new_shares_out > 0 {
            if new_shares < min_new_shares_out {
                return Err(MigrationError::SlippageExceeded);
            }
        }

        // ---- Emit Migrated event -------------------------------------------
        //
        // Topics: ("migrated", user)
        // Data:   (user_shares_burned, underlying_out, new_shares_minted,
        //          old_vault, new_vault)
        env.events().publish(
            (Symbol::new(&env, "migrated"), user.clone()),
            (user_shares, underlying_out, new_shares, old_vault, new_vault),
        );

        Self::bump_instance(&env);

        Ok((underlying_out, new_shares))
    }

    // -----------------------------------------------------------------------
    // View functions
    // -----------------------------------------------------------------------

    /// Return `true` if the migration window has expired.
    ///
    /// Read-only; no authorization required.
    pub fn is_expired(env: Env) -> bool {
        let Some(expiry): Option<u64> =
            env.storage().instance().get(&DataKey::ExpiryTimestamp)
        else {
            // Not yet initialized — treat as not-expired so callers can still
            // check before initializing.
            return false;
        };
        env.ledger().timestamp() > expiry
    }

    /// Return the expiry timestamp (Unix seconds), or `0` if not initialized.
    ///
    /// Read-only; no authorization required.
    pub fn expiry_timestamp(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ExpiryTimestamp)
            .unwrap_or(0)
    }

    /// Return the old (source) vault address, or `None` if not initialized.
    ///
    /// Read-only; no authorization required.
    pub fn old_vault(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::OldVault)
    }

    /// Return the new (destination) vault address, or `None` if not initialized.
    ///
    /// Read-only; no authorization required.
    pub fn new_vault(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::NewVault)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    }
}

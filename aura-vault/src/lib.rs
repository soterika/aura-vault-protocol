#![no_std]

mod errors;
mod interface;
mod storage;
mod governance;
mod fee;

pub use errors::VaultError;

#[cfg(test)]
mod test;
#[cfg(test)]
mod security_test;
#[cfg(test)]
mod gas_benchmark;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec, Symbol};

use storage::{
    bump_instance, bump_persistent, get_admin, get_balance, get_layout_version, get_token,
    get_total_deposited, get_total_shares, get_version, is_paused as storage_is_paused, set_admin,
    set_balance, set_layout_version, set_paused, set_token, set_total_deposited, set_total_shares,
    set_version, CURRENT_LAYOUT_VERSION,
};
use governance::{
    initialize_governance, create_proposal, vote_on_proposal, execute_proposal,
    get_proposal_status, ProposalStatus, ProposalType,
};

#[contract]
pub struct AuraVault;

#[contractimpl]
impl AuraVault {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------
    pub fn initialize(
        env: Env,
        admin: Address,
        underlying_token: Address,
        signers: Vec<Address>,
    ) -> Result<(), VaultError> {
        if get_admin(&env).is_some() {
            return Err(VaultError::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_token(&env, &underlying_token);
        set_total_shares(&env, 0);
        set_total_deposited(&env, 0);
        set_version(&env, 1);
        set_layout_version(&env, CURRENT_LAYOUT_VERSION);
        initialize_governance(&env, signers)?;
        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit
    //
    // Issue requirement: Emit Deposit event with indexed user and amount.
    // In Soroban, topics (first tuple) are indexed; data (second value) is not.
    // We place `caller` and `amount` in topics so they can be efficiently
    // filtered by indexers.
    // -----------------------------------------------------------------------
    pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
        caller.require_auth();

        if amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard: actual token balance must equal tracked state before deposit.
        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let total_shares = get_total_shares(&env);

        // Compute shares to mint (checked arithmetic; overflow returns MathOverflow)
        let new_shares: i128 = if total_shares == 0 || total_deposited == 0 {
            amount
        } else {
            let numerator = amount
                .checked_mul(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            numerator
                .checked_div(total_deposited)
                .ok_or(VaultError::MathOverflow)?
        };

        if new_shares <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        // CEI — Interaction: pull tokens from caller into vault
        token.transfer(&caller, &env.current_contract_address(), &amount);

        // Effects: write state after successful transfer
        let old_balance = get_balance(&env, &caller);
        let new_balance = old_balance
            .checked_add(new_shares)
            .ok_or(VaultError::MathOverflow)?;
        set_balance(&env, &caller, new_balance);
        let new_total_shares = total_shares
            .checked_add(new_shares)
            .ok_or(VaultError::MathOverflow)?;
        set_total_shares(&env, new_total_shares);
        let new_total_deposited = total_deposited
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        set_total_deposited(&env, new_total_deposited);

        // Event: topics = (event_name, caller, amount) — indexed for efficient filtering.
        // data = (new_shares, new_total_shares, new_total_deposited) — contextual payload.
        env.events().publish(
            (Symbol::new(&env, "deposit"), caller.clone(), amount),
            (new_shares, new_total_shares, new_total_deposited),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(new_shares)
    }

    // -----------------------------------------------------------------------
    // withdraw
    // -----------------------------------------------------------------------
    pub fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError> {
        caller.require_auth();

        if shares <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let user_balance = get_balance(&env, &caller);
        if shares > user_balance {
            return Err(VaultError::InsufficientShares);
        }

        let total_shares = get_total_shares(&env);

        let numerator = shares
            .checked_mul(total_deposited)
            .ok_or(VaultError::MathOverflow)?;
        let redeem_amount = numerator
            .checked_div(total_shares)
            .ok_or(VaultError::MathOverflow)?;

        if redeem_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if total_deposited < redeem_amount {
            return Err(VaultError::InsufficientUnderlying);
        }

        // CEI — Effects first: burn shares before token transfer
        let new_balance = user_balance - shares;
        set_balance(&env, &caller, new_balance);
        let new_total_shares = total_shares
            .checked_sub(shares)
            .ok_or(VaultError::MathOverflow)?;
        set_total_shares(&env, new_total_shares);
        let new_total_deposited = total_deposited
            .checked_sub(redeem_amount)
            .ok_or(VaultError::MathOverflow)?;
        set_total_deposited(&env, new_total_deposited);

        // Interaction: send tokens to caller after state is settled
        token.transfer(&env.current_contract_address(), &caller, &redeem_amount);

        // Event: topics = (event_name, caller, shares) — indexed for efficient filtering.
        env.events().publish(
            (Symbol::new(&env, "withdraw"), caller.clone(), shares),
            (redeem_amount, new_total_shares, new_total_deposited),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(redeem_amount)
    }

    // -----------------------------------------------------------------------
    // harvest — permissionless keeper entry point (underlying token)
    // -----------------------------------------------------------------------
    pub fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
        caller.require_auth();

        if yield_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let total_shares = get_total_shares(&env);
        if total_shares == 0 {
            return Err(VaultError::ZeroShares);
        }

        let total_deposited = get_total_deposited(&env);

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard
        let balance_before = token.balance(&env.current_contract_address());
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
        let yield_after_fee = yield_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let current_fees = storage::get_total_fee_collected(&env);
        let new_fees = current_fees
            .checked_add(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let new_total = total_deposited
            .checked_add(yield_after_fee)
            .ok_or(VaultError::MathOverflow)?;

        // Interaction: pull yield tokens into vault
        token.transfer(&caller, &env.current_contract_address(), &yield_amount);

        // Effects: increase total deposited with net yield; accumulate fees
        set_total_deposited(&env, new_total);
        storage::set_total_fee_collected(&env, new_fees);

        env.events().publish(
            (Symbol::new(&env, "harvest"), caller.clone(), yield_amount),
            (yield_after_fee, fee_amount, new_total),
        );

        bump_instance(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // harvest_token — multi-yield-token entry point (Issue #48)
    // -----------------------------------------------------------------------
    pub fn harvest_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        if yield_amount <= 0 || underlying_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let total_shares = get_total_shares(&env);
        if total_shares == 0 {
            return Err(VaultError::ZeroShares);
        }

        // Verify the alt_token is whitelisted
        if !storage::is_yield_token(&env, &alt_token) {
            return Err(VaultError::InvalidAddress);
        }

        let total_deposited = get_total_deposited(&env);

        // Flash-loan guard on underlying token
        let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let underlying = token::Client::new(&env, &underlying_addr);
        let balance_before = underlying.balance(&env.current_contract_address());
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps)
            .unwrap_or(0);
        let net_underlying = underlying_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let new_total = total_deposited
            .checked_add(net_underlying)
            .ok_or(VaultError::MathOverflow)?;

        // Interaction: pull alt-token yield from caller
        token::Client::new(&env, &alt_token)
            .transfer(&caller, &env.current_contract_address(), &yield_amount);

        // Effects: credit net underlying value
        set_total_deposited(&env, new_total);
        let prev_fees = storage::get_total_fee_collected(&env);
        storage::set_total_fee_collected(
            &env,
            prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
        );

        env.events().publish(
            (Symbol::new(&env, "harvest_token"), caller, alt_token),
            (yield_amount, net_underlying, fee_amount),
        );

        bump_instance(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // register_yield_token — admin-only: whitelist an alt yield token
    // -----------------------------------------------------------------------
    pub fn register_yield_token(env: Env, alt_token: Address) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        storage::set_yield_token(&env, &alt_token, true);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "yield_token_registered"),),
            (alt_token,),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // pause / unpause — admin-only emergency controls
    // Takes admin address so the client can require_auth on it.
    // -----------------------------------------------------------------------
    pub fn pause(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_paused(&env, true);
        env.events().publish((Symbol::new(&env, "paused"),), ());
        bump_instance(&env);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_paused(&env, false);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
        bump_instance(&env);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        storage_is_paused(&env)
    }

    // -----------------------------------------------------------------------
    // Fee administration — admin-only
    // -----------------------------------------------------------------------

    /// Set performance and management fee rates (basis points).
    pub fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_perf_fee_bps(&env, perf_fee_bps);
        storage::set_mgmt_fee_bps(&env, mgmt_fee_bps);
        bump_instance(&env);
        Ok(())
    }

    /// Set treasury address where fees are sent on withdrawal.
    pub fn set_treasury(env: Env, admin: Address, treasury: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_treasury(&env, &treasury);
        bump_instance(&env);
        Ok(())
    }

    /// Withdraw accumulated fees to the treasury. Admin-only.
    pub fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();

        let fees = storage::get_total_fee_collected(&env);
        if fees <= 0 {
            return Ok(0);
        }

        let treasury = storage::get_treasury(&env).ok_or(VaultError::NotInitialized)?;
        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Adjust total_deposited: fees were already excluded from it during harvest,
        // so we just transfer from vault balance.
        token.transfer(&env.current_contract_address(), &treasury, &fees);
        storage::set_total_fee_collected(&env, 0);

        env.events().publish(
            (Symbol::new(&env, "fees_withdrawn"), admin),
            (fees, treasury),
        );

        bump_instance(&env);
        Ok(fees)
    }

    /// Read total accumulated (unwithdrawn) fees.
    pub fn total_fees_collected(env: Env) -> i128 {
        storage::get_total_fee_collected(&env)
    }

    // -----------------------------------------------------------------------
    // total_assets  (read-only)
    // -----------------------------------------------------------------------
    pub fn total_assets(env: Env) -> i128 {
        get_total_deposited(&env)
    }

    // -----------------------------------------------------------------------
    // balance_of  (read-only)
    // -----------------------------------------------------------------------
    pub fn balance_of(env: Env, address: Address) -> i128 {
        get_balance(&env, &address)
    }

    // -----------------------------------------------------------------------
    // Upgrade
    // -----------------------------------------------------------------------
    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        let current_version = get_layout_version(&env);
        if current_version != CURRENT_LAYOUT_VERSION {
            return Err(VaultError::StorageLayoutMismatch);
        }

        let old_version = get_version(&env);
        let new_version = old_version + 1;
        set_version(&env, new_version);

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events().publish(
            (Symbol::new(&env, "upgrade"), admin),
            (old_version, new_version),
        );

        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Governance Methods
    // -----------------------------------------------------------------------

    pub fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateAdmin)
    }

    pub fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateUnderlyingToken)
    }

    pub fn propose_parameter_update(
        env: Env,
        proposer: Address,
        name: Symbol,
        value: i128,
    ) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateParameter { name, value })
    }

    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), VaultError> {
        vote_on_proposal(&env, voter, proposal_id, approve)
    }

    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        execute_proposal(&env, executor, proposal_id)?;
        bump_instance(&env);
        Ok(())
    }

    pub fn proposal_status(env: Env, proposal_id: u64) -> Option<soroban_sdk::String> {
        get_proposal_status(&env, proposal_id).map(|status| {
            match status {
                ProposalStatus::Pending => soroban_sdk::String::from_str(&env, "Pending"),
                ProposalStatus::Approved => soroban_sdk::String::from_str(&env, "Approved"),
                ProposalStatus::Executed => soroban_sdk::String::from_str(&env, "Executed"),
                ProposalStatus::Rejected => soroban_sdk::String::from_str(&env, "Rejected"),
            }
        })
    }
}

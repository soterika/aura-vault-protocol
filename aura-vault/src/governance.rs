//! Multi-sig admin operations (Issue #375)
//!
//! Provides M-of-N threshold signature governance for critical vault operations:
//!   - Contract upgrade
//!   - Fee change (performance fee, management fee)
//!   - TVL cap change
//!   - Admin set management (add/remove signers, set threshold)
//!
//! # Flow
//! 1. Any current signer calls `propose_operation(op_type, params)` → returns `op_id`
//! 2. Other signers call `sign_operation(op_id)` to add their signature
//! 3. Once `signature_count >= threshold`, the operation becomes executable
//! 4. Any signer calls `execute_operation(op_id)` to apply the change
//! 5. Proposals expire 72 hours after creation (whether signed or not)

use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol, Vec};

use crate::errors::VaultError;
use crate::storage::{
    get_multisig_op_count, get_multisig_signers, get_multisig_threshold, has_multisig_signed,
    record_multisig_vote, set_multisig_op_count, set_multisig_signers, set_multisig_threshold,
    MULTISIG_EXPIRY_SECS,
};

// ---------------------------------------------------------------------------
// Operation type — Soroban contracttype requires simple (tuple) variants
// ---------------------------------------------------------------------------

/// All critical operations that require multi-sig approval.
/// Note: `#[contracttype]` only supports unit and tuple variants.
#[contracttype]
#[derive(Clone, Debug)]
pub enum OpType {
    /// Upgrade the contract Wasm. Param: new_wasm_hash.
    Upgrade(BytesN<32>),
    /// Change the performance fee (basis points). Param: bps.
    SetPerfFee(u32),
    /// Change the management fee (basis points). Param: bps.
    SetMgmtFee(u32),
    /// Change the TVL cap (maximum total_deposited). Param: cap.
    SetTvlCap(i128),
    /// Add a new signer to the multi-sig set. Param: signer address.
    AddSigner(Address),
    /// Remove a signer from the multi-sig set. Param: signer address.
    RemoveSigner(Address),
    /// Update the M-of-N signature threshold. Param: new threshold.
    SetThreshold(u32),

    // ---------------------------------------------------------------------------
    // Legacy governance types (kept for backward compat with existing tests)
    // ---------------------------------------------------------------------------
    UpdateAdmin,
    UpdateUnderlyingToken,
    UpdateParameter(Symbol, i128),
}

// ---------------------------------------------------------------------------
// Operation status
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum OpStatus {
    /// Created, collecting signatures.
    Pending,
    /// Threshold met — ready to execute (or already executed).
    Ready,
    /// Successfully executed on-chain.
    Executed,
    /// Expired before threshold was reached.
    Expired,
}

// ---------------------------------------------------------------------------
// Stored operation record
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiSigOp {
    pub id: u64,
    pub op_type: OpType,
    pub proposer: Address,
    pub status: OpStatus,
    /// Number of signatures collected so far.
    pub sig_count: u32,
    /// Signers that have signed this operation.
    pub signers: Vec<Address>,
    /// Unix timestamp when proposed (ledger time).
    pub proposed_at: u64,
    /// Unix timestamp after which the operation expires.
    pub expires_at: u64,
}

// ---------------------------------------------------------------------------
// Storage key for a MultiSigOp (separate from DataKey to avoid naming conflict)
// ---------------------------------------------------------------------------

#[contracttype]
pub enum MultisigKey {
    Op(u64),
}

fn get_op(env: &Env, id: u64) -> Option<MultiSigOp> {
    env.storage().instance().get(&MultisigKey::Op(id))
}

fn set_op(env: &Env, id: u64, op: &MultiSigOp) {
    env.storage().instance().set(&MultisigKey::Op(id), op);
}

// ---------------------------------------------------------------------------
// Core multi-sig functions (Issue #375 API)
// ---------------------------------------------------------------------------

/// Start a new multi-sig proposal.
///
/// # Arguments
/// - `proposer` — must be an active signer; will be auto-signed as the first sig.
/// - `op_type`  — the operation to propose.
///
/// # Returns
/// The new operation ID (1-indexed, monotonically increasing).
///
/// # Events
/// Emits `OperationProposed` with topics `(op_id, proposer)`.
pub fn propose_operation(
    env: &Env,
    proposer: Address,
    op_type: OpType,
) -> Result<u64, VaultError> {
    proposer.require_auth();

    // Proposer must be a registered signer
    let signers = get_multisig_signers(env);
    if !signers.iter().any(|s| s == proposer) {
        return Err(VaultError::NotASigner);
    }

    let count = get_multisig_op_count(env);
    let new_id = count + 1;
    let now = env.ledger().timestamp();

    // The proposer counts as the first signature
    let mut initial_signers = Vec::new(env);
    initial_signers.push_back(proposer.clone());

    let threshold = get_multisig_threshold(env);
    let status = if 1 >= threshold {
        OpStatus::Ready
    } else {
        OpStatus::Pending
    };

    let op = MultiSigOp {
        id: new_id,
        op_type,
        proposer: proposer.clone(),
        status,
        sig_count: 1,
        signers: initial_signers,
        proposed_at: now,
        expires_at: now + MULTISIG_EXPIRY_SECS,
    };

    set_op(env, new_id, &op);
    set_multisig_op_count(env, new_id);

    // Record the proposer's vote to prevent double-signing
    record_multisig_vote(env, new_id, &proposer);

    env.events().publish(
        (Symbol::new(env, "OperationProposed"), new_id, proposer),
        (),
    );

    Ok(new_id)
}

/// Add a signature to an existing pending operation.
///
/// # Events
/// Emits `OperationSigned` with topics `(op_id, signer, sig_count)`.
/// If the threshold is reached, also transitions the status to `Ready`.
pub fn sign_operation(
    env: &Env,
    signer: Address,
    op_id: u64,
) -> Result<(), VaultError> {
    signer.require_auth();

    // Must be a registered signer
    let signers = get_multisig_signers(env);
    if !signers.iter().any(|s| s == signer) {
        return Err(VaultError::NotASigner);
    }

    let mut op = get_op(env, op_id).ok_or(VaultError::OperationNotFound)?;

    // Check expiry
    let now = env.ledger().timestamp();
    if now > op.expires_at {
        return Err(VaultError::OperationExpired);
    }

    match op.status {
        OpStatus::Executed => return Err(VaultError::OperationAlreadyExecuted),
        OpStatus::Expired  => return Err(VaultError::OperationExpired),
        _ => {}
    }

    if has_multisig_signed(env, op_id, &signer) {
        return Err(VaultError::OperationAlreadySigned);
    }

    op.sig_count += 1;
    op.signers.push_back(signer.clone());
    record_multisig_vote(env, op_id, &signer);

    let threshold = get_multisig_threshold(env);
    if op.sig_count >= threshold {
        op.status = OpStatus::Ready;
    }

    let sig_count = op.sig_count;
    set_op(env, op_id, &op);

    env.events().publish(
        (Symbol::new(env, "OperationSigned"), op_id, signer),
        sig_count,
    );

    Ok(())
}

/// Execute a Ready operation.
///
/// The caller must be a signer. The operation must be in `Ready` status and
/// not yet expired.
///
/// # Events
/// Emits `OperationExecuted` with topics `(op_id, executor)`.
///
/// # Returns
/// The executed `MultiSigOp` so the caller (lib.rs) can apply state changes.
pub fn execute_multisig_op(
    env: &Env,
    executor: Address,
    op_id: u64,
) -> Result<MultiSigOp, VaultError> {
    executor.require_auth();

    // Must be a registered signer
    let signers = get_multisig_signers(env);
    if !signers.iter().any(|s| s == executor) {
        return Err(VaultError::NotASigner);
    }

    let mut op = get_op(env, op_id).ok_or(VaultError::OperationNotFound)?;

    let now = env.ledger().timestamp();
    if now > op.expires_at {
        return Err(VaultError::OperationExpired);
    }

    match op.status {
        OpStatus::Executed => return Err(VaultError::OperationAlreadyExecuted),
        OpStatus::Expired  => return Err(VaultError::OperationExpired),
        OpStatus::Pending  => return Err(VaultError::ThresholdNotMet),
        OpStatus::Ready    => {}
    }

    op.status = OpStatus::Executed;
    set_op(env, op_id, &op);

    env.events().publish(
        (Symbol::new(env, "OperationExecuted"), op_id, executor),
        (),
    );

    Ok(op)
}

/// Read the current status of a multi-sig operation.
pub fn get_operation_status(env: &Env, op_id: u64) -> Option<OpStatus> {
    get_op(env, op_id).map(|op| {
        // Lazily reflect expiry without writing state (read-only)
        let now = env.ledger().timestamp();
        if matches!(op.status, OpStatus::Pending | OpStatus::Ready) && now > op.expires_at {
            OpStatus::Expired
        } else {
            op.status
        }
    })
}

/// Return the full operation record.
pub fn get_operation(env: &Env, op_id: u64) -> Option<MultiSigOp> {
    get_op(env, op_id)
}

// ---------------------------------------------------------------------------
// Admin-set management functions
// ---------------------------------------------------------------------------

/// Add a signer directly (called after a multi-sig `AddSigner` op is executed).
pub fn apply_add_signer(env: &Env, new_signer: &Address) -> Result<(), VaultError> {
    let mut signers = get_multisig_signers(env);
    // Idempotent — don't add duplicates
    if signers.iter().any(|s| s == *new_signer) {
        return Ok(());
    }
    signers.push_back(new_signer.clone());
    set_multisig_signers(env, &signers);
    Ok(())
}

/// Remove a signer (called after a multi-sig `RemoveSigner` op is executed).
/// Ensures the remaining signer count is at least the threshold.
pub fn apply_remove_signer(env: &Env, target: &Address) -> Result<(), VaultError> {
    let signers = get_multisig_signers(env);
    let threshold = get_multisig_threshold(env);
    let new_len = signers.iter().filter(|s| s != target).count() as u32;

    if new_len < threshold {
        return Err(VaultError::InvalidThreshold);
    }

    let mut new_signers: Vec<Address> = Vec::new(env);
    for s in signers.iter() {
        if s != *target {
            new_signers.push_back(s.clone());
        }
    }
    set_multisig_signers(env, &new_signers);
    Ok(())
}

/// Update the M threshold (called after a multi-sig `SetThreshold` op is executed).
pub fn apply_set_threshold(env: &Env, threshold: u32) -> Result<(), VaultError> {
    let signers = get_multisig_signers(env);
    if threshold == 0 || threshold as usize > signers.len() as usize {
        return Err(VaultError::InvalidThreshold);
    }
    set_multisig_threshold(env, threshold);
    Ok(())
}

// ---------------------------------------------------------------------------
// Initialization helper
// ---------------------------------------------------------------------------

/// Called once during vault `initialize` to seed the signer set and threshold.
/// An empty signer list is valid (governance disabled until signers are added).
pub fn initialize_governance(env: &Env, signers: Vec<Address>) -> Result<(), VaultError> {
    // Allow re-seeding only if signers are not yet set (idempotent init path)
    let current = get_multisig_signers(env);
    if current.len() > 0 {
        return Err(VaultError::AlreadyInitialized);
    }

    set_multisig_signers(env, &signers);
    set_multisig_op_count(env, 0);

    // Default threshold is 2; clamp to signer count if fewer than 2 signers provided
    let len = signers.len() as u32;
    let threshold = if len == 0 { 1 } else if len < 2 { len } else { 2 };
    set_multisig_threshold(env, threshold);

    Ok(())
}

// ---------------------------------------------------------------------------
// Legacy shim — keeps old `create_proposal` / `vote_on_proposal` /
// `execute_proposal` API so existing tests compile without change.
// ---------------------------------------------------------------------------

// Re-export status enum under the old names used in lib.rs
pub use OpStatus as ProposalStatus;
pub use OpType as ProposalType;

pub fn create_proposal(
    env: &Env,
    proposer: Address,
    proposal_type: ProposalType,
) -> Result<u64, VaultError> {
    propose_operation(env, proposer, proposal_type)
}

pub fn vote_on_proposal(
    env: &Env,
    voter: Address,
    proposal_id: u64,
    approve: bool,
) -> Result<(), VaultError> {
    if !approve {
        // Rejections are a no-op in the new model (we just don't sign)
        return Ok(());
    }
    sign_operation(env, voter, proposal_id)
}

pub fn execute_proposal(
    env: &Env,
    executor: Address,
    proposal_id: u64,
) -> Result<(), VaultError> {
    execute_multisig_op(env, executor, proposal_id)?;
    Ok(())
}

pub fn get_proposal_status(env: &Env, proposal_id: u64) -> Option<ProposalStatus> {
    get_operation_status(env, proposal_id)
}

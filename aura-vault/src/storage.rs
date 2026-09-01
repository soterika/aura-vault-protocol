use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    UnderlyingToken,
    TotalShares,
    TotalDeposited,
    Balance(Address),
    Version,
    LayoutVersion,
    /// Emergency pause flag — when true, deposit/withdraw/harvest are blocked.
    Paused,
    Treasury,
    PerfFeeBps,
    MgmtFeeBps,
    TotalFeeCollected,
    LastMgmtFeeTime,
    /// Whitelisted alternative yield tokens (Issue #48)
    YieldToken(Address),
    /// Maximum total assets allowed (0 = unlimited). Issue #467.
    TvlCap,
    /// Timestamp of the last successful harvest (ledger timestamp). Issue #471.
    LastHarvestTime,
    /// Minimum seconds between harvests (0 = no cooldown). Issue #471.
    HarvestCooldownSecs,
    // -----------------------------------------------------------------------
    // Yield-distribution per-share accumulator (Issue #YD)
    // -----------------------------------------------------------------------
    /// Global cumulative yield-per-share (YPS) accumulator (scaled by YIELD_PRECISION).
    CumulativeYps,
    /// Per-user YPS checkpoint: the value of CumulativeYps at the user's last
    /// collect_pending_yield or deposit call.
    UserCheckpoint(Address),
    /// Stored (unsettled) pending yield tokens for a user, in underlying units.
    UserPendingYield(Address),
    /// Monotonically increasing epoch counter; bumped on every distribution.
    DistributionEpoch,
    // -----------------------------------------------------------------------
    // Withdrawal queue (Issue #WQ)
    // -----------------------------------------------------------------------
    /// Minimum underlying-token amount that triggers queue instead of instant withdrawal.
    WithdrawalQueueThreshold,
    /// Minimum seconds a queued withdrawal must wait before it can be claimed.
    WithdrawalUnbondingSecs,
    /// Per-user withdrawal fee in basis points (0 = no fee, max 500 = 5%).
    WithdrawalFeeBps,
    /// Next sequential withdrawal queue ID.
    WithdrawalNextId,
    /// Individual withdrawal queue entry keyed by queue ID.
    WithdrawalEntry(u64),
    // -----------------------------------------------------------------------
    // Circuit breaker — share-price movement limit (Issue #371)
    // -----------------------------------------------------------------------
    /// Maximum allowed share-price movement per harvest, in basis points.
    /// 0 = check disabled. Covers both up and down movements.
    PriceMovementLimit,
    // -----------------------------------------------------------------------
    // Whitelist-only deposit mode (Issue #349)
    // -----------------------------------------------------------------------
    /// Whether whitelist-only mode is enabled for deposits.
    WhitelistEnabled,
    /// Per-address whitelist status (persistent storage).
    Whitelist(Address),
    // -----------------------------------------------------------------------
    // Minimum deposit amount (Issue #355)
    // -----------------------------------------------------------------------
    /// Minimum deposit amount in underlying token units.
    MinDeposit,
    // -----------------------------------------------------------------------
    // Contract metadata (Issue #350)
    // -----------------------------------------------------------------------
    /// Vault name (set at initialization).
    VaultName,
    /// Vault share symbol (set at initialization).
    VaultSymbol,
    /// Contract version integer (set at initialization).
    VaultVersion,
    // -----------------------------------------------------------------------
    // AuraPriceOracle integration (Issue #348)
    // -----------------------------------------------------------------------
    /// Oracle contract address for underlying token USD price.
    OracleAddress,
    /// Maximum age (seconds) for an oracle price before it is treated as stale.
    /// Default: ORACLE_DEFAULT_MAX_AGE_SECS (3600 s = 1 hour).
    OracleMaxAge,
    // -----------------------------------------------------------------------
    // Price snapshots (Issue #352)
    // -----------------------------------------------------------------------
    /// Share-price snapshot stored after every harvest.
    /// Key = ledger timestamp (u64), Value = share price in micro-USD (i128).
    PriceSnapshot(u64),
}

pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const INSTANCE_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const PERSISTENT_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;

// ---------------------------------------------------------------------------
// Instance-storage helpers
// ---------------------------------------------------------------------------

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::UnderlyingToken)
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UnderlyingToken, token);
}

pub fn get_total_shares(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
}

pub fn set_total_shares(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::TotalShares, &val);
}

pub fn get_total_deposited(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalDeposited).unwrap_or(0)
}

pub fn set_total_deposited(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::TotalDeposited, &val);
}

// ---------------------------------------------------------------------------
// Persistent-storage helpers
// ---------------------------------------------------------------------------

pub fn get_balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(addr.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, addr: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(addr.clone()), &val);
}

// ---------------------------------------------------------------------------
// Fee storage helpers (instance storage)
// ---------------------------------------------------------------------------

pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Treasury)
}

pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn get_perf_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::PerfFeeBps).unwrap_or(1000)
}

pub fn set_perf_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::PerfFeeBps, &bps);
}

pub fn get_mgmt_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::MgmtFeeBps).unwrap_or(0)
}

pub fn set_mgmt_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::MgmtFeeBps, &bps);
}

pub fn get_total_fee_collected(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalFeeCollected).unwrap_or(0)
}

pub fn set_total_fee_collected(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::TotalFeeCollected, &val);
}

pub fn get_last_mgmt_fee_time(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::LastMgmtFeeTime).unwrap_or(0)
}

pub fn set_last_mgmt_fee_time(env: &Env, time: u64) {
    env.storage().instance().set(&DataKey::LastMgmtFeeTime, &time);
}

// ---------------------------------------------------------------------------
// Yield-token whitelist helpers (instance storage — Issue #48)
// ---------------------------------------------------------------------------

pub fn is_yield_token(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::YieldToken(token.clone()))
        .unwrap_or(false)
}

pub fn set_yield_token(env: &Env, token: &Address, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::YieldToken(token.clone()), &enabled);
}

// ---------------------------------------------------------------------------
// TTL bump helpers
// ---------------------------------------------------------------------------

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn bump_persistent(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .extend_ttl(
            &DataKey::Balance(addr.clone()),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
}

// ---------------------------------------------------------------------------
// Version helpers (instance storage — same TTL as the rest of state)
// ---------------------------------------------------------------------------

/// Current storage layout constant. Bump this in source whenever a new
/// DataKey variant changes an existing key's meaning.
pub const CURRENT_LAYOUT_VERSION: u32 = 1;

pub fn get_version(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Version).unwrap_or(0)
}

pub fn set_version(env: &Env, v: u32) {
    env.storage().instance().set(&DataKey::Version, &v);
}

pub fn get_layout_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::LayoutVersion)
        .unwrap_or(0)
}

pub fn set_layout_version(env: &Env, v: u32) {
    env.storage().instance().set(&DataKey::LayoutVersion, &v);
}

// ---------------------------------------------------------------------------
// Pause helpers (instance storage)
// ---------------------------------------------------------------------------

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

// ---------------------------------------------------------------------------
// TVL cap helpers (instance storage) — Issue #467
// 0 means unlimited.
// ---------------------------------------------------------------------------

pub fn get_tvl_cap(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TvlCap).unwrap_or(0)
}

pub fn set_tvl_cap(env: &Env, cap: i128) {
    env.storage().instance().set(&DataKey::TvlCap, &cap);
}

// ---------------------------------------------------------------------------
// Harvest cooldown helpers (instance storage) — Issue #471
// ---------------------------------------------------------------------------

/// Timestamp (ledger unix seconds) of the last successful harvest. 0 = never.
pub fn get_last_harvest_time(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::LastHarvestTime).unwrap_or(0)
}

pub fn set_last_harvest_time(env: &Env, ts: u64) {
    env.storage().instance().set(&DataKey::LastHarvestTime, &ts);
}

/// Minimum seconds that must elapse between harvests. 0 = no cooldown.
pub fn get_harvest_cooldown_secs(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::HarvestCooldownSecs).unwrap_or(0)
}

pub fn set_harvest_cooldown_secs(env: &Env, secs: u64) {
    env.storage().instance().set(&DataKey::HarvestCooldownSecs, &secs);
}

// ---------------------------------------------------------------------------
// Yield-distribution accumulator helpers (Issue #YD)
// ---------------------------------------------------------------------------

/// Global cumulative yield-per-share (YPS), scaled by YIELD_PRECISION.
pub fn get_cumulative_yps(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::CumulativeYps).unwrap_or(0)
}

pub fn set_cumulative_yps(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::CumulativeYps, &val);
}

/// Per-user YPS checkpoint (persistent storage — one entry per user address).
pub fn get_user_checkpoint(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserCheckpoint(addr.clone()))
        .unwrap_or(0)
}

pub fn set_user_checkpoint(env: &Env, addr: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::UserCheckpoint(addr.clone()), &val);
}

/// Per-user stored pending yield tokens, in underlying units.
pub fn get_user_pending_yield(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserPendingYield(addr.clone()))
        .unwrap_or(0)
}

pub fn set_user_pending_yield(env: &Env, addr: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::UserPendingYield(addr.clone()), &val);
}

/// Global distribution epoch counter.
pub fn get_distribution_epoch(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::DistributionEpoch).unwrap_or(0)
}

pub fn set_distribution_epoch(env: &Env, epoch: u64) {
    env.storage().instance().set(&DataKey::DistributionEpoch, &epoch);
}

/// TTL bump for per-user yield checkpoint and pending entries.
pub fn bump_user_yield_ttl(env: &Env, addr: &Address) {
    // Bump both entries if they exist; silently skip if not yet set.
    let ck = DataKey::UserCheckpoint(addr.clone());
    if env.storage().persistent().has(&ck) {
        env.storage().persistent().extend_ttl(&ck, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    }
    let py = DataKey::UserPendingYield(addr.clone());
    if env.storage().persistent().has(&py) {
        env.storage().persistent().extend_ttl(&py, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    }
}

// ---------------------------------------------------------------------------
// Withdrawal queue helpers (Issue #WQ)
// ---------------------------------------------------------------------------

/// Minimum underlying-token amount that routes a withdrawal through the queue.
/// 0 means all withdrawals are instant (queue disabled).
pub fn get_withdrawal_queue_threshold(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::WithdrawalQueueThreshold).unwrap_or(0)
}

pub fn set_withdrawal_queue_threshold(env: &Env, threshold: i128) {
    env.storage().instance().set(&DataKey::WithdrawalQueueThreshold, &threshold);
}

/// Seconds a queued withdrawal must wait before it can be claimed.
/// Default 0 (instant once queued — admin sets unbonding period).
pub fn get_withdrawal_unbonding_secs(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::WithdrawalUnbondingSecs).unwrap_or(0)
}

pub fn set_withdrawal_unbonding_secs(env: &Env, secs: u64) {
    env.storage().instance().set(&DataKey::WithdrawalUnbondingSecs, &secs);
}

/// Withdrawal fee in basis points (0–500). Applied on claim.
pub fn get_withdrawal_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::WithdrawalFeeBps).unwrap_or(0)
}

pub fn set_withdrawal_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::WithdrawalFeeBps, &bps);
}

/// Monotonically-increasing withdrawal queue ID.  The next entry will use
/// this value, then it is incremented.
pub fn get_withdrawal_next_id(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::WithdrawalNextId).unwrap_or(1)
}

pub fn set_withdrawal_next_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::WithdrawalNextId, &id);
}

/// Retrieve a withdrawal queue entry.
pub fn get_withdrawal_entry(env: &Env, id: u64) -> Option<WithdrawalEntry> {
    env.storage().persistent().get(&DataKey::WithdrawalEntry(id))
}

/// Store a withdrawal queue entry.
pub fn set_withdrawal_entry(env: &Env, id: u64, entry: &WithdrawalEntry) {
    env.storage()
        .persistent()
        .set(&DataKey::WithdrawalEntry(id), entry);
    let key = DataKey::WithdrawalEntry(id);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

/// Remove a withdrawal queue entry (after claim).
pub fn remove_withdrawal_entry(env: &Env, id: u64) {
    env.storage().persistent().remove(&DataKey::WithdrawalEntry(id));
}

// ---------------------------------------------------------------------------
// Circuit-breaker helpers (instance storage) — Issue #371
// ---------------------------------------------------------------------------

/// Maximum allowed share-price movement per harvest, in basis points.
/// 0 = check disabled.  Applies symmetrically to upward and downward moves.
pub fn get_price_movement_limit(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PriceMovementLimit)
        .unwrap_or(0)
}

pub fn set_price_movement_limit(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PriceMovementLimit, &bps);
}

/// A single entry in the withdrawal queue.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct WithdrawalEntry {
    /// Address that queued the withdrawal.
    pub owner: Address,
    /// Number of vault shares burned when this entry was created.
    pub shares: i128,
    /// Underlying token amount to be redeemed (computed at queue time).
    pub redeem_amount: i128,
    /// Ledger timestamp after which the entry may be claimed.
    pub claimable_after: u64,
    /// Whether this entry has already been claimed.
    pub claimed: bool,
}

// ---------------------------------------------------------------------------
// Whitelist helpers (Issue #349)
// ---------------------------------------------------------------------------

pub fn get_whitelist_enabled(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::WhitelistEnabled).unwrap_or(false)
}

pub fn set_whitelist_enabled(env: &Env, enabled: bool) {
    env.storage().instance().set(&DataKey::WhitelistEnabled, &enabled);
}

pub fn is_whitelisted(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Whitelist(addr.clone()))
        .unwrap_or(false)
}

pub fn set_whitelisted(env: &Env, addr: &Address, whitelisted: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Whitelist(addr.clone()), &whitelisted);
    let key = DataKey::Whitelist(addr.clone());
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

// ---------------------------------------------------------------------------
// Minimum deposit helpers (Issue #355)
// ---------------------------------------------------------------------------

pub fn get_min_deposit(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::MinDeposit).unwrap_or(10_000)
}

pub fn set_min_deposit(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::MinDeposit, &amount);
}

// ---------------------------------------------------------------------------
// Contract metadata helpers (Issue #350)
// ---------------------------------------------------------------------------

pub fn get_vault_name(env: &Env) -> Option<soroban_sdk::String> {
    env.storage().instance().get(&DataKey::VaultName)
}

pub fn set_vault_name(env: &Env, name: &soroban_sdk::String) {
    env.storage().instance().set(&DataKey::VaultName, name);
}

pub fn get_vault_symbol(env: &Env) -> Option<soroban_sdk::String> {
    env.storage().instance().get(&DataKey::VaultSymbol)
}

pub fn set_vault_symbol(env: &Env, symbol: &soroban_sdk::String) {
    env.storage().instance().set(&DataKey::VaultSymbol, symbol);
}

pub fn get_vault_version(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::VaultVersion).unwrap_or(1u32)
}

pub fn set_vault_version(env: &Env, version: u32) {
    env.storage().instance().set(&DataKey::VaultVersion, &version);
}

// ---------------------------------------------------------------------------
// AuraPriceOracle helpers (Issue #348)
// ---------------------------------------------------------------------------

/// Oracle contract address for the underlying token USD price.
pub fn get_oracle_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::OracleAddress)
}

pub fn set_oracle_address(env: &Env, oracle: &Address) {
    env.storage().instance().set(&DataKey::OracleAddress, oracle);
}

/// Maximum price age in seconds before staleness rejection.
/// Default: 3600 (1 hour) — matches ORACLE_DEFAULT_MAX_AGE_SECS.
pub fn get_oracle_max_age(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::OracleMaxAge)
        .unwrap_or(3_600)
}

pub fn set_oracle_max_age(env: &Env, secs: u64) {
    env.storage().instance().set(&DataKey::OracleMaxAge, &secs);
}

// ---------------------------------------------------------------------------
// Price snapshot helpers (Issue #352)
// ---------------------------------------------------------------------------

/// 90-day TTL constants for price snapshots.
pub const SNAPSHOT_TTL_LEDGERS: u32 = DAY_IN_LEDGERS * 90;
pub const SNAPSHOT_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;

/// Store a share-price snapshot at the given timestamp.
pub fn set_price_snapshot(env: &Env, timestamp: u64, price: i128) {
    let key = DataKey::PriceSnapshot(timestamp);
    env.storage().persistent().set(&key, &price);
    env.storage()
        .persistent()
        .extend_ttl(&key, SNAPSHOT_TTL_THRESHOLD, SNAPSHOT_TTL_LEDGERS);
}

/// Retrieve a share-price snapshot for a given timestamp.
pub fn get_price_snapshot(env: &Env, timestamp: u64) -> Option<i128> {
    env.storage()
        .persistent()
        .get(&DataKey::PriceSnapshot(timestamp))
}

// ---------------------------------------------------------------------------
// Multi-sig governance helpers (Issue #375)
// ---------------------------------------------------------------------------

/// Expiry duration for multi-sig operations (72 hours in seconds).
pub const MULTISIG_EXPIRY_SECS: u64 = 72 * 3_600;

/// Keys for multi-sig governance data (stored in instance storage).
#[contracttype]
pub enum MultisigStorageKey {
    /// Ordered list of authorized governance signers.
    Signers,
    /// Required number of signatures (M of N).
    Threshold,
    /// Monotonically increasing operation counter.
    OpCount,
    /// Per-operation vote record: (op_id, signer) → bool
    Voted(u64, soroban_sdk::Address),
}

/// Get the current list of multisig signers.
pub fn get_multisig_signers(env: &Env) -> soroban_sdk::Vec<soroban_sdk::Address> {
    env.storage()
        .instance()
        .get(&MultisigStorageKey::Signers)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// Set the multisig signer list.
pub fn set_multisig_signers(env: &Env, signers: &soroban_sdk::Vec<soroban_sdk::Address>) {
    env.storage()
        .instance()
        .set(&MultisigStorageKey::Signers, signers);
}

/// Get the signature threshold (M).
pub fn get_multisig_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&MultisigStorageKey::Threshold)
        .unwrap_or(1)
}

/// Set the signature threshold.
pub fn set_multisig_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&MultisigStorageKey::Threshold, &threshold);
}

/// Get the current operation count (used to assign new IDs).
pub fn get_multisig_op_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&MultisigStorageKey::OpCount)
        .unwrap_or(0)
}

/// Update the operation count.
pub fn set_multisig_op_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&MultisigStorageKey::OpCount, &count);
}

/// Check if a signer has already voted on an operation.
pub fn has_multisig_signed(env: &Env, op_id: u64, signer: &soroban_sdk::Address) -> bool {
    env.storage()
        .instance()
        .get(&MultisigStorageKey::Voted(op_id, signer.clone()))
        .unwrap_or(false)
}

/// Record a signer's vote for an operation.
pub fn record_multisig_vote(env: &Env, op_id: u64, signer: &soroban_sdk::Address) {
    env.storage()
        .instance()
        .set(&MultisigStorageKey::Voted(op_id, signer.clone()), &true);
}

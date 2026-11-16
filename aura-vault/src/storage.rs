use crate::errors::VaultError;
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultState {
    pub total_assets: i128,
    pub total_shares: i128,
}

#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    UnderlyingToken,
    TotalShares,
    TotalDeposited,
    VaultState,
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
    /// Harvest-specific epoch counter, independent of yield distributions.
    HarvestEpoch,
    /// Start time and aggregate checkpoint for time-weighted harvest epochs.
    EpochStart,
    EpochLastUpdate,
    EpochShareSeconds,
    EpochStartAt(u64),
    EpochEndAt(u64),
    EpochTotalShareSeconds(u64),
    EpochYield(u64),
    /// Latest deposit metadata for an address.
    DepositTimestamp(Address),
    DepositEpoch(Address),
    /// User share-seconds checkpoints and per-epoch weights.
    UserEpochTimestamp(Address),
    UserEpochIndex(Address),
    UserEpochShareSeconds(Address, u64),
    /// Harvested yield still owed to shareholders.
    OutstandingHarvestYield,
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
    // Withdrawal rate limit (Issue #913)
    // -----------------------------------------------------------------------
    MaxWithdrawalBps,
    LastWithdrawalLedger,
    CurrentLedgerWithdrawals,
    // -----------------------------------------------------------------------
    // Minimum harvest amount (Issue #914)
    // -----------------------------------------------------------------------
    MinHarvestAmount,
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
    // Contract metadata (Issue #350, Issue #347)
    // -----------------------------------------------------------------------
    /// Vault name (set at initialization).
    VaultName,
    /// Vault share symbol (set at initialization).
    VaultSymbol,
    /// Contract version integer (set at initialization).
    VaultVersion,
    /// Vault share decimals (set at initialization, immutable). Issue #347.
    Decimals,
    // -----------------------------------------------------------------------
    // Reentrancy guard (Issue #345)
    // -----------------------------------------------------------------------
    /// Reentrancy guard lock flag.
    ReentrancyGuard,
    // -----------------------------------------------------------------------
    // Per-address deposit nonce (replay-attack prevention)
    // -----------------------------------------------------------------------
    /// Monotonically increasing nonce for `deposit` calls.  Starts at 0 for
    /// every new address.  Must be supplied by the caller and is incremented
    /// atomically on every successful deposit.
    Nonce(Address),
    // ---------------------------------------------------------------------------
    // Role-based access control (RBAC)
    // ---------------------------------------------------------------------------
    /// Per-address role bitmask (u32). Bits defined by ADMIN_ROLE, KEEPER_ROLE, etc.
    Role(Address),
    // ---------------------------------------------------------------------------
    // Multi-sig admin operations (Issue #375)
    // ---------------------------------------------------------------------------
    /// Ordered list of current multi-sig signers
    MultiSigSigners,
    /// M (threshold) — number of signatures required to execute an operation
    MultiSigThreshold,
    /// Monotonically increasing operation counter
    MultiSigOpCount,
    /// Per-signer vote record — prevents double-signing. Tuple: (op_id, signer).
    MultiSigVote(u64, Address),
    /// Per-address role bitmask used by admin/keeper/guardian checks.
    Role(Address),
    /// SEP-41 share allowance and its expiration ledger.
    ShareAllowance(Address, Address),
    /// Optional contract address implementing the configured DEX router API.
    DexRouter,
    /// Pending admin nominated for a two-step transfer.
    PendingAdmin,
    /// Unix timestamp at which a pending admin transfer expires.
    PendingAdminExpiry,
    /// Yield amount currently subject to linear vesting, in underlying units.
    YieldVestingPending,
    /// Ledger at which the current vesting interval began.
    YieldVestingStart,
    /// Vesting interval length, in ledgers.
    YieldVestingPeriod,
}

pub const ADMIN_ROLE: u32 = 1 << 0;
pub const KEEPER_ROLE: u32 = 1 << 1;
pub const GUARDIAN_ROLE: u32 = 1 << 2;

/// Check whether `addr` has been granted the specified role bitmask.
///
/// Role assignments are stored in instance storage as a u32 bitmask under a
/// `Role(address)` key.  Returns `false` for any address that has no role
/// entry (i.e. not yet assigned).
pub fn has_role(env: &Env, addr: &Address, role: u32) -> bool {
    let stored: u32 = env
        .storage()
        .instance()
        .get(&DataKey::Role(addr.clone()))
        .unwrap_or(0);
    stored & role != 0
}

pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const DEFAULT_YIELD_VESTING_PERIOD: u32 = DAY_IN_LEDGERS * 7;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const INSTANCE_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const PERSISTENT_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;

// ---------------------------------------------------------------------------
// Instance-storage helpers
// ---------------------------------------------------------------------------

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
        || env.storage().instance().has(&DataKey::UnderlyingToken)
        || env.storage().instance().has(&DataKey::Admin)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::UnderlyingToken)
}

pub fn get_active_strategy(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::ActiveStrategy)
}

pub fn set_active_strategy(env: &Env, strategy: &Address) {
    env.storage().instance().set(&DataKey::ActiveStrategy, strategy);
}

pub fn clear_active_strategy(env: &Env) {
    env.storage().instance().remove(&DataKey::ActiveStrategy);
}

pub fn get_oracle_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::OracleAddress)
}

pub fn set_oracle_address(env: &Env, address: &Address) {
    env.storage().instance().set(&DataKey::OracleAddress, address);
}

pub fn get_oracle_max_age(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::OracleMaxAgeSecs).unwrap_or(3_600)
}

pub fn set_oracle_max_age(env: &Env, seconds: u64) {
    env.storage().instance().set(&DataKey::OracleMaxAgeSecs, &seconds);
}

pub fn get_swap_router(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::SwapRouterAddress)
}

pub fn set_swap_router(env: &Env, address: &Address) {
    env.storage().instance().set(&DataKey::SwapRouterAddress, address);
}

pub fn get_max_swap_slippage_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::MaxSwapSlippageBps).unwrap_or(300)
}

pub fn set_max_swap_slippage_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::MaxSwapSlippageBps, &bps);
}

pub fn get_twap_window_secs(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::TwapWindowSecs).unwrap_or(1_800)
}

pub fn set_twap_window_secs(env: &Env, seconds: u64) {
    env.storage().instance().set(&DataKey::TwapWindowSecs, &seconds);
}

pub fn get_max_oracle_deviation_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::MaxOracleDeviationBps).unwrap_or(500)
}

pub fn set_max_oracle_deviation_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::MaxOracleDeviationBps, &bps);
}

pub fn get_strategy_timelock(env: &Env, operation_id: u64) -> u64 {
    env.storage().instance().get(&DataKey::StrategyTimelock(operation_id)).unwrap_or(0)
}

pub fn set_strategy_timelock(env: &Env, operation_id: u64, ready_at: u64) {
    env.storage().instance().set(&DataKey::StrategyTimelock(operation_id), &ready_at);
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::UnderlyingToken, token);
}

pub fn get_dex_router(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::DexRouter)
}

pub fn set_dex_router(env: &Env, router: Option<&Address>) {
    if let Some(address) = router {
        env.storage().instance().set(&DataKey::DexRouter, address);
    } else {
        env.storage().instance().remove(&DataKey::DexRouter);
    }
}

pub fn get_vault_state(env: &Env) -> VaultState {
    if let Some(state) = env.storage().instance().get(&DataKey::VaultState) {
        state
    } else {
        VaultState {
            total_assets: env.storage().instance().get(&DataKey::TotalDeposited).unwrap_or(0),
            total_shares: env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0),
        }
    }
}

pub fn set_vault_state(env: &Env, state: &VaultState) {
    env.storage().instance().set(&DataKey::VaultState, state);
    env.storage().instance().set(&DataKey::TotalDeposited, &state.total_assets);
    env.storage().instance().set(&DataKey::TotalShares, &state.total_shares);
}

pub fn get_total_shares(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalShares)
        .unwrap_or(0)
}

pub fn set_total_shares(env: &Env, val: i128) {
    let mut state = get_vault_state(env);
    state.total_shares = val;
    set_vault_state(env, &state);
}

pub fn get_total_deposited(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalDeposited)
        .unwrap_or(0)
}

pub fn set_total_deposited(env: &Env, val: i128) {
    let mut state = get_vault_state(env);
    state.total_assets = val;
    set_vault_state(env, &state);
}

pub fn get_yield_vesting_pending(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::YieldVestingPending).unwrap_or(0)
}

pub fn set_yield_vesting_pending(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::YieldVestingPending, &amount);
}

pub fn get_yield_vesting_start(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::YieldVestingStart).unwrap_or(0)
}

pub fn set_yield_vesting_start(env: &Env, ledger: u32) {
    env.storage().instance().set(&DataKey::YieldVestingStart, &ledger);
}

pub fn get_yield_vesting_period(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::YieldVestingPeriod).unwrap_or(DEFAULT_YIELD_VESTING_PERIOD)
}

pub fn set_yield_vesting_period(env: &Env, ledgers: u32) {
    env.storage().instance().set(&DataKey::YieldVestingPeriod, &ledgers);
}

/// Returns the portion of harvested yield that has not vested at this ledger.
pub fn unvested_yield(env: &Env) -> i128 {
    let pending = get_yield_vesting_pending(env);
    let period = get_yield_vesting_period(env);
    if pending <= 0 || period == 0 { return 0; }
    let start = get_yield_vesting_start(env);
    let elapsed = env.ledger().sequence().saturating_sub(start);
    if elapsed >= period { return 0; }
    let remaining = (period - elapsed) as i128;
    let period = period as i128;
    (pending / period) * remaining + ((pending % period) * remaining) / period
}

/// Add a new yield credit while preserving the currently unvested balance.
/// The combined remainder restarts its linear schedule from the current ledger.
pub fn schedule_yield_vesting(env: &Env, added: i128) -> Result<(), VaultError> {
    let pending = unvested_yield(env)
        .checked_add(added)
        .ok_or(VaultError::MathOverflow)?;
    set_yield_vesting_pending(env, pending);
    set_yield_vesting_start(env, env.ledger().sequence());
    Ok(())
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

pub fn get_share_allowance(env: &Env, owner: &Address, spender: &Address) -> i128 {
    get_share_allowance_details(env, owner, spender).map(|(amount, _)| amount).unwrap_or(0)
}

pub fn get_share_allowance_details(
    env: &Env,
    owner: &Address,
    spender: &Address,
) -> Option<(i128, u32)> {
    let key = DataKey::ShareAllowance(owner.clone(), spender.clone());
    match env.storage().persistent().get::<_, (i128, u32)>(&key) {
        value @ Some((_, expiration)) if env.ledger().sequence() <= expiration => value,
        _ => None,
    }
}

pub fn set_share_allowance(
    env: &Env,
    owner: &Address,
    spender: &Address,
    amount: i128,
    expiration: u32,
) {
    let key = DataKey::ShareAllowance(owner.clone(), spender.clone());
    env.storage().persistent().set(&key, &(amount, expiration));
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
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
    env.storage()
        .instance()
        .get(&DataKey::PerfFeeBps)
        .unwrap_or(1000)
}

pub fn set_perf_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::PerfFeeBps, &bps);
}

pub fn get_mgmt_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MgmtFeeBps)
        .unwrap_or(0)
}

pub fn set_mgmt_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::MgmtFeeBps, &bps);
}

pub fn get_total_fee_collected(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalFeeCollected)
        .unwrap_or(0)
}

pub fn set_total_fee_collected(env: &Env, val: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalFeeCollected, &val);
}

pub fn get_last_mgmt_fee_time(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::LastMgmtFeeTime)
        .unwrap_or(0)
}

pub fn set_last_mgmt_fee_time(env: &Env, time: u64) {
    env.storage()
        .instance()
        .set(&DataKey::LastMgmtFeeTime, &time);
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
    env.storage().persistent().extend_ttl(
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
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
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
    env.storage()
        .instance()
        .get(&DataKey::LastHarvestTime)
        .unwrap_or(0)
}

pub fn set_last_harvest_time(env: &Env, ts: u64) {
    env.storage().instance().set(&DataKey::LastHarvestTime, &ts);
}

/// Minimum seconds that must elapse between harvests. 0 = no cooldown.
pub fn get_harvest_cooldown_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::HarvestCooldownSecs)
        .unwrap_or(0)
}

pub fn set_harvest_cooldown_secs(env: &Env, secs: u64) {
    env.storage()
        .instance()
        .set(&DataKey::HarvestCooldownSecs, &secs);
}

// ---------------------------------------------------------------------------
// Yield-distribution accumulator helpers (Issue #YD)
// ---------------------------------------------------------------------------

/// Global cumulative yield-per-share (YPS), scaled by YIELD_PRECISION.
pub fn get_cumulative_yps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::CumulativeYps)
        .unwrap_or(0)
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
    env.storage()
        .instance()
        .get(&DataKey::DistributionEpoch)
        .unwrap_or(0)
}

pub fn set_distribution_epoch(env: &Env, epoch: u64) {
    env.storage()
        .instance()
        .set(&DataKey::DistributionEpoch, &epoch);
}

pub fn get_harvest_epoch(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::HarvestEpoch).unwrap_or(0)
}

pub fn set_harvest_epoch(env: &Env, epoch: u64) {
    env.storage().instance().set(&DataKey::HarvestEpoch, &epoch);
}

pub fn get_epoch_start(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::EpochStart).unwrap_or(0)
}

pub fn set_epoch_start(env: &Env, timestamp: u64) {
    env.storage().instance().set(&DataKey::EpochStart, &timestamp);
}

pub fn get_epoch_last_update(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::EpochLastUpdate).unwrap_or_else(|| get_epoch_start(env))
}

pub fn set_epoch_last_update(env: &Env, timestamp: u64) {
    env.storage().instance().set(&DataKey::EpochLastUpdate, &timestamp);
}

pub fn get_epoch_share_seconds(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::EpochShareSeconds).unwrap_or(0)
}

pub fn set_epoch_share_seconds(env: &Env, share_seconds: i128) {
    env.storage().instance().set(&DataKey::EpochShareSeconds, &share_seconds);
}

pub fn set_epoch_start_at(env: &Env, epoch: u64, timestamp: u64) {
    let key = DataKey::EpochStartAt(epoch);
    env.storage().persistent().set(&key, &timestamp);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_epoch_start_at(env: &Env, epoch: u64) -> u64 {
    env.storage().persistent().get(&DataKey::EpochStartAt(epoch)).unwrap_or(0)
}

pub fn set_epoch_end_at(env: &Env, epoch: u64, timestamp: u64) {
    let key = DataKey::EpochEndAt(epoch);
    env.storage().persistent().set(&key, &timestamp);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_epoch_end_at(env: &Env, epoch: u64) -> Option<u64> {
    env.storage().persistent().get(&DataKey::EpochEndAt(epoch))
}

pub fn set_epoch_total_share_seconds(env: &Env, epoch: u64, share_seconds: i128) {
    let key = DataKey::EpochTotalShareSeconds(epoch);
    env.storage().persistent().set(&key, &share_seconds);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_epoch_total_share_seconds(env: &Env, epoch: u64) -> i128 {
    env.storage().persistent().get(&DataKey::EpochTotalShareSeconds(epoch)).unwrap_or(0)
}

pub fn set_epoch_yield(env: &Env, epoch: u64, amount: i128) {
    let key = DataKey::EpochYield(epoch);
    env.storage().persistent().set(&key, &amount);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_epoch_yield(env: &Env, epoch: u64) -> i128 {
    env.storage().persistent().get(&DataKey::EpochYield(epoch)).unwrap_or(0)
}

pub fn set_deposit_metadata(env: &Env, addr: &Address, timestamp: u64, epoch: u64) {
    let timestamp_key = DataKey::DepositTimestamp(addr.clone());
    let epoch_key = DataKey::DepositEpoch(addr.clone());
    env.storage().persistent().set(&timestamp_key, &timestamp);
    env.storage().persistent().set(&epoch_key, &epoch);
    env.storage().persistent().extend_ttl(&timestamp_key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    env.storage().persistent().extend_ttl(&epoch_key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_deposit_timestamp(env: &Env, addr: &Address) -> u64 {
    env.storage().persistent().get(&DataKey::DepositTimestamp(addr.clone())).unwrap_or(0)
}

pub fn get_deposit_epoch(env: &Env, addr: &Address) -> u64 {
    env.storage().persistent().get(&DataKey::DepositEpoch(addr.clone())).unwrap_or(0)
}

pub fn get_user_epoch_cursor(env: &Env, addr: &Address) -> Option<(u64, u64)> {
    let timestamp = env.storage().persistent().get(&DataKey::UserEpochTimestamp(addr.clone()))?;
    let epoch = env.storage().persistent().get(&DataKey::UserEpochIndex(addr.clone()))?;
    Some((timestamp, epoch))
}

pub fn set_user_epoch_cursor(env: &Env, addr: &Address, timestamp: u64, epoch: u64) {
    let timestamp_key = DataKey::UserEpochTimestamp(addr.clone());
    let epoch_key = DataKey::UserEpochIndex(addr.clone());
    env.storage().persistent().set(&timestamp_key, &timestamp);
    env.storage().persistent().set(&epoch_key, &epoch);
    env.storage().persistent().extend_ttl(&timestamp_key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
    env.storage().persistent().extend_ttl(&epoch_key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_user_epoch_share_seconds(env: &Env, addr: &Address, epoch: u64) -> i128 {
    env.storage().persistent().get(&DataKey::UserEpochShareSeconds(addr.clone(), epoch)).unwrap_or(0)
}

pub fn set_user_epoch_share_seconds(env: &Env, addr: &Address, epoch: u64, share_seconds: i128) {
    let key = DataKey::UserEpochShareSeconds(addr.clone(), epoch);
    env.storage().persistent().set(&key, &share_seconds);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_outstanding_harvest_yield(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::OutstandingHarvestYield).unwrap_or(0)
}

pub fn set_outstanding_harvest_yield(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::OutstandingHarvestYield, &amount);
}

/// TTL bump for per-user yield checkpoint and pending entries.
pub fn bump_user_yield_ttl(env: &Env, addr: &Address) {
    // Bump both entries if they exist; silently skip if not yet set.
    let ck = DataKey::UserCheckpoint(addr.clone());
    if env.storage().persistent().has(&ck) {
        env.storage().persistent().extend_ttl(
            &ck,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
    let py = DataKey::UserPendingYield(addr.clone());
    if env.storage().persistent().has(&py) {
        env.storage().persistent().extend_ttl(
            &py,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
}

// ---------------------------------------------------------------------------
// Withdrawal queue helpers (Issue #WQ)
// ---------------------------------------------------------------------------

/// Minimum underlying-token amount that routes a withdrawal through the queue.
/// 0 means all withdrawals are instant (queue disabled).
pub fn get_withdrawal_queue_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawalQueueThreshold)
        .unwrap_or(0)
}

pub fn set_withdrawal_queue_threshold(env: &Env, threshold: i128) {
    env.storage()
        .instance()
        .set(&DataKey::WithdrawalQueueThreshold, &threshold);
}

/// Seconds a queued withdrawal must wait before it can be claimed.
/// Default 0 (instant once queued — admin sets unbonding period).
pub fn get_withdrawal_unbonding_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawalUnbondingSecs)
        .unwrap_or(0)
}

pub fn set_withdrawal_unbonding_secs(env: &Env, secs: u64) {
    env.storage()
        .instance()
        .set(&DataKey::WithdrawalUnbondingSecs, &secs);
}

/// Withdrawal fee in basis points (0–500). Applied on claim.
pub fn get_withdrawal_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawalFeeBps)
        .unwrap_or(0)
}

pub fn set_withdrawal_fee_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::WithdrawalFeeBps, &bps);
}

/// Monotonically-increasing withdrawal queue ID.  The next entry will use
/// this value, then it is incremented.
pub fn get_withdrawal_next_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawalNextId)
        .unwrap_or(1)
}

pub fn set_withdrawal_next_id(env: &Env, id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::WithdrawalNextId, &id);
}

/// Retrieve a withdrawal queue entry.
pub fn get_withdrawal_entry(env: &Env, id: u64) -> Option<WithdrawalEntry> {
    env.storage()
        .persistent()
        .get(&DataKey::WithdrawalEntry(id))
}

/// Store a withdrawal queue entry.
pub fn set_withdrawal_entry(env: &Env, id: u64, entry: &WithdrawalEntry) {
    env.storage()
        .persistent()
        .set(&DataKey::WithdrawalEntry(id), entry);
    let key = DataKey::WithdrawalEntry(id);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Remove a withdrawal queue entry (after claim).
pub fn remove_withdrawal_entry(env: &Env, id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::WithdrawalEntry(id));
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
    env.storage()
        .instance()
        .get(&DataKey::WhitelistEnabled)
        .unwrap_or(false)
}

pub fn set_whitelist_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::WhitelistEnabled, &enabled);
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
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

// ---------------------------------------------------------------------------
// KYC deposit allowlist (Issue #916)
// ---------------------------------------------------------------------------

pub fn is_allowlist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AllowlistEnabled)
        .unwrap_or(false)
}

pub fn set_allowlist_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::AllowlistEnabled, &enabled);
}

pub fn is_allowlisted(env: &Env, address: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AllowlistedAddress(address.clone()))
        .unwrap_or(false)
}

pub fn set_allowlisted(env: &Env, address: &Address, allowed: bool) {
    let key = DataKey::AllowlistedAddress(address.clone());
    if allowed {
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    } else {
        env.storage().persistent().remove(&key);
    }
}

// ---------------------------------------------------------------------------
// Minimum deposit helpers (Issue #355)
// ---------------------------------------------------------------------------

pub fn get_min_deposit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinDeposit)
        .unwrap_or(10_000)
}

pub fn set_min_deposit(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::MinDeposit, &amount);
}

// ---------------------------------------------------------------------------
// Withdrawal rate limit helpers (Issue #913)
// ---------------------------------------------------------------------------

pub fn get_max_withdrawal_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxWithdrawalBps)
        .unwrap_or(0)
}

pub fn set_max_withdrawal_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MaxWithdrawalBps, &bps);
}

pub fn get_last_withdrawal_ledger(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::LastWithdrawalLedger)
        .unwrap_or(0)
}

pub fn set_last_withdrawal_ledger(env: &Env, ledger: u32) {
    env.storage()
        .instance()
        .set(&DataKey::LastWithdrawalLedger, &ledger);
}

pub fn get_current_ledger_withdrawals(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::CurrentLedgerWithdrawals)
        .unwrap_or(0)
}

pub fn set_current_ledger_withdrawals(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::CurrentLedgerWithdrawals, &amount);
}

// ---------------------------------------------------------------------------
// Minimum harvest amount helpers (Issue #914)
// ---------------------------------------------------------------------------

pub fn get_min_harvest_amount(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinHarvestAmount)
        .unwrap_or(1_000_000)
}

pub fn set_min_harvest_amount(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinHarvestAmount, &amount);
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
    env.storage()
        .instance()
        .get(&DataKey::VaultVersion)
        .unwrap_or(1u32)
}

pub fn set_vault_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::VaultVersion, &version);
}

// ---------------------------------------------------------------------------
// Vault share decimals helpers (Issue #347)
// ---------------------------------------------------------------------------

pub fn get_decimals(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Decimals)
        .unwrap_or(7u32)
}

pub fn set_decimals(env: &Env, decimals: u32) {
    env.storage().instance().set(&DataKey::Decimals, &decimals);
}

// ---------------------------------------------------------------------------
// Referral tracking helpers
// ---------------------------------------------------------------------------

/// Returns the number of deposits made through `referrer`.
pub fn get_referral_count(env: &Env, referrer: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ReferralCount(referrer.clone()))
        .unwrap_or(0u32)
}

/// Increments the referral deposit count for `referrer` by 1.
pub fn increment_referral_count(env: &Env, referrer: &Address) {
    let current = get_referral_count(env, referrer);
    let new_count = current.saturating_add(1);
    env.storage()
        .persistent()
        .set(&DataKey::ReferralCount(referrer.clone()), &new_count);
    let key = DataKey::ReferralCount(referrer.clone());
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

// ---------------------------------------------------------------------------
// Reentrancy guard helpers (Issue #345)
// ---------------------------------------------------------------------------

pub fn is_reentrancy_locked(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ReentrancyGuard)
        .unwrap_or(false)
}

pub fn set_reentrancy_lock(env: &Env, locked: bool) {
    env.storage()
        .instance()
        .set(&DataKey::ReentrancyGuard, &locked);
}

pub fn enter_reentrancy_guard(env: &Env) -> Result<(), VaultError> {
    if is_reentrancy_locked(env) {
        return Err(VaultError::Reentrancy);
    }
    set_reentrancy_lock(env, true);
    Ok(())
}

pub fn exit_reentrancy_guard(env: &Env) {
    set_reentrancy_lock(env, false);
}

// ---------------------------------------------------------------------------
// Per-address deposit nonce helpers (replay-attack prevention)
// ---------------------------------------------------------------------------

/// Return the current deposit nonce for `addr`.  Returns `0` for addresses
/// that have never deposited (their first valid nonce is `0`).
pub fn get_nonce(env: &Env, addr: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::Nonce(addr.clone()))
        .unwrap_or(0u64)
}

/// Overwrite the stored nonce.  Use `increment_nonce` instead in production
/// code; this setter is provided for testing and migration convenience.
pub fn set_nonce(env: &Env, addr: &Address, nonce: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::Nonce(addr.clone()), &nonce);
}

/// Atomically increment the nonce for `addr` by 1 and persist the new value.
///
/// Returns `Err(VaultError::MathOverflow)` on the astronomically unlikely
/// event that the nonce wraps past `u64::MAX`.
pub fn increment_nonce(env: &Env, addr: &Address) -> Result<(), VaultError> {
    let current = get_nonce(env, addr);
    let next = current.checked_add(1).ok_or(VaultError::MathOverflow)?;
    set_nonce(env, addr, next);
    // Keep the nonce entry alive for the standard 30-day window.
    env.storage().persistent().extend_ttl(
        &DataKey::Nonce(addr.clone()),
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Multi-sig storage helpers (Issue #375)
// ---------------------------------------------------------------------------

/// Default threshold is 2-of-N (overridden after signer set grows).
pub const DEFAULT_THRESHOLD: u32 = 2;
/// Operations expire 72 hours after proposal.
pub const MULTISIG_EXPIRY_SECS: u64 = 72 * 60 * 60;

pub fn get_multisig_signers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::MultiSigSigners)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_multisig_signers(env: &Env, signers: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::MultiSigSigners, signers);
}

pub fn get_multisig_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MultiSigThreshold)
        .unwrap_or(DEFAULT_THRESHOLD)
}

pub fn set_multisig_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MultiSigThreshold, &threshold);
}

pub fn get_multisig_op_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MultiSigOpCount)
        .unwrap_or(0)
}

pub fn set_multisig_op_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&DataKey::MultiSigOpCount, &count);
}

pub fn get_role_mask(env: &Env, addr: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Role(addr.clone()))
        .unwrap_or(0)
}

pub fn set_role_mask(env: &Env, addr: &Address, mask: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::Role(addr.clone()), &mask);
    let key = DataKey::Role(addr.clone());
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

pub fn has_role(env: &Env, addr: &Address, role: u32) -> bool {
    (get_role_mask(env, addr) & role) == role
}

pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}

pub fn set_pending_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::PendingAdmin, addr);
}

pub fn clear_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
}

pub fn get_pending_admin_expiry(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::PendingAdminExpiry)
        .unwrap_or(0)
}

pub fn set_pending_admin_expiry(env: &Env, expiry: u64) {
    env.storage()
        .instance()
        .set(&DataKey::PendingAdminExpiry, &expiry);
}

pub fn clear_pending_admin_expiry(env: &Env) {
    env.storage()
        .instance()
        .remove(&DataKey::PendingAdminExpiry);
}

pub fn has_multisig_signed(env: &Env, op_id: u64, signer: &Address) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::MultiSigVote(op_id, signer.clone()))
        .unwrap_or(false)
}

pub fn record_multisig_vote(env: &Env, op_id: u64, signer: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::MultiSigVote(op_id, signer.clone()), &true);
}

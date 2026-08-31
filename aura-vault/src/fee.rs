use crate::VaultError;

/// Performance fee in basis points (0-20%, i.e., 0-2000 bps)
pub const MIN_PERF_FEE_BPS: u32 = 0;     // 0%
pub const MAX_PERF_FEE_BPS: u32 = 2000;  // 20%

/// Management fee in basis points annually (0-1%, i.e., 0-100 bps)
pub const MIN_MGMT_FEE_BPS: u32 = 0; // 0%
pub const MAX_MGMT_FEE_BPS: u32 = 100; // 1%

const BASIS_POINTS: i128 = 10_000;

/// Calculate performance fee on yield
pub fn calc_perf_fee(yield_amount: i128, perf_fee_bps: u32) -> Result<i128, VaultError> {
    let fee_i128 = (perf_fee_bps as i128) * yield_amount / BASIS_POINTS;
    Ok(fee_i128)
}

/// Calculate management fee (daily accrual from annual %)
/// Assumes 365.25 days per year, treasury tracks accumulated amount
pub fn calc_mgmt_fee_daily(total_assets: i128, mgmt_fee_bps: u32) -> Result<i128, VaultError> {
    let annual_fee = (mgmt_fee_bps as i128) * total_assets / BASIS_POINTS;
    let daily_fee = annual_fee / 365;
    Ok(daily_fee)
}

/// Validate fee percentages
pub fn validate_fees(perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError> {
    if perf_fee_bps < MIN_PERF_FEE_BPS || perf_fee_bps > MAX_PERF_FEE_BPS {
        return Err(VaultError::InvalidAddress); // Reuse for invalid fee
    }
    if mgmt_fee_bps < MIN_MGMT_FEE_BPS || mgmt_fee_bps > MAX_MGMT_FEE_BPS {
        return Err(VaultError::InvalidAddress);
    }
    Ok(())
}

/// Ensure fee collection maintains precision
pub fn validate_fee_accuracy(collected: i128, calculated: i128) -> Result<(), VaultError> {
    let diff = (collected - calculated).abs();
    let tolerance = calculated / 10_000; // 0.01% tolerance
    if diff > tolerance {
        return Err(VaultError::MathOverflow);
    }
    Ok(())
}

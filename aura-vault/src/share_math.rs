//! Pure share-accounting arithmetic shared by the contract and Kani proofs.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DepositMathError {
    ZeroAmount,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WithdrawalMathError {
    Overflow,
    InsufficientAssets,
}

/// Calculate shares for a deposit using the vault's seed ratio and floor rule.
pub(crate) fn shares_for_assets(assets: i128, total_shares: i128, total_assets: i128) -> Option<i128> {
    if total_assets == 0 || total_shares == 0 {
        return Some(assets);
    }
    assets
        .checked_mul(total_shares)
        .and_then(|numerator| numerator.checked_div(total_assets))
}

/// Calculate shares accepted by `deposit`, including its zero-share mint fence.
pub(crate) fn deposit_shares(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
) -> Result<i128, DepositMathError> {
    if assets <= 0 {
        return Err(DepositMathError::ZeroAmount);
    }
    let shares = shares_for_assets(assets, total_shares, total_assets)
        .ok_or(DepositMathError::Overflow)?;
    if shares <= 0 {
        return Err(DepositMathError::ZeroAmount);
    }
    Ok(shares)
}

/// Calculate underlying assets for shares using floor division.
pub(crate) fn assets_for_shares(
    shares: i128,
    total_assets: i128,
    total_shares: i128,
) -> Option<i128> {
    if total_shares == 0 {
        return None;
    }
    shares
        .checked_mul(total_assets)
        .and_then(|numerator| numerator.checked_div(total_shares))
}

/// Calculate a withdrawal amount and enforce the contract's available-assets
/// bound before allowing the withdrawal transition to proceed.
pub(crate) fn withdrawal_assets(
    shares: i128,
    total_assets: i128,
    total_shares: i128,
) -> Result<i128, WithdrawalMathError> {
    let assets = assets_for_shares(shares, total_assets, total_shares)
        .ok_or(WithdrawalMathError::Overflow)?;
    if assets > total_assets {
        return Err(WithdrawalMathError::InsufficientAssets);
    }
    Ok(assets)
}

/// Calculate a fixed-point share price, returning `None` on overflow.
pub(crate) fn scaled_share_price(
    total_assets: i128,
    total_shares: i128,
    precision: i128,
) -> Option<i128> {
    if total_shares == 0 {
        return Some(0);
    }
    total_assets
        .checked_mul(precision)
        .and_then(|numerator| numerator.checked_div(total_shares))
}

/// Apply the two share balance additions performed by a successful deposit.
pub(crate) fn deposit_transition(
    owner_shares: i128,
    total_shares: i128,
    minted_shares: i128,
) -> Option<(i128, i128)> {
    Some((
        owner_shares.checked_add(minted_shares)?,
        total_shares.checked_add(minted_shares)?,
    ))
}

/// Apply the two share balance subtractions performed by a successful withdrawal.
pub(crate) fn withdraw_transition(
    owner_shares: i128,
    total_shares: i128,
    burned_shares: i128,
) -> Option<(i128, i128)> {
    Some((
        owner_shares.checked_sub(burned_shares)?,
        total_shares.checked_sub(burned_shares)?,
    ))
}

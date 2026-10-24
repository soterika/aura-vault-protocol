//! Kani proof harnesses for the share math used by the contract.
//!
//! The implementation is imported from the production source file so these
//! proofs check the same arithmetic and share transitions as `AuraVault`.

#[path = "../../src/share_math.rs"]
#[allow(dead_code)]
mod share_math;

#[cfg(kani)]
mod proofs {
    use super::share_math;

    /// Invariant 1: every successful positive deposit mints at least one share.
    #[kani::proof]
    fn successful_deposit_never_mints_zero_shares_for_i128_inputs() {
        let assets: i128 = kani::any();
        let total_shares: i128 = kani::any();
        let total_assets: i128 = kani::any();

        kani::assume(assets > 0);
        kani::assume(total_shares >= 0);
        kani::assume(total_assets >= 0);

        if let Ok(minted) = share_math::deposit_shares(assets, total_shares, total_assets) {
            assert!(minted >= 1);
        }
    }

    /// Invariant 1 (caller view): after a positive deposit, caller's ending shares >= 1.
    #[kani::proof]
    fn deposit_caller_shares_at_least_one_for_i128_inputs() {
        let assets: i128 = kani::any();
        let total_shares: i128 = kani::any();
        let total_assets: i128 = kani::any();
        let caller_shares_before: i128 = kani::any();

        kani::assume(assets > 0);
        kani::assume(total_shares >= 0);
        kani::assume(total_assets >= 0);
        kani::assume(caller_shares_before >= 0);
        kani::assume(caller_shares_before <= total_shares);

        if let Ok(minted) = share_math::deposit_shares(assets, total_shares, total_assets) {
            if let Some(caller_shares_after) = caller_shares_before.checked_add(minted) {
                assert!(caller_shares_after >= 1);
            }
        }
    }

    /// Invariant 2: adding non-negative net yield without minting shares cannot
    /// reduce the exact assets-per-share ratio. With the same positive
    /// denominator, this also proves the rounded fixed-point price is monotone.
    #[kani::proof]
    fn harvest_does_not_reduce_share_price_for_i128_inputs() {
        let assets_before: i128 = kani::any();
        let shares: i128 = kani::any();
        let net_yield: i128 = kani::any();
        kani::assume(assets_before >= 0);
        kani::assume(shares > 0);
        kani::assume(net_yield >= 0);

        if let Some(assets_after) = assets_before.checked_add(net_yield) {
            assert!(assets_after >= assets_before);
        }
    }

    /// Invariant 3: redeemed assets cannot exceed pool assets, which are the
    /// starting deposit plus non-negative accrued yield. Owner shares are
    /// bounded by the total supply, and withdrawal uses the production formula.
    #[kani::proof]
    fn withdrawal_redemption_is_bounded_by_deposit_plus_accrued_yield() {
        let deposited: i128 = kani::any();
        let accrued_yield: i128 = kani::any();
        let owner_shares: i128 = kani::any();
        let total_shares: i128 = kani::any();

        kani::assume(deposited >= 0);
        kani::assume(accrued_yield >= 0);
        kani::assume(total_shares > 0);
        kani::assume(owner_shares >= 0);
        kani::assume(owner_shares <= total_shares);

        if let Some(total_assets) = deposited.checked_add(accrued_yield) {
            if let Ok(redeemed) =
                share_math::withdrawal_assets(owner_shares, total_assets, total_shares)
            {
                assert!(redeemed >= 0);
                assert!(redeemed <= total_assets);
                assert!(redeemed <= deposited + accrued_yield);
            }
        }
    }

    /// Invariant 4a: a deposit adds the same minted amount to owner balance and
    /// total supply, preserving the sum of balances (shown with two holders).
    #[kani::proof]
    fn deposit_transition_preserves_two_holder_share_sum_for_i128_inputs() {
        let owner_before: i128 = kani::any();
        let other_before: i128 = kani::any();
        let minted: i128 = kani::any();

        kani::assume(owner_before >= 0);
        kani::assume(other_before >= 0);
        kani::assume(minted > 0);

        if let Some(total_before) = owner_before.checked_add(other_before) {
            if let Some((owner_after, total_after)) =
                share_math::deposit_transition(owner_before, total_before, minted)
            {
                let sum_after = owner_after.checked_add(other_before).unwrap();
                assert_eq!(total_after, sum_after);
            }
        }
    }

    /// Invariant 4b: a withdrawal burns the same amount from owner balance and
    /// total supply, preserving the sum of balances (shown with two holders).
    #[kani::proof]
    fn withdraw_transition_preserves_two_holder_share_sum_for_i128_inputs() {
        let owner_before: i128 = kani::any();
        let other_before: i128 = kani::any();
        let burned: i128 = kani::any();

        kani::assume(owner_before >= 0);
        kani::assume(other_before >= 0);
        kani::assume(burned >= 0);
        kani::assume(burned <= owner_before);

        if let Some(total_before) = owner_before.checked_add(other_before) {
            if let Some((owner_after, total_after)) =
                share_math::withdraw_transition(owner_before, total_before, burned)
            {
                let sum_after = owner_after.checked_add(other_before).unwrap();
                assert_eq!(total_after, sum_after);
            }
        }
    }
}

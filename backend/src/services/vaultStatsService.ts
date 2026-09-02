/**
 * Vault Stats Service — Issue #466
 *
 * Encapsulates the on-chain / data-layer read for vault statistics.
 * In production this would call the Soroban RPC; in tests it is mocked.
 */

export interface VaultStatsData {
  total_assets: number;
  total_shares: number;
  apy: number;             // 0–1, e.g. 0.085 = 8.5%
  last_harvest: string | null; // ISO-8601 or null if never harvested
}

/**
 * Fetch live vault stats from the on-chain contract (or data layer).
 * This function is the single seam that tests mock.
 */
export async function getVaultStats(): Promise<VaultStatsData> {
  // Production implementation would call Soroban RPC here.
  // For now, return a realistic placeholder so the route compiles.
  return {
    total_assets: 0,
    total_shares: 0,
    apy: 0,
    last_harvest: null,
  };
}

export interface SimulateDepositResult {
  expectedShares: number;
  sharePrice: number;
  priceImpact: number;
}

/**
 * Compute expected shares, share price, and price impact for a prospective
 * deposit of `amount` underlying tokens, given the current vault state.
 *
 * Formulas mirror the on-chain logic in aura-vault/src/lib.rs:
 *   - First depositor (total_shares === 0): shares = amount  (1:1 seed ratio)
 *   - Subsequent depositors: shares = floor(amount * total_shares / total_assets)
 *   - sharePrice = total_assets / total_shares  (or 1.0 when vault is empty)
 *   - priceImpact = (newSharePrice - currentSharePrice) / currentSharePrice
 *     where newSharePrice is computed after the simulated deposit
 */
export function simulateDeposit(
  amount: number,
  totalAssets: number,
  totalShares: number,
): SimulateDepositResult {
  // Share price before deposit: underlying token units per share.
  const sharePrice = totalShares > 0 ? totalAssets / totalShares : 1;

  // Expected shares minted, matching on-chain floor() arithmetic.
  let expectedShares: number;
  if (totalShares === 0) {
    // First depositor — 1:1 seed ratio
    expectedShares = amount;
  } else {
    expectedShares = Math.floor((amount * totalShares) / totalAssets);
  }

  // Price impact: relative change in share price after the deposit.
  //   newTotalAssets = totalAssets + amount
  //   newTotalShares = totalShares + expectedShares
  const newTotalAssets = totalAssets + amount;
  const newTotalShares = totalShares + expectedShares;
  const newSharePrice = newTotalShares > 0 ? newTotalAssets / newTotalShares : 1;
  const priceImpact = sharePrice > 0 ? (newSharePrice - sharePrice) / sharePrice : 0;

  return { expectedShares, sharePrice, priceImpact };
}

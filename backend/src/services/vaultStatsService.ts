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
  /** TVL cap in underlying token units. null when no cap is configured. */
  tvl_cap: number | null;
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
    tvl_cap: null,
  };
}

export interface UserVolumeResult {
  total_deposited: number;
  total_withdrawn: number;
  total_yield: number;
  net_position: number;
  /** True when the underlying event count exceeded the pagination threshold
   *  and only aggregated totals are returned (no per-event payload). */
  aggregated_only: boolean;
}

/** Maximum number of underlying events before we stop returning per-event data. */
export const VOLUME_EVENT_THRESHOLD = 10_000;

/**
 * Compute per-address lifetime transaction volume from the data layer.
 *
 * Aggregates from two tables:
 *   - `vault_positions`: sums `amount` for deposits and `yield_earned` for yield.
 *   - `contract_events`: sums `amount` for events of type 'withdraw'.
 *
 * `net_position = total_deposited + total_yield - total_withdrawn`.
 *
 * When the combined underlying event count exceeds VOLUME_EVENT_THRESHOLD,
 * only the aggregated totals are returned (`aggregated_only: true`).
 */
export async function getUserVolume(address: string): Promise<UserVolumeResult> {
  const { getReadPool } = await import('../db.js');
  const pool = getReadPool();

  // Count underlying events first so we can decide whether to paginate.
  const countResult = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM vault_positions WHERE address = $1) +
       (SELECT COUNT(*) FROM contract_events WHERE address = $1) AS total`,
    [address],
  );
  const eventCount = Number(countResult.rows[0]?.total ?? 0);
  const aggregatedOnly = eventCount > VOLUME_EVENT_THRESHOLD;

  // Aggregate deposit + yield totals from vault_positions.
  const positionsResult = await pool.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS total_deposited,
       COALESCE(SUM(yield_earned), 0) AS total_yield
     FROM vault_positions
     WHERE address = $1`,
    [address],
  );

  // Aggregate withdrawal totals from contract_events.
  const withdrawalsResult = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_withdrawn
     FROM contract_events
     WHERE address = $1 AND event_type = 'withdraw'`,
    [address],
  );

  const totalDeposited = Number(positionsResult.rows[0]?.total_deposited ?? 0);
  const totalYield = Number(positionsResult.rows[0]?.total_yield ?? 0);
  const totalWithdrawn = Number(withdrawalsResult.rows[0]?.total_withdrawn ?? 0);

  return {
    total_deposited: totalDeposited,
    total_withdrawn: totalWithdrawn,
    total_yield: totalYield,
    net_position: totalDeposited + totalYield - totalWithdrawn,
    aggregated_only: aggregatedOnly,
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

/**
 * vaultUtils.ts — Client-side vault utility functions
 *
 * All arithmetic mirrors the on-chain Rust integer semantics:
 *   - Deposit:  floor(amount × totalShares / totalAssets)  [or 1:1 on first deposit]
 *   - Withdraw: floor(shares × totalAssets / totalShares)
 *
 * BigInt is used throughout to stay consistent with Soroban's i128 arithmetic
 * and avoid floating-point rounding divergence.
 *
 * @module vaultUtils
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of decimal places used by all vault token amounts (Stellar stroops). */
export const TOKEN_DECIMALS = 7;

/** Divisor to convert from stroops to display units (10^7). */
export const TOKEN_SCALE = 10n ** BigInt(TOKEN_DECIMALS);

// ---------------------------------------------------------------------------
// Share calculation — mirrors on-chain Rust i128 integer arithmetic
// ---------------------------------------------------------------------------

/**
 * Calculate the number of vault shares minted for a deposit.
 *
 * Matches the Soroban contract formula exactly:
 *   - If vault is empty (totalShares === 0 || totalAssets === 0): shares = amount (1:1 seed)
 *   - Otherwise: shares = floor(amount × totalShares / totalAssets)
 *
 * @param amount       - Deposit amount in stroops (bigint, must be > 0)
 * @param totalShares  - Current total vault shares (bigint)
 * @param totalAssets  - Current total vault assets in stroops (bigint)
 * @returns Number of shares to mint (bigint, floored)
 * @throws {RangeError} if any argument is negative
 */
export function calcDepositShares(
  amount: bigint,
  totalShares: bigint,
  totalAssets: bigint
): bigint {
  if (amount <= 0n) throw new RangeError("amount must be > 0");
  if (totalShares < 0n) throw new RangeError("totalShares must be >= 0");
  if (totalAssets < 0n) throw new RangeError("totalAssets must be >= 0");

  if (totalShares === 0n || totalAssets === 0n) {
    // First deposit: 1:1 seed ratio
    return amount;
  }

  // floor(amount × totalShares / totalAssets)
  return (amount * totalShares) / totalAssets;
}

/**
 * Calculate the number of underlying tokens redeemed for burning vault shares.
 *
 * Matches the Soroban contract formula exactly:
 *   redeemAmount = floor(shares × totalAssets / totalShares)
 *
 * @param shares       - Number of shares to burn (bigint, must be > 0)
 * @param totalShares  - Current total vault shares (bigint, must be > 0)
 * @param totalAssets  - Current total vault assets in stroops (bigint)
 * @returns Number of underlying tokens redeemed (bigint, floored)
 * @throws {RangeError} if shares or totalShares are <= 0 or arguments are negative
 */
export function calcWithdrawAmount(
  shares: bigint,
  totalShares: bigint,
  totalAssets: bigint
): bigint {
  if (shares <= 0n) throw new RangeError("shares must be > 0");
  if (totalShares <= 0n) throw new RangeError("totalShares must be > 0");
  if (totalAssets < 0n) throw new RangeError("totalAssets must be >= 0");
  if (shares > totalShares) throw new RangeError("shares must not exceed totalShares");

  // floor(shares × totalAssets / totalShares)
  return (shares * totalAssets) / totalShares;
}

/**
 * Calculate the current share price (in token units, 7 decimals).
 *
 * Share price = totalAssets / totalShares.
 * Returns 1.0 (as TOKEN_SCALE) if the vault is empty.
 *
 * @param totalShares - Current total vault shares
 * @param totalAssets - Current total vault assets in stroops
 * @returns Share price scaled by TOKEN_SCALE (i.e. 1.5 = 15_000_000n)
 */
export function calcSharePrice(totalShares: bigint, totalAssets: bigint): bigint {
  if (totalShares <= 0n) return TOKEN_SCALE; // 1:1 seed price
  return (totalAssets * TOKEN_SCALE) / totalShares;
}

// ---------------------------------------------------------------------------
// APY calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the annualised percentage yield (APY) from vault state snapshots.
 *
 * Uses the compound APY formula:
 *   APY = ((endPrice / startPrice) ^ (365 / days) - 1) × 100
 *
 * @param startSharePrice - Share price at start of observation window (float)
 * @param endSharePrice   - Share price at end of observation window (float)
 * @param observationDays - Number of days in the observation window (must be > 0)
 * @returns APY as a percentage (e.g. 12.5 = 12.5%)
 * @throws {RangeError} if inputs are invalid
 */
export function calcAPY(
  startSharePrice: number,
  endSharePrice: number,
  observationDays: number
): number {
  if (startSharePrice <= 0) throw new RangeError("startSharePrice must be > 0");
  if (endSharePrice <= 0) throw new RangeError("endSharePrice must be > 0");
  if (observationDays <= 0) throw new RangeError("observationDays must be > 0");

  const ratio = endSharePrice / startSharePrice;
  const annualisedRatio = Math.pow(ratio, 365 / observationDays);
  return (annualisedRatio - 1) * 100;
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Format a bigint stroop value to a human-readable token string with
 * exactly 7 decimal places.
 *
 * Examples:
 *   formatTokenAmount(1_000_000n)    → "0.1000000"
 *   formatTokenAmount(10_000_000n)   → "1.0000000"
 *   formatTokenAmount(12_345_678n)   → "1.2345678"
 *   formatTokenAmount(0n)            → "0.0000000"
 *
 * @param stroops - Amount in stroops (bigint)
 * @returns Formatted string with exactly TOKEN_DECIMALS (7) decimal places
 * @throws {RangeError} if stroops is negative
 */
export function formatTokenAmount(stroops: bigint): string {
  if (stroops < 0n) throw new RangeError("stroops must be >= 0");

  const isNegative = stroops < 0n; // kept for symmetry if future signed support
  const absStroops = isNegative ? -stroops : stroops;

  const whole = absStroops / TOKEN_SCALE;
  const frac = absStroops % TOKEN_SCALE;
  const fracStr = frac.toString().padStart(TOKEN_DECIMALS, "0");

  return `${isNegative ? "-" : ""}${whole}.${fracStr}`;
}

/**
 * Format a token amount using locale-aware number formatting.
 *
 * Produces a string with thousands separators and exactly 7 decimal places.
 *
 * @param stroops - Amount in stroops (bigint)
 * @param locale  - BCP 47 locale tag (default: "en-US")
 * @returns Locale-formatted string, e.g. "1,234,567.1234567"
 */
export function formatTokenAmountLocale(stroops: bigint, locale = "en-US"): string {
  if (stroops < 0n) throw new RangeError("stroops must be >= 0");

  // Convert to float with 7dp for Intl formatting
  const floatValue = Number(stroops) / Number(TOKEN_SCALE);
  return floatValue.toLocaleString(locale, {
    minimumFractionDigits: TOKEN_DECIMALS,
    maximumFractionDigits: TOKEN_DECIMALS,
  });
}

/**
 * Format an APY value as a percentage string with 2 decimal places.
 *
 * @param apy - APY as a percentage number (e.g. 12.5)
 * @returns Formatted string e.g. "12.50%"
 */
export function formatAPY(apy: number): string {
  return `${apy.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Address utilities
// ---------------------------------------------------------------------------

/**
 * Truncate a Stellar address (or any long string) to `first4...last4` format.
 *
 * For a Stellar G-address (56 chars):
 *   "GABC...XYZ4"
 *
 * @param address     - Full address string
 * @param prefixLen   - Characters to keep at the start (default: 4)
 * @param suffixLen   - Characters to keep at the end (default: 4)
 * @returns Truncated string, or the full address if it fits within prefix+suffix+3 chars
 */
export function truncateAddress(
  address: string,
  prefixLen = 4,
  suffixLen = 4
): string {
  if (!address) return "";
  const minLengthToTruncate = prefixLen + suffixLen + 3; // "..." is 3 chars
  if (address.length <= minLengthToTruncate) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// ---------------------------------------------------------------------------
// Preview helpers (for UI display before transaction submission)
// ---------------------------------------------------------------------------

/**
 * Preview: how many shares will I receive for a given deposit amount?
 * Returns null if the deposit would result in 0 shares (too small).
 *
 * @param amountStroops - Proposed deposit amount in stroops
 * @param totalShares   - Current total vault shares
 * @param totalAssets   - Current total vault assets in stroops
 */
export function previewDeposit(
  amountStroops: bigint,
  totalShares: bigint,
  totalAssets: bigint
): bigint | null {
  if (amountStroops <= 0n) return null;
  const shares = calcDepositShares(amountStroops, totalShares, totalAssets);
  return shares > 0n ? shares : null;
}

/**
 * Preview: how many tokens will I receive for burning a given number of shares?
 * Returns null if totalShares is 0 (vault is empty).
 *
 * @param sharesToBurn - Proposed shares to burn
 * @param totalShares  - Current total vault shares
 * @param totalAssets  - Current total vault assets in stroops
 */
export function previewWithdraw(
  sharesToBurn: bigint,
  totalShares: bigint,
  totalAssets: bigint
): bigint | null {
  if (sharesToBurn <= 0n) return null;
  if (totalShares <= 0n) return null;
  return calcWithdrawAmount(sharesToBurn, totalShares, totalAssets);
}

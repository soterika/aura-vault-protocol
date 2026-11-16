/** Return the estimated underlying-token yield accrued by a position each second. */
export function estimateYieldPerSecond(
  underlyingBalance: string,
  apy: number | null | undefined,
): number {
  const positionValue = Number(underlyingBalance.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(positionValue) || positionValue <= 0) return 0;
  if (typeof apy !== "number" || !Number.isFinite(apy) || apy < 0) return 0;
  return positionValue * apy / (365.25 * 24 * 60 * 60);
}

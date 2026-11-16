"use client";

/**
 * RedemptionPreview — Issue #884
 *
 * Live share redemption preview that shows how many underlying tokens a user
 * will receive before confirming a withdrawal.
 *
 * Acceptance criteria:
 *   ✅ Display estimated token output as user types share amount
 *   ✅ Update preview using total_assets / total_shares fetched from
 *      /api/v1/vault/stats with a 15-second SWR refresh interval
 *   ✅ Show exchange rate (1 share = X tokens) below the input
 *   ✅ Warn if share price changed >1% since page load
 *   ✅ Handle total_shares = 0 edge case gracefully
 *   ✅ 300 ms debounce prevents excessive re-renders
 *   ✅ Floor division mirrors on-chain arithmetic
 */

import { useState, useEffect, useRef } from "react";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { useVaultStats } from "@/lib/useVaultStats";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RedemptionPreviewProps {
  /** Raw share amount string from the input field. */
  sharesInput: string;
  /** Symbol of the share token (default "aUSDC"). */
  shareSymbol?: string;
  /** Symbol of the underlying token (default "USDC"). */
  tokenSymbol?: string;
  /** Additional CSS classes for the wrapper element. */
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute floor(shares × totalAssets / totalShares) — mirrors on-chain math.
 * Returns null when inputs are invalid or totalShares is 0.
 */
function computeRedemption(
  sharesStr: string,
  totalAssets: string,
  totalShares: string
): bigint | null {
  try {
    const sharesFloat = parseFloat(sharesStr);
    if (isNaN(sharesFloat) || sharesFloat <= 0) return null;
    const shares = BigInt(Math.floor(sharesFloat));
    const assets = BigInt(totalAssets);
    const supply = BigInt(totalShares);
    if (supply === 0n || shares === 0n) return null;
    return (shares * assets) / supply;
  } catch {
    return null;
  }
}

/** Format a raw bigint stroops value with 2 decimal places. */
function formatTokens(raw: bigint): string {
  const whole = raw / 10_000_000n;
  const frac = (raw % 10_000_000n).toString().padStart(7, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function RedemptionPreview({
  sharesInput,
  shareSymbol = "aUSDC",
  tokenSymbol = "USDC",
  className = "",
}: RedemptionPreviewProps) {
  const { totalAssets, totalShares, sharePrice, isLoading } = useVaultStats();

  // Capture the share price observed on first load for drift detection
  const initialSharePrice = useRef<string | null>(null);
  useEffect(() => {
    if (sharePrice !== "1.0000" && initialSharePrice.current === null) {
      initialSharePrice.current = sharePrice;
    }
  }, [sharePrice]);

  // Debounce the input by 300 ms to avoid excessive re-renders (#884)
  const [debouncedShares, setDebouncedShares] = useState(sharesInput);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedShares(sharesInput), 300);
    return () => clearTimeout(timer);
  }, [sharesInput]);

  const shareAmount = parseFloat(debouncedShares);
  const hasValidInput = !isNaN(shareAmount) && shareAmount > 0;

  // Compute estimated redemption value
  const rawRedemption = hasValidInput
    ? computeRedemption(debouncedShares, totalAssets, totalShares)
    : null;
  const estimatedOutput = rawRedemption !== null ? formatTokens(rawRedemption) : null;

  // Detect >1% share price drift since page load
  const priceDriftWarning = (() => {
    if (initialSharePrice.current === null) return false;
    const initial = parseFloat(initialSharePrice.current);
    const current = parseFloat(sharePrice);
    if (isNaN(initial) || isNaN(current) || initial === 0) return false;
    return Math.abs((current - initial) / initial) > 0.01;
  })();

  // Edge case: vault has no shares outstanding
  const isEmptyVault = totalShares === "0";

  // Loading skeleton (only on first load, not background refresh)
  if (isLoading && !estimatedOutput && !hasValidInput) {
    return (
      <div
        className={`rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 animate-pulse ${className}`}
        aria-busy="true"
        aria-label="Loading redemption preview"
      >
        <div className="h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-700 mb-2" />
        <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
    );
  }

  if (isEmptyVault) {
    return (
      <div
        className={`rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400 ${className}`}
        role="status"
        data-cy="redemption-preview-empty-vault"
      >
        The vault has no shares outstanding. Redemption preview is unavailable.
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 px-4 py-3 text-sm ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-cy="redemption-preview"
    >
      {/* Estimated output */}
      {hasValidInput && estimatedOutput !== null ? (
        <p className="text-zinc-700 dark:text-zinc-300">
          You will receive approximately{" "}
          <span
            className="font-mono font-semibold text-orange-700 dark:text-orange-300"
            data-cy="redemption-output"
          >
            {estimatedOutput} {tokenSymbol}
          </span>
        </p>
      ) : hasValidInput ? (
        <p className="text-zinc-500 dark:text-zinc-400">Calculating…</p>
      ) : (
        <p className="text-zinc-500 dark:text-zinc-400">
          Enter a share amount to see the estimated output.
        </p>
      )}

      {/* Exchange rate (#884) */}
      <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <TrendingUp size={12} aria-hidden="true" />
        <span data-cy="exchange-rate">
          1 {shareSymbol} = {sharePrice} {tokenSymbol}
        </span>
        {isLoading && (
          <span className="ml-1 text-zinc-400">(updating…)</span>
        )}
      </div>

      {/* >1% price drift warning (#884) */}
      {priceDriftWarning && (
        <div
          className="flex items-start gap-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300"
          role="alert"
          data-cy="price-drift-warning"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            The share price has changed by more than 1% since you opened this
            page. The final redemption amount may differ slightly from this
            estimate.
          </span>
        </div>
      )}

      {/* Formula hint */}
      {hasValidInput && (
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
          Formula: floor({debouncedShares} × totalAssets / totalShares)
        </p>
      )}
    </div>
  );
}

export default RedemptionPreview;

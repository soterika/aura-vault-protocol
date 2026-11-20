"use client";

import { useState } from "react";
import { AccessibleModal } from "./AccessibleFormComponents";

export const SKIP_CONFIRMATION_STORAGE_KEY = "aura_skip_share_math_confirmation";

export function shouldSkipShareMathConfirmation(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SKIP_CONFIRMATION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSkipShareMathConfirmation(skip: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (skip) {
      window.localStorage.setItem(SKIP_CONFIRMATION_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(SKIP_CONFIRMATION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
}

/**
 * On-chain share math:
 * - Deposit: shares = floor(amount * totalShares / totalAssets) (1:1 if pool is empty)
 * - Withdraw: assets = floor(shares * totalAssets / totalShares)
 */
export function calculateDepositShares(
  amount: number,
  totalShares: number,
  totalAssets: number
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (totalShares <= 0 || totalAssets <= 0) {
    return Math.floor(amount);
  }
  return Math.floor((amount * totalShares) / totalAssets);
}

export function calculateWithdrawAssets(
  shares: number,
  totalAssets: number,
  totalShares: number
): number {
  if (!Number.isFinite(shares) || shares <= 0 || totalShares <= 0) return 0;
  return Math.floor((shares * totalAssets) / totalShares);
}

export function calculateSharePrice(totalAssets: number, totalShares: number): number {
  if (!Number.isFinite(totalAssets) || !Number.isFinite(totalShares) || totalShares <= 0) {
    return 1;
  }
  return totalAssets / totalShares;
}

export function calculateEstimatedYield(
  principalUsdc: number,
  apyPercent: number,
  days: number
): number {
  if (!Number.isFinite(principalUsdc) || principalUsdc <= 0) return 0;
  if (!Number.isFinite(apyPercent) || apyPercent <= 0) return 0;
  return principalUsdc * (apyPercent / 100) * (days / 365);
}

export interface ShareMathConfirmationModalProps {
  isOpen: boolean;
  mode: "deposit" | "withdraw";
  /** Deposit amount in USDC, or withdrawal amount in shares */
  amount: string;
  totalShares: string;
  totalAssets: string;
  /** Current vault APY percentage (e.g. 8.5 for 8.5%) */
  apyPercent?: number;
  assetSymbol?: string;
  shareSymbol?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ShareMathConfirmationModal({
  isOpen,
  mode,
  amount,
  totalShares,
  totalAssets,
  apyPercent = 8.5,
  assetSymbol = "USDC",
  shareSymbol = "shares",
  onConfirm,
  onCancel,
}: ShareMathConfirmationModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const numericTotalShares = parseFloat(totalShares) || 0;
  const numericTotalAssets = parseFloat(totalAssets) || 0;

  const sharePrice = calculateSharePrice(numericTotalAssets, numericTotalShares);
  const calculatedShares =
    mode === "deposit"
      ? calculateDepositShares(numericAmount, numericTotalShares, numericTotalAssets)
      : numericAmount;
  const calculatedAssets =
    mode === "withdraw"
      ? calculateWithdrawAssets(numericAmount, numericTotalAssets, numericTotalShares)
      : numericAmount;

  const yield7d = calculateEstimatedYield(calculatedAssets, apyPercent, 7);
  const yield30d = calculateEstimatedYield(calculatedAssets, apyPercent, 30);
  const yield1y = calculateEstimatedYield(calculatedAssets, apyPercent, 365);

  const handleConfirm = () => {
    if (dontShowAgain) {
      setSkipShareMathConfirmation(true);
    }
    onConfirm();
  };

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onCancel}
      title={mode === "deposit" ? "Confirm Deposit" : "Confirm Withdrawal"}
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        {/* Primary summary */}
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/70 p-4 border border-zinc-200 dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {mode === "deposit" ? (
              <>
                You will deposit{" "}
                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                  {numericAmount.toLocaleString()} {assetSymbol}
                </span>{" "}
                and receive{" "}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {calculatedShares.toLocaleString()} {shareSymbol}
                </span>
              </>
            ) : (
              <>
                You will redeem{" "}
                <span className="font-bold text-orange-600 dark:text-orange-400">
                  {numericAmount.toLocaleString()} {shareSymbol}
                </span>{" "}
                and receive{" "}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {calculatedAssets.toLocaleString()} {assetSymbol}
                </span>
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            1 share = {sharePrice.toFixed(6)} {assetSymbol}
          </p>
        </div>

        {/* Estimated Yield */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Estimated Yield ({apyPercent.toFixed(2)}% APY)</span>
            <span>{mode === "withdraw" ? "Forfeited" : "Projected"}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 text-center">
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">7d</div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {yield7d.toFixed(4)} {assetSymbol}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">30d</div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {yield30d.toFixed(4)} {assetSymbol}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">1y</div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {yield1y.toFixed(4)} {assetSymbol}
              </div>
            </div>
          </div>
        </div>

        {/* Don't show again */}
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>Don&apos;t show again</span>
        </label>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Confirm &amp; Sign
          </button>
        </div>
      </div>
    </AccessibleModal>
  );
}

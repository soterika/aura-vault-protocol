"use client";

/**
 * WithdrawModal (#238)
 *
 * Multi-step withdraw modal — mirrors DepositModal pattern for withdrawals.
 *   Step 1 — Share input with max-shares button and real-time token preview
 *   Step 2 — Review: confirm details + estimated gas fee
 *   Step 3 — Success / failure result
 *
 * Acceptance criteria:
 *   ✅ Share input field with max-shares button
 *   ✅ Preview formula: tokens = floor(shares × totalAssets / totalShares)
 *   ✅ Validate shares do not exceed user's balance
 *   ✅ Multi-step flow identical to deposit modal pattern
 *   ✅ Error state for InsufficientShares and VaultPaused
 *   ✅ Post-success, onSuccess callback triggers portfolio data refresh
 *   ✅ Re-uses AccessibleModal base component
 */

import { useState, useEffect, useCallback } from "react";
import {
  AccessibleModal,
  ShareInput,
  FormField,
} from "./AccessibleFormComponents";
import { UsdAmountConverter } from "./UsdAmountConverter";
import TransactionProgress from "./TransactionProgress";
import StellarBaseFee from "./StellarBaseFee";

// ─── Types ────────────────────────────────────────────────────────────────────

type WithdrawStep = 1 | 2 | 3;
type TxStatus = "idle" | "pending" | "success" | "error";
type SlippagePreset = "0.1" | "0.5" | "1" | "custom";

export interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** User's current share balance */
  shareBalance: string;
  /** Current total assets in the vault */
  totalAssets?: string;
  /** Current total shares in the vault */
  totalShares?: string;
  /** Share symbol (default "aUSDC") */
  shareSymbol?: string;
  /** Called on successful withdrawal — use to refresh portfolio data */
  onSuccess?: () => void;
}

interface GasEstimate {
  baseFee: string;
  priorityFee: string;
  totalGas: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * tokens = floor(shares × totalAssets / totalShares)
 */
function previewTokens(shares: string, totalAssets: string, totalShares: string): string {
  const s = parseFloat(shares);
  const ta = parseFloat(totalAssets);
  const ts = parseFloat(totalShares);
  if (isNaN(s) || s <= 0 || ts === 0) return "0";
  return Math.floor((s * ta) / ts).toFixed(4);
}

async function fetchLiveSharePrice(): Promise<number> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
  const response = await fetch(`${apiBase}/api/v1/vault/stats`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not refresh the vault exchange rate. Please try again.");
  const payload = await response.json() as {
    data?: { sharePrice?: string | number };
    sharePrice?: string | number;
  };
  const price = Number(payload.data?.sharePrice ?? payload.sharePrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("The vault returned an invalid exchange rate. Please try again.");
  }
  return price;
}

function tokensAtPrice(shares: string, price: number): string {
  const amount = Number(shares);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return (Math.floor(amount * price * 10_000) / 10_000).toFixed(4);
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── StepIndicator ────────────────────────────────────────────────────────────

const STEP_LABELS: Record<WithdrawStep, string> = {
  1: "Shares",
  2: "Fees",
  3: "Result",
};

function StepIndicator({ step }: { step: WithdrawStep }) {
  return (
    <ol aria-label="Withdrawal steps" className="flex items-center gap-0 mb-6">
      {([1, 2, 3] as WithdrawStep[]).map((s, i) => {
        const isCompleted = s < step;
        const isCurrent = s === step;
        return (
          <li
            key={s}
            className="flex items-center flex-1 last:flex-none"
            aria-current={isCurrent ? "step" : undefined}
          >
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300",
                  isCompleted
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : isCurrent
                    ? "border-orange-500 bg-orange-500 text-white ring-4 ring-orange-500/20"
                    : "border-zinc-300 bg-white text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900",
                ].join(" ")}
                aria-hidden="true"
              >
                {isCompleted ? "✓" : s}
              </div>
              <span
                className={[
                  "text-[10px] font-medium",
                  isCurrent ? "text-orange-600 dark:text-orange-400" : "text-zinc-400",
                ].join(" ")}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
            {i < 2 && (
              <div
                aria-hidden="true"
                className="flex-1 mx-1 h-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden -mt-4"
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isCompleted ? "bg-emerald-500 w-full" : "w-0"
                  }`}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── GasEstimateRow ───────────────────────────────────────────────────────────

function GasEstimateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">{value} XLM</span>
    </div>
  );
}

// ─── Error message map for vault-specific errors ──────────────────────────────

const VAULT_ERROR_MESSAGES: Record<string, string> = {
  InsufficientShares: "You do not have enough shares to complete this withdrawal.",
  VaultPaused: "The vault is currently paused. Withdrawals are temporarily disabled.",
  ZeroAmount: "Please enter a valid share amount greater than 0.",
  MathOverflow: "An arithmetic error occurred. Please try a smaller amount.",
};

function resolveVaultError(raw: string): string {
  for (const [key, msg] of Object.entries(VAULT_ERROR_MESSAGES)) {
    if (raw.includes(key)) return msg;
  }
  return raw;
}

// ─── WithdrawModal ────────────────────────────────────────────────────────────

export function WithdrawModal({
  isOpen,
  onClose,
  shareBalance,
  totalAssets = "0",
  totalShares = "0",
  shareSymbol = "aUSDC",
  onSuccess,
}: WithdrawModalProps) {
  const [step, setStep] = useState<WithdrawStep>(1);
  const [shares, setShares] = useState("");
  const [sharesError, setSharesError] = useState("");
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState("");
  const [progressStep, setProgressStep] = useState(2);
  const [closeWarning, setCloseWarning] = useState(false);

  const requestClose = useCallback(() => {
    if (txStatus === "pending") {
      setCloseWarning(true);
      return;
    }
    onClose();
  }, [onClose, txStatus]);
  const [txError, setTxError] = useState("");
  const [slippagePreset, setSlippagePreset] = useState<SlippagePreset>("0.5");
  const [customSlippage, setCustomSlippage] = useState("0.5");
  const [reviewEstimate, setReviewEstimate] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const slippagePercent = slippagePreset === "custom" ? Number(customSlippage) : Number(slippagePreset);

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep(1);
        setShares("");
        setSharesError("");
        setGasEstimate(null);
        setTxStatus("idle");
        setTxHash("");
        setTxError("");
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aura-withdraw-slippage");
      if (!saved) return;
      const parsed = JSON.parse(saved) as { preset?: SlippagePreset; custom?: string };
      if (["0.1", "0.5", "1", "custom"].includes(parsed.preset ?? "")) {
        setSlippagePreset(parsed.preset!);
      }
      if (parsed.custom && Number(parsed.custom) > 0 && Number(parsed.custom) <= 5) {
        setCustomSlippage(parsed.custom);
      }
    } catch {
      // Ignore unavailable or invalid local preferences.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("aura-withdraw-slippage", JSON.stringify({ preset: slippagePreset, custom: customSlippage }));
    } catch {
      // The setting remains active for this session when storage is unavailable.
    }
  }, [slippagePreset, customSlippage]);

  const estimatedTokens = previewTokens(shares, totalAssets, totalShares);

  function validate(): boolean {
    if (!Number.isFinite(slippagePercent) || slippagePercent <= 0 || slippagePercent > 5) {
      setSharesError("Slippage tolerance must be greater than 0 and no more than 5%.");
      return false;
    }
    const n = parseFloat(shares);
    if (!shares || isNaN(n) || n <= 0) {
      setSharesError("Enter a share amount greater than 0.");
      return false;
    }
    if (n > parseFloat(shareBalance)) {
      setSharesError(
        `Amount exceeds your share balance of ${shareBalance} ${shareSymbol}.`
      );
      return false;
    }
    setSharesError("");
    return true;
  }

  const fetchGasEstimate = useCallback(async (amt: string) => {
    setGasLoading(true);
    try {
      const res = await fetch("/api/vault/estimate-gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "withdraw", amount: amt }),
      });
      if (res.ok) {
        const data = await res.json() as { baseFee?: string; priorityFee?: string; totalGas?: string };
        setGasEstimate({
          baseFee: data.baseFee ?? "0.0001",
          priorityFee: data.priorityFee ?? "0.00005",
          totalGas: data.totalGas ?? "0.00015",
        });
      } else {
        setGasEstimate({ baseFee: "0.0001", priorityFee: "0.00005", totalGas: "0.00015" });
      }
    } catch {
      setGasEstimate({ baseFee: "0.0001", priorityFee: "0.00005", totalGas: "0.00015" });
    } finally {
      setGasLoading(false);
    }
  }, []);

  async function handleNext() {
    if (step === 1) {
      if (!validate()) return;
      await fetchGasEstimate(shares);
      try {
        const livePrice = await fetchLiveSharePrice();
        setReviewEstimate(tokensAtPrice(shares, livePrice));
        setQuoteError("");
      } catch (err) {
        setQuoteError(err instanceof Error ? err.message : "Could not refresh the vault exchange rate.");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      await handleSubmit();
    }
  }

  async function handleSubmit() {
    try {
      const livePrice = await fetchLiveSharePrice();
      const latestEstimate = Number(tokensAtPrice(shares, livePrice));
      const reviewed = Number(reviewEstimate || estimatedTokens);
      const changePct = reviewed > 0 ? Math.abs(latestEstimate - reviewed) / reviewed * 100 : 100;
      if (changePct > slippagePercent) {
        setQuoteError(`The exchange rate changed by ${changePct.toFixed(2)}%, above your ${slippagePercent}% tolerance. Refresh the quote before signing.`);
        setReviewEstimate(tokensAtPrice(shares, livePrice));
        setStep(2);
        return;
      }
      setQuoteError("");
      setTxStatus("pending");
      setProgressStep(2);
      setCloseWarning(false);
      setTxError("");
      setStep(3);
      const res = await fetch("/api/vault/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares }),
      });
      const data = await res.json() as { hash?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Withdrawal failed");
      setProgressStep(3);
      setTxHash(data.hash ?? `tx-${Date.now()}`);
      setProgressStep(4);
      setTxStatus("success");
      onSuccess?.();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Withdrawal failed";
      if (step === 2 && txStatus === "idle") {
        setQuoteError(raw);
        return;
      }
      setTxError(resolveVaultError(raw));
      setTxStatus("error");
      setStep(3);
    }
  }

  const titleMap: Record<WithdrawStep, string> = {
    1: "Withdraw",
    2: "Fee Breakdown",
    3:
      txStatus === "success"
        ? "Withdrawal Successful"
        : txStatus === "error"
        ? "Withdrawal Failed"
        : "Processing…",
  };

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={requestClose}
      title={titleMap[step]}
      description={
        step === 1
          ? `Enter the number of ${shareSymbol} shares you want to redeem for underlying USDC.`
          : undefined
      }
    >
      {/* Accessible live region — announces step transitions */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {step === 1 && "Step 1 of 3: Enter shares to withdraw."}
        {step === 2 && "Step 2 of 3: Review your withdrawal details."}
        {step === 3 && txStatus === "pending" && "Processing your withdrawal…"}
        {step === 3 && txStatus === "success" && "Withdrawal successful!"}
        {step === 3 && txStatus === "error" && `Withdrawal failed: ${txError}`}
      </div>

      <StepIndicator step={step} />

      {/* ── Step 1: Share Input ──────────────────────────────────────────── */}
      {step === 1 && (
        <div className="flex flex-col gap-5">
          {quoteError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{quoteError}</p>}
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Your share balance: </span>
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
              {shareBalance} {shareSymbol}
            </span>
          </div>

          <FormField
            label={`Shares (${shareSymbol})`}
            error={sharesError}
            required
            hint="Enter the number of shares to burn and redeem."
          >
            {({ inputId, errorId, hintId }) => (
              <ShareInput
                id={inputId}
                value={shares}
                onChange={(v) => {
                  setShares(v);
                  setSharesError("");
                }}
                maxShares={shareBalance}
                shareSymbol={shareSymbol}
                hasError={!!sharesError}
                errorId={sharesError ? errorId : undefined}
                hintId={hintId}
                autoFocus
                data-cy="withdraw-shares-input"
              />
            )}
          </FormField>

          <button type="button" onClick={() => { setShares(shareBalance); setSharesError(""); }} className="-mt-3 self-end rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950" aria-label={`Use maximum available share balance ${shareBalance}`}>
            Max
          </button>

          <details className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Advanced settings</summary>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label htmlFor="withdraw-slippage" className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                Slippage tolerance
                <select id="withdraw-slippage" value={slippagePreset} onChange={(event) => setSlippagePreset(event.target.value as SlippagePreset)} className="h-9 rounded-lg border border-zinc-200 px-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  <option value="0.1">0.1%</option><option value="0.5">0.5% (default)</option><option value="1">1%</option><option value="custom">Custom</option>
                </select>
              </label>
              {slippagePreset === "custom" && <label htmlFor="withdraw-custom-slippage" className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">Custom tolerance (%)
                <input id="withdraw-custom-slippage" type="number" min="0.01" max="5" step="0.01" value={customSlippage} onChange={(event) => setCustomSlippage(event.target.value)} className="h-9 w-28 rounded-lg border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              </label>}
              {slippagePreset === "custom" && (slippagePercent <= 0 || slippagePercent > 5) && <p role="alert" className="text-xs text-red-600">Enter a value greater than 0 and no more than 5%.</p>}
            </div>
          </details>

          {/* Quick-select percentage buttons */}
          <div className="flex gap-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  const v = ((parseFloat(shareBalance) * pct) / 100).toFixed(2);
                  setShares(v);
                  setSharesError("");
                }}
                aria-label={`Set shares to ${pct}% of balance`}
                className="flex-1 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Real-time redemption preview (#884) */}
          <RedemptionPreview
            sharesInput={shares}
            shareSymbol={shareSymbol}
          />

          <UsdAmountConverter tokenAmount={estimatedTokens} shareAmount={shares} />

          <button
            type="button"
            onClick={() => void handleNext()}
            data-cy="withdraw-next-btn"
            className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          >
            Review Withdrawal
          </button>
        </div>
      )}

      {/* ── Step 2: Fee Breakdown (#885) ────────────────────────────────── */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          {quoteError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{quoteError}</p>}
          <div className="rounded-lg bg-zinc-50 px-4 py-3 text-sm dark:bg-zinc-800">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">Rate protection</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">The withdrawal will stop if the estimated output changes by more than {slippagePercent}% before submission.</p>
          </div>
          {/* Summary table */}
          <dl className="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
            {[
              { label: "Shares to burn", value: `${shares} ${shareSymbol}` },
              { label: "Estimated USDC", value: `${reviewEstimate || estimatedTokens} USDC` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between px-4 py-3 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
                <dd className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">{value}</dd>
              </div>
            ))}
          </dl>

          {/* Gas estimate */}
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 px-4 py-3 space-y-2">
            <StellarBaseFee />
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
              Estimated Gas Fee
            </p>
            {gasLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Spinner />
                Fetching estimate…
              </div>
            ) : gasEstimate ? (
              <>
                <GasEstimateRow label="Base fee" value={gasEstimate.baseFee} />
                <GasEstimateRow label="Priority fee" value={gasEstimate.priorityFee} />
                <div className="border-t border-zinc-200 dark:border-zinc-700 pt-2 mt-1">
                  <GasEstimateRow label="Total" value={gasEstimate.totalGas} />
                </div>
              </>
            ) : null}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 font-semibold py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleNext()}
              disabled={gasLoading}
              data-cy="withdraw-confirm-btn"
              className="flex-1 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            >
              Confirm & Sign
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Result ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="flex flex-col items-center gap-5 py-4 text-center" data-cy="withdraw-result">
          <div className="w-full text-left">
            <TransactionProgress status={txStatus === "idle" ? "pending" : txStatus} currentStep={progressStep} onRetry={() => void handleSubmit()} />
            {closeWarning && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Your transaction is still processing. Keep this window open until it finishes.</p>}
          </div>
          {txStatus === "pending" && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 dark:bg-orange-950">
                <Spinner />
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">Processing…</p>
                <p className="text-sm text-zinc-500 mt-1">Broadcasting withdrawal to Stellar network</p>
              </div>
              <button
                disabled
                className="w-full rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-400 font-semibold py-2.5 cursor-not-allowed"
              >
                Waiting for confirmation…
              </button>
            </>
          )}

          {txStatus === "success" && (
            <>
              <div
                aria-hidden="true"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">Withdrawal successful!</p>
                <p className="text-sm text-zinc-500 mt-1">
                  Your USDC has been sent to your wallet. Share balance has been updated.
                </p>
                {txHash && (
                  <p className="text-xs text-zinc-400 mt-1 font-mono" data-cy="withdraw-tx-hash">
                    Tx: {txHash.slice(0, 16)}…
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
              >
                Done
              </button>
            </>
          )}

          {txStatus === "error" && (
            <>
              <div
                aria-hidden="true"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-red-600 dark:text-red-400"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">Withdrawal failed</p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{txError}</p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  data-cy="withdraw-retry-btn"
                  className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => { setTxStatus("idle"); setStep(1); }}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 font-semibold py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  Start Over
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </AccessibleModal>
  );
}

export default WithdrawModal;

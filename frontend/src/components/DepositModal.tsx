"use client";

/**
 * DepositModal (#237)
 *
 * Multi-step deposit modal:
 *   Step 1 — Amount input with max-balance button and real-time share preview
 *   Step 2 — Review: confirm details + estimated gas fee
 *   Step 3 — Success / failure result
 *
 * Acceptance criteria:
 *   ✅ Amount input with max-balance button
 *   ✅ Real-time share preview: shares = floor(amount × totalShares / totalAssets)
 *   ✅ Validation: reject zero, negative, or above-balance amounts
 *   ✅ Step 1: confirm details → Step 2: sign tx → Step 3: success/failure
 *   ✅ Disable submit button while tx is pending
 *   ✅ Show estimated gas/fee before signing
 *   ✅ Success state shows new share balance
 *   ✅ Re-uses AccessibleModal base component
 *   ✅ Calls /api/vault/deposit on submit
 */

import { useState, useEffect, useCallback } from "react";
import { AccessibleModal, AmountInput, FormField, FormErrorMessage } from "./AccessibleFormComponents";
import { UsdAmountConverter } from "./UsdAmountConverter";

// ─── Types ────────────────────────────────────────────────────────────────────

type DepositStep = 1 | 2 | 3;
type TxStatus = "idle" | "pending" | "success" | "error";
const DEPOSIT_FEE_BUFFER = 0.001;

export interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** User's current underlying token balance (e.g. "500.00") */
  balance: string;
  /** Current total shares in the vault */
  totalShares?: string;
  /** Current total assets in the vault */
  totalAssets?: string;
  /** Called on successful deposit — use to refresh portfolio data */
  onSuccess?: (newShareBalance: string) => void;
}

interface GasEstimate {
  baseFee: string;
  priorityFee: string;
  totalGas: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * shares = floor(amount × totalShares / totalAssets)
 * Falls back to a 1:1 ratio for the first depositor.
 */
function previewShares(amount: string, totalShares: string, totalAssets: string): string {
  const a = parseFloat(amount);
  const ts = parseFloat(totalShares);
  const ta = parseFloat(totalAssets);
  if (isNaN(a) || a <= 0) return "0";
  if (ta === 0 || ts === 0) {
    // First depositor — 1:1 seed ratio
    return Math.floor(a).toString();
  }
  return Math.floor((a * ts) / ta).toString();
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

const STEP_LABELS: Record<DepositStep, string> = {
  1: "Amount",
  2: "Fees",
  3: "Result",
};

function StepIndicator({ step }: { step: DepositStep }) {
  return (
    <ol
      aria-label="Deposit steps"
      className="flex items-center gap-0 mb-6"
    >
      {([1, 2, 3] as DepositStep[]).map((s, i) => {
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
                    ? "border-indigo-600 bg-indigo-600 text-white ring-4 ring-indigo-600/20"
                    : "border-zinc-300 bg-white text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900",
                ].join(" ")}
                aria-hidden="true"
              >
                {isCompleted ? "✓" : s}
              </div>
              <span
                className={[
                  "text-[10px] font-medium",
                  isCurrent ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400",
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

// ─── DepositModal ─────────────────────────────────────────────────────────────

export function DepositModal({
  isOpen,
  onClose,
  balance,
  totalShares = "0",
  totalAssets = "0",
  onSuccess,
}: DepositModalProps) {
  const { address } = useWalletStore();
  const [step, setStep] = useState<DepositStep>(1);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState("");
  const [txError, setTxError] = useState("");
  const [newShareBalance, setNewShareBalance] = useState("");

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep(1);
        setAmount("");
        setAmountError("");
        setGasEstimate(null);
        setTxStatus("idle");
        setTxHash("");
        setTxError("");
        setNewShareBalance("");
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const estimatedShares = previewShares(amount, totalShares, totalAssets);

  function validate(): boolean {
    const n = parseFloat(amount);
    if (!amount || isNaN(n) || n <= 0) {
      setAmountError("Enter an amount greater than 0.");
      return false;
    }
    if (n > parseFloat(balance)) {
      setAmountError(`Amount exceeds your available balance of ${balance} USDC.`);
      return false;
    }
    setAmountError("");
    return true;
  }

  const fetchGasEstimate = useCallback(async (amt: string) => {
    setGasLoading(true);
    try {
      const res = await fetch("/api/vault/estimate-gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "deposit", amount: amt }),
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
      // Step 2 is now PreSignBreakdown which fetches its own fee data (#885)
      setStep(2);
    } else if (step === 2) {
      await handleSubmit();
    }
  }

  async function handleSubmit() {
    setTxStatus("pending");
    setTxError("");
    setStep(3);
    try {
      const res = await fetch("/api/vault/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json() as { hash?: string; error?: string; newShareBalance?: string };
      if (!res.ok) throw new Error(data.error ?? "Deposit failed");
      setTxHash(data.hash ?? `tx-${Date.now()}`);
      const newBalance = data.newShareBalance ?? estimatedShares;
      setNewShareBalance(newBalance);
      setTxStatus("success");
      // Invalidate portfolio SWR cache so the panel refreshes automatically (#886)
      if (address) invalidatePortfolioCache(address);
      onSuccess?.(newBalance);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Deposit failed");
      setTxStatus("error");
    }
  }

  const titleMap: Record<DepositStep, string> = {
    1: "Deposit",
    2: "Fee Breakdown",
    3: txStatus === "success" ? "Deposit Successful" : txStatus === "error" ? "Deposit Failed" : "Processing…",
  };

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={titleMap[step]}
      description={
        step === 1
          ? "Enter the amount of USDC you want to deposit into the vault."
          : undefined
      }
    >
      {/* Accessible live region — announces step transitions */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {step === 1 && "Step 1 of 3: Enter deposit amount."}
        {step === 2 && "Step 2 of 3: Review fee breakdown before signing."}
        {step === 3 && txStatus === "pending" && "Processing your deposit…"}
        {step === 3 && txStatus === "success" && "Deposit successful!"}
        {step === 3 && txStatus === "error" && `Deposit failed: ${txError}`}
      </div>

      <StepIndicator step={step} />

      {/* ── Step 1: Amount ───────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="flex flex-col gap-5">
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Available balance: </span>
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">{balance} USDC</span>
          </div>

          <FormField
            label="Amount (USDC)"
            error={amountError}
            required
            hint="Enter the amount of USDC to deposit."
          >
            {({ inputId, errorId, hintId }) => (
              <AmountInput
                id={inputId}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setAmountError("");
                }}
                maxValue={balance}
                tokenSymbol="USDC"
                hasError={!!amountError}
                errorId={amountError ? errorId : undefined}
                hintId={hintId}
                autoFocus
                data-cy="deposit-amount-input"
              />
            )}
          </FormField>

          <button type="button" onClick={() => {
            const max = Math.max(0, Number.parseFloat(balance) - DEPOSIT_FEE_BUFFER);
            setAmount(Number.isFinite(max) ? max.toFixed(2) : "0.00");
            setAmountError("");
          }} className="-mt-3 self-end rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950" aria-label="Use maximum deposit amount after reserving the 0.001 fee buffer">
            Max
          </button>

          {/* Quick-select percentage buttons */}
          <div className="flex gap-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  const v = ((parseFloat(balance) * pct) / 100).toFixed(2);
                  setAmount(v);
                  setAmountError("");
                }}
                aria-label={`Set amount to ${pct}% of balance`}
                className="flex-1 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600"
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Real-time share preview */}
          {parseFloat(amount) > 0 && !amountError && (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 px-4 py-3 text-sm"
            >
              <p className="text-zinc-600 dark:text-zinc-300">
                You will receive approximately{" "}
                <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                  {estimatedShares} aUSDC shares
                </span>
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                Formula: floor({amount} × totalShares / totalAssets)
              </p>
            </div>
          )}

          <UsdAmountConverter tokenAmount={amount} shareAmount={estimatedShares} />

          <button
            type="button"
            onClick={() => void handleNext()}
            data-cy="deposit-next-btn"
            className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2"
          >
            Review Deposit
          </button>
        </div>
      )}

      {/* ── Step 2: Fee Breakdown (#885) ────────────────────────────────── */}
      {step === 2 && (
        <PreSignBreakdown
          type="deposit"
          amount={amount}
          onCancel={() => setStep(1)}
          onProceed={() => { void handleSubmit(); }}
        />
      )}

      {/* ── Step 3: Result ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="flex flex-col items-center gap-5 py-4 text-center" data-cy="deposit-result">
          {txStatus === "pending" && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950">
                <Spinner />
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">Processing…</p>
                <p className="text-sm text-zinc-500 mt-1">Broadcasting to Stellar network</p>
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
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">Deposit successful!</p>
                <p className="text-sm text-zinc-500 mt-1">
                  You received{" "}
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {newShareBalance} aUSDC shares
                  </span>
                </p>
                {txHash && (
                  <p className="text-xs text-zinc-400 mt-1 font-mono" data-cy="deposit-tx-hash">
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
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">Deposit failed</p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{txError}</p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  data-cy="deposit-retry-btn"
                  className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => { setTxStatus("idle"); setStep(1); }}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 font-semibold py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600"
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

export default DepositModal;

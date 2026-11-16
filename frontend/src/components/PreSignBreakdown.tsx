"use client";

/**
 * PreSignBreakdown — Issue #249
 *
 * Pre-sign transaction breakdown screen. Shows a summary of the operation
 * before the user commits, including:
 *   - Operation type and amount
 *   - Expected output (shares received or XLM redeemed)
 *   - Protocol fee (if any)
 *   - Estimated Stellar network fee in XLM and USD
 *   - Loading state while fee is being fetched
 *   - Cancel and Proceed buttons
 *
 * Usage:
 *   <PreSignBreakdown
 *     type="deposit"
 *     amount="100"
 *     onCancel={() => setStep(1)}
 *     onProceed={() => setStep(3)}
 *   />
 */

import { useEffect, useState } from "react";
import { AlertCircle, Info } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TxType = "deposit" | "withdraw";

interface FeeTier {
  stroops: number;
  xlm: string;
}

interface StellarFeeStats {
  lastLedger: number;
  lastLedgerBaseFee: number;
  ledgerCapacityUsage: number;
  congested: boolean;
  fee: {
    base: FeeTier;
    low: FeeTier;
    standard: FeeTier;
    high: FeeTier;
  };
  fetchedAt: string;
  cached: boolean;
}

export interface PreSignBreakdownProps {
  /** Transaction type: deposit or withdrawal. */
  type: TxType;
  /** Amount entered by the user (in underlying token). */
  amount: string;
  /** Current share price used to compute expected output. */
  sharePrice?: string;
  /** Protocol fee rate as a decimal (e.g. 0.001 = 0.1%). */
  protocolFeeRate?: number;
  /** Estimated transaction time label (default "5–7 seconds"). */
  estimatedTimeSec?: string;
  /** Called when user clicks Cancel / Back. */
  onCancel: () => void;
  /** Called when user clicks Confirm / Proceed. */
  onProceed: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const FEE_STATS_URL = `${API_BASE}/api/v1/stellar/fee-stats`;
const GAS_ESTIMATE_URL = `${API_BASE}/api/v1/gas/estimate`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(raw: string, decimals = 4): string {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

function computeExpectedOutput(
  type: TxType,
  amount: string,
  sharePrice = "1.0",
  protocolFeeRate = 0
): string {
  const amt = parseFloat(amount);
  const price = parseFloat(sharePrice);
  if (!Number.isFinite(amt) || amt <= 0 || !Number.isFinite(price) || price <= 0) return "—";

  const afterFee = amt * (1 - protocolFeeRate);
  if (type === "deposit") {
    // Shares received = (amount - protocol fee) / share price
    return formatAmount(String(afterFee / price));
  } else {
    // XLM redeemed = shares * share price - protocol fee
    return formatAmount(String(afterFee * price));
  }
}

function computeProtocolFee(amount: string, feeRate: number): string {
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || feeRate <= 0) return "0";
  return formatAmount(String(amt * feeRate), 6);
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="animate-spin text-current"
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function Row({
  label,
  value,
  sub,
  loading,
  bold,
  testId,
}: {
  label: string;
  value?: string;
  sub?: string;
  loading?: boolean;
  bold?: boolean;
  testId?: string;
}) {
  return (
    <div className={`flex justify-between items-start text-sm ${bold ? "font-semibold" : ""}`}>
      <dt className="text-zinc-500 dark:text-zinc-400 shrink-0 mr-4">{label}</dt>
      <dd
        data-cy={testId}
        className={`font-mono text-right ${bold ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-800 dark:text-zinc-200"}`}
      >
        {loading ? (
          <span className="flex items-center justify-end gap-1.5 text-zinc-400">
            <Spinner size={13} />
            <span className="text-xs">Fetching…</span>
          </span>
        ) : (
          <>
            <span>{value ?? "—"}</span>
            {sub && (
              <span className="block text-xs text-zinc-400 dark:text-zinc-500">{sub}</span>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PreSignBreakdown({
  type,
  amount,
  sharePrice = "1.0",
  protocolFeeRate = 0,
  estimatedTimeSec = "5–7",
  onCancel,
  onProceed,
}: PreSignBreakdownProps) {
  const [feeStats, setFeeStats] = useState<StellarFeeStats | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState(false);
  const [xlmUsdPrice, setXlmUsdPrice] = useState<number | null>(null);

  // Fetch fee stats from backend — try /api/v1/gas/estimate first (#885), then
  // fall back to /api/v1/stellar/fee-stats for the full Stellar fee stats shape.
  useEffect(() => {
    let cancelled = false;
    setFeeLoading(true);
    setFeeError(false);

    (async () => {
      try {
        // Primary: /api/v1/gas/estimate (returns baseFee in stroops + XLM)
        const gasRes = await fetch(GAS_ESTIMATE_URL);
        if (gasRes.ok) {
          const gasJson = await gasRes.json();
          const gasData = gasJson.data ?? gasJson;
          // Normalize to StellarFeeStats shape so the existing Row components work
          const baseFeeStroops: number =
            gasData.baseFeeStroops ?? gasData.baseFee ?? 100;
          const baseFeeXlm: string =
            gasData.xlm ?? (baseFeeStroops / 10_000_000).toFixed(7);
          if (!cancelled) {
            setFeeStats({
              lastLedger: gasData.lastLedger ?? 0,
              lastLedgerBaseFee: baseFeeStroops,
              ledgerCapacityUsage: gasData.ledgerCapacityUsage ?? 0,
              congested: gasData.congested ?? false,
              fee: {
                base: { stroops: baseFeeStroops, xlm: baseFeeXlm },
                low: { stroops: baseFeeStroops, xlm: baseFeeXlm },
                standard: { stroops: baseFeeStroops, xlm: baseFeeXlm },
                high: { stroops: baseFeeStroops * 2, xlm: (baseFeeStroops * 2 / 10_000_000).toFixed(7) },
              },
              fetchedAt: new Date().toISOString(),
              cached: gasData.cached ?? false,
            });
          }
          if (!cancelled) setFeeLoading(false);
          return;
        }
      } catch {
        // fall through to stellar fee-stats
      }

      // Fallback: /api/v1/stellar/fee-stats
      try {
        const res = await fetch(FEE_STATS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setFeeStats(json.data ?? json);
      } catch {
        if (!cancelled) setFeeError(true);
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshPrice = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/gas/usd-price?asset=XLM`, { cache: "no-store" });
        if (!response.ok) throw new Error("Price unavailable");
        const body = await response.json();
        const price = Number(body.data?.priceUSD);
        if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");
        if (!cancelled) setXlmUsdPrice(price);
      } catch {
        if (!cancelled) setXlmUsdPrice(null);
      }
    };
    void refreshPrice();
    const timer = window.setInterval(() => void refreshPrice(), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const label = type === "deposit" ? "Deposit" : "Withdrawal";
  const outputLabel = type === "deposit" ? "Shares received" : "XLM redeemed";
  const outputUnit = type === "deposit" ? "AVS" : "XLM";

  const protocolFee = computeProtocolFee(amount, protocolFeeRate);
  const expectedOutput = computeExpectedOutput(type, amount, sharePrice, protocolFeeRate);

  const stdFeeXlm = feeStats?.fee.standard.xlm ?? null;
  const stdFeeUsd = stdFeeXlm && xlmUsdPrice !== null ? `~$${(Number(stdFeeXlm) * xlmUsdPrice).toFixed(6)}` : null;

  return (
    <div data-cy="pre-sign-breakdown" className="flex flex-col gap-4">
      {/* Breakdown table */}
      <dl className="flex flex-col gap-3 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800">
        {/* Operation */}
        <Row
          label="Operation"
          value={label}
          testId="breakdown-operation"
        />

        {/* Amount */}
        <Row
          label="Amount"
          value={`${formatAmount(amount)} XLM`}
          testId="breakdown-amount"
        />

        {/* Expected output */}
        <Row
          label={outputLabel}
          value={`${expectedOutput} ${outputUnit}`}
          testId="breakdown-expected-output"
        />

        {/* Protocol fee (only shown when > 0) */}
        {protocolFeeRate > 0 && (
          <Row
            label={`Protocol fee (${(protocolFeeRate * 100).toFixed(2)}%)`}
            value={`${protocolFee} XLM`}
            testId="breakdown-protocol-fee"
          />
        )}

        <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />

        {/* Stellar network fee */}
        <Row
          label="Stellar network fee"
          value={stdFeeXlm ? `${stdFeeXlm} XLM` : feeError ? "~0.0000100 XLM" : undefined}
          sub={stdFeeUsd ?? "USD price unavailable"}
          loading={feeLoading && !feeError}
          bold
          testId="breakdown-network-fee"
        />

        <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />

        {/* Estimated confirmation time (#885) */}
        <Row
          label="Estimated time"
          value={`~${estimatedTimeSec} seconds`}
          testId="breakdown-estimated-time"
        />
      </dl>

      {/* Network congestion warning */}
      {feeStats?.congested && (
        <div
          data-cy="breakdown-congestion-warning"
          className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          role="alert"
        >
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            Network is congested ({(feeStats.ledgerCapacityUsage * 100).toFixed(0)}% capacity). Fees
            may be higher than shown.
          </span>
        </div>
      )}

      {/* Fee fetch error notice */}
      {feeError && !feeLoading && (
        <div
          data-cy="breakdown-fee-error"
          className="flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          role="status"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Could not fetch live fee estimate — showing fallback values.</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 mt-2">
        <button
          data-cy="breakdown-cancel-btn"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          data-cy="breakdown-proceed-btn"
          onClick={onProceed}
          disabled={feeLoading && !feeError}
          className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 disabled:dark:opacity-50 transition-colors"
          aria-busy={feeLoading && !feeError}
        >
          {feeLoading && !feeError ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner size={14} />
              Loading…
            </span>
          ) : (
            "Confirm & Sign"
          )}
        </button>
      </div>
    </div>
  );
}

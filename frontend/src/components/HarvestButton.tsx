"use client";

/**
 * HarvestButton — permissionless keeper harvest trigger.
 *
 * Acceptance criteria implemented here:
 *  ✓ Harvest button with yield amount input
 *  ✓ Confirm dialog explaining keeper mechanics
 *  ✓ Shows last harvest timestamp and estimated yield since then
 *  ✓ Post-harvest success: displays the new share price
 *  ✓ Disabled when total_shares == 0 (maps to ZeroShares on-chain error)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedButton } from "./AnimatedButton";
import { useNotifications } from "./notifications";
import StellarBaseFee from "./StellarBaseFee";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EstimatedYieldData {
  estimatedYield: string;
  lastHarvestAt: string | null;
  totalAssets: number;
  totalShares: number;
  elapsedMs: number;
}

interface HarvestResult {
  newSharePrice: string;
  harvestedAt: string;
  yieldAmount: string;
}

type HarvestStatus = "idle" | "loading" | "confirming" | "submitting" | "success" | "error";

interface HarvestButtonProps {
  /** Total vault shares — button is disabled when 0 */
  totalShares?: number;
  /** Called after a successful harvest so the parent can refresh stats */
  onHarvestComplete?: (result: HarvestResult) => void;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatAbsTime(isoString: string | null): string | null {
  if (!isoString) return null;
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  estimatedData: EstimatedYieldData | null;
  yieldAmount: string;
  onYieldAmountChange: (v: string) => void;
  yieldAmountError: string;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function ConfirmDialog({
  estimatedData,
  yieldAmount,
  onYieldAmountChange,
  yieldAmountError,
  onConfirm,
  onCancel,
  isSubmitting,
}: ConfirmDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount, enable Escape to cancel
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const lastHarvestRel = formatRelativeTime(estimatedData?.lastHarvestAt ?? null);
  const lastHarvestAbs = formatAbsTime(estimatedData?.lastHarvestAt ?? null);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="harvest-dialog-title"
    >
      <div className="relative w-full max-w-md rounded-[var(--radius-xl,1rem)] bg-[var(--color-surface,#fff)] dark:bg-zinc-900 border border-[var(--color-border,#e4e4e7)] shadow-2xl p-6 mx-4">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2
              id="harvest-dialog-title"
              className="text-[length:var(--text-lg,1.125rem)] font-[var(--font-semibold,600)] text-[var(--color-text,#18181b)]"
            >
              Trigger Harvest
            </h2>
            <p className="mt-1 text-[length:var(--text-sm,0.875rem)] text-[var(--color-text-muted,#71717a)]">
              Inject yield into the vault as a permissionless keeper.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close harvest dialog"
            className="rounded-md p-1 text-[var(--color-text-muted,#71717a)] hover:text-[var(--color-text,#18181b)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
            </svg>
          </button>
        </div>

        {/* Keeper mechanics explanation */}
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 mb-5">
          <p className="text-[length:var(--text-xs,0.75rem)] font-[var(--font-semibold,600)] text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1.5">
            How keeper harvests work
          </p>
          <p className="text-[length:var(--text-sm,0.875rem)] text-amber-700 dark:text-amber-300 leading-relaxed">
            Anyone can act as a keeper. When you submit this harvest, the yield
            amount you specify is injected into the vault without minting new
            shares — increasing the share price for all depositors. This
            operation is <strong>permissionless</strong> and
            <strong> irreversible</strong>.
          </p>
        </div>

        {/* Last harvest info */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg bg-[var(--color-surface-raised,#f4f4f5)] dark:bg-zinc-800 p-3">
            <p className="text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-muted,#71717a)] uppercase tracking-wide mb-0.5">
              Last Harvest
            </p>
            <p
              className="font-[var(--font-mono,monospace)] text-[length:var(--text-sm,0.875rem)] font-[var(--font-semibold,600)] text-[var(--color-text,#18181b)]"
              title={lastHarvestAbs ?? undefined}
            >
              {lastHarvestRel}
            </p>
            {lastHarvestAbs && (
              <p className="text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-disabled,#a1a1aa)] mt-0.5">
                {lastHarvestAbs}
              </p>
            )}
          </div>

          <div className="rounded-lg bg-[var(--color-surface-raised,#f4f4f5)] dark:bg-zinc-800 p-3">
            <p className="text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-muted,#71717a)] uppercase tracking-wide mb-0.5">
              Est. Yield Accrued
            </p>
            <p className="font-[var(--font-mono,monospace)] text-[length:var(--text-sm,0.875rem)] font-[var(--font-semibold,600)] text-[var(--color-success,#22c55e)]">
              {estimatedData
                ? `${parseFloat(estimatedData.estimatedYield).toFixed(4)} USDC`
                : "—"}
            </p>
            <p className="text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-disabled,#a1a1aa)] mt-0.5">
              Based on current APY
            </p>
          </div>
        </div>

        {/* Yield amount input */}
        <div className="mb-5">
          <label
            htmlFor="harvest-yield-amount"
            className="block text-[length:var(--text-sm,0.875rem)] font-[var(--font-medium,500)] text-[var(--color-text,#18181b)] mb-1.5"
          >
            Yield Amount to Inject
          </label>
          <div className="relative">
            <input
              ref={inputRef}
              id="harvest-yield-amount"
              type="number"
              min="0.0000001"
              step="0.0000001"
              placeholder={
                estimatedData
                  ? parseFloat(estimatedData.estimatedYield).toFixed(7)
                  : "0.0000000"
              }
              value={yieldAmount}
              onChange={(e) => onYieldAmountChange(e.target.value)}
              disabled={isSubmitting}
              aria-invalid={!!yieldAmountError}
              aria-describedby={yieldAmountError ? "harvest-amount-error" : undefined}
              className={[
                "w-full rounded-lg border px-3 py-2.5 font-[var(--font-mono,monospace)] text-[length:var(--text-sm,0.875rem)]",
                "bg-[var(--color-surface,#fff)] dark:bg-zinc-800 text-[var(--color-text,#18181b)]",
                "placeholder:text-[var(--color-text-disabled,#a1a1aa)]",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-colors duration-150",
                yieldAmountError
                  ? "border-red-400 dark:border-red-500"
                  : "border-[var(--color-border,#e4e4e7)] dark:border-zinc-700",
              ].join(" ")}
            />
            <span
              aria-hidden="true"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-muted,#71717a)] font-[var(--font-mono,monospace)]"
            >
              USDC
            </span>
          </div>
          {yieldAmountError && (
            <p
              id="harvest-amount-error"
              role="alert"
              className="mt-1.5 text-[length:var(--text-xs,0.75rem)] text-red-500"
            >
              {yieldAmountError}
            </p>
          )}
        </div>

        <StellarBaseFee />
        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className={[
              "flex-1 rounded-lg border border-[var(--color-border,#e4e4e7)] dark:border-zinc-700",
              "py-2.5 text-[length:var(--text-sm,0.875rem)] font-[var(--font-medium,500)]",
              "text-[var(--color-text-muted,#71717a)] hover:text-[var(--color-text,#18181b)]",
              "hover:bg-[var(--color-surface-raised,#f4f4f5)] dark:hover:bg-zinc-800",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "transition-colors duration-150",
            ].join(" ")}
          >
            Cancel
          </button>

          <AnimatedButton
            variant="primary"
            size="md"
            loading={isSubmitting}
            onClick={onConfirm}
            disabled={isSubmitting || !!yieldAmountError || !yieldAmount}
            className="flex-1"
          >
            {isSubmitting ? "Harvesting…" : "Confirm Harvest"}
          </AnimatedButton>
        </div>
      </div>
    </div>
  );
}

// ─── Success Banner ───────────────────────────────────────────────────────────

interface SuccessBannerProps {
  result: HarvestResult;
  onDismiss: () => void;
}

function SuccessBanner({ result, onDismiss }: SuccessBannerProps) {
  // Auto-dismiss after 10 seconds
  useEffect(() => {
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="harvest-success-banner"
      className="rounded-[var(--radius-lg,0.75rem)] border border-[var(--color-success,#22c55e)] bg-green-50 dark:bg-green-950/40 p-4 flex items-start gap-3"
    >
      {/* Checkmark icon */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        className="flex-shrink-0 mt-0.5 text-[var(--color-success,#22c55e)]"
        aria-hidden="true"
      >
        <path
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
          fill="currentColor"
        />
      </svg>

      <div className="flex-1 min-w-0">
        <p className="text-[length:var(--text-sm,0.875rem)] font-[var(--font-semibold,600)] text-green-700 dark:text-green-400">
          Harvest successful!
        </p>
        <p className="text-[length:var(--text-sm,0.875rem)] text-green-600 dark:text-green-300 mt-0.5">
          Injected{" "}
          <span className="font-[var(--font-mono,monospace)] font-[var(--font-semibold,600)]">
            {parseFloat(result.yieldAmount).toFixed(4)} USDC
          </span>{" "}
          into the vault.
        </p>

        <div className="mt-2 rounded-md bg-white/60 dark:bg-zinc-800/60 px-3 py-2 inline-flex items-center gap-2">
          <span className="text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-muted,#71717a)] uppercase tracking-wide">
            New Share Price
          </span>
          <span
            className="font-[var(--font-mono,monospace)] text-[length:var(--text-sm,0.875rem)] font-[var(--font-bold,700)] text-[var(--color-text,#18181b)]"
            data-testid="harvest-new-share-price"
          >
            {parseFloat(result.newSharePrice).toFixed(6)}
          </span>
        </div>

        <p className="text-[length:var(--text-xs,0.75rem)] text-green-500 dark:text-green-400/70 mt-2">
          {new Date(result.harvestedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss harvest success"
        className="flex-shrink-0 rounded-md p-1 text-green-500 hover:text-green-700 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HarvestButton({
  totalShares,
  onHarvestComplete,
  className,
}: HarvestButtonProps) {
  const { toast } = useNotifications();

  const [status, setStatus] = useState<HarvestStatus>("idle");
  const [estimated, setEstimated] = useState<EstimatedYieldData | null>(null);
  const [yieldAmount, setYieldAmount] = useState("");
  const [yieldAmountError, setYieldAmountError] = useState("");
  const [successResult, setSuccessResult] = useState<HarvestResult | null>(null);

  // totalShares gate: if explicitly 0, disable the button
  const isVaultEmpty = totalShares === 0;

  // ── Fetch estimated yield on open ─────────────────────────────────────────
  const fetchEstimated = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/vault/harvest/estimated");
      if (!res.ok) return;
      const json = await res.json();
      const data: EstimatedYieldData = json.data ?? json;
      setEstimated(data);
      // Pre-fill the yield amount with the estimate if the field is empty
      if (!yieldAmount && parseFloat(data.estimatedYield) > 0) {
        setYieldAmount(parseFloat(data.estimatedYield).toFixed(7));
      }
    } catch {
      // Non-fatal — user can still type a manual amount
    }
  }, [yieldAmount]);

  const handleOpen = useCallback(() => {
    setStatus("loading");
    setYieldAmount("");
    setYieldAmountError("");
    setSuccessResult(null);
    fetchEstimated().finally(() => setStatus("confirming"));
  }, [fetchEstimated]);

  // ── Yield amount validation ───────────────────────────────────────────────
  const handleYieldAmountChange = useCallback((val: string) => {
    setYieldAmount(val);
    if (!val) {
      setYieldAmountError("Yield amount is required");
      return;
    }
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) {
      setYieldAmountError("Amount must be greater than 0");
    } else if (!/^[0-9]+(\.[0-9]{1,7})?$/.test(val)) {
      setYieldAmountError("Up to 7 decimal places only");
    } else {
      setYieldAmountError("");
    }
  }, []);

  // ── Submit harvest ────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!yieldAmount || yieldAmountError) return;

    setStatus("submitting");
    try {
      const res = await fetch("/api/v1/vault/harvest/keeper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yieldAmount }),
      });

      const json = await res.json();

      if (!res.ok) {
        const code: string = json.error?.code ?? "UNKNOWN";
        const msg: string = json.error?.message ?? "Harvest failed.";

        if (code === "ZERO_SHARES") {
          toast(
            "error",
            "Vault is empty",
            "Cannot harvest: there are no depositors. Deposit into the vault first."
          );
        } else if (res.status === 429) {
          toast("warning", "Rate limited", "Too many requests. Please wait a moment before retrying.");
        } else {
          toast("error", "Harvest failed", msg);
        }

        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }

      const result: HarvestResult = {
        newSharePrice: json.data?.newSharePrice ?? "—",
        harvestedAt: json.data?.harvestedAt ?? new Date().toISOString(),
        yieldAmount: json.data?.yieldAmount ?? yieldAmount,
      };

      setSuccessResult(result);
      setStatus("success");
      toast("success", "Harvest complete!", `Injected ${parseFloat(result.yieldAmount).toFixed(4)} USDC. New share price: ${parseFloat(result.newSharePrice).toFixed(6)}.`);
      onHarvestComplete?.(result);
    } catch {
      toast("error", "Network error", "Could not reach the server. Please check your connection.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }, [yieldAmount, yieldAmountError, toast, onHarvestComplete]);

  const handleCancel = useCallback(() => {
    setStatus("idle");
    setYieldAmount("");
    setYieldAmountError("");
  }, []);

  const handleDismissSuccess = useCallback(() => {
    setStatus("idle");
    setSuccessResult(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={className} data-testid="harvest-button-container">

      {/* Post-harvest success banner */}
      {status === "success" && successResult && (
        <SuccessBanner result={successResult} onDismiss={handleDismissSuccess} />
      )}

      {/* Trigger button — hidden after success until dismissed */}
      {status !== "success" && (
        <AnimatedButton
          variant="secondary"
          size="md"
          loading={status === "loading" || status === "submitting"}
          disabled={isVaultEmpty || status === "loading" || status === "submitting"}
          onClick={handleOpen}
          data-testid="harvest-trigger-btn"
          aria-label={
            isVaultEmpty
              ? "Harvest disabled: vault has no depositors"
              : "Trigger keeper harvest"
          }
          title={
            isVaultEmpty
              ? "Cannot harvest: the vault has no depositors (total shares = 0)"
              : "Trigger a permissionless keeper harvest"
          }
          className="w-full"
        >
          {/* Lightning bolt icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className="flex-shrink-0"
          >
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001z" />
          </svg>
          Trigger Harvest
        </AnimatedButton>
      )}

      {/* Empty-vault hint */}
      {isVaultEmpty && (
        <p
          role="note"
          className="mt-2 text-[length:var(--text-xs,0.75rem)] text-[var(--color-text-muted,#71717a)]"
          data-testid="harvest-disabled-hint"
        >
          Harvest is unavailable — the vault has no depositors yet.
        </p>
      )}

      {/* Confirm dialog */}
      {status === "confirming" && (
        <ConfirmDialog
          estimatedData={estimated}
          yieldAmount={yieldAmount}
          onYieldAmountChange={handleYieldAmountChange}
          yieldAmountError={yieldAmountError}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isSubmitting={false}
        />
      )}

      {/* Submitting state: keep dialog open but show spinner */}
      {status === "submitting" && (
        <ConfirmDialog
          estimatedData={estimated}
          yieldAmount={yieldAmount}
          onYieldAmountChange={handleYieldAmountChange}
          yieldAmountError={yieldAmountError}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isSubmitting={true}
        />
      )}
    </div>
  );
}

export default HarvestButton;

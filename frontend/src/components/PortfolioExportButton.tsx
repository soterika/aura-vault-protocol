"use client";

import { useState } from "react";
import {
  exportPortfolio,
  type ExportFormat,
  type ExportTransaction,
  type PortfolioPosition,
} from "@/lib/portfolioExport";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PortfolioExportButtonProps {
  walletAddress: string;
  network?: string;
  position: PortfolioPosition;
  transactions: ExportTransaction[];
  /** Optional CSS class for the wrapper element */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * `PortfolioExportButton`
 *
 * Renders a format-chooser (CSV / JSON) and a Download button.
 * All file generation is done client-side using the Web File API — no data
 * leaves the browser, satisfying the privacy requirement in Issue #260.
 *
 * ## Filename pattern
 * `aura-portfolio-{address}-{YYYY-MM-DD}.{csv|json}`
 *
 * ## Accessibility
 * - Radio group uses `role="radiogroup"` with `aria-labelledby`
 * - Each option is a native `<input type="radio">` for keyboard / screen-reader support
 * - Download button has `aria-busy` set during the brief generation phase
 * - Success/error states are announced via `aria-live="polite"`
 */
export function PortfolioExportButton({
  walletAddress,
  network,
  position,
  transactions,
  className = "",
}: PortfolioExportButtonProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [status, setStatus] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleExport = () => {
    if (status === "exporting") return;
    setStatus("exporting");
    setErrorMsg("");

    try {
      exportPortfolio(format, { walletAddress, network, position, transactions });
      setStatus("done");
      // Reset after 3 s so the user can export again
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed. Please try again.";
      setErrorMsg(msg);
      setStatus("error");
    }
  };

  const labelId = "export-format-label";

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Format chooser */}
      <div role="radiogroup" aria-labelledby={labelId}>
        <p
          id={labelId}
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Export format
        </p>
        <div className="flex gap-4">
          {(["csv", "json"] as ExportFormat[]).map((f) => (
            <label
              key={f}
              className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200"
            >
              <input
                type="radio"
                name="export-format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                className="accent-zinc-900 dark:accent-zinc-50"
              />
              <span className="font-medium uppercase">{f}</span>
              <span className="text-xs text-zinc-400">
                {f === "csv" ? "Excel-compatible" : "Machine-readable"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Download button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={status === "exporting" || transactions.length === 0}
          aria-busy={status === "exporting"}
          aria-disabled={transactions.length === 0}
          className={[
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold",
            "transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-400",
            status === "done"
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200",
            (status === "exporting" || transactions.length === 0) && "opacity-50 cursor-not-allowed",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {status === "exporting" && (
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {status === "done" ? "✓ Downloaded" : status === "exporting" ? "Generating…" : `Download ${format.toUpperCase()}`}
        </button>

        {transactions.length === 0 && (
          <p className="text-xs text-zinc-400">No transactions to export.</p>
        )}
      </div>

      {/* Live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {status === "done" && `Portfolio exported as ${format.toUpperCase()}.`}
        {status === "error" && `Export failed: ${errorMsg}`}
      </div>

      {/* Visible error */}
      {status === "error" && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMsg}
        </p>
      )}
    </div>
  );
}

"use client";

/**
 * VaultCapacityBar — Issue #1005
 *
 * Shows a visual progress bar indicating TVL cap usage.
 * - Hidden when no tvl_cap is set on the vault stats
 * - Green < 80%, Yellow 80–95%, Red > 95%
 * - Tooltip shows current TVL, cap, and remaining capacity
 * - Accessible: <progress> element with aria-valuenow/max/label
 * - Updates every 60 seconds via SWR (simulated with useEffect + interval)
 */

import { useState, useEffect, useCallback } from "react";

export interface VaultCapacityData {
  total_assets: number;
  tvl_cap: number | null;
}

interface VaultCapacityBarProps {
  /** Override the data source URL (defaults to /api/v1/vault/stats) */
  apiUrl?: string;
  /** Refresh interval in milliseconds (default: 60 000) */
  refreshInterval?: number;
}

type CapacityTier = "green" | "yellow" | "red";

function getTier(pct: number): CapacityTier {
  if (pct >= 95) return "red";
  if (pct >= 80) return "yellow";
  return "green";
}

const tierStyles: Record<CapacityTier, string> = {
  green:  "bg-emerald-500",
  yellow: "bg-amber-400",
  red:    "bg-red-500",
};

const tierTextStyles: Record<CapacityTier, string> = {
  green:  "text-emerald-700 dark:text-emerald-400",
  yellow: "text-amber-700 dark:text-amber-400",
  red:    "text-red-700 dark:text-red-400",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function VaultCapacityBar({
  apiUrl = "/api/v1/vault/stats",
  refreshInterval = 60_000,
}: VaultCapacityBarProps) {
  const [data, setData] = useState<VaultCapacityData | null>(null);
  const [error, setError] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as VaultCapacityData;
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, [apiUrl]);

  // Initial fetch + polling every refreshInterval ms (matches SWR refreshInterval)
  useEffect(() => {
    void fetchData();
    const id = setInterval(() => { void fetchData(); }, refreshInterval);
    return () => clearInterval(id);
  }, [fetchData, refreshInterval]);

  // Hidden when no cap configured or data not yet loaded
  if (!data || data.tvl_cap === null || data.tvl_cap <= 0) {
    return null;
  }

  if (error) {
    return null; // silent failure — don't break the dashboard
  }

  const { total_assets, tvl_cap } = data;
  const pct = Math.min(100, Math.max(0, (total_assets / tvl_cap) * 100));
  const remaining = Math.max(0, tvl_cap - total_assets);
  const tier = getTier(pct);
  const pctDisplay = pct.toFixed(1);

  const labelId = "vault-capacity-label";
  const descId = "vault-capacity-desc";

  return (
    <section
      aria-labelledby={labelId}
      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span
          id={labelId}
          className="text-xs font-medium uppercase tracking-wide text-zinc-500"
        >
          Vault Capacity
        </span>

        {/* Tooltip trigger */}
        <div className="relative">
          <button
            type="button"
            aria-describedby={descId}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-zinc-400 rounded"
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
            onFocus={() => setTooltipVisible(true)}
            onBlur={() => setTooltipVisible(false)}
          >
            Details
          </button>

          {tooltipVisible && (
            <div
              id={descId}
              role="tooltip"
              className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 space-y-1"
            >
              <div className="flex justify-between">
                <span className="text-zinc-500">Current TVL</span>
                <span className="font-mono font-semibold">{formatTokens(total_assets)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Cap</span>
                <span className="font-mono font-semibold">{formatTokens(tvl_cap)}</span>
              </div>
              <div className="flex justify-between border-t border-zinc-100 dark:border-zinc-700 pt-1">
                <span className="text-zinc-500">Remaining</span>
                <span className={`font-mono font-semibold ${tierTextStyles[tier]}`}>
                  {formatTokens(remaining)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Label above bar */}
      <p className={`text-sm font-semibold mb-1 ${tierTextStyles[tier]}`}>
        Vault Capacity: {pctDisplay}% full
      </p>

      {/* Accessible progress bar */}
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-700"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${tierStyles[tier]}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Semantic <progress> for screen readers */}
      <progress
        className="sr-only"
        aria-labelledby={labelId}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        value={Math.round(pct)}
        max={100}
      >
        {pctDisplay}% full
      </progress>

      {/* Sub-text */}
      <p className="mt-1 text-xs text-zinc-400">
        {formatTokens(remaining)} remaining of {formatTokens(tvl_cap)} cap
      </p>
    </section>
  );
}

export default VaultCapacityBar;

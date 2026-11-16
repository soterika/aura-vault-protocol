"use client";

/**
 * useVaultStats — Issue #884
 *
 * SWR hook that fetches /api/v1/vault/stats with a 15-second refresh interval
 * and derives the current share price using floor division matching on-chain math.
 */

import useSWR from "swr";

// ── Types ──────────────────────────────────────────────────────────────────

interface RawVaultStats {
  totalAssets: string;
  totalShares: string;
  apy7d?: number;
}

export interface VaultStatsResult {
  totalAssets: string;
  totalShares: string;
  /** Share price formatted to 4 decimal places, e.g. "1.0456" */
  sharePrice: string;
  isLoading: boolean;
  error: unknown;
}

// ── Fetcher ────────────────────────────────────────────────────────────────

async function fetchVaultStats(): Promise<RawVaultStats> {
  const res = await fetch("/api/v1/vault/stats");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // Support both flat and envelope response shapes
  const data = json.data ?? json;
  return {
    totalAssets: String(data.totalAssets ?? data.total_assets ?? "0"),
    totalShares: String(data.totalShares ?? data.total_shares ?? "0"),
    apy7d: data.apy7d,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useVaultStats(): VaultStatsResult {
  const { data, isLoading, error } = useSWR<RawVaultStats>(
    "/api/v1/vault/stats",
    fetchVaultStats,
    { refreshInterval: 15_000, revalidateOnFocus: false }
  );

  const totalAssets = data?.totalAssets ?? "0";
  const totalShares = data?.totalShares ?? "0";

  // Compute share price using floor division to mirror on-chain arithmetic
  let sharePrice = "1.0000";
  try {
    const a = BigInt(totalAssets);
    const s = BigInt(totalShares);
    if (s > 0n) {
      // Multiply by 10^4 for 4 decimal places, then floor-divide
      const priceBps = (a * 10_000n) / s;
      sharePrice = (Number(priceBps) / 10_000).toFixed(4);
    }
  } catch {
    // Fallback to float division when BigInt parsing fails
    const a = parseFloat(totalAssets);
    const s = parseFloat(totalShares);
    if (s > 0 && !isNaN(a)) sharePrice = (a / s).toFixed(4);
  }

  return { totalAssets, totalShares, sharePrice, isLoading, error };
}

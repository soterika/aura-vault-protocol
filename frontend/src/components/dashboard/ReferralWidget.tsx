"use client";

/**
 * ReferralWidget
 *
 * Dashboard card that shows the connected user's referral stats:
 *   - Number of successful referrals
 *   - Total deposited volume attributed to those referrals
 *   - Their unique referral link with copy button
 *
 * Data is fetched from GET /api/referrals/:address.
 * Falls back gracefully when no wallet is connected.
 */

import { useEffect, useState } from "react";
import { Users, TrendingUp, RefreshCw } from "lucide-react";
import ReferralLink from "@/components/ReferralLink";
import { DashboardCard } from "./DashboardCard";
import { Skeleton } from "@/components/Skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferralStats {
  address: string;
  referrals: {
    referredAddress: string;
    registeredAt: number;
    depositVolume: number;
    pendingReward: number;
    claimedReward: number;
    isClaimable: boolean;
  }[];
  claimableReward: number;
  lockedReward: number;
  totalClaimed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtVolume(n: number): string {
  if (isNaN(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  /** Connected wallet address, or undefined when not connected. */
  address?: string;
  isLoading?: boolean;
}

export function ReferralWidget({ address, isLoading = false }: Props) {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setStats(null);
      return;
    }

    let cancelled = false;

    async function fetchStats() {
      setFetching(true);
      setError(null);
      try {
        const apiBase =
          typeof window !== "undefined"
            ? (process.env.NEXT_PUBLIC_API_URL ?? "")
            : "";
        const res = await fetch(`${apiBase}/api/referrals/${address}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ReferralStats = await res.json();
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    }

    void fetchStats();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const referralCount = stats?.referrals.length ?? 0;
  const totalVolume =
    stats?.referrals.reduce((sum, r) => sum + r.depositVolume, 0) ?? 0;

  const loading = isLoading || fetching;

  return (
    <DashboardCard title="Referrals" data-testid="referral-widget">
      {/* ── No wallet ──────────────────────────────────────────────────── */}
      {!address && !loading && (
        <p className="text-sm text-[var(--color-text-muted)] py-2">
          Connect your wallet to see referral stats.
        </p>
      )}

      {/* ── Loading skeleton ───────────────────────────────────────────── */}
      {loading && (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-9 rounded-lg col-span-2" />
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {address && error && !loading && (
        <p className="text-sm text-red-500 py-2">{error}</p>
      )}

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      {address && !error && !loading && (
        <>
          {/* Stat row */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Referral count */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Users
                  size={12}
                  className="text-zinc-400"
                  aria-hidden="true"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Referred
                </span>
              </div>
              <p
                className="text-2xl font-semibold font-mono text-[var(--color-text)]"
                aria-label={`${referralCount} referrals`}
              >
                {referralCount}
              </p>
            </div>

            {/* Total deposit volume */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp
                  size={12}
                  className="text-zinc-400"
                  aria-hidden="true"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Volume
                </span>
              </div>
              <p
                className="text-2xl font-semibold font-mono text-[var(--color-text)]"
                aria-label={`${totalVolume} total deposit volume`}
              >
                {fmtVolume(totalVolume)}
              </p>
            </div>
          </div>

          {/* Pending / claimable reward badge */}
          {stats && (stats.claimableReward > 0 || stats.lockedReward > 0) && (
            <div className="flex items-center gap-2 mb-3 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
              <RefreshCw
                size={12}
                className="text-emerald-600 dark:text-emerald-400 shrink-0"
                aria-hidden="true"
              />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                {stats.claimableReward > 0 ? (
                  <>
                    <span className="font-semibold font-mono">
                      {fmtVolume(stats.claimableReward)}
                    </span>{" "}
                    claimable reward
                  </>
                ) : (
                  <>
                    <span className="font-semibold font-mono">
                      {fmtVolume(stats.lockedReward)}
                    </span>{" "}
                    locked (30-day vest)
                  </>
                )}
              </p>
            </div>
          )}

          {/* Referral link with copy button */}
          <ReferralLink address={address} />
        </>
      )}
    </DashboardCard>
  );
}

import React from "react";

export interface VaultStatsCardProps {
  /** Current Annual Percentage Yield, formatted (e.g., "12.45%") */
  apy: string;
  /** Total assets in the vault, formatted (e.g., "1,250,000 USDC") */
  totalAssets: string;
  /** User's share balance, formatted (e.g., "4,200.00") */
  yourShares: string;
  /** Optional loading state to render the matching skeleton loader */
  isLoading?: boolean;
  /** Optional additional className */
  className?: string;
}

/**
 * Skeleton loader for VaultStatsCard.
 * Mirrors the mobile-first hierarchy (160px height, centred primary APY,
 * 2-column secondary metrics) and desktop 3-column layout to prevent CLS.
 */
export function VaultStatsCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading vault statistics"
      data-testid="vault-stats-card-skeleton"
      className={`h-[160px] sm:h-auto rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-700 dark:bg-zinc-900 ${className}`}
    >
      <div className="flex h-full flex-col justify-between sm:grid sm:grid-cols-3 sm:items-center sm:gap-6">
        {/* Primary metric skeleton (APY) */}
        <div className="flex flex-col items-center justify-center gap-1.5 sm:order-2">
          <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-8 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* Secondary metrics skeleton (Total Assets & Your Shares) */}
        <div className="grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:contents">
          <div className="flex flex-col items-start gap-1.5 sm:order-1">
            <div className="h-3 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-5 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="flex flex-col items-end gap-1.5 sm:order-3 sm:items-start">
            <div className="h-3 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-5 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile-first Vault Stats Card with clear visual hierarchy:
 * - Mobile (< 640px, including < 375px): 160px constrained height,
 *   large centred Current APY, and 2-column Total Assets / Your Shares below.
 * - Desktop (>= 640px): 3-column horizontal layout.
 * - WCAG 2.1 AA compliant contrast on all labels and metric values.
 */
export function VaultStatsCard({
  apy,
  totalAssets,
  yourShares,
  isLoading = false,
  className = "",
}: VaultStatsCardProps) {
  if (isLoading) {
    return <VaultStatsCardSkeleton className={className} />;
  }

  return (
    <section
      aria-label="Vault statistics"
      data-testid="vault-stats-card"
      className={`h-[160px] sm:h-auto rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-700 dark:bg-zinc-900 ${className}`}
    >
      <div className="flex h-full flex-col justify-between sm:grid sm:grid-cols-3 sm:items-center sm:gap-6">
        {/* Primary Metric: Current APY — large and centred on mobile */}
        <div
          data-testid="vault-stat-apy"
          className="flex flex-col items-center justify-center text-center sm:order-2"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            Current APY
          </span>
          <span className="mt-0.5 font-mono text-3xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
            {apy}
          </span>
        </div>

        {/* Secondary Metrics: Total Assets & Your Shares — 2 columns below on mobile */}
        <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 pt-2.5 dark:border-zinc-700 sm:contents sm:border-t-0 sm:pt-0">
          <div
            data-testid="vault-stat-total-assets"
            className="flex min-w-0 flex-col items-start sm:order-1"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              Total Assets
            </span>
            <span className="mt-0.5 w-full truncate font-mono text-base font-semibold text-zinc-900 dark:text-zinc-50 sm:text-xl">
              {totalAssets}
            </span>
          </div>

          <div
            data-testid="vault-stat-your-shares"
            className="flex min-w-0 flex-col items-end text-right sm:order-3 sm:items-start sm:text-left"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              Your Shares
            </span>
            <span className="mt-0.5 w-full truncate font-mono text-base font-semibold text-zinc-900 dark:text-zinc-50 sm:text-xl">
              {yourShares}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default VaultStatsCard;

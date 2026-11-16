"use client";

/**
 * Skeleton loading components (#252)
 *
 * Content-aware skeleton screens for all data-fetching components:
 *   - StatCardSkeleton       — vault stat cards (TVL, APY, shares, price)
 *   - PortfolioPanelSkeleton — user portfolio / position panel
 *   - TxHistoryTableSkeleton — transaction history table
 *   - SharePriceChartSkeleton — share price chart area
 *
 * All skeletons:
 *   ✅ Match the exact layout/dimensions of loaded content (CLS = 0)
 *   ✅ Pulse animation using CSS @keyframes (skeleton-pulse in globals.css)
 *   ✅ aria-busy="true" on outer container while loading
 *   ✅ aria-hidden="true" on individual placeholder elements
 */

// ─── Base Skeleton atom ───────────────────────────────────────────────────────

export interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton atom. Apply size classes from outside.
 * Uses the `.skeleton` class defined in globals.css which provides
 * the shimmer pulse animation and appropriate background colour.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      aria-hidden="true"
      role="presentation"
    />
  );
}

// ─── Stat Card Skeleton ───────────────────────────────────────────────────────

/**
 * Skeleton that exactly mirrors the StatCard layout in VaultDashboard:
 *   label (xs text) → value (2xl mono) → optional sub-label (xs)
 *
 * Used for: TVL, APY, user balance, share price cards.
 */
export function StatCardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading stat card"
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* label row — ~60px wide */}
      <Skeleton className="h-3 w-20 rounded" />
      {/* value row — mimics font-mono text-2xl */}
      <Skeleton className="h-8 w-32 rounded mt-1" />
      {/* optional sub-label */}
      <Skeleton className="h-3 w-16 rounded mt-0.5" />
    </div>
  );
}

// ─── Portfolio Panel Skeleton ─────────────────────────────────────────────────

/**
 * Skeleton that mirrors the UserPositionCard / portfolio panel layout:
 *   - heading row
 *   - two value rows (shares + token equivalent)
 *   - action buttons row
 */
export function PortfolioPanelSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading portfolio panel"
      className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900 space-y-4"
    >
      {/* Heading */}
      <Skeleton className="h-4 w-36 rounded" />

      {/* Shares value block */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-20 rounded" />
        <Skeleton className="h-9 w-48 rounded" />
      </div>

      {/* Token equivalent block */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="h-6 w-36 rounded" />
      </div>

      {/* Action buttons row */}
      <div className="flex gap-3 pt-1">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

// ─── Transaction History Table Skeleton ──────────────────────────────────────

export interface TxHistoryTableSkeletonProps {
  /** Number of skeleton rows to render. Default: 5 */
  rows?: number;
}

/**
 * Skeleton that mirrors the TransactionHistory table layout:
 *   - table header row
 *   - N data rows, each with: icon circle + type/hash cols + amount col
 */
export function TxHistoryTableSkeleton({ rows = 5 }: TxHistoryTableSkeletonProps) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading transaction history"
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 overflow-hidden"
    >
      {/* Table header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <Skeleton className="h-3 w-10 rounded" />
        <Skeleton className="h-3 w-24 rounded ml-8" />
        <Skeleton className="h-3 w-16 rounded ml-auto" />
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <TransactionRowSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Transaction Row Skeleton ─────────────────────────────────────────────────

/**
 * Single skeleton row for a transaction history entry.
 * Mirrors: icon circle | type label + hash | amount
 */
export function TransactionRowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
    >
      {/* Icon circle */}
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />

      {/* Type + timestamp */}
      <div className="flex-1 space-y-1.5 min-w-0">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-3 w-28 rounded" />
      </div>

      {/* Amount */}
      <Skeleton className="h-4 w-20 rounded" />
    </div>
  );
}

// ─── Share Price Chart Skeleton ───────────────────────────────────────────────

export interface SharePriceChartSkeletonProps {
  /** Height in pixels for the chart area. Default: 200 */
  height?: number;
}

/**
 * Skeleton that mirrors the PerformanceCharts / share-price chart layout:
 *   - title row
 *   - chart body (solid area + simulated bars)
 *   - x-axis label row
 */
export function SharePriceChartSkeleton({ height = 200 }: SharePriceChartSkeletonProps) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading share price chart"
      className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900 space-y-4"
    >
      {/* Chart title + period selector */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32 rounded" />
        <div className="flex gap-2">
          {[1, 2, 3].map((k) => (
            <Skeleton key={k} className="h-6 w-10 rounded-full" />
          ))}
        </div>
      </div>

      {/* Chart body — mimics the canvas area */}
      <div
        className="relative overflow-hidden rounded-lg"
        style={{ height }}
        aria-hidden="true"
      >
        <Skeleton className="absolute inset-0 rounded-lg" />

        {/* Simulated bar chart lines for visual fidelity */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end gap-1 px-2 pb-2">
          {[60, 45, 70, 55, 80, 65, 90, 75, 85, 70, 95, 80].map((h, i) => (
            <div
              key={i}
              className="flex-1 skeleton rounded-sm opacity-40"
              style={{ height: `${h}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between">
        {[1, 2, 3, 4, 5].map((k) => (
          <Skeleton key={k} className="h-2.5 w-8 rounded" />
        ))}
      </div>
    </div>
  );
}

// ─── Vault Card Skeleton (pre-existing, kept for compat) ─────────────────────

/** Pre-built skeleton for a vault position card */
export function VaultCardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading vault card"
      className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-8 w-2/3 rounded" />
      <div className="flex gap-2">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
    </div>
  );
}

// ─── Dashboard Loading Skeleton ───────────────────────────────────────────────

/**
 * Full dashboard loading skeleton — composes the above primitives to provide
 * a zero-layout-shift loading state for the entire VaultDashboard view.
 */
export function DashboardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      className="space-y-6"
    >
      {/* Stat cards row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Chart + Portfolio row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SharePriceChartSkeleton height={220} />
        </div>
        <PortfolioPanelSkeleton />
      </div>

      {/* Transaction history */}
      <TxHistoryTableSkeleton rows={5} />
    </div>
  );
}

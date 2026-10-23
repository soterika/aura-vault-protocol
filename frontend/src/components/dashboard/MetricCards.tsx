"use client";

import React from "react";
import { DashboardCard } from "./DashboardCard";
import HelpTooltip from "@/components/HelpTooltip";
import VaultStatSparkline from "./VaultStatSparkline";

/* ─────────────────────────────────────────────
   Shared skeleton / loading placeholder
───────────────────────────────────────────── */
function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-[var(--radius-sm)] bg-[var(--color-surface-overlay)] animate-pulse ${className ?? ""}`}
    />
  );
}

/* ─────────────────────────────────────────────
   APY Card — 7-day annualised yield
───────────────────────────────────────────── */
export interface ApyCardProps {
  /** 7-day APY as a percentage number */
  apy7d: number | null;
  isLoading?: boolean;
}

export function ApyCard({ apy7d, isLoading }: ApyCardProps) {
  const display = apy7d != null ? `${apy7d.toFixed(2)}%` : "—";

  return (
    <DashboardCard
      variant="accent"
      title="7-Day APY"
      subtitle={<span className="inline-flex items-center gap-1">Annualised yield (rolling 7 days)<HelpTooltip helpKey="apy" side="bottom" /></span>}
      data-testid="apy-card"
    >
      {isLoading ? (
        <Skeleton className="h-9 w-28 mt-1" />
      ) : (
        <p
          className="font-[var(--font-mono,monospace)] text-[length:var(--text-3xl)] font-[var(--font-bold)] text-[var(--color-success)]"
          data-testid="apy-value"
          aria-label={`7-day APY: ${display}`}
        >
          {display}
        </p>
      )}
      <VaultStatSparkline metric="apy" label="7-day APY" />
    </DashboardCard>
  );
}

/* ─────────────────────────────────────────────
   DepositorCountCard — total unique depositors
───────────────────────────────────────────── */
export interface DepositorCountCardProps {
  count: number | null;
  isLoading?: boolean;
}

export function DepositorCountCard({ count, isLoading }: DepositorCountCardProps) {
  const display = count != null ? count.toLocaleString() : "—";

  return (
    <DashboardCard
      variant="accent"
      title="Depositors"
      subtitle="Unique vault participants"
      data-testid="depositor-count-card"
    >
      {isLoading ? (
        <Skeleton className="h-9 w-24 mt-1" />
      ) : (
        <p
          className="font-[var(--font-mono,monospace)] text-[length:var(--text-3xl)] font-[var(--font-bold)] text-[var(--color-text)]"
          data-testid="depositor-count-value"
          aria-label={`Total depositors: ${display}`}
        >
          {display}
        </p>
      )}
    </DashboardCard>
  );
}

/* ─────────────────────────────────────────────
   LastHarvestCard — timestamp of most recent harvest
───────────────────────────────────────────── */
export interface LastHarvestCardProps {
  /** Unix timestamp (ms) of the last harvest, or null if never */
  lastHarvestAt: number | null;
  /** Yield amount from the last harvest */
  lastHarvestAmount?: string | null;
  isLoading?: boolean;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function LastHarvestCard({
  lastHarvestAt,
  lastHarvestAmount,
  isLoading,
}: LastHarvestCardProps) {
  const relTime = lastHarvestAt != null ? formatRelativeTime(lastHarvestAt) : "Never";
  const absTime =
    lastHarvestAt != null
      ? new Date(lastHarvestAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <DashboardCard
      variant="accent"
      title="Last Harvest"
      subtitle={<span className="inline-flex items-center gap-1">Most recent keeper harvest<HelpTooltip helpKey="harvest" side="bottom" /></span>}
      data-testid="last-harvest-card"
    >
      {isLoading ? (
        <Skeleton className="h-9 w-28 mt-1" />
      ) : (
        <>
          <p
            className="font-[var(--font-mono,monospace)] text-[length:var(--text-2xl)] font-[var(--font-semibold)] text-[var(--color-text)]"
            data-testid="last-harvest-relative"
            title={absTime ?? undefined}
            aria-label={`Last harvest: ${relTime}${absTime ? `, on ${absTime}` : ""}`}
          >
            {relTime}
          </p>
          {lastHarvestAmount && (
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]" data-testid="last-harvest-amount">
              {lastHarvestAmount} injected
            </p>
          )}
          {absTime && (
            <p className="text-[length:var(--text-xs)] text-[var(--color-text-disabled)]">
              {absTime}
            </p>
          )}
        </>
      )}
    </DashboardCard>
  );
}

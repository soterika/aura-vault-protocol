"use client";

import React from "react";
import { DashboardCard } from "./DashboardCard";
import VaultStatSparkline from "./VaultStatSparkline";

export interface HeroCardProps {
  /** Total value locked in the vault, formatted string e.g. "$1,234,567.89" */
  tvl: string;
  /** Current share price formatted string e.g. "1.0842" */
  sharePrice: string;
  /** 24-hour TVL change as a percentage, positive or negative */
  tvlChange24h?: number;
  /** Whether data is still loading */
  isLoading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block rounded-[var(--radius-sm)] bg-[var(--color-surface-overlay)] animate-pulse ${className ?? ""}`}
    />
  );
}

/**
 * HeroCard — the primary focal point of the dashboard.
 * Displays vault TVL and share price with prominent typography.
 */
export function HeroCard({ tvl, sharePrice, tvlChange24h, isLoading }: HeroCardProps) {
  const changePositive = (tvlChange24h ?? 0) >= 0;
  const changeColor = changePositive
    ? "text-[var(--color-success)]"
    : "text-[var(--color-error)]";
  const changePrefix = changePositive ? "+" : "";

  return (
    <DashboardCard
      variant="hero"
      title="Aura Vault"
      subtitle="Share-based yield vault on Stellar"
      data-testid="hero-card"
      className="col-span-2"
    >
      {/* TVL — primary metric */}
      <section aria-label="Total Value Locked">
        <p className="text-[length:var(--text-xs)] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
          Total Value Locked
        </p>
        {isLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : (
          <p
            className="font-[var(--font-mono,monospace)] text-[length:var(--text-4xl)] font-[var(--font-bold)] leading-[var(--leading-tight)] text-[var(--color-text)]"
            data-testid="hero-tvl"
          >
            {tvl}
          </p>
        )}
        <VaultStatSparkline metric="tvl" label="Total value locked" />
        {!isLoading && tvlChange24h !== undefined && (
          <p className={`text-[length:var(--text-sm)] mt-1 ${changeColor}`} aria-label={`TVL change in last 24 hours: ${changePrefix}${tvlChange24h.toFixed(2)}%`}>
            {changePrefix}{tvlChange24h.toFixed(2)}% (24 h)
          </p>
        )}
      </section>

      {/* Divider */}
      <hr className="border-[var(--color-border)] my-2" />

      {/* Share price — secondary prominent metric */}
      <section aria-label="Share price">
        <p className="text-[length:var(--text-xs)] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
          Share Price
        </p>
        {isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <p
            className="font-[var(--font-mono,monospace)] text-[length:var(--text-3xl)] font-[var(--font-semibold)] text-[var(--color-primary)]"
            data-testid="hero-share-price"
          >
            {sharePrice}
          </p>
        )}
        <VaultStatSparkline metric="share-price" label="Share price" />
        <p className="text-[length:var(--text-xs)] text-[var(--color-text-disabled)] mt-0.5">
          per vault share
        </p>
      </section>
    </DashboardCard>
  );
}

"use client";

import React from "react";
import { DashboardCard } from "./DashboardCard";
import { ShareBalanceDisplay } from "@/components/ShareBalanceDisplay";
import { ExplorerMenu } from "@/components/ExplorerMenu";
import HelpTooltip from "@/components/HelpTooltip";
import { WalletAliasDisplay } from "@/components/WalletAliasDisplay";

export interface UserPosition {
  /** Underlying token balance redeemable by this user */
  underlyingBalance: string;
  /** Share token balance held by this user */
  shares: string;
  /** Current share price used to price the position */
  sharePrice: string;
  /** Wallet address (truncated display) */
  address: string;
  /** Unix timestamp (ms) when share price was last fetched */
  sharePriceUpdatedAt?: number;
}

export interface UserPositionCardProps {
  /** Pass null / undefined when wallet is not connected — card renders nothing */
  position: UserPosition | null | undefined;
  isLoading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-[var(--radius-sm)] bg-[var(--color-surface-overlay)] animate-pulse ${className ?? ""}`}
    />
  );
}

function Row({ label, value, testId }: { label: React.ReactNode; value: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[length:var(--text-sm)] text-[var(--color-text-muted)] shrink-0">{label}</dt>
      <dd
        className="font-[var(--font-mono,monospace)] text-[length:var(--text-sm)] font-[var(--font-semibold)] text-[var(--color-text)] text-right"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * UserPositionCard — only visible when a wallet is connected.
 *
 * When `position` is null/undefined the component returns null so it takes
 * up no space in the grid at all, keeping the layout clean for
 * disconnected visitors.
 */
export function UserPositionCard({ position, isLoading }: UserPositionCardProps) {
  // Wallet not connected — render nothing (satisfies AC: card only visible when connected)
  if (!isLoading && !position) return null;

  return (
    <DashboardCard
      variant="default"
      title="Your Position"
      subtitle={
        position?.address ? (
          <span className="inline-flex items-center gap-2">
            <WalletAliasDisplay address={position.address} />
            <ExplorerMenu value={position.address} type="account" className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]" />
          </span>
        ) : undefined
      }
      data-testid="user-position-card"
      className="col-span-2"
    >
      {isLoading ? (
        <div className="flex flex-col gap-3 mt-1" aria-busy="true" aria-label="Loading your position">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : (
        <dl className="flex flex-col gap-3 mt-1">
          <Row
            label="Underlying balance"
            value={position!.underlyingBalance}
            testId="position-underlying"
          />
          <hr className="border-[var(--color-border)]" />
          <Row
            label={<span className="inline-flex items-center gap-1">Vault shares held<HelpTooltip helpKey="vaultShares" side="left" /></span>}
            value={
              <ShareBalanceDisplay
                shares={position!.shares}
                sharePrice={position!.sharePrice}
                sharePriceUpdatedAt={position!.sharePriceUpdatedAt}
                variant="compact"
              />
            }
            testId="position-shares"
          />
          <Row
            label={<span className="inline-flex items-center gap-1">At share price<HelpTooltip helpKey="exchangeRate" side="left" /></span>}
            value={position!.sharePrice}
            testId="position-share-price"
          />
        </dl>
      )}
    </DashboardCard>
  );
}

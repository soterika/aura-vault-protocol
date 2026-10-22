"use client";

import React, { useEffect, useMemo, useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { ShareBalanceDisplay } from "@/components/ShareBalanceDisplay";
import { ExplorerMenu } from "@/components/ExplorerMenu";
import { useContractEvents } from "@/lib/useContractEvents";

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
  /** Current annualised APY as a decimal (for example, 0.08 for 8%). */
  apy7d?: number | null;
  lastHarvestAt?: string | number | null;
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

function Row({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
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
  const [accrued, setAccrued] = useState(0);
  const { lastEvent } = useContractEvents({ walletAddress: position?.address });
  const positionValue = useMemo(() => {
    const value = Number(position?.underlyingBalance.replace(/[^\d.-]/g, ""));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [position?.underlyingBalance]);
  const apy = position?.apy7d;
  const perSecond = typeof apy === "number" && Number.isFinite(apy) && apy >= 0
    ? positionValue * apy / (365.25 * 24 * 60 * 60)
    : 0;

  useEffect(() => {
    if (lastEvent?.type === "harvest") setAccrued(0);
  }, [lastEvent]);

  useEffect(() => {
    if (!position?.lastHarvestAt) return;
    const harvestedAt = typeof position.lastHarvestAt === "number"
      ? position.lastHarvestAt
      : new Date(position.lastHarvestAt).getTime();
    if (Number.isFinite(harvestedAt)) {
      setAccrued(Math.max(0, Date.now() - harvestedAt) / 1000 * perSecond);
    }
  }, [position?.lastHarvestAt, perSecond]);

  useEffect(() => {
    if (!position || perSecond <= 0) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const updateTimer = () => {
      if (document.visibilityState === "visible") {
        if (!timer) timer = window.setInterval(() => setAccrued((amount) => amount + perSecond), 1000);
      } else if (timer) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    updateTimer();
    document.addEventListener("visibilitychange", updateTimer);
    return () => {
      document.removeEventListener("visibilitychange", updateTimer);
      if (timer) window.clearInterval(timer);
    };
  }, [position, perSecond]);

  // Wallet not connected — render nothing (satisfies AC: card only visible when connected)
  if (!isLoading && !position) return null;

  return (
    <DashboardCard
      variant="default"
      title="Your Position"
      subtitle={
        position?.address ? (
          <ExplorerMenu
            value={position.address}
            type="account"
            className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          />
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
            label="Vault shares held"
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
            label="At share price"
            value={position!.sharePrice}
            testId="position-share-price"
          />
          {positionValue > 0 && typeof apy === "number" && Number.isFinite(apy) && apy >= 0 && (
            <p className="text-xs text-[var(--color-text-muted)]" aria-live="off" data-testid="yield-accrual-counter">
              Estimated yield: +{accrued.toFixed(6)} USDC accrued ({perSecond.toFixed(6)} USDC/sec at current APY)
            </p>
          )}
        </dl>
      )}
    </DashboardCard>
  );
}

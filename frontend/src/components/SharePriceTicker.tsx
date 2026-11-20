"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TickerDirection = "up" | "down" | "unchanged";

export interface SharePriceTickerProps {
  /** Total underlying assets in the vault */
  totalAssets?: number | string;
  /** Total vault shares */
  totalShares?: number | string;
  /** Optional 24h percentage change (e.g. 1.25 for +1.25%, -0.42 for -0.42%) */
  change24h?: number | null;
  /** Optional token symbol suffix (e.g. "USDC") */
  tokenSymbol?: string;
  /** Optional explicit direction override (useful for Storybook/testing) */
  directionOverride?: TickerDirection;
  /** Enable SSE subscription to /api/v1/events/stream for live updates */
  enableSse?: boolean;
  /** Base URL for the SSE endpoint */
  apiBaseUrl?: string;
  /** Optional callback invoked when an SSE vault event updates the ticker */
  onSseUpdate?: (nextPrice: number) => void;
  className?: string;
}

const ANIMATION_DURATION_MS = 2000;

export function calculateSharePrice(
  totalAssets?: number | string,
  totalShares?: number | string,
): number {
  const assets = Number(totalAssets ?? 0);
  const shares = Number(totalShares ?? 0);
  if (!Number.isFinite(assets) || !Number.isFinite(shares) || shares <= 0) {
    return 1;
  }
  return assets / shares;
}

function getDirectionLabel(direction: TickerDirection): string {
  switch (direction) {
    case "up":
      return "Share price increased";
    case "down":
      return "Share price decreased";
    default:
      return "Share price unchanged";
  }
}

export function SharePriceTicker({
  totalAssets,
  totalShares,
  change24h = 0,
  tokenSymbol,
  directionOverride,
  enableSse = false,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  onSseUpdate,
  className = "",
}: SharePriceTickerProps) {
  const computedPrice = useMemo(
    () => calculateSharePrice(totalAssets, totalShares),
    [totalAssets, totalShares],
  );

  const [livePrice, setLivePrice] = useState<number>(computedPrice);
  const [direction, setDirection] = useState<TickerDirection>(
    directionOverride ?? "unchanged",
  );
  const [isAnimating, setIsAnimating] = useState<boolean>(
    Boolean(directionOverride && directionOverride !== "unchanged"),
  );

  const prevPriceRef = useRef<number>(computedPrice);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDirection = (nextPrice: number) => {
    const prev = prevPriceRef.current;
    if (nextPrice > prev) {
      setDirection("up");
      setIsAnimating(true);
    } else if (nextPrice < prev) {
      setDirection("down");
      setIsAnimating(true);
    } else {
      setDirection("unchanged");
      setIsAnimating(false);
    }
    prevPriceRef.current = nextPrice;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (nextPrice !== prev) {
      timerRef.current = setTimeout(() => {
        setIsAnimating(false);
      }, ANIMATION_DURATION_MS);
    }
  };

  useEffect(() => {
    if (directionOverride) {
      setDirection(directionOverride);
      setIsAnimating(directionOverride !== "unchanged");
      if (directionOverride !== "unchanged") {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setIsAnimating(false);
        }, ANIMATION_DURATION_MS);
      }
      return;
    }

    setLivePrice(computedPrice);
    triggerDirection(computedPrice);
  }, [computedPrice, directionOverride]);

  useEffect(() => {
    if (!enableSse || typeof EventSource === "undefined") return;

    const es = new EventSource(`${apiBaseUrl}/api/v1/events/stream`);

    const handleEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          total_assets?: number | string;
          total_shares?: number | string;
          share_price?: number | string;
        };

        let nextPrice: number | null = null;
        if (payload.share_price !== undefined) {
          const parsed = Number(payload.share_price);
          if (Number.isFinite(parsed) && parsed > 0) nextPrice = parsed;
        } else if (
          payload.total_assets !== undefined &&
          payload.total_shares !== undefined
        ) {
          nextPrice = calculateSharePrice(
            payload.total_assets,
            payload.total_shares,
          );
        }

        if (nextPrice !== null) {
          setLivePrice(nextPrice);
          triggerDirection(nextPrice);
          onSseUpdate?.(nextPrice);
        }
      } catch {
        // Ignore non-JSON heartbeat/keepalive payloads
      }
    };

    es.addEventListener("deposit", handleEvent as EventListener);
    es.addEventListener("withdraw", handleEvent as EventListener);
    es.addEventListener("harvest", handleEvent as EventListener);

    return () => {
      es.close();
    };
  }, [enableSse, apiBaseUrl, onSseUpdate]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const activeDirection = directionOverride ?? direction;
  const formattedPrice = livePrice.toFixed(6);
  const formattedChange =
    change24h !== null && change24h !== undefined
      ? `${change24h > 0 ? "+" : ""}${change24h.toFixed(2)}%`
      : "0.00%";

  const directionColorClass =
    activeDirection === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : activeDirection === "down"
        ? "text-rose-600 dark:text-rose-400"
        : "text-zinc-500 dark:text-zinc-400";

  const animationClass = isAnimating
    ? activeDirection === "up"
      ? "animate-bounce"
      : activeDirection === "down"
        ? "animate-pulse"
        : ""
    : "";

  const arrowSymbol =
    activeDirection === "up" ? "↑" : activeDirection === "down" ? "↓" : "—";

  return (
    <div
      className={`inline-flex items-center gap-2 font-mono text-sm ${className}`.trim()}
      data-testid="share-price-ticker"
      data-direction={activeDirection}
      data-animating={isAnimating ? "true" : "false"}
    >
      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
        {formattedPrice}
        {tokenSymbol ? ` ${tokenSymbol}` : ""}
      </span>

      <span
        className={`inline-flex items-center gap-1 transition-colors duration-300 ${directionColorClass} ${animationClass}`.trim()}
      >
        <span aria-hidden="true">{arrowSymbol}</span>
        <span className="sr-only">{getDirectionLabel(activeDirection)}</span>
        <span className="text-xs font-medium">{formattedChange} (24h)</span>
      </span>
    </div>
  );
}

export default SharePriceTicker;

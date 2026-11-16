"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, Bell } from "lucide-react";
import SharePriceAlertModal from "./SharePriceAlertModal";

const POLL_INTERVAL_MS = 30_000;

interface PriceData {
  price: number;
  change24h: number;
  symbol: string;
}

interface PriceApiResponse {
  price: string | number;
  change24h?: string | number;
  symbol?: string;
}

function isPriceApiResponse(v: unknown): v is PriceApiResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return "price" in r && (typeof r.price === "string" || typeof r.price === "number");
}

function formatPrice(price: number): string {
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function formatChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

export function SharePriceTicker() {
  const [data, setData] = useState<PriceData | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/price");
      if (!res.ok) return;
      const raw: unknown = await res.json();
      if (!isPriceApiResponse(raw)) return;

      const newPrice =
        typeof raw.price === "string" ? parseFloat(raw.price) : raw.price;
      const change24h =
        raw.change24h !== undefined
          ? typeof raw.change24h === "string"
            ? parseFloat(raw.change24h)
            : raw.change24h
          : 0;
      const symbol = raw.symbol ?? "USDC";

      setData((prev) => {
        if (prev && prev.price !== newPrice) {
          setPrevPrice(prev.price);
          setAnimating(true);
          setTimeout(() => setAnimating(false), 600);
        }
        return { price: newPrice, change24h, symbol };
      });
    } catch {
      // silently keep showing stale data on network errors
    }
  }, []);

  useEffect(() => {
    const wsUrl =
      typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_URL ??
          `ws://${window.location.host}/api/ws/vault`)
        : null;

    let wsConnected = false;

    if (wsUrl) {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => { wsConnected = true; };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data as string) as Record<string, unknown>;
            if (msg.type === "price_update" || msg.type === "vault_update") {
              const newPrice =
                typeof msg.price === "string"
                  ? parseFloat(msg.price)
                  : typeof msg.price === "number"
                  ? msg.price
                  : null;
              if (newPrice === null) return;
              const change24h =
                typeof msg.change24h === "string"
                  ? parseFloat(msg.change24h)
                  : typeof msg.change24h === "number"
                  ? msg.change24h
                  : 0;
              const symbol =
                typeof msg.symbol === "string" ? msg.symbol : "USDC";
              setData((prev) => {
                if (prev && prev.price !== newPrice) {
                  setPrevPrice(prev.price);
                  setAnimating(true);
                  setTimeout(() => setAnimating(false), 600);
                }
                return { price: newPrice, change24h, symbol };
              });
            }
          } catch {
            // ignore malformed messages
          }
        };

        ws.onclose = () => { wsConnected = false; };
      } catch {
        wsConnected = false;
      }
    }

    // Always poll as backup (WebSocket may not be available in all environments)
    void fetchPrice();
    pollTimerRef.current = setInterval(() => {
      if (!wsConnected) void fetchPrice();
    }, POLL_INTERVAL_MS);

    return () => {
      wsRef.current?.close();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchPrice]);

  // Loading skeleton
  if (!data) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading share price"
        className="flex items-center gap-1.5 h-5 w-36 rounded animate-pulse bg-zinc-200 dark:bg-zinc-700"
      />
    );
  }

  const direction: "up" | "down" | "flat" =
    data.change24h > 0 ? "up" : data.change24h < 0 ? "down" : "flat";

  const colorClass =
    direction === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : direction === "down"
      ? "text-red-500 dark:text-red-400"
      : "text-zinc-500 dark:text-zinc-400";

  const ArrowIcon =
    direction === "up"
      ? TrendingUp
      : direction === "down"
      ? TrendingDown
      : Minus;

  const priceWentUp = prevPrice !== null && data.price > prevPrice;
  const priceWentDown = prevPrice !== null && data.price < prevPrice;
  const animClass = animating
    ? priceWentUp
      ? "text-emerald-500 dark:text-emerald-400"
      : priceWentDown
      ? "text-red-500 dark:text-red-400"
      : ""
    : "";

  return (
    <div className="relative flex items-center gap-1.5">
      {tooltipVisible && (
        <div
          role="tooltip"
          id="share-price-tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-100 dark:text-zinc-900 shadow-lg z-50 pointer-events-none"
        >
          24h change: {formatChange(data.change24h)}
          {prevPrice !== null && (
            <span className="ml-2 opacity-60">
              (was {formatPrice(prevPrice)})
            </span>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-100" />
        </div>
      )}

      <button
        aria-label={`Share price: ${formatPrice(data.price)} ${data.symbol}. 24h change: ${formatChange(data.change24h)}`}
        aria-describedby="share-price-tooltip"
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        className="flex items-center gap-1.5 text-sm font-medium cursor-default focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
      >
        <span className="text-zinc-500 dark:text-zinc-400 text-xs">
          Share Price:
        </span>
        <span
          className={`font-mono font-semibold text-zinc-900 dark:text-zinc-50 transition-colors duration-500 ${animClass}`}
        >
          {formatPrice(data.price)} {data.symbol}
        </span>
        <span className={`flex items-center gap-0.5 text-xs font-semibold ${colorClass}`}>
          <ArrowIcon size={12} aria-hidden="true" />
          {formatChange(data.change24h)}
        </span>
      </button>

      <button
        type="button"
        onClick={() => setAlertModalOpen(true)}
        aria-label="Set share price alerts"
        title="Set share price alerts"
        className="p-1 rounded text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <Bell size={14} aria-hidden="true" />
      </button>

      <SharePriceAlertModal
        isOpen={alertModalOpen}
        onClose={() => setAlertModalOpen(false)}
        currentPrice={data.price}
      />
    </div>
  );
}

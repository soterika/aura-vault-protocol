"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Wallet } from "lucide-react";

const REFRESH_INTERVAL_MS = 30_000;

interface BalanceData {
  balance: number;
  symbol: string;
}

interface BalanceApiResponse {
  balance: string | number;
  symbol?: string;
}

function isBalanceApiResponse(v: unknown): v is BalanceApiResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    "balance" in r &&
    (typeof r.balance === "string" || typeof r.balance === "number")
  );
}

function formatBalance(balance: number): string {
  return balance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface WalletBalanceDisplayProps {
  /** Connected wallet address. Renders nothing when null/undefined. */
  address: string | null | undefined;
  /** Called when the user clicks the balance — should open the portfolio panel */
  onOpenPortfolio?: () => void;
}

export function WalletBalanceDisplay({
  address,
  onOpenPortfolio,
}: WalletBalanceDisplayProps) {
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/vault/balance_of?address=${encodeURIComponent(address)}`
      );
      if (!res.ok) throw new Error("fetch failed");
      const raw: unknown = await res.json();
      if (!isBalanceApiResponse(raw)) throw new Error("unexpected shape");

      const balance =
        typeof raw.balance === "string"
          ? parseFloat(raw.balance)
          : raw.balance;
      const symbol = raw.symbol ?? "USDC";

      if (mountedRef.current) setData({ balance, symbol });
    } catch {
      if (mountedRef.current) setError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    mountedRef.current = true;
    if (!address) {
      setData(null);
      return;
    }
    void fetchBalance();
    timerRef.current = setInterval(() => void fetchBalance(), REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [address, fetchBalance]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!address) return null;

  // Loading skeleton — shown on initial load before data arrives
  if (loading && !data) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading wallet balance"
        className="flex items-center gap-1.5 h-5 w-28 rounded animate-pulse bg-zinc-200 dark:bg-zinc-700"
      />
    );
  }

  if (error && !data) {
    return (
      <span
        className="text-xs text-red-500 dark:text-red-400"
        aria-label="Balance unavailable"
      >
        Balance unavailable
      </span>
    );
  }

  if (!data) return null;

  const label = `Your balance: ${formatBalance(data.balance)} ${data.symbol}. Click to open portfolio.`;

  return (
    <button
      onClick={onOpenPortfolio}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
    >
      <Wallet size={14} aria-hidden="true" className="text-zinc-400 shrink-0" />
      <span className="font-mono">
        {/* Show inline skeleton while refreshing without losing layout */}
        {loading ? (
          <span
            aria-hidden="true"
            className="inline-block h-3 w-16 rounded animate-pulse bg-zinc-200 dark:bg-zinc-700 align-middle"
          />
        ) : (
          <>
            {formatBalance(data.balance)}{" "}
            <span className="text-zinc-400 dark:text-zinc-500">{data.symbol}</span>
          </>
        )}
      </span>
    </button>
  );
}

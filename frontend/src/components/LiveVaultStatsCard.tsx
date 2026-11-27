"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeVaultStats, type PublicVaultStats } from "@/lib/vaultStatsServer";

export interface LiveVaultStatsCardProps {
  initialStats: PublicVaultStats;
  apiBaseUrl?: string;
}

const STREAM_EVENT_TYPES = ["deposit", "withdraw", "harvest", "vault_updated", "stats"];

export function LiveVaultStatsCard({
  initialStats,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
}: LiveVaultStatsCardProps) {
  const [stats, setStats] = useState<PublicVaultStats>(initialStats);
  const [isLive, setIsLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/vault/stats`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown>;
      setStats(normalizeVaultStats(json));
    } catch {
      // Keep last known stats on transient network error
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    let isCancelled = false;

    function connect() {
      if (isCancelled) return;

      const es = new EventSource(`${apiBaseUrl}/api/v1/events/stream`);
      esRef.current = es;

      es.onopen = () => {
        if (!isCancelled) setIsLive(true);
      };

      const handleVaultEvent = () => {
        void refreshStats();
      };

      for (const eventType of STREAM_EVENT_TYPES) {
        es.addEventListener(eventType, handleVaultEvent);
      }
      es.onmessage = handleVaultEvent;

      es.onerror = () => {
        if (isCancelled) return;
        setIsLive(false);
        es.close();
        reconnectTimerRef.current = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      esRef.current?.close();
    };
  }, [apiBaseUrl, refreshStats]);

  return (
    <section
      aria-labelledby="vault-stats-heading"
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2
            id="vault-stats-heading"
            className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {stats.vaultName} Statistics
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Public on-chain vault metrics with live SSE updates
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isLive ? "bg-emerald-500" : "bg-zinc-400"
            }`}
            aria-hidden="true"
          />
          {isLive ? "Live" : "Cached"}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Current APY
          </dt>
          <dd
            data-testid="vault-stat-apy"
            className="mt-1 font-mono text-2xl font-semibold text-emerald-600 dark:text-emerald-400"
          >
            {stats.apy}
          </dd>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Total Value Locked
          </dt>
          <dd
            data-testid="vault-stat-tvl"
            className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {stats.tvl}
          </dd>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Share Price
          </dt>
          <dd
            data-testid="vault-stat-share-price"
            className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {stats.sharePrice}
          </dd>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Total Depositors
          </dt>
          <dd
            data-testid="vault-stat-depositors"
            className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {stats.totalDepositors}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default LiveVaultStatsCard;

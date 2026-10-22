"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { HeroCard } from "./HeroCard";
import { ApyCard, DepositorCountCard, LastHarvestCard } from "./MetricCards";
import { UserPositionCard, type UserPosition } from "./UserPositionCard";
import SharePriceChart from "@/components/SharePriceChart";

/* ─────────────────────────────────────────────
   Data shapes
───────────────────────────────────────────── */
interface VaultStats {
  tvl: string;
  tvlChange24h: number;
  sharePrice: string;
  apy7d: number | null;
  depositorCount: number | null;
  lastHarvestAt: number | null;
  lastHarvestAmount: string | null;
}

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function fmtUsd(raw: string | number): string {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtSharePrice(raw: string | number): string {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n)) return "—";
  return n.toFixed(6);
}

/* ─────────────────────────────────────────────
   DashboardGrid
───────────────────────────────────────────── */
/**
 * Responsive dashboard grid layout.
 *
 * Breakpoints:
 *   mobile  (< 768 px)  — 1 column
 *   tablet  (≥ 768 px)  — 2 columns
 *   desktop (≥ 1024 px) — 2 columns (identical to tablet per AC)
 *
 * Grid slots:
 *   [HeroCard        ][HeroCard       ]  ← spans 2 cols
 *   [ApyCard         ][DepositorCard  ]
 *   [LastHarvestCard ][—              ]
 *   [UserPositionCard][UserPositionCard] ← spans 2 cols, hidden when disconnected
 */
export function DashboardGrid() {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMsg, setLiveMsg] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  /* ── Data fetching ── */
  const fetchStats = useCallback(async () => {
    try {
      const [assetsRes, apyRes, metricsRes] = await Promise.allSettled([
        fetch("/api/vault/total_assets"),
        fetch("/api/vault/apy"),
        fetch("/api/vault/metrics"),
      ]);

      const assets =
        assetsRes.status === "fulfilled" && assetsRes.value.ok
          ? await assetsRes.value.json()
          : {};
      const apyData =
        apyRes.status === "fulfilled" && apyRes.value.ok
          ? await apyRes.value.json()
          : {};
      const metrics =
        metricsRes.status === "fulfilled" && metricsRes.value.ok
          ? await metricsRes.value.json()
          : {};

      setStats({
        tvl: fmtUsd(assets.total ?? metrics.tvl ?? "0"),
        tvlChange24h: metrics.tvlChange24h ?? 0,
        sharePrice: fmtSharePrice(assets.pricePerShare ?? "1"),
        apy7d: parseFloat(apyData.apy7d ?? apyData.apy ?? "0") || null,
        depositorCount: metrics.totalUsers ?? metrics.depositorCount ?? null,
        lastHarvestAt: metrics.lastHarvestAt ?? null,
        lastHarvestAmount: metrics.lastHarvestAmount ?? null,
      });

      // If the API returns wallet-specific position data (requires auth header)
      if (assets.userBalance && assets.userShares) {
        setPosition({
          underlyingBalance: `${parseFloat(assets.userBalance).toLocaleString()} USDC`,
          shares: parseFloat(assets.userShares).toLocaleString(),
          sharePrice: fmtSharePrice(assets.pricePerShare ?? "1"),
          address: assets.walletAddress ?? "",
          apy7d: parseFloat(apyData.apy7d ?? apyData.apy ?? "0") || 0,
          lastHarvestAt: metrics.lastHarvestAt ?? null,
        });
      }
    } catch {
      // Fail silently — cards show "—" fallback text
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── WebSocket for live vault_update events ── */
  useEffect(() => {
    const wsUrl =
      typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_URL ??
          `ws://${window.location.host}/api/ws/vault`)
        : null;
    if (!wsUrl) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl!);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === "vault_update") {
            setStats((prev) =>
              prev
                ? {
                    ...prev,
                    tvl: msg.tvl ? fmtUsd(msg.tvl) : prev.tvl,
                    sharePrice: msg.pricePerShare
                      ? fmtSharePrice(msg.pricePerShare)
                      : prev.sharePrice,
                    apy7d: msg.apy7d ?? prev.apy7d,
                  }
                : prev
            );
            setLiveMsg("Vault data updated");
            setTimeout(() => setLiveMsg(""), 3000);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  /* ── Initial load ── */
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  /* ─────────────────────────────────────────────
     Render
  ───────────────────────────────────────────── */
  return (
    <main
      className="w-full max-w-4xl mx-auto px-4 py-8"
      aria-label="Vault dashboard"
    >
      {/* Screen-reader live region for real-time updates */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMsg}
      </div>

      {/* Page heading */}
      <div className="mb-8">
        <h1
          className="text-[length:var(--text-2xl)] font-[var(--font-semibold)] tracking-tight text-[var(--color-text)]"
        >
          Dashboard
        </h1>
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)] mt-1">
          Real-time overview of the Aura yield vault.
        </p>
      </div>

      {/*
        Responsive grid:
          mobile  → 1 column   (grid-cols-1)
          ≥768px  → 2 columns  (md:grid-cols-2)
      */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-5"
        role="region"
        aria-label="Vault metrics"
      >
        {/* ① Hero card — spans full width on all breakpoints */}
        <HeroCard
          tvl={stats?.tvl ?? "—"}
          sharePrice={stats?.sharePrice ?? "—"}
          tvlChange24h={stats?.tvlChange24h}
          isLoading={loading}
        />

        {/* ② 7-day APY */}
        <ApyCard apy7d={stats?.apy7d ?? null} isLoading={loading} />

        {/* ③ Depositor count */}
        <DepositorCountCard
          count={stats?.depositorCount ?? null}
          isLoading={loading}
        />

        {/* ④ Last harvest */}
        <LastHarvestCard
          lastHarvestAt={stats?.lastHarvestAt ?? null}
          lastHarvestAmount={stats?.lastHarvestAmount ?? null}
          isLoading={loading}
        />

        {/* ⑤ User position — only rendered when wallet connected */}
        <UserPositionCard position={position} isLoading={loading} />
      </div>

      {/* ⑥ Share Price Chart — spans full width */}
      <div className="mt-5">
        <SharePriceChart />
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WalletConnect from "./WalletConnect";
import VaultActions from "./VaultActions";
import { useOnboarding } from "@/components/OnboardingChecklist";
import { FinancialValue } from "./FinancialValue";
import { EmptyState } from "./EmptyState";
import { AnimatedShareBalance } from "./AnimatedShareBalance";
import { useAnimatedNumber } from "@/lib/useAnimatedNumber";

interface VaultStats {
  tvl: string;
  apy: string;
  userBalance: string;
  userShares: string;
  pricePerShare: string;
  sharePriceUpdatedAt?: number;
}

interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "harvest";
  amount: string;
  timestamp: number;
  hash: string;
}

function StatCard({
  label,
  value,
  rawValue,
  decimals,
  suffix,
  sub,
  testId,
}: {
  label: string;
  value: string;
  rawValue?: number;
  decimals?: number;
  suffix?: string;
  sub?: string;
  testId?: string;
}) {
  const animatedValue = useAnimatedNumber(rawValue ?? 0, { decimals });
  const displayValue = rawValue !== undefined
    ? `${animatedValue}${suffix ?? ""}`
    : value;

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {displayValue}
      </span>
      {sub && <span className="text-xs text-zinc-400">{sub}</span>}
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const sentimentMap = {
    deposit: "positive" as const,
    withdraw: "negative" as const,
    harvest: "warning" as const,
  };
  const iconMap = {
    deposit: "↓",
    withdraw: "↑",
    harvest: "⚡",
  };

  return (
    <div className="flex items-center justify-between border-b border-zinc-100 py-2.5 last:border-0 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <span aria-hidden="true">
          <FinancialValue
            value={iconMap[tx.type]}
            sentiment={sentimentMap[tx.type]}
            className="text-lg"
          />
        </span>

        <div>
          <p className="text-sm font-medium capitalize text-zinc-800 dark:text-zinc-200">
            {tx.type}
          </p>

          <p className="font-mono text-xs text-zinc-400">
  {tx.timestamp}
</p>
        </div>
      </div>

      <div className="text-right">
        <p className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {tx.amount}
        </p>

        <a
          href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label={`View transaction ${tx.hash} on explorer`}
        >
          {tx.hash.slice(0, 8)}…
        </a>
      </div>
    </div>
  );
}

const MOCK_TXS: Transaction[] = [
  {
    id: "1",
    type: "deposit",
    amount: "500 USDC",
    timestamp: 1787688610304,
    hash: "abc123def456",
  },
  {
    id: "2",
    type: "harvest",
    amount: "12.5 USDC",
    timestamp: 1787685010304,
    hash: "fff999aaa111",
  },
  {
    id: "3",
    type: "withdraw",
    amount: "100 USDC",
    timestamp: 1787602210304,
    hash: "dead1234beef",
  },
];

export default function VaultDashboard() {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [txs] = useState<Transaction[]>(MOCK_TXS);
  const [loading, setLoading] = useState(true);
  const [liveMsg, setLiveMsg] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const { markComplete } = useOnboarding();

  // Mark "view_dashboard" milestone when dashboard is first viewed
  useEffect(() => {
    markComplete("view_dashboard");
  }, [markComplete]);

  const fetchStats = useCallback(async () => {
    try {
      const [assetsRes, apyRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/total_assets`),
fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/apy`),
      ]);

      const assets = assetsRes.ok
        ? await assetsRes.json()
        : { total: "0" };

      const apyData = apyRes.ok
        ? await apyRes.json()
        : { apy: "0" };

      setStats({
        tvl: assets.total ?? "0",
        apy: apyData.apy ?? "0",
        userBalance: assets.userBalance ?? "—",
        userShares: assets.userShares ?? "—",
        pricePerShare: assets.pricePerShare ?? "1.0000",
        sharePriceUpdatedAt: Date.now(),
      });
    } catch {
      setStats({
        tvl: "—",
        apy: "—",
        userBalance: "—",
        userShares: "—",
        pricePerShare: "—",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

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
                    tvl: msg.tvl ?? prev.tvl,
                    apy: msg.apy ?? prev.apy,
                  }
                : prev,
            );

            setLiveMsg("Balance updated");

            setTimeout(() => {
              setLiveMsg("");
            }, 3000);
          }
        } catch {
          // Ignore malformed WebSocket messages.
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

  const fmtNumber = (value: string) => {
    const number = parseFloat(value);

    if (Number.isNaN(number)) {
      return value;
    }

    return number.toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  };

  return (
    <main className="relative z-0 mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMsg}
      </div>

      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Vault Dashboard
        </h1>

        <p className="text-sm text-zinc-500">
          Real-time overview of your Aura vault positions.
        </p>
      </div>

      {/* Portfolio */}
      <section
        data-testid="portfolio-section"
        aria-label="Portfolio"
        className="relative z-0"
      >
        {loading ? (
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-4"
            aria-busy="true"
            aria-label="Loading vault statistics"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-24 rounded-xl border border-zinc-200 bg-zinc-100 animate-pulse dark:border-zinc-700 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : (
          <div
            className="relative z-0 grid grid-cols-2 gap-4 sm:grid-cols-4"
            role="region"
            aria-label="Vault statistics"
          >
            <StatCard
              testId="total-assets"
              label="TVL"
              value={fmtNumber(stats!.tvl)}
              sub="Total Value Locked"
            />
< HEAD

          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" role="region" aria-label="Vault statistics">
          <StatCard
            data-cy="stat-tvl"
            label="TVL"
            value={fmtNumber(stats!.tvl)}
            rawValue={parseFloat(stats!.tvl)}
            decimals={4}
            sub="Total Value Locked"
          />
          <StatCard
            data-cy="stat-apy"
            label="APY"
            value={`${fmtNumber(stats!.apy)}%`}
            rawValue={parseFloat(stats!.apy)}
            decimals={2}
            suffix="%"
            sub="Annualized yield"
          />
          <StatCard
            data-cy="stat-balance"
            label="Your Balance"
            value={fmtNumber(stats!.userBalance)}
            rawValue={parseFloat(stats!.userBalance)}
            decimals={4}
            sub="Underlying tokens"
          />
          <div
            data-cy="stat-shares"
            className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Your Shares</span>
            <AnimatedShareBalance
              value={fmtNumber(stats!.userShares)}
              className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
            />
            <span className="text-xs text-zinc-400">
              <AnimatedShareBalance
                value={stats!.pricePerShare}
                className="font-mono"
                priceMode
              />
              {" / share"}
            </span>
          </div>
        </div>
      )}
 upstream/main

            <StatCard
              testId="apy"
              label="APY"
              value={`${fmtNumber(stats!.apy)}%`}
              sub="Annualized yield"
            />

            <StatCard
              testId="share-balance"
              label="Your Balance"
              value={fmtNumber(stats!.userBalance)}
              sub="Underlying tokens"
            />

            <StatCard
              testId="price-per-share"
              label="Your Shares"
              value={fmtNumber(stats!.userShares)}
              sub={`@ ${stats!.pricePerShare} / share`}
            />
          </div>
        )}

        {!loading && (
          <p className="mt-3 text-sm text-zinc-500">
            Price per share: {stats!.pricePerShare}
          </p>
        )}
      </section>

      {/* Wallet and Actions */}
      <div className="relative z-0 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section
          aria-labelledby="wallet-heading"
          className="relative z-0"
        >
          <h2
            id="wallet-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            Wallet
          </h2>

          <WalletConnect />
        </section>

        <section
          aria-labelledby="actions-heading"
          className="relative z-0"
        >
          <h2
            id="actions-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            Actions
          </h2>

          <VaultActions />
        </section>
      </div>

      {/* Transactions */}
    <section

      <section
        aria-labelledby="tx-heading"
        className="relative z-50"
      >
        <div className="relative z-0 mb-3 flex items-center justify-between">
          <h2
            id="tx-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
          >
            Recent Transactions
          </h2>

          <button
            data-testid="refresh-btn"
            type="button"
            onClick={fetchStats}
            className="relative z-20 touch-manipulation text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ↻ Refresh
          </button>
        </div>

        <div
          data-testid="tx-list"
          className="relative z-0 rounded-xl border border-zinc-200 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-900"
          role="list"
          aria-label="Recent transactions"
        >
          {txs.length === 0 ? (
            <EmptyState variant="no-transactions" className="py-4" />
          ) : (
            txs.map((tx) => (
              <div key={tx.id} role="listitem">
                <TxRow tx={tx} />
              </div>
            ))
          )}
        </div>

</section>
    </main>
  );
}

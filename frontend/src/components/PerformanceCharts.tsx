"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Download, TrendingUp, Eye, EyeOff } from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  generateMockData,
  toCSV,
  type TimePeriod,
  type PerformanceData,
} from "../lib/performanceCharts";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TxEvent {
  type: "deposit" | "withdraw";
  /** ISO-8601 or epoch ms */
  timestamp: number;
  amount: number;
  /** formatted currency label, e.g. "500 USDC" */
  amountLabel: string;
}

interface WalletState {
  connected: boolean;
  address: string | null;
}

// ─── Mock transaction events (replace with real data when available) ──────────

function generateMockTxEvents(periodDays: number): TxEvent[] {
  const now = Date.now();
  const events: TxEvent[] = [];

  if (periodDays >= 1) {
    events.push({
      type: "deposit",
      timestamp: now - Math.floor(periodDays * 0.2) * 86_400_000,
      amount: 500,
      amountLabel: "500 USDC",
    });
  }
  if (periodDays >= 7) {
    events.push({
      type: "withdraw",
      timestamp: now - Math.floor(periodDays * 0.5) * 86_400_000,
      amount: 100,
      amountLabel: "100 USDC",
    });
  }
  if (periodDays >= 30) {
    events.push({
      type: "deposit",
      timestamp: now - Math.floor(periodDays * 0.8) * 86_400_000,
      amount: 250,
      amountLabel: "250 USDC",
    });
  }
  return events;
}

const PERIOD_DAYS: Record<TimePeriod, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  All: 730,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PerformanceCharts() {
  const [period, setPeriod] = useState<TimePeriod>("1M");
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"balance" | "apy" | "yield">(
    "balance"
  );
  const [showMarkers, setShowMarkers] = useState(true);
  const [walletConnected, setWalletConnected] = useState(false);
  const chartRef = useRef(null);

  const timePeriods: TimePeriod[] = ["1D", "1W", "1M", "3M", "1Y", "All"];

  // Read wallet connection from localStorage (same key as WalletConnect.tsx)
  useEffect(() => {
    function checkWallet() {
      try {
        const saved = localStorage.getItem("aura_wallet_state");
        if (saved) {
          const state: WalletState = JSON.parse(saved);
          setWalletConnected(state.connected === true);
        }
      } catch {
        setWalletConnected(false);
      }
    }
    checkWallet();

    // Listen for storage changes (e.g. wallet connect/disconnect in another tab)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "aura_wallet_state") checkWallet();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, []);

  const fetchPerformanceData = useCallback(async (p: TimePeriod) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vault/performance?period=${p}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      } else {
        setData(generateMockData(p));
      }
    } catch {
      setData(generateMockData(p));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPerformanceData(period);
  }, [period, fetchPerformanceData]);

  function downloadCSV() {
    if (!data) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const csv = toCSV(data);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${period}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-700">
        <div className="h-96 bg-zinc-100 dark:bg-zinc-800 rounded-lg animate-pulse" />
      </div>
    );
  }

  // ── Build chart data ────────────────────────────────────────────────────────

  const labels = data.balanceHistory.map((p) =>
    new Date(p.timestamp).toLocaleDateString()
  );

  const txEvents =
    walletConnected && showMarkers
      ? generateMockTxEvents(PERIOD_DAYS[period])
      : [];

  /**
   * Find the nearest chart index for a given event timestamp.
   */
  function nearestIndex(eventTs: number): number {
    let nearest = 0;
    let minDist = Infinity;
    data!.balanceHistory.forEach((pt, i) => {
      const dist = Math.abs(pt.timestamp - eventTs);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    });
    return nearest;
  }

  // Deposit marker dataset (green upward triangles)
  const depositPoints = data.balanceHistory.map((_, i) => null as number | null);
  const withdrawPoints = data.balanceHistory.map(
    (_, i) => null as number | null
  );

  txEvents.forEach((ev) => {
    const idx = nearestIndex(ev.timestamp);
    if (ev.type === "deposit") {
      depositPoints[idx] = data!.balanceHistory[idx].balance;
    } else {
      withdrawPoints[idx] = data!.balanceHistory[idx].balance;
    }
  });

  const balanceChartData = {
    labels,
    datasets: [
      {
        label: "Balance",
        data: data.balanceHistory.map((p) => p.balance),
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.12)",
        borderWidth: 2,
        fill: true,
        pointRadius: 2,
        pointHoverRadius: 7,
        pointBackgroundColor: "#2563eb",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 1.5,
        tension: 0.4,
        order: 3,
      },
      ...(walletConnected && showMarkers
        ? [
            {
              label: "Deposit",
              data: depositPoints,
              borderColor: "transparent",
              backgroundColor: "#16a34a",
              pointBackgroundColor: "#16a34a",
              pointBorderColor: "#fff",
              pointBorderWidth: 2,
              pointRadius: depositPoints.map((v) => (v !== null ? 10 : 0)),
              pointHoverRadius: depositPoints.map((v) =>
                v !== null ? 12 : 0
              ),
              pointStyle: "triangle" as const,
              showLine: false,
              order: 1,
            },
            {
              label: "Withdrawal",
              data: withdrawPoints,
              borderColor: "transparent",
              backgroundColor: "#dc2626",
              pointBackgroundColor: "#dc2626",
              pointBorderColor: "#fff",
              pointBorderWidth: 2,
              pointRadius: withdrawPoints.map((v) => (v !== null ? 10 : 0)),
              pointHoverRadius: withdrawPoints.map((v) =>
                v !== null ? 12 : 0
              ),
              // Downward triangle: rotate via canvas transform is not direct –
              // use 'rectRot' which is a diamond, or we use a custom rotation:
              pointStyle: withdrawPoints.map((v) =>
                v !== null ? ("triangle" as const) : ("circle" as const)
              ),
              rotation: 180,
              showLine: false,
              order: 2,
            },
          ]
        : []),
    ],
  };

  const apyChartData = {
    labels,
    datasets: [
      {
        label: "APY %",
        data: data.balanceHistory.map((p) => p.apy),
        borderColor: "#16a34a",
        backgroundColor: "rgba(22, 163, 74, 0.12)",
        borderWidth: 2,
        fill: true,
        pointRadius: 2,
        pointHoverRadius: 7,
        pointBackgroundColor: "#16a34a",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 1.5,
        tension: 0.4,
      },
    ],
  };

  // ── Chart options ───────────────────────────────────────────────────────────

  const balanceChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
    elements: {
      point: {
        hitRadius: 12,
      },
    },
    animation: {
      duration: 0,
    },
    plugins: {
      legend: {
        display: walletConnected && showMarkers,
        labels: {
          filter: (item: { text: string }) =>
            item.text === "Deposit" || item.text === "Withdrawal",
          usePointStyle: true,
          color: "rgba(100,100,100,0.9)",
        },
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        padding: 12,
        titleColor: "#fff",
        bodyColor: "#fff",
        borderColor: "rgba(255, 255, 255, 0.2)",
        borderWidth: 1,
        displayColors: true,
        callbacks: {
          label: function (context: TooltipItem<"line">) {
            const datasetLabel = context.dataset.label ?? "";
            const value = context.parsed.y;
            if (value === null) return "";

            if (datasetLabel === "Deposit" || datasetLabel === "Withdrawal") {
              // Find the matching TxEvent for richer tooltip info
              const idx = context.dataIndex;
              const ev = txEvents.find((e) => {
                const ni = nearestIndex(e.timestamp);
                return (
                  ni === idx &&
                  ((datasetLabel === "Deposit" && e.type === "deposit") ||
                    (datasetLabel === "Withdrawal" && e.type === "withdraw"))
                );
              });
              if (ev) {
                const dateStr = new Date(ev.timestamp).toLocaleString();
                return `${datasetLabel}: ${ev.amountLabel} — ${dateStr}`;
              }
              return `${datasetLabel}: ${value.toFixed(2)}`;
            }
            return value !== null ? `$${value.toFixed(2)}` : "N/A";
          },
          // Filter out null values so tooltip only shows when hovered on a real point
          filter: function (item: TooltipItem<"line">) {
            return item.parsed.y !== null;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        grid: {
          drawBorder: false,
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          color: "rgba(0, 0, 0, 0.5)",
        },
      },
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "rgba(0, 0, 0, 0.5)",
        },
      },
    },
  };

  const apyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "nearest" as const,
      intersect: false,
    },
    elements: {
      point: {
        hitRadius: 12,
      },
    },
    animation: {
      duration: 0,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        padding: 12,
        titleColor: "#fff",
        bodyColor: "#fff",
        borderColor: "rgba(255, 255, 255, 0.2)",
        borderWidth: 1,
        displayColors: false,
        callbacks: {
          label: function (context: TooltipItem<"line">) {
            const value = context.parsed.y;
            return value !== null ? `${value.toFixed(2)}%` : "N/A";
          },
          title: function (tooltipItems: TooltipItem<"line">[]) {
            const item = tooltipItems[0];
            return item?.label ?? "Point";
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        grid: {
          drawBorder: false,
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          color: "rgba(0, 0, 0, 0.5)",
          callback: (val: number | string) => `${val}%`,
        },
      },
      x: {
        grid: { display: false },
        ticks: { color: "rgba(0, 0, 0, 0.5)" },
      },
    },
  };

  return (
    <div
      data-cy="performance-charts"
      className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-700"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <TrendingUp size={20} />
            Portfolio Performance
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            Current APY:{" "}
            <span className="font-semibold">{data.currentAPY.toFixed(2)}%</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle personal markers (only shown when wallet connected) */}
          {walletConnected && activeTab === "balance" && (
            <button
              data-cy="toggle-markers-btn"
              onClick={() => setShowMarkers((v) => !v)}
              aria-pressed={showMarkers}
              aria-label={
                showMarkers
                  ? "Hide personal deposit/withdraw markers"
                  : "Show personal deposit/withdraw markers"
              }
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              {showMarkers ? <EyeOff size={14} /> : <Eye size={14} />}
              {showMarkers ? "Hide" : "Show"} My Events
            </button>
          )}

          <button
            data-cy="export-csv-btn"
            onClick={downloadCSV}
            className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Marker legend — shown when wallet connected and on balance tab */}
      {walletConnected && activeTab === "balance" && showMarkers && (
        <div
          role="note"
          aria-label="Transaction event marker legend"
          className="flex items-center gap-4 mb-4 text-xs text-zinc-500"
        >
          <span className="flex items-center gap-1.5">
            {/* Upward triangle SVG */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <polygon points="6,1 11,11 1,11" fill="rgb(34,197,94)" />
            </svg>
            <span>Deposit</span>
          </span>
          <span className="flex items-center gap-1.5">
            {/* Downward triangle SVG */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <polygon points="6,11 11,1 1,1" fill="rgb(239,68,68)" />
            </svg>
            <span>Withdrawal</span>
          </span>
          <span className="text-zinc-400 italic">
            Hover markers for amount &amp; date
          </span>
        </div>
      )}

      {/* Time Period Selector */}
      <div
        data-cy="time-period-selector"
        className="flex flex-wrap gap-2 mb-6 border-b border-zinc-200 dark:border-zinc-700 pb-4"
      >
        {timePeriods.map((p) => (
          <button
            key={p}
            data-cy={`period-btn-${p}`}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              period === p
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chart Tabs */}
      <div
        data-cy="chart-tabs"
        className="flex flex-wrap gap-2 mb-6 border-b border-zinc-200 dark:border-zinc-700"
      >
        {(["balance", "apy", "yield"] as const).map((tab) => (
          <button
            key={tab}
            data-cy={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            }`}
          >
            {tab === "balance" && "Balance History"}
            {tab === "apy" && "APY Trend"}
            {tab === "yield" && "Yield Breakdown"}
          </button>
        ))}
      </div>

      {/* Charts */}
      {activeTab === "balance" && (
        <div data-cy="balance-chart" className="h-96 relative">
          {loading ? (
            <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 rounded-lg animate-pulse" />
          ) : (
            <Line
              ref={chartRef}
              data={balanceChartData}
              options={balanceChartOptions}
              aria-label="Balance history chart with deposit and withdrawal event markers"
            />
          )}
        </div>
      )}

      {activeTab === "apy" && (
        <div data-cy="apy-chart" className="h-96 relative">
          {loading ? (
            <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 rounded-lg animate-pulse" />
          ) : (
            <Line
              ref={chartRef}
              data={apyChartData}
              options={apyChartOptions}
              aria-label="APY trend chart"
            />
          )}
        </div>
      )}

      {activeTab === "yield" && (
        <div data-cy="yield-breakdown" className="space-y-4">
          {data.yieldBreakdown.map((item, idx) => {
            const percentage = data.totalYield > 0 ? (item.amount / data.totalYield) * 100 : 0;
            const colors = ["bg-blue-600", "bg-emerald-600", "bg-violet-600"];
            return (
              <div key={idx}>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {item.source}
                  </span>
                  <span className="font-mono font-semibold">
                    {item.amount.toFixed(2)} ({percentage.toFixed(1)}%)
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percentage)}
                  aria-label={`${item.source} share of total yield`}
                >
                  <div
                    className={`h-full rounded-full ${colors[idx % colors.length]}`}
                    style={{ width: `${Math.max(percentage, 4)}%` }}
                  />
                </div>
              </div>
            );
          })}
          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <div className="flex justify-between text-base font-semibold">
              <span>Total Yield</span>
              <span className="text-green-600 dark:text-green-400">
                +{data.totalYield.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Accessible hidden event list for screen readers */}
      {walletConnected && txEvents.length > 0 && (
        <ul className="sr-only" aria-label="Your transaction events on this chart">
          {txEvents.map((ev, i) => (
            <li
              key={i}
              aria-label={`${ev.type === "deposit" ? "Deposit" : "Withdrawal"} of ${ev.amountLabel} on ${new Date(ev.timestamp).toLocaleString()}`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
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
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { TrendingUp, Info } from "lucide-react";

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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApySnapshot {
  /** ISO-8601 date string (YYYY-MM-DD) */
  date: string;
  /** APY as a percentage, e.g. 10.5 means 10.5% */
  apy: number;
}

export interface YieldProjectionChartProps {
  /** Historical APY snapshots — 30 points minimum for meaningful stats. */
  apyHistory?: ApySnapshot[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute mean and std-dev of an array of numbers. */
function stats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Generate a 12-month forward projection from a rolling-30-day average APY
 * and a ±1 std-dev confidence band.
 *
 * Returns month labels and three series: lower band, projection, upper band.
 */
function buildProjection(
  depositAmount: number,
  meanApy: number,
  stdApy: number
): {
  labels: string[];
  projection: number[];
  lower: number[];
  upper: number[];
} {
  const now = new Date();
  const labels: string[] = [];
  const projection: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];

  // Monthly compounding: FV = PV × (1 + APY/12/100)^n
  for (let month = 0; month <= 12; month++) {
    const d = new Date(now.getFullYear(), now.getMonth() + month, 1);
    labels.push(
      d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    );

    const apyMid = meanApy / 100;
    const apyLow = Math.max(0, (meanApy - stdApy)) / 100;
    const apyHigh = (meanApy + stdApy) / 100;

    projection.push(parseFloat((depositAmount * (1 + apyMid / 12) ** month).toFixed(2)));
    lower.push(parseFloat((depositAmount * (1 + apyLow  / 12) ** month).toFixed(2)));
    upper.push(parseFloat((depositAmount * (1 + apyHigh / 12) ** month).toFixed(2)));
  }

  return { labels, projection, lower, upper };
}

/** Generate plausible mock APY history (30 days) if no real data is passed. */
function generateMockApyHistory(): ApySnapshot[] {
  const history: ApySnapshot[] = [];
  const now = Date.now();
  let apy = 10.5;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    apy = Math.min(16, Math.max(6, apy + (Math.random() - 0.5) * 0.4));
    history.push({
      date: d.toISOString().split("T")[0],
      apy:  parseFloat(apy.toFixed(2)),
    });
  }
  return history;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function YieldProjectionChart({
  apyHistory,
}: YieldProjectionChartProps) {
  const [depositInput, setDepositInput] = useState("1000");
  const [viewMode, setViewMode] = useState<"absolute" | "percentage">("absolute");

  const history = useMemo(
    () => apyHistory && apyHistory.length >= 5 ? apyHistory : generateMockApyHistory(),
    [apyHistory]
  );

  // Rolling 30-day APY — use last 30 snapshots (or all if fewer)
  const recentApys = useMemo(() => {
    const window = history.slice(-30).map((s) => s.apy);
    return window;
  }, [history]);

  const { mean: meanApy, std: stdApy } = useMemo(() => stats(recentApys), [recentApys]);

  const depositAmount = useMemo(() => {
    const v = parseFloat(depositInput);
    return isNaN(v) || v <= 0 ? 0 : v;
  }, [depositInput]);

  const { labels, projection, lower, upper } = useMemo(
    () => buildProjection(depositAmount, meanApy, stdApy),
    [depositAmount, meanApy, stdApy]
  );

  // Convert to % gain relative to depositAmount (month 0)
  const toPercent = (series: number[]) =>
    series.map((v) => (depositAmount > 0 ? parseFloat((((v - depositAmount) / depositAmount) * 100).toFixed(2)) : 0));

  const dispProjection = viewMode === "percentage" ? toPercent(projection) : projection;
  const dispLower      = viewMode === "percentage" ? toPercent(lower)      : lower;
  const dispUpper      = viewMode === "percentage" ? toPercent(upper)      : upper;

  const formatValue = (v: number) =>
    viewMode === "percentage"
      ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
      : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const finalValue    = dispProjection[dispProjection.length - 1] ?? 0;
  const finalLow      = dispLower[dispLower.length - 1] ?? 0;
  const finalHigh     = dispUpper[dispUpper.length - 1] ?? 0;

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = {
    labels,
    datasets: [
      // Upper confidence band (invisible line, fills down to lower)
      {
        label: "+1σ",
        data: dispUpper,
        borderColor: "transparent",
        backgroundColor: "rgba(99, 102, 241, 0.12)",
        borderWidth: 0,
        fill: "+1", // fill toward dataset index +1 (lower band)
        pointRadius: 0,
        tension: 0.4,
        order: 3,
      },
      // Projection line
      {
        label: "Projection",
        data: dispProjection,
        borderColor: "#4f46e5",
        backgroundColor: "rgba(79, 70, 229, 0.08)",
        borderWidth: 2.5,
        fill: false,
        pointRadius: 3,
        pointHoverRadius: 7,
        pointBackgroundColor: "#4f46e5",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 1.5,
        tension: 0.4,
        order: 1,
      },
      // Lower confidence band
      {
        label: "−1σ",
        data: dispLower,
        borderColor: "transparent",
        backgroundColor: "rgba(99, 102, 241, 0.12)",
        borderWidth: 0,
        fill: false,
        pointRadius: 0,
        tension: 0.4,
        order: 2,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 as const },
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: {
          filter: (item: { text: string }) => item.text === "Projection",
          usePointStyle: true,
          color: "rgba(120,120,120,0.9)",
        },
      },
      tooltip: {
        backgroundColor: "rgba(0,0,0,0.85)",
        padding: 12,
        titleColor: "#fff",
        bodyColor: "#fff",
        borderColor: "rgba(255,255,255,0.15)",
        borderWidth: 1,
        callbacks: {
          label: (ctx: TooltipItem<"line">) => {
            const { dataset, parsed } = ctx;
            if (dataset.label === "+1σ")
              return `Upper band: ${formatValue(parsed.y)}`;
            if (dataset.label === "−1σ")
              return `Lower band: ${formatValue(parsed.y)}`;
            return `Projected: ${formatValue(parsed.y)}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: viewMode === "percentage",
        grid: { color: "rgba(0,0,0,0.05)" },
        ticks: {
          color: "rgba(0,0,0,0.5)",
          callback: (v: number | string) =>
            viewMode === "percentage"
              ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`
              : `$${Number(v).toLocaleString()}`,
        },
      },
      x: {
        grid: { display: false },
        ticks: { color: "rgba(0,0,0,0.5)" },
      },
    },
  };

  return (
    <div
      data-cy="yield-projection-chart"
      className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-700"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <TrendingUp size={20} aria-hidden="true" />
            Yield Projection
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            12-month forward estimate · Rolling 30-day APY:{" "}
            <span className="font-semibold">{meanApy.toFixed(2)}%</span>
            {" "}± <span className="font-semibold">{stdApy.toFixed(2)}%</span>
          </p>
        </div>

        {/* View mode toggle */}
        <div
          role="group"
          aria-label="Display mode"
          className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        >
          {(["absolute", "percentage"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === mode
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {mode === "absolute" ? "$ Value" : "% Gain"}
            </button>
          ))}
        </div>
      </div>

      {/* Deposit input */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="deposit-amount" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Hypothetical deposit (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-sm select-none">
              $
            </span>
            <input
              id="deposit-amount"
              type="number"
              min="1"
              step="100"
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
              className="h-10 w-44 rounded-lg border border-zinc-200 pl-7 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-describedby="deposit-hint"
            />
          </div>
          <span id="deposit-hint" className="text-xs text-zinc-400">
            Amount to simulate
          </span>
        </div>

        {/* Quick summary stats */}
        {depositAmount > 0 && (
          <dl className="flex gap-6 text-sm">
            <div className="flex flex-col">
              <dt className="text-zinc-500 text-xs">12-mo projection</dt>
              <dd className="font-semibold text-indigo-600 dark:text-indigo-400">
                {formatValue(finalValue)}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-zinc-500 text-xs">Lower band (−1σ)</dt>
              <dd className="font-semibold text-zinc-700 dark:text-zinc-300">
                {formatValue(finalLow)}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-zinc-500 text-xs">Upper band (+1σ)</dt>
              <dd className="font-semibold text-zinc-700 dark:text-zinc-300">
                {formatValue(finalHigh)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Chart */}
      <div className="h-72 relative" aria-label="Yield projection chart for the next 12 months">
        {depositAmount <= 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            Enter a deposit amount to see the projection.
          </div>
        ) : (
          <Line
            data={chartData}
            options={chartOptions}
            aria-label={`12-month yield projection for a $${depositAmount.toLocaleString()} deposit`}
          />
        )}
      </div>

      {/* Disclaimer */}
      <div
        role="note"
        aria-label="Projection accuracy disclaimer"
        className="mt-5 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-4 py-3"
      >
        <Info
          size={16}
          className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          <strong>Disclaimer:</strong> This projection is based on historical APY data and is
          provided for informational purposes only. Past performance is not indicative of future
          results. Actual yield may vary significantly due to market conditions, protocol changes,
          and other factors. This is not financial advice.
        </p>
      </div>
    </div>
  );
}

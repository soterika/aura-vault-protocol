"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Legend, Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import {
  fetchDataset,
  loadAllDatasets,
  toErrorMessage,
  type ActivityPoint,
  type DatasetKey,
  type DatasetState,
  type Period,
  type Stats,
  type YieldPoint,
} from "../lib/analyticsDatasets";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const panel = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const chartOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: "bottom" as const } },
  scales: { y: { beginAtZero: true, grid: { color: "rgba(148,163,184,.15)" } }, x: { grid: { display: false } } },
};

export default function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>("30D");
  const [activityState, setActivityState] = useState<DatasetState<ActivityPoint[]>>({ data: [], loading: true, error: null });
  const [yieldsState, setYieldsState] = useState<DatasetState<YieldPoint[]>>({ data: [], loading: true, error: null });
  const [statsState, setStatsState] = useState<DatasetState<Stats>>({ data: {}, loading: true, error: null });

  useEffect(() => {
    let active = true;
    setActivityState((prev) => ({ ...prev, loading: true, error: null }));
    setYieldsState((prev) => ({ ...prev, loading: true, error: null }));
    setStatsState((prev) => ({ ...prev, loading: true, error: null }));

    loadAllDatasets(period).then((results) => {
      if (!active) return;
      setActivityState(results.activity);
      setYieldsState(results.yields);
      setStatsState(results.stats);
    });

    return () => { active = false; };
  }, [period]);

  const retryDataset = useCallback(async (key: DatasetKey) => {
    if (key === "activity") {
      setActivityState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fetchDataset("activity", period);
        setActivityState({ data, loading: false, error: null });
      } catch (err) {
        setActivityState((prev) => ({ ...prev, loading: false, error: toErrorMessage(err) }));
      }
    } else if (key === "yields") {
      setYieldsState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fetchDataset("yields", period);
        setYieldsState({ data, loading: false, error: null });
      } catch (err) {
        setYieldsState((prev) => ({ ...prev, loading: false, error: toErrorMessage(err) }));
      }
    } else {
      setStatsState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fetchDataset("stats", period);
        setStatsState({ data, loading: false, error: null });
      } catch (err) {
        setStatsState((prev) => ({ ...prev, loading: false, error: toErrorMessage(err) }));
      }
    }
  }, [period]);

  const activity = activityState.data;
  const yields = yieldsState.data;
  const stats = statsState.data;

  const labels = activity.map((point) => new Date(point.date).toLocaleDateString());
  const yieldLabels = yields.map((point) => new Date(point.date).toLocaleDateString());
  const apyAverage = useMemo(() => yields.map((_, index) => {
    const lastSeven = yields.slice(Math.max(0, index - 6), index + 1);
    return lastSeven.reduce((sum, point) => sum + Number(point.apy || 0), 0) / lastSeven.length;
  }), [yields]);

  const metricCards = [
    ["Total value locked", Number(stats.total_assets ?? stats.totalAssets ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })],
    ["7 day APY", `${(Number(stats.apy7d ?? 0) * 100).toFixed(2)}%`],
    ["30 day APY", `${(Number(stats.apy30d ?? 0) * 100).toFixed(2)}%`],
    ["Share price", Number(stats.sharePrice ?? stats.share_price ?? 0).toFixed(6)],
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-2 text-sm font-semibold uppercase tracking-widest text-indigo-600">Aura Vault</p><h1 className="text-3xl font-bold">Vault analytics</h1><p className="mt-2 text-zinc-500">Historical performance, activity, and share pricing.</p></div>
        <div className="flex gap-2" aria-label="Analytics time range">
          {(["1D", "7D", "30D", "ALL"] as Period[]).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded-lg px-4 py-2 text-sm font-medium ${period === value ? "bg-indigo-600 text-white" : "border border-zinc-200 dark:border-zinc-700"}`}>{value}</button>)}
        </div>
      </header>
      {statsState.error && (
        <div role="alert" className="mb-5 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <span>Vault metrics unavailable: {statsState.error}</span>
          <button type="button" onClick={() => retryDataset("stats")} className="rounded-md bg-amber-800 px-3 py-1 text-xs font-medium text-white hover:bg-amber-900">Retry</button>
        </div>
      )}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Current vault metrics">
        {metricCards.map(([label, value]) => <article key={label} className={panel}><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold">{statsState.loading ? "—" : value}</p></article>)}
      </section>
      <section className="grid gap-5 lg:grid-cols-2" aria-label="Historical charts">
        <ChartPanel title="TVL over time" loading={activityState.loading} error={activityState.error} onRetry={() => retryDataset("activity")} empty={!activity.length}><Line data={{ labels, datasets: [{ label: "TVL", data: activity.map((p) => p.tvl), borderColor: "#4f46e5", backgroundColor: "rgba(79,70,229,.12)", fill: true, tension: .3 }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="APY and 7 day average" loading={yieldsState.loading} error={yieldsState.error} onRetry={() => retryDataset("yields")} empty={!yields.length}><Line data={{ labels: yieldLabels, datasets: [{ label: "APY", data: yields.map((p) => Number(p.apy) * 100), borderColor: "#0d9488", tension: .25 }, { label: "7 day average", data: apyAverage.map((value) => value * 100), borderColor: "#f59e0b", borderDash: [5, 5], tension: .25 }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="Deposit and withdrawal volume" loading={activityState.loading} error={activityState.error} onRetry={() => retryDataset("activity")} empty={!activity.length}><Bar data={{ labels, datasets: [{ label: "Deposits", data: activity.map((p) => p.deposits), backgroundColor: "#10b981" }, { label: "Withdrawals", data: activity.map((p) => p.withdrawals), backgroundColor: "#f97316" }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="Unique depositors per day" loading={activityState.loading} error={activityState.error} onRetry={() => retryDataset("activity")} empty={!activity.length}><Line data={{ labels, datasets: [{ label: "Depositors", data: activity.map((p) => p.uniqueDepositors), borderColor: "#8b5cf6", tension: .25 }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="Share price history" loading={activityState.loading} error={activityState.error} onRetry={() => retryDataset("activity")} empty={!activity.length}><Line data={{ labels, datasets: [{ label: "Share price", data: activity.map((p) => p.sharePrice), borderColor: "#0284c7", tension: .25 }] }} options={chartOptions} /></ChartPanel>
      </section>
    </main>
  );
}

function ChartPanel({ title, loading, error, onRetry, empty, children }: { title: string; loading: boolean; error: string | null; onRetry: () => void; empty: boolean; children: ReactNode }) {
  return (
    <article className={panel}>
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="h-64">
        {loading ? (
          <div role="status" className="h-full animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        ) : error ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-center text-sm text-amber-800">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="rounded-md bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900">Retry</button>
          </div>
        ) : empty ? (
          <p className="flex h-full items-center justify-center text-sm text-zinc-500">No historical data available for this range.</p>
        ) : children}
      </div>
    </article>
  );
}

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Legend, Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);
const API = process.env.NEXT_PUBLIC_API_URL ?? "";
type Period = "1D" | "7D" | "30D" | "ALL";
type ActivityPoint = { date: string; tvl: number; deposits: number; withdrawals: number; uniqueDepositors: number; sharePrice: number };
type YieldPoint = { date: string; apy: number; daily_yield: number };
type Stats = { total_assets?: number | string; totalAssets?: number | string; apy7d?: number; apy30d?: number; sharePrice?: number | string; share_price?: number | string };

const panel = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const chartOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: "bottom" as const } },
  scales: { y: { beginAtZero: true, grid: { color: "rgba(148,163,184,.15)" } }, x: { grid: { display: false } } },
};

async function readJson(path: string) {
  const response = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Analytics request failed (${response.status})`);
  const payload = await response.json();
  return payload.data ?? payload;
}

export default function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>("30D");
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [yields, setYields] = useState<YieldPoint[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const days = period === "ALL" ? 3650 : Number(period.slice(0, -1));
    setLoading(true);
    setError("");
    Promise.all([
      readJson(`/api/v1/vault/analytics/history?period=${period}`),
      readJson(`/api/v1/yield/history?days=${days}`),
      readJson("/api/v1/vault/stats"),
    ]).then(([activityResponse, yieldResponse, statsResponse]) => {
      if (!active) return;
      setActivity(activityResponse.history ?? []);
      setYields(yieldResponse.history ?? []);
      setStats(statsResponse.stats ?? statsResponse);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Unable to load analytics");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);

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
      {error && <p role="alert" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Current vault metrics">
        {metricCards.map(([label, value]) => <article key={label} className={panel}><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold">{loading ? "—" : value}</p></article>)}
      </section>
      <section className="grid gap-5 lg:grid-cols-2" aria-label="Historical charts">
        <ChartPanel title="TVL over time" loading={loading} empty={!activity.length}><Line data={{ labels, datasets: [{ label: "TVL", data: activity.map((p) => p.tvl), borderColor: "#4f46e5", backgroundColor: "rgba(79,70,229,.12)", fill: true, tension: .3 }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="APY and 7 day average" loading={loading} empty={!yields.length}><Line data={{ labels: yieldLabels, datasets: [{ label: "APY", data: yields.map((p) => Number(p.apy) * 100), borderColor: "#0d9488", tension: .25 }, { label: "7 day average", data: apyAverage.map((value) => value * 100), borderColor: "#f59e0b", borderDash: [5, 5], tension: .25 }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="Deposit and withdrawal volume" loading={loading} empty={!activity.length}><Bar data={{ labels, datasets: [{ label: "Deposits", data: activity.map((p) => p.deposits), backgroundColor: "#10b981" }, { label: "Withdrawals", data: activity.map((p) => p.withdrawals), backgroundColor: "#f97316" }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="Unique depositors per day" loading={loading} empty={!activity.length}><Line data={{ labels, datasets: [{ label: "Depositors", data: activity.map((p) => p.uniqueDepositors), borderColor: "#8b5cf6", tension: .25 }] }} options={chartOptions} /></ChartPanel>
        <ChartPanel title="Share price history" loading={loading} empty={!activity.length}><Line data={{ labels, datasets: [{ label: "Share price", data: activity.map((p) => p.sharePrice), borderColor: "#0284c7", tension: .25 }] }} options={chartOptions} /></ChartPanel>
      </section>
    </main>
  );
}

function ChartPanel({ title, loading, empty, children }: { title: string; loading: boolean; empty: boolean; children: ReactNode }) {
  return <article className={panel}><h2 className="mb-4 font-semibold">{title}</h2><div className="h-64">{loading ? <div role="status" className="h-full animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" /> : empty ? <p className="flex h-full items-center justify-center text-sm text-zinc-500">No historical data available for this range.</p> : children}</div></article>;
}

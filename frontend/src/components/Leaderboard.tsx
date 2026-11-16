"use client";

import { useCallback, useEffect, useState } from "react";

type Period = "all" | "30d" | "7d" | "24h";

interface LeaderboardRow {
  userId: string;
  shareBalance: string;
  usdValue: string;
  isCurrentUser: boolean;
  rank: number;
  rankChange: number | null;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  period: Period;
  generatedAt: string;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "30d", label: "30 Days" },
  { value: "7d", label: "7 Days" },
  { value: "24h", label: "24 Hours" },
];

function changeLabel(value: number | null): string {
  if (value === null) return "No earlier snapshot";
  if (value > 0) return `Up ${value} ${value === 1 ? "place" : "places"}`;
  if (value < 0) return `Down ${Math.abs(value)} ${Math.abs(value) === 1 ? "place" : "places"}`;
  return "No rank change";
}

function medal(rank: number): string | null {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
}

function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 5)}...${address.slice(-4)}` : address;
}

export function Leaderboard() {
  const [period, setPeriod] = useState<Period>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animatedChanges, setAnimatedChanges] = useState<Record<string, number>>({});

  const load = useCallback(async (selectedPeriod: Period, selectedPage: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
      let address = "";
      try { address = JSON.parse(localStorage.getItem("aura_wallet_state") ?? "null")?.address ?? ""; } catch { /* optional wallet */ }
      const response = await fetch(
        `${apiBase}/api/vault/leaderboard?period=${selectedPeriod}&page=${selectedPage}&pageSize=20${address ? `&address=${encodeURIComponent(address)}` : ""}`,
        { signal, cache: "no-store" }
      );
      if (!response.ok) throw new Error("Leaderboard could not be loaded.");
      setData((await response.json()) as LeaderboardResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Leaderboard could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(period, page, controller.signal);
    return () => controller.abort();
  }, [load, period, page]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(period, page), 60_000);
    return () => window.clearInterval(interval);
  }, [load, period, page]);

  useEffect(() => {
    if (!data) return;
    const changes = data.leaderboard.filter((entry) => entry.rankChange !== null);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedChanges(Object.fromEntries(changes.map((entry) => [entry.userId, Math.abs(entry.rankChange ?? 0)])));
      return;
    }
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 450);
      setAnimatedChanges(Object.fromEntries(changes.map((entry) => [
        entry.userId,
        Math.round(Math.abs(entry.rankChange ?? 0) * progress),
      ])));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [data]);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6" aria-labelledby="leaderboard-title">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Community</p>
          <h1 id="leaderboard-title" className="mt-1 text-3xl font-bold tracking-tight">Vault leaderboard</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">See the top vault positions and how their ranks have moved.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>Compare ranks over</span>
          <select
            aria-label="Leaderboard time period"
            value={period}
            onChange={(event) => { setPeriod(event.target.value as Period); setPage(1); }}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {error ? (
          <div role="alert" className="p-8 text-center text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : loading && !data ? (
          <div role="status" className="p-8 text-center text-sm text-zinc-500">Loading leaderboard…</div>
        ) : data?.leaderboard.length ? (
          <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <caption className="sr-only">Top vault holders, current rank and rank movement over the selected period</caption>
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-5 py-3">Rank</th>
                  <th scope="col" className="px-5 py-3">Vault holder</th>
                  <th scope="col" className="px-5 py-3 text-right">Shares</th>
                  <th scope="col" className="px-5 py-3 text-right">USD value</th>
                  <th scope="col" className="px-5 py-3 text-right">Rank change</th>
                </tr>
              </thead>
              <tbody className={loading ? "opacity-60" : ""} aria-busy={loading}>
                {data.leaderboard.map((entry) => {
                  const award = medal(entry.rank);
                  const direction = entry.rankChange === null ? "unknown" : entry.rankChange > 0 ? "up" : entry.rankChange < 0 ? "down" : "same";
                  return (
                    <tr key={entry.userId} className={`animate-[leaderboard-enter_350ms_ease-out_both] border-t border-zinc-100 dark:border-zinc-800 ${entry.isCurrentUser ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}`}>
                      <th scope="row" className="whitespace-nowrap px-5 py-4 font-semibold tabular-nums">
                        <span aria-label={award ? `Rank ${entry.rank}, ${["", "gold", "silver", "bronze"][entry.rank]} medal` : `Rank ${entry.rank}`}>
                          {award ? <span aria-hidden="true" className="mr-2">{award}</span> : null}#{entry.rank}
                        </span>
                      </th>
                      <td className="px-5 py-4 font-mono text-zinc-600 dark:text-zinc-300">{truncateAddress(entry.userId)}</td>
                      <td className="px-5 py-4 text-right font-medium tabular-nums">{Number(entry.shareBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="px-5 py-4 text-right tabular-nums">${Number(entry.usdValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-5 py-4 text-right">
                        <span className={direction === "up" ? "text-emerald-600 dark:text-emerald-400" : direction === "down" ? "text-rose-600 dark:text-rose-400" : "text-zinc-500"} aria-label={changeLabel(entry.rankChange)}>
                          {direction === "up" ? "▲" : direction === "down" ? "▼" : direction === "same" ? "—" : "·"}{" "}
                          {entry.rankChange === null ? "—" : (animatedChanges[entry.userId] ?? 0)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800 sm:hidden" aria-label="Leaderboard cards">
            {data.leaderboard.map((entry) => <li key={entry.userId} className={`p-4 ${entry.isCurrentUser ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}`}>
              <div className="flex items-center justify-between"><strong>#{entry.rank} · {truncateAddress(entry.userId)}</strong><span className={entry.rankChange && entry.rankChange > 0 ? "text-emerald-600" : entry.rankChange && entry.rankChange < 0 ? "text-rose-600" : "text-zinc-500"}>{entry.rankChange && entry.rankChange > 0 ? "▲" : entry.rankChange && entry.rankChange < 0 ? "▼" : "—"} {entry.rankChange === null ? "" : animatedChanges[entry.userId] ?? 0}</span></div>
              <p className="mt-2 text-sm text-zinc-500">{Number(entry.shareBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} shares · ${Number(entry.usdValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </li>)}
          </ol>
          </>
        ) : (
          <p className="p-8 text-center text-sm text-zinc-500">No vault positions are available yet.</p>
        )}
      </div>
      {data && data.totalPages > 1 && <nav aria-label="Leaderboard pages" className="mt-4 flex items-center justify-between">
        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">Previous</button>
        <span className="text-sm text-zinc-500">Page {page} of {data.totalPages} · {data.total} holders</span>
        <button type="button" disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">Next</button>
      </nav>}
      {data?.generatedAt && <p className="mt-3 text-right text-xs text-zinc-500">Updated {new Date(data.generatedAt).toLocaleString()}</p>}
    </section>
  );
}

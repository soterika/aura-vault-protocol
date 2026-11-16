"use client";

import { useCallback, useEffect, useState } from "react";

interface StatusSnapshot {
  totalAssets: string;
  sharePrice: string;
  apy7d: number;
  apy30d: number;
  lastHarvest: string | null;
  fetchedAt: string;
  cacheAgeSecs: number | null;
  contractId: string | null;
  version: number | null;
  wasmHash: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const REFRESH_MS = 30_000;

function relativeTime(value: string | null, now: number): string {
  if (!value) return "No harvest recorded";
  const elapsed = Math.max(0, now - new Date(value).getTime());
  if (!Number.isFinite(elapsed)) return "Timestamp unavailable";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

async function readJson(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  return await response.json() as Record<string, unknown>;
}

export default function VaultStatusPage() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const [statsResponse, upgradeResponse] = await Promise.all([
        readJson("/api/v1/vault/stats", signal),
        readJson("/api/admin/upgrade/info", signal).catch(() => ({})),
      ]);
      const stats = (statsResponse.data ?? statsResponse) as Record<string, unknown>;
      const fetchedAt = typeof stats.fetched_at === "string" ? stats.fetched_at : "";
      setSnapshot({
        totalAssets: String(stats.totalAssets ?? "0"),
        sharePrice: String(stats.sharePrice ?? "1"),
        apy7d: Number(stats.apy7d ?? 0),
        apy30d: Number(stats.apy30d ?? 0),
        lastHarvest: typeof stats.lastHarvest === "string" ? stats.lastHarvest : null,
        fetchedAt,
        cacheAgeSecs: typeof stats.cache_age_secs === "number" ? stats.cache_age_secs : null,
        contractId: typeof upgradeResponse.contract_id === "string" ? upgradeResponse.contract_id : null,
        version: typeof upgradeResponse.current_version === "number" ? upgradeResponse.current_version : null,
        wasmHash: typeof upgradeResponse.current_wasm_hash === "string" ? upgradeResponse.current_wasm_hash : null,
      });
      setError("");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Unable to load vault status.");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      const nextController = new AbortController();
      void refresh(nextController.signal);
    }, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const harvestDate = snapshot?.lastHarvest ? new Date(snapshot.lastHarvest) : null;
  const freshness = snapshot?.cacheAgeSecs ?? null;
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "public" : "testnet";
  const contractUrl = snapshot?.contractId
    ? `https://stellar.expert/explorer/${network}/contract/${encodeURIComponent(snapshot.contractId)}`
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Aura Vault</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Vault status</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Read-only vault metrics refresh every 30 seconds.</p>
      </header>

      {error && <p role="alert" className="mb-5 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {loading && !snapshot && <p role="status" className="mb-5 text-sm text-zinc-500">Loading vault status…</p>}

      {snapshot && <>
        <section aria-label="Live vault metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="Total assets" value={`${Number(snapshot.totalAssets).toLocaleString()} USDC`} />
          <Metric label="Share price" value={`${snapshot.sharePrice} USDC`} />
          <Metric label="7 day APY" value={`${(snapshot.apy7d * 100).toFixed(2)}%`} />
          <Metric label="30 day APY" value={`${(snapshot.apy30d * 100).toFixed(2)}%`} />
          <Metric label="Last harvest" value={relativeTime(snapshot.lastHarvest, now)} detail={harvestDate && Number.isFinite(harvestDate.getTime()) ? harvestDate.toLocaleString() : undefined} />
          <Metric label="Status data" value={freshness !== null && freshness < 90 ? "Available" : freshness === null ? "Timestamp unavailable" : "Stale"} detail={freshness === null ? undefined : `Cached ${freshness}s ago`} />
        </section>

        <section aria-labelledby="contract-status-heading" className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 id="contract-status-heading" className="text-lg font-semibold">Contract parameters</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <StatusValue label="Pause state" value="Unknown — public API does not expose this value" state="unknown" />
            <StatusValue label="TVL cap" value="Unknown — public API does not expose this value" state="unknown" />
            <StatusValue label="Admin address" value="Unknown — public API does not expose this value" state="unknown" />
            <StatusValue label="Recorded contract version" value={snapshot.version === null ? "Unavailable" : String(snapshot.version)} state={snapshot.version === null ? "unknown" : "ok"} />
            <StatusValue label="Wasm hash" value={snapshot.wasmHash ?? "Unavailable"} state={snapshot.wasmHash ? "ok" : "unknown"} />
            <StatusValue label="Contract address" value={snapshot.contractId ?? "Unavailable"} href={contractUrl ?? undefined} state={snapshot.contractId ? "ok" : "unknown"} />
          </dl>
          <p className="mt-5 text-xs text-zinc-500 dark:text-zinc-400">Pause state, TVL cap, and admin address are shown as unavailable until the backend exposes on-chain values. This page does not infer them from cached or administrative state.</p>
        </section>
      </>}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p>{detail && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>}</div>;
}

function StatusValue({ label, value, href, state }: { label: string; value: string; href?: string; state: "ok" | "unknown" | "warning" }) {
  const colors = { ok: "bg-emerald-500", unknown: "bg-amber-500", warning: "bg-red-500" };
  const stateLabel = { ok: "Available", unknown: "Unknown", warning: "Warning" };
  return <div><dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="mt-1 flex items-start gap-2 break-all text-sm font-medium"><span aria-label={stateLabel[state]} title={stateLabel[state]} className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${colors[state]}`} />{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">{value}</a> : value}</dd></div>;
}

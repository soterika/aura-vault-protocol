"use client";

import { useEffect, useState } from "react";

type Snapshot = { timestamp?: string; apy_7d?: string | null; total_assets?: string | null; total_yield?: string | null };
type Metric = "apy" | "tvl" | "share-price";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

function metricValue(point: Snapshot, metric: Metric): number | null {
  const raw = metric === "apy" ? point.apy_7d : metric === "tvl" ? point.total_assets : point.total_yield;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export default function VaultStatSparkline({ metric, label }: { metric: Metric; label: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${API}/api/v1/vault/apy/history?period=7d`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json();
        const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.data) ? body.data.data : [];
        if (!cancelled) setSnapshots(rows);
      } catch { /* dashboard metrics remain useful when history is unavailable */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const points = snapshots.flatMap((snapshot) => {
    const value = metricValue(snapshot, metric);
    return value === null ? [] : [{ value, timestamp: snapshot.timestamp ?? "" }];
  });
  const values = points.map((point) => point.value);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  const min = Math.min(...values, first);
  const max = Math.max(...values, first);
  const spread = max - min;
  const series = points.length >= 2 ? points : [{ value: last, timestamp: "" }, { value: last, timestamp: "" }];
  const plotted = series.map((point, index) => {
    const x = 2 + (index / Math.max(1, series.length - 1)) * 96;
    const y = spread === 0 ? 9 : 17 - ((point.value - min) / spread) * 16;
    return { x, y, point };
  });
  const coordinates = plotted.map(({ x, y }) => `${x},${y}`).join(" ");
  const direction = last > first ? "upward" : last < first ? "downward" : "flat";
  const stroke = direction === "downward" ? "#dc2626" : "#16a34a";
  const description = `${label} 7-day trend is ${direction}${points.length < 2 ? "; showing a flat line because fewer than two snapshots are available" : ""}`;

  return (
    <svg className="mt-2 h-8 w-24 overflow-visible" viewBox="0 0 100 20" role="img" aria-label={description}>
      <title>{description}</title>
      <polyline fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={coordinates} />
      {plotted.map(({ x, y, point }, index) => (
        <circle key={`${point.timestamp}-${index}`} cx={x} cy={y} r="1.8" fill={stroke}>
          <title>{point.timestamp ? `${new Date(point.timestamp).toLocaleString()}: ` : ""}{point.value}</title>
        </circle>
      ))}
    </svg>
  );
}

export type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y" | "All";

export interface BalancePoint {
  ts: number;   // unix ms
  balance: number;
  label: string;
}

export interface ApyPoint {
  ts: number;
  apy: number;
  label: string;
}

export interface YieldPoint {
  label: string;
  harvest: number;
  compound: number;
  bonus: number;
}

const timeframeConfig: Record<Timeframe, { points: number; intervalMs: number }> = {
  "1D":  { points: 96,   intervalMs: 15 * 60 * 1000 },
  "1W":  { points: 168,  intervalMs: 60 * 60 * 1000 },
  "1M":  { points: 120,  intervalMs: 6 * 60 * 60 * 1000 },
  "3M":  { points: 90,   intervalMs: 24 * 60 * 60 * 1000 },
  "1Y":  { points: 365,  intervalMs: 24 * 60 * 60 * 1000 },
  "All": { points: 730,  intervalMs: 48 * 60 * 60 * 1000 },
};

function formatLabel(ts: number, tf: Timeframe): string {
  const d = new Date(ts);
  if (tf === "1D") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (tf === "1W") return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Seeded pseudo-random for reproducible mock data */
function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function generateBalanceHistory(tf: Timeframe): BalancePoint[] {
  const { points, intervalMs } = timeframeConfig[tf];
  const now = Date.now();
  const rand = seededRand(tf.charCodeAt(0) + points);
  let balance = 10_000;

  return Array.from({ length: points }, (_, i) => {
    const ts = now - (points - i) * intervalMs;
    const drift = (rand() - 0.48) * 0.003;
    balance = Math.max(0, balance * (1 + drift));
    return { ts, balance: Math.round(balance * 100) / 100, label: formatLabel(ts, tf) };
  });
}

export function generateApyHistory(tf: Timeframe): ApyPoint[] {
  const { points, intervalMs } = timeframeConfig[tf];
  const now = Date.now();
  const rand = seededRand(tf.charCodeAt(0) + 99);
  let apy = 8.5;

  return Array.from({ length: points }, (_, i) => {
    const ts = now - (points - i) * intervalMs;
    apy = Math.max(1, Math.min(30, apy + (rand() - 0.5) * 0.4));
    return { ts, apy: Math.round(apy * 100) / 100, label: formatLabel(ts, tf) };
  });
}

/** Yield breakdown — weekly buckets */
export function generateYieldBreakdown(tf: Timeframe): YieldPoint[] {
  const buckets = Math.min(12, timeframeConfig[tf].points / 7 | 0) || 4;
  const now = Date.now();
  const rand = seededRand(tf.charCodeAt(0) + 42);
  const msPerBucket = timeframeConfig[tf].intervalMs * (timeframeConfig[tf].points / buckets);

  return Array.from({ length: buckets }, (_, i) => {
    const ts = now - (buckets - i) * msPerBucket;
    const d = new Date(ts);
    return {
      label: d.toLocaleDateString([], { month: "short", day: "numeric" }),
      harvest:  Math.round(rand() * 80 + 20),
      compound: Math.round(rand() * 40 + 10),
      bonus:    Math.round(rand() * 20),
    };
  });
}

export function exportCsv(
  balance: BalancePoint[],
  apy: ApyPoint[],
  tf: Timeframe
): void {
  const rows = ["timestamp,balance,apy"];
  const apyMap = new Map(apy.map((p) => [p.ts, p.apy]));
  for (const b of balance) {
    rows.push(`${new Date(b.ts).toISOString()},${b.balance},${apyMap.get(b.ts) ?? ""}`);
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aura-vault-performance-${tf.toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

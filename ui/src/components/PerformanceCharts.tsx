import { useState, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  generateBalanceHistory,
  generateApyHistory,
  generateYieldBreakdown,
  exportCsv,
  type Timeframe,
} from "../lib/chartData";

const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y", "All"];

// Downsample to at most `max` evenly-spaced points for render performance
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

const MAX_RENDER_POINTS = 300;

// Accessible color palette — WCAG AA contrast on dark surface
const COLORS = {
  balance:  "#7c83fd",
  apy:      "#4caf84",
  harvest:  "#7c83fd",
  compound: "#4caf84",
  bonus:    "#81d4fa",
};

function fmt(n: number, prefix = ""): string {
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip" role="tooltip">
      <p className="chart-tooltip__label">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

export function PerformanceCharts() {
  const [tf, setTf] = useState<Timeframe>("1M");

  const rawBalance = useMemo(() => generateBalanceHistory(tf), [tf]);
  const rawApy     = useMemo(() => generateApyHistory(tf), [tf]);
  const breakdown  = useMemo(() => generateYieldBreakdown(tf), [tf]);

  const balance = useMemo(() => downsample(rawBalance, MAX_RENDER_POINTS), [rawBalance]);
  const apy     = useMemo(() => downsample(rawApy, MAX_RENDER_POINTS), [rawApy]);

  const handleExport = useCallback(
    () => exportCsv(rawBalance, rawApy, tf),
    [rawBalance, rawApy, tf]
  );

  return (
    <section aria-labelledby="perf-title" className="perf-charts">
      <div className="perf-charts__header">
        <h2 id="perf-title" className="form-title">Performance</h2>
        <div className="perf-charts__controls">
          <div className="timeframe-tabs" role="group" aria-label="Select timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                className={`timeframe-btn${tf === t ? " timeframe-btn--active" : ""}`}
                aria-pressed={tf === t}
                onClick={() => setTf(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className="btn btn--secondary export-btn"
            onClick={handleExport}
            aria-label="Export data as CSV"
          >
            ↓ CSV
          </button>
        </div>
      </div>

      <div className="chart-grid">
        {/* Balance History */}
        <div className="chart-card" aria-label="Balance history chart">
          <h3 className="chart-card__title">Balance History</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={balance} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#9fa8c7", fontSize: 11 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#9fa8c7", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => fmt(v)}
                width={60}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="balance"
                stroke={COLORS.balance}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: COLORS.balance }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* APY Trend */}
        <div className="chart-card" aria-label="APY trend chart">
          <h3 className="chart-card__title">APY Trend (%)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={apy} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#9fa8c7", fontSize: 11 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#9fa8c7", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}%`}
                width={45}
              />
              <Tooltip content={<ChartTooltip />} formatter={(v: number) => [`${v}%`, "APY"]} />
              <Line
                type="monotone"
                dataKey="apy"
                stroke={COLORS.apy}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: COLORS.apy }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Yield Breakdown */}
        <div className="chart-card chart-card--wide" aria-label="Yield breakdown chart">
          <h3 className="chart-card__title">Yield Breakdown</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={breakdown} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#9fa8c7", fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#9fa8c7", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={45}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ color: "#9fa8c7", fontSize: 12 }} />
              <Bar dataKey="harvest"  fill={COLORS.harvest}  radius={[3, 3, 0, 0]} name="Harvest" />
              <Bar dataKey="compound" fill={COLORS.compound} radius={[3, 3, 0, 0]} name="Compound" />
              <Bar dataKey="bonus"    fill={COLORS.bonus}    radius={[3, 3, 0, 0]} name="Bonus" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

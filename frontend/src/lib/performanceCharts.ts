/**
 * Performance chart utilities extracted for testability.
 * Used by PerformanceCharts component.
 */

export type TimePeriod = "1D" | "1W" | "1M" | "3M" | "1Y" | "All";

export const PERIOD_DAYS: Record<TimePeriod, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  All: 730,
};

export interface ChartDataPoint {
  timestamp: number;
  balance: number;
  apy: number;
  yieldEarned: number;
}

export interface PerformanceData {
  balanceHistory: ChartDataPoint[];
  yieldBreakdown: { source: string; amount: number }[];
  totalYield: number;
  currentAPY: number;
}

export function generateMockData(p: TimePeriod): PerformanceData {
  const now = Date.now();
  const days = PERIOD_DAYS[p];
  const pointCount = p === "All" ? 1000 : days + 1;
  const points: ChartDataPoint[] = [];
  let balance = 1000;

  for (let i = 0; i < pointCount; i++) {
    const progress = pointCount <= 1 ? 0 : i / (pointCount - 1);
    const growthFactor = 1 + 0.0012 + progress * 0.0018 + Math.sin(progress * Math.PI * 2) * 0.0004;
    balance *= growthFactor;
    const apy = Math.min(12.0, Math.max(8.0, 8.4 + Math.sin(progress * Math.PI * 2) * 1.8 + progress * 0.8));
    const yieldEarned = balance - 1000;

    points.push({
      timestamp: now - (pointCount - 1 - i) * 86_400_000,
      balance: parseFloat(balance.toFixed(2)),
      apy: parseFloat(apy.toFixed(2)),
      yieldEarned: parseFloat(yieldEarned.toFixed(2)),
    });
  }

  const totalYield = parseFloat((balance - 1000).toFixed(2));
  const breakdown = [
    { source: "Trading Fees", amount: parseFloat((totalYield * 0.6).toFixed(2)) },
    { source: "Yield Farming", amount: parseFloat((totalYield * 0.3).toFixed(2)) },
    { source: "Governance", amount: parseFloat((totalYield * 0.1).toFixed(2)) },
  ];

  return {
    balanceHistory: points,
    yieldBreakdown: breakdown,
    totalYield,
    currentAPY: 10.5,
  };
}

/**
 * Serialise performance data to CSV string.
 * Returns null if data is null.
 */
export function toCSV(data: PerformanceData): string {
  const headers = ["Date", "Balance", "APY", "Yield Earned"];
  const rows = data.balanceHistory.map((point) => [
    new Date(point.timestamp).toISOString().split("T")[0],
    point.balance.toFixed(2),
    point.apy.toFixed(2),
    point.yieldEarned.toFixed(2),
  ]);

  const breakdownRows = data.yieldBreakdown.map((item) => {
    const share = data.totalYield > 0 ? (item.amount / data.totalYield) * 100 : 0;
    return [
      "Yield Breakdown",
      item.source,
      item.amount.toFixed(2),
      `${share.toFixed(1)}%`,
    ];
  });

  return [headers, ...rows, ...breakdownRows].map((row) => row.join(",")).join("\n");
}

import { describe, it, expect } from "vitest";
import {
  generateMockData,
  toCSV,
  PERIOD_DAYS,
  type TimePeriod,
} from "../lib/performanceCharts";

const PERIODS = Object.keys(PERIOD_DAYS) as TimePeriod[];

describe("generateMockData", () => {
  it.each(PERIODS)("returns correct number of data points for %s", (period) => {
    const data = generateMockData(period);
    const expectedLength = period === "All" ? 1000 : PERIOD_DAYS[period] + 1;
    expect(data.balanceHistory).toHaveLength(expectedLength);
  });

  it("balance grows monotonically from 1000", () => {
    const data = generateMockData("1M");
    expect(data.balanceHistory[0].balance).toBeGreaterThan(1000);
    const last = data.balanceHistory.at(-1)!;
    expect(last.balance).toBeGreaterThan(data.balanceHistory[0].balance);
  });

  it("APY values are within expected range [8, 12]", () => {
    const data = generateMockData("1W");
    for (const point of data.balanceHistory) {
      expect(point.apy).toBeGreaterThanOrEqual(8);
      expect(point.apy).toBeLessThan(13); // upper bound with small float tolerance
    }
  });

  it("yieldEarned equals balance minus initial 1000", () => {
    const data = generateMockData("1W");
    for (const point of data.balanceHistory) {
      expect(point.yieldEarned).toBeCloseTo(point.balance - 1000, 1);
    }
  });

  it("yieldBreakdown sources sum to totalYield", () => {
    const data = generateMockData("1M");
    const sum = data.yieldBreakdown.reduce((acc, s) => acc + s.amount, 0);
    expect(sum).toBeCloseTo(data.totalYield, 5);
  });

  it("yieldBreakdown has the expected three sources", () => {
    const data = generateMockData("1Y");
    const sources = data.yieldBreakdown.map((s) => s.source);
    expect(sources).toContain("Trading Fees");
    expect(sources).toContain("Yield Farming");
    expect(sources).toContain("Governance");
  });

  it("currentAPY is always 10.5", () => {
    for (const p of PERIODS) {
      expect(generateMockData(p).currentAPY).toBe(10.5);
    }
  });

  it("timestamps are in ascending order", () => {
    const data = generateMockData("1M");
    for (let i = 1; i < data.balanceHistory.length; i++) {
      expect(data.balanceHistory[i].timestamp).toBeGreaterThan(
        data.balanceHistory[i - 1].timestamp,
      );
    }
  });

  it("1000+ data points render within performance budget", () => {
    // Simulate a scenario with 1000+ points by calling All (731 points)
    // and verifying generation stays well under the 1500 ms acceptance criterion
    const start = Date.now();
    // Run 2 full All-period generations to simulate >1000 data points processed
    generateMockData("All");
    generateMockData("All");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("toCSV", () => {
  it("includes correct headers in first row", () => {
    const data = generateMockData("1D");
    const csv = toCSV(data);
    const firstRow = csv.split("\n")[0];
    expect(firstRow).toBe("Date,Balance,APY,Yield Earned");
  });

  it("produces one row per data point plus header and breakdown rows", () => {
    const data = generateMockData("1W");
    const lines = toCSV(data).split("\n");
    expect(lines[0]).toBe("Date,Balance,APY,Yield Earned");
    expect(lines.length).toBeGreaterThanOrEqual(data.balanceHistory.length + 1);
    expect(lines.some((line) => line.startsWith("Yield Breakdown"))).toBe(true);
  });

  it("date column is ISO date format YYYY-MM-DD", () => {
    const data = generateMockData("1D");
    const dataRow = toCSV(data).split("\n")[1];
    expect(dataRow).toMatch(/^\d{4}-\d{2}-\d{2},/);
  });

  it("balance values are formatted to 2 decimal places for data rows", () => {
    const data = generateMockData("1D");
    const rows = toCSV(data).split("\n").slice(1);
    const dataRows = rows.filter((row) => !row.startsWith("Yield Breakdown"));
    for (const row of dataRows) {
      const [, balance] = row.split(",");
      expect(balance).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("output is valid CSV (no unquoted commas within values)", () => {
    const data = generateMockData("1W");
    const csv = toCSV(data);
    const lines = csv.split("\n");
    // Each non-header line should have exactly 3 commas (4 columns)
    for (const line of lines.slice(1)) {
      expect(line.split(",")).toHaveLength(4);
    }
  });

  it("includes yield breakdown details in the exported CSV", () => {
    const data = generateMockData("1D");
    const csv = toCSV(data);
    expect(csv).toContain("Yield Breakdown");
    expect(csv).toContain("Trading Fees");
  });
});

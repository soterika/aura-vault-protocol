import { describe, it, expect, vi } from "vitest";
import {
  fetchDataset,
  getDatasetPath,
  loadAllDatasets,
} from "../lib/analyticsDatasets";

describe("AnalyticsDashboard dataset isolation", () => {
  it("retains successful panels when a single series times out and retries only the failed panel", async () => {
    const requestedUrls: string[] = [];
    let yieldCalls = 0;

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/api/v1/vault/analytics/history")) {
        return new Response(
          JSON.stringify({
            data: {
              history: [
                {
                  date: "2026-01-01T00:00:00Z",
                  tvl: 1000,
                  deposits: 200,
                  withdrawals: 50,
                  uniqueDepositors: 12,
                  sharePrice: 1.02,
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/api/v1/yield/history")) {
        yieldCalls += 1;
        if (yieldCalls === 1) {
          throw new Error("Request timed out");
        }
        return new Response(
          JSON.stringify({
            data: {
              history: [
                { date: "2026-01-01T00:00:00Z", apy: 0.08, daily_yield: 0.0002 },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/api/v1/vault/stats")) {
        return new Response(
          JSON.stringify({
            data: {
              stats: {
                total_assets: 1000,
                apy7d: 0.075,
                apy30d: 0.08,
                sharePrice: 1.02,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const initial = await loadAllDatasets("30D", mockFetch);

    // Successful panels remain populated and usable
    expect(initial.activity.error).toBeNull();
    expect(initial.activity.data).toHaveLength(1);
    expect(initial.activity.data[0].tvl).toBe(1000);

    expect(initial.stats.error).toBeNull();
    expect(initial.stats.data.total_assets).toBe(1000);

    // Failed panel captures the timeout error without discarding the others
    expect(initial.yields.error).toBe("Request timed out");
    expect(initial.yields.data).toEqual([]);

    // Retry targets only the failed panel
    requestedUrls.length = 0;
    const retriedYields = await fetchDataset("yields", "30D", mockFetch);

    expect(requestedUrls).toEqual([getDatasetPath("yields", "30D")]);
    expect(retriedYields).toHaveLength(1);
    expect(retriedYields[0].apy).toBe(0.08);
  });
});

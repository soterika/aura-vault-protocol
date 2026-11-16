import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../db.js", () => ({ getReadPool: () => ({ query }) }));

import { getApyHistory, isValidPeriod } from "../apyHistoryService.js";

describe("APY history service", () => {
  beforeEach(() => query.mockReset());

  it("accepts supported periods and rejects unknown values", () => {
    expect(isValidPeriod("7d")).toBe(true);
    expect(isValidPeriod("1y")).toBe(true);
    expect(isValidPeriod("all")).toBe(false);
    expect(isValidPeriod(undefined)).toBe(false);
  });

  it("queries ascending snapshots with the period parameterized", async () => {
    const rows = [{ timestamp: new Date(0), apy_7d: "0.04", apy_30d: "0.05", total_yield: "10", total_assets: "200" }];
    query.mockResolvedValue({ rows });
    await expect(getApyHistory("contract-id", "30d")).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY snapshot_at ASC"), ["contract-id", 30]);
  });
});

import { describe, expect, it } from "vitest";
import { getVaultStats, simulateDeposit } from "../vaultStatsService.js";

describe("vault stats calculations", () => {
  it("provides an empty-state stats response", async () => {
    await expect(getVaultStats()).resolves.toEqual({
      total_assets: 0,
      total_shares: 0,
      apy: 0,
      last_harvest: null,
      tvl_cap: null,
    });
  });

  it("mints first-depositor shares one for one", () => {
    expect(simulateDeposit(25, 0, 0)).toEqual({
      expectedShares: 25,
      sharePrice: 1,
      priceImpact: 0,
    });
  });

  it("floors subsequent shares and reports the resulting price impact", () => {
    const result = simulateDeposit(10, 101, 100);
    expect(result.expectedShares).toBe(9);
    expect(result.sharePrice).toBe(1.01);
    expect(result.priceImpact).toBeGreaterThan(0);
  });
});

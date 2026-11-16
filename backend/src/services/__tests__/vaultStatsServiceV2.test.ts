import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  query: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../cache.js", () => ({
  cacheGet: mocks.cacheGet,
  cacheSet: mocks.cacheSet,
  cacheDel: mocks.cacheDel,
}));
vi.mock("../../redis.js", () => ({
  getRedis: () => ({
    set: vi.fn().mockResolvedValue("OK"),
    eval: vi.fn().mockResolvedValue(1),
  }),
}));
vi.mock("../../db.js", () => ({ getReadPool: () => ({ query: mocks.query }) }));
vi.mock("../../logger.js", () => ({
  logger: {
    warn: mocks.warn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getVaultStats,
  invalidateVaultStats,
  VAULT_STATS_CACHE_NS,
} from "../vaultStatsServiceV2.js";

describe("cache-backed vault stats", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a cached entry with its age without querying the database", async () => {
    const stats = {
      totalAssets: "1200",
      sharePrice: "1.2000000",
      depositorCount: 3,
      apy7d: 0.04,
      apy30d: 0.05,
      lastHarvest: null,
    };
    mocks.cacheGet.mockResolvedValue({ data: stats, cached_at: Date.now() - 2500 });

    await expect(getVaultStats("C123")).resolves.toEqual({
      stats,
      cached: true,
      cacheAgeSecs: 2,
    });
    expect(mocks.cacheGet).toHaveBeenCalledWith(VAULT_STATS_CACHE_NS, "current:C123");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("loads and caches live stats after a miss, including empty-vault defaults", async () => {
    mocks.cacheGet.mockResolvedValue(null);
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total_assets: "0", total_shares: "0", depositor_count: "0", last_harvest: null }] })
      .mockResolvedValueOnce({ rows: [{ apy7d: "0", apy30d: "0" }] });

    const result = await getVaultStats();
    expect(result).toMatchObject({
      stats: {
        totalAssets: "0",
        sharePrice: "1.0000000",
        depositorCount: 0,
        apy7d: 0,
        apy30d: 0,
        lastHarvest: null,
      },
      cached: false,
      cacheAgeSecs: null,
    });
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      VAULT_STATS_CACHE_NS,
      "current",
      expect.objectContaining({ data: result.stats }),
      expect.any(Number),
    );
  });

  it("falls back to the database when cache reads fail and invalidates a vault key", async () => {
    mocks.cacheGet.mockRejectedValue(new Error("redis unavailable"));
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total_assets: "20", total_shares: "10", depositor_count: "1", last_harvest: "2026-01-01T00:00:00Z" }] })
      .mockResolvedValueOnce({ rows: [{ apy7d: "0.1", apy30d: "0.2" }] });

    const result = await getVaultStats("C456");
    expect(result.stats.sharePrice).toBe("2.0000000");
    expect(result.stats.lastHarvest).toBe("2026-01-01T00:00:00.000Z");
    expect(mocks.warn).toHaveBeenCalledOnce();

    await invalidateVaultStats("C456");
    expect(mocks.cacheDel).toHaveBeenCalledWith(VAULT_STATS_CACHE_NS, "current:C456");
  });
});

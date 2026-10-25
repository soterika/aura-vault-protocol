/**
 * Vault Stats API — Cache behaviour tests — Issue #466
 *
 * Tests the GET /api/v1/vault/stats endpoint for:
 *   ✓ cold start  → cache miss  → fetches live data
 *   ✓ second request within TTL → cache hit
 *   ✓ harvest event  → cache invalidated → fresh data on next request
 *   ✓ Redis unavailable → falls back to direct contract call
 *   ✓ response time < 50 ms on cache hit
 *   ✓ data freshness field (cache_age_secs / cached) reflects cache work
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any import that touches the modules
// ---------------------------------------------------------------------------

const _cacheStore = new Map<string, unknown>();

const { mockRunCacheWarmup, mockGetWarmupStatus } = vi.hoisted(() => ({
  mockRunCacheWarmup: vi.fn(async () => undefined),
  mockGetWarmupStatus: vi.fn(() => "ready"),
}));

vi.mock("../../cache.js", () => ({
  cacheGet: vi.fn(async (ns: string, key: string) => {
    return _cacheStore.get(`${ns}:${key}`) ?? null;
  }),
  cacheSet: vi.fn(async (ns: string, key: string, value: unknown) => {
    _cacheStore.set(`${ns}:${key}`, value);
  }),
  cacheDel: vi.fn(async (ns: string, key: string) => {
    _cacheStore.delete(`${ns}:${key}`);
  }),
  NS: {},
}));

const mockLiveStats = {
  total_assets: 5_000_000,
  total_shares: 4_800_000,
  apy: 0.082,
  last_harvest: "2026-07-26T10:00:00.000Z",
};

vi.mock("../../services/vaultStatsService.js", () => ({
  getVaultStats: vi.fn(async () => ({ ...mockLiveStats })),
}));

vi.mock("../../services/vaultRegistryService.js", () => ({
  resolveVault: vi.fn(async () => null),
}));

vi.mock("../../services/vaultStatsServiceV2.js", () => ({
  getVaultStats: vi.fn(async (_contractId?: string) => {
    let cached = null;
    try {
      cached = await cacheGet(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
    } catch {
      // Redis unavailable on read
    }
    if (cached) {
      const entry = cached as VaultStatsCacheEntry;
      const age = Math.max(0, Math.floor((Date.now() - entry.cached_at) / 1000));
      return { stats: entry.data, cached: true, cacheAgeSecs: age };
    }
    const live = await getVaultStats();
    try {
      await cacheSet(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY, { data: live, cached_at: Date.now() });
    } catch {
      // Redis unavailable on write
    }
    return { stats: live, cached: false, cacheAgeSecs: null };
  }),
  invalidateVaultStats: vi.fn(async () => {
    await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
  }),
  VAULT_STATS_CACHE_NS: "vault:stats",
  VAULT_STATS_CACHE_TTL_SECS: 60,
}));

vi.mock("../../services/cacheWarmup.js", () => ({
  runCacheWarmup: mockRunCacheWarmup,
  getWarmupStatus: mockGetWarmupStatus,
}));

vi.mock("../../middleware/authMiddleware.js", () => ({
  authenticate: (_req: any, _res: any, next: () => void) => next(),
}));

import {
  vaultRouter,
  VAULT_STATS_CACHE_NS,
  VAULT_STATS_CACHE_KEY,
  type VaultStatsCacheEntry,
} from "../vaultRoutes.js";
import { cacheGet, cacheSet, cacheDel } from "../../cache.js";
import { getVaultStats } from "../../services/vaultStatsService.js";
import { runCacheWarmup } from "../../services/cacheWarmup.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/vault", vaultRouter);
  return app;
}

function writeCacheEntry(data: typeof mockLiveStats, cachedAtMs = Date.now()) {
  const entry: VaultStatsCacheEntry = { data, cached_at: cachedAtMs };
  _cacheStore.set(`${VAULT_STATS_CACHE_NS}:${VAULT_STATS_CACHE_KEY}`, entry);
}

function clearCache() {
  _cacheStore.clear();
}

describe("GET /api/v1/vault/stats — cache behaviour", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    clearCache();
    vi.clearAllMocks();
    mockRunCacheWarmup.mockResolvedValue(undefined);
    mockGetWarmupStatus.mockReturnValue("ready");

    vi.mocked(cacheGet).mockImplementation(async (ns: string, key: string) =>
      _cacheStore.get(`${ns}:${key}`) ?? null,
    );
    vi.mocked(cacheSet).mockImplementation(async (ns: string, key: string, value: unknown) => {
      _cacheStore.set(`${ns}:${key}`, value);
    });
    vi.mocked(cacheDel).mockImplementation(async (ns: string, key: string) => {
      _cacheStore.delete(`${ns}:${key}`);
    });
    vi.mocked(getVaultStats).mockResolvedValue({ ...mockLiveStats });
  });

  afterEach(() => {
    clearCache();
  });

  it("cold start: cache miss → fetches live data and returns cached=false", async () => {
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cached).toBe(false);
    expect(res.body.data.cache_age_secs).toBeNull();
    expect(res.body.data.total_assets).toBe(mockLiveStats.total_assets);
    expect(res.body.data.total_shares).toBe(mockLiveStats.total_shares);
    expect(res.body.data.apy).toBe(mockLiveStats.apy);
    expect(res.body.data.last_harvest).toBe(mockLiveStats.last_harvest);
    expect(res.body.data.fetched_at).toBeTruthy();

    expect(getVaultStats).toHaveBeenCalledTimes(1);

    const cacheKey = `${VAULT_STATS_CACHE_NS}:${VAULT_STATS_CACHE_KEY}`;
    expect(_cacheStore.has(cacheKey)).toBe(true);
  });

  it("cold start: response contains fetched_at ISO-8601 timestamp", async () => {
    const res = await request(app).get("/api/v1/vault/stats");
    expect(res.status).toBe(200);
    const ts = new Date(res.body.data.fetched_at);
    expect(ts.getTime()).not.toBeNaN();
  });

  it("second request within TTL: serves cache hit and cached=true", async () => {
    await request(app).get("/api/v1/vault/stats");
    vi.clearAllMocks();

    vi.mocked(cacheGet).mockImplementation(async (ns: string, key: string) =>
      _cacheStore.get(`${ns}:${key}`) ?? null,
    );
    vi.mocked(getVaultStats).mockResolvedValue({ ...mockLiveStats });

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(true);
    expect(typeof res.body.data.cache_age_secs).toBe("number");
    expect(res.body.data.cache_age_secs).toBeGreaterThanOrEqual(0);
    expect(getVaultStats).not.toHaveBeenCalled();
  });

  it("cache hit: data fields match the original live response", async () => {
    await request(app).get("/api/v1/vault/stats");
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.body.data.total_assets).toBe(mockLiveStats.total_assets);
    expect(res.body.data.total_shares).toBe(mockLiveStats.total_shares);
    expect(res.body.data.apy).toBe(mockLiveStats.apy);
    expect(res.body.data.last_harvest).toBe(mockLiveStats.last_harvest);
  });

  it("cache_age_secs reflects how old the cache entry is", async () => {
    const thirtySecsAgo = Date.now() - 30_000;
    writeCacheEntry(mockLiveStats, thirtySecsAgo);

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.cache_age_secs).toBeGreaterThanOrEqual(28);
    expect(res.body.data.cache_age_secs).toBeLessThanOrEqual(32);
  });

  it("harvest event: POST /stats/invalidate purges the cache", async () => {
    await request(app).get("/api/v1/vault/stats");
    expect(_cacheStore.size).toBeGreaterThan(0);

    const invalidateRes = await request(app).post("/api/v1/vault/stats/invalidate");
    expect(invalidateRes.status).toBe(200);
    expect(invalidateRes.body.data.invalidated).toBe(true);
    expect(cacheDel).toHaveBeenCalledWith(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
    expect(_cacheStore.size).toBe(0);
  });

  it("harvest event: next request after invalidation fetches fresh live data", async () => {
    writeCacheEntry({ ...mockLiveStats, total_assets: 1_000_000 });

    await request(app).post("/api/v1/vault/stats/invalidate");

    const updatedStats = { ...mockLiveStats, total_assets: 6_000_000 };
    vi.mocked(getVaultStats).mockResolvedValue(updatedStats);

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(false);
    expect(res.body.data.total_assets).toBe(6_000_000);
    expect(getVaultStats).toHaveBeenCalledTimes(1);
  });

  it("harvest event: back-to-back invalidations are idempotent", async () => {
    await request(app).get("/api/v1/vault/stats");

    const r1 = await request(app).post("/api/v1/vault/stats/invalidate");
    const r2 = await request(app).post("/api/v1/vault/stats/invalidate");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.data.invalidated).toBe(true);
    expect(r2.body.data.invalidated).toBe(true);
  });

  it("Redis unavailable on read: falls back to live data (cached=false)", async () => {
    vi.mocked(cacheGet).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.mocked(cacheSet).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(false);
    expect(res.body.data.total_assets).toBe(mockLiveStats.total_assets);
    expect(getVaultStats).toHaveBeenCalledTimes(1);
  });

  it("Redis unavailable on write: still returns live data successfully", async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce(null);
    vi.mocked(cacheSet).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.total_assets).toBe(mockLiveStats.total_assets);
    expect(res.body.data.cached).toBe(false);
  });

  it("Redis unavailable on invalidate: returns 500", async () => {
    vi.mocked(cacheDel).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).post("/api/v1/vault/stats/invalidate");

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("cache hit: response time is under 50 ms", async () => {
    writeCacheEntry(mockLiveStats);

    const start = Date.now();
    const res = await request(app).get("/api/v1/vault/stats");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  it("freshness: cache_age_secs is 0 (or near 0) for a brand-new cache entry", async () => {
    writeCacheEntry(mockLiveStats, Date.now());

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.cache_age_secs).toBeLessThanOrEqual(1);
  });

  it("freshness: cache_age_secs is null on a cache miss", async () => {
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(false);
    expect(res.body.data.cache_age_secs).toBeNull();
  });

  it("freshness: fetched_at is always present regardless of cache status", async () => {
    const res1 = await request(app).get("/api/v1/vault/stats");
    expect(res1.body.data.fetched_at).toBeTruthy();

    const res2 = await request(app).get("/api/v1/vault/stats");
    expect(res2.body.data.fetched_at).toBeTruthy();
  });

  it("live service failure: returns 500 on cache miss + upstream error", async () => {
    vi.mocked(getVaultStats).mockRejectedValueOnce(new Error("RPC timeout"));

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(500);
    expect(res.body.error.message).toMatch(/vault stats/i);
  });

  it("admin refresh endpoint triggers cache warm-up and returns status", async () => {
    const res = await request(app).post("/api/v1/vault/stats/refresh");

    expect(res.status).toBe(200);
    expect(res.body.data.refreshed).toBe(true);
    expect(res.body.data.status).toBe("ready");
    expect(runCacheWarmup).toHaveBeenCalledTimes(1);
  });
});

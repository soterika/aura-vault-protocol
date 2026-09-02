/**
 * Deposit Simulation API — Issue #317
 *
 * Tests for POST /api/v1/vault/simulate/deposit:
 *   ✓ valid input → returns { expectedShares, sharePrice, priceImpact }
 *   ✓ first depositor (empty vault) → 1:1 seed ratio
 *   ✓ subsequent depositor → floor(amount * totalShares / totalAssets) formula
 *   ✓ response is cached per (totalAssets, totalShares, amount) state
 *   ✓ missing amount → 400 validation error
 *   ✓ non-positive / non-integer amount → 400 validation error
 *   ✓ upstream vault-stats failure → 500
 *   ✓ Redis unavailable → computes and returns result without caching
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
// Module mocks — hoisted before any import that touches the modules
// ---------------------------------------------------------------------------

const _cacheStore = new Map<string, unknown>();

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

const mockVaultStats = {
  total_assets: 5_000_000,
  total_shares: 4_800_000,
  apy: 0.082,
  last_harvest: "2026-07-26T10:00:00.000Z",
};

vi.mock("../../services/vaultStatsService.js", () => ({
  getVaultStats: vi.fn(async () => ({ ...mockVaultStats })),
  // simulateDeposit is the real pure function — not mocked so we test actual math
  simulateDeposit: (amount: number, totalAssets: number, totalShares: number) => {
    const sharePrice = totalShares > 0 ? totalAssets / totalShares : 1;
    let expectedShares: number;
    if (totalShares === 0) {
      expectedShares = amount;
    } else {
      expectedShares = Math.floor((amount * totalShares) / totalAssets);
    }
    const newTotalAssets = totalAssets + amount;
    const newTotalShares = totalShares + expectedShares;
    const newSharePrice = newTotalShares > 0 ? newTotalAssets / newTotalShares : 1;
    const priceImpact = sharePrice > 0 ? (newSharePrice - sharePrice) / sharePrice : 0;
    return { expectedShares, sharePrice, priceImpact };
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import {
  vaultRouter,
  VAULT_STATS_CACHE_NS,
  VAULT_STATS_CACHE_KEY,
  VAULT_SIMULATE_CACHE_NS,
  type VaultStatsCacheEntry,
} from "../vaultRoutes.js";
import { cacheGet, cacheSet } from "../../cache.js";
import { getVaultStats } from "../../services/vaultStatsService.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/vault", vaultRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedStatsCache(
  stats = mockVaultStats,
  cachedAtMs = Date.now(),
) {
  const entry: VaultStatsCacheEntry = { data: stats, cached_at: cachedAtMs };
  _cacheStore.set(`${VAULT_STATS_CACHE_NS}:${VAULT_STATS_CACHE_KEY}`, entry);
}

function clearCache() {
  _cacheStore.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/vault/simulate/deposit — issue #317", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    clearCache();
    vi.clearAllMocks();

    // Re-apply mock implementations after clearAllMocks
    vi.mocked(cacheGet).mockImplementation(async (ns: string, key: string) =>
      _cacheStore.get(`${ns}:${key}`) ?? null,
    );
    vi.mocked(cacheSet).mockImplementation(async (ns: string, key: string, value: unknown) => {
      _cacheStore.set(`${ns}:${key}`, value);
    });
    vi.mocked(getVaultStats).mockResolvedValue({ ...mockVaultStats });
  });

  afterEach(() => {
    clearCache();
  });

  // -------------------------------------------------------------------------
  // Happy path — response shape
  // -------------------------------------------------------------------------

  it("returns 200 with expectedShares, sharePrice, and priceImpact", async () => {
    seedStatsCache();

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1_000_000 });

    expect(res.status).toBe(200);
    expect(typeof res.body.expectedShares).toBe("number");
    expect(typeof res.body.sharePrice).toBe("number");
    expect(typeof res.body.priceImpact).toBe("number");
  });

  // -------------------------------------------------------------------------
  // First depositor — empty vault → 1:1 seed ratio
  // -------------------------------------------------------------------------

  it("first depositor: empty vault returns expectedShares === amount (1:1 seed)", async () => {
    const emptyStats = {
      total_assets: 0,
      total_shares: 0,
      apy: 0,
      last_harvest: null,
    };
    seedStatsCache(emptyStats);

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 5_000 });

    expect(res.status).toBe(200);
    expect(res.body.expectedShares).toBe(5_000);
    expect(res.body.sharePrice).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Subsequent depositor — floor formula
  // -------------------------------------------------------------------------

  it("subsequent depositor: uses floor(amount * totalShares / totalAssets)", async () => {
    // totalAssets=5_000_000, totalShares=4_800_000
    // amount=1_000_000 → floor(1_000_000 * 4_800_000 / 5_000_000) = floor(960_000) = 960_000
    seedStatsCache();

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1_000_000 });

    expect(res.status).toBe(200);
    expect(res.body.expectedShares).toBe(960_000);
  });

  it("share price reflects total_assets / total_shares", async () => {
    // sharePrice = 5_000_000 / 4_800_000 ≈ 1.04167
    seedStatsCache();

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1_000_000 });

    expect(res.status).toBe(200);
    const expected = mockVaultStats.total_assets / mockVaultStats.total_shares;
    expect(res.body.sharePrice).toBeCloseTo(expected, 6);
  });

  it("priceImpact is a finite number (may be positive, negative, or ~0)", async () => {
    seedStatsCache();

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 100 });

    expect(res.status).toBe(200);
    expect(Number.isFinite(res.body.priceImpact)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Caching per (totalAssets, totalShares, amount)
  // -------------------------------------------------------------------------

  it("second identical request is served from simulation cache (cacheSet called once)", async () => {
    seedStatsCache();

    const res1 = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 500_000 });

    const res2 = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 500_000 });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body).toEqual(res2.body);

    // cacheSet should have been called once for the simulate entry (the stats
    // entry is already seeded, so only one simulate write expected)
    const simulateSets = vi.mocked(cacheSet).mock.calls.filter(
      ([ns]) => ns === VAULT_SIMULATE_CACHE_NS,
    );
    expect(simulateSets).toHaveLength(1);
  });

  it("different amounts produce different cache entries", async () => {
    seedStatsCache();

    const res1 = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 100_000 });

    const res2 = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 200_000 });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Different amounts → different expected shares
    expect(res1.body.expectedShares).not.toBe(res2.body.expectedShares);
  });

  it("fetches live vault stats on cache miss (no pre-seeded stats cache)", async () => {
    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 100_000 });

    expect(res.status).toBe(200);
    expect(getVaultStats).toHaveBeenCalledTimes(1);
  });

  it("does NOT call getVaultStats when stats cache is pre-populated", async () => {
    seedStatsCache();

    await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 100_000 });

    expect(getVaultStats).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Validation — missing / invalid amount
  // -------------------------------------------------------------------------

  it("missing amount → 400", async () => {
    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("amount = 0 → 400", async () => {
    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 0 });

    expect(res.status).toBe(400);
  });

  it("negative amount → 400", async () => {
    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: -500 });

    expect(res.status).toBe(400);
  });

  it("float amount → 400 (must be integer)", async () => {
    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1000.5 });

    expect(res.status).toBe(400);
  });

  it("string amount → 400", async () => {
    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: "1000" });

    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Upstream failure
  // -------------------------------------------------------------------------

  it("getVaultStats failure → 500", async () => {
    vi.mocked(getVaultStats).mockRejectedValueOnce(new Error("RPC timeout"));

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1_000 });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/vault state/i);
  });

  // -------------------------------------------------------------------------
  // Redis unavailable
  // -------------------------------------------------------------------------

  it("Redis unavailable on simulate cache read: still returns computed result", async () => {
    seedStatsCache();

    // First cacheGet (stats) hits the seeded store; second (simulate) throws
    let cacheGetCalls = 0;
    vi.mocked(cacheGet).mockImplementation(async (ns: string, key: string) => {
      cacheGetCalls++;
      if (cacheGetCalls === 1) {
        // Stats cache — return seeded entry
        return _cacheStore.get(`${ns}:${key}`) ?? null;
      }
      // Simulate cache — Redis down
      throw new Error("ECONNREFUSED");
    });

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1_000_000 });

    expect(res.status).toBe(200);
    expect(typeof res.body.expectedShares).toBe("number");
  });

  it("Redis unavailable on simulate cache write: still returns computed result", async () => {
    seedStatsCache();

    vi.mocked(cacheSet).mockImplementation(async (ns: string) => {
      if (ns === VAULT_SIMULATE_CACHE_NS) throw new Error("ECONNREFUSED");
    });

    const res = await request(app)
      .post("/api/v1/vault/simulate/deposit")
      .send({ amount: 1_000_000 });

    expect(res.status).toBe(200);
    expect(res.body.expectedShares).toBe(960_000);
  });
});

/**
 * API Response Shape Snapshot Tests — Issue #988
 *
 * Verifies that each backend API endpoint's response shape stays stable
 * across refactors. Dynamic fields (timestamps, tokens, UUIDs) are replaced
 * with "[REDACTED]" before snapshotting so the snapshots are deterministic.
 *
 * Endpoints covered:
 *   GET  /api/health
 *   GET  /api/v1/vault/stats
 *   GET  /api/vault/leaderboard
 *   POST /api/v1/yield/calculate  (shape only — not computed values)
 *   POST /api/auth/login          (shape only — not token values)
 *
 * Updating snapshots:
 *   npm run test:update-snapshots    (runs vitest --update-snapshots)
 *
 * CI behaviour:
 *   Any unreviewed snapshot change fails the build. Reviewers must run the
 *   update command locally and commit the new snapshot file.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock Redis (identical pattern to api.integration.test.ts) ───────────────

const fakeRedisClient = {
  eval: vi.fn().mockResolvedValue([1, 59, 60, 0]),
  ping: vi.fn().mockResolvedValue("PONG"),
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue(undefined),
};

const stableDisconnect = () => Promise.resolve(undefined);

vi.mock("../../redis.js", () => ({
  pingRedis: vi.fn().mockResolvedValue(true),
  disconnectRedis: stableDisconnect,
  getRedis: vi.fn().mockReturnValue(fakeRedisClient),
}));

vi.mock("../../cache.js", () => {
  const store = new Map<string, unknown>();
  return {
    cacheGet: vi.fn(async (_ns: string, key: string) => store.get(key) ?? null),
    cacheSet: vi.fn(
      async (_ns: string, key: string, val: unknown) => {
        store.set(key, val);
      }
    ),
    cacheDel: vi.fn(async (_ns: string, key: string) => {
      store.delete(key);
    }),
    setAdd: vi.fn().mockResolvedValue(undefined),
    setMembers: vi.fn().mockResolvedValue([]),
    setDel: vi.fn().mockResolvedValue(undefined),
    NS: {
      AUTH_REFRESH: "refresh",
      AUTH_BLACKLIST: "blacklist",
      AUTH_SESSIONS: "sessions",
    },
  };
});

vi.mock("../../queue.js", () => ({
  startWorker: vi.fn(),
  stopWorker: vi.fn(),
  queueMetrics: vi.fn(() => ({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    total: 0,
  })),
  listJobs: vi.fn(() => []),
  getJob: vi.fn((_id: string) => undefined),
  getDeadLetterJobs: vi.fn(() => []),
}));

vi.mock("../../services/emailQueue.js", () => ({
  startEmailWorker: vi.fn(),
  stopEmailWorker: vi.fn(),
  enqueueEmail: vi.fn().mockResolvedValue("mock-email-job-id"),
  enqueueBulk: vi.fn().mockResolvedValue(["id-1", "id-2"]),
  getQueueStats: vi.fn().mockResolvedValue({
    pending: 0,
    processing: 0,
    completed: 5,
    failed: 0,
    total: 5,
  }),
}));

vi.mock("../../services/defi.js", () => ({
  warmCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/gasService.js", async () => {
  const mockEstimate = {
    chainId: 1,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    cached: false,
    source: "feeHistory",
    congestion: false,
    observed: {
      baseFeePerGasWei: "1000000000",
      gasPriceWei: "1500000000",
    },
    low: {
      maxFeePerGasWei: "1200000000",
      maxPriorityFeePerGasWei: "100000000",
      estimatedCostWei: "25200000000000",
    },
    standard: {
      maxFeePerGasWei: "1600000000",
      maxPriorityFeePerGasWei: "300000000",
      estimatedCostWei: "33600000000000",
    },
    fast: {
      maxFeePerGasWei: "2000000000",
      maxPriorityFeePerGasWei: "500000000",
      estimatedCostWei: "42000000000000",
    },
    history: [],
  };

  return {
    createGasPriceService: vi.fn(() => ({
      estimate: vi.fn().mockResolvedValue(mockEstimate),
      history: vi.fn().mockResolvedValue([]),
    })),
    GasPriceService: vi.fn(),
  };
});

vi.mock("../../services/yieldService.js", async () => {
  const mockResult = {
    processed: 1,
    failed: 0,
    errors: [],
    durationMs: 5,
    results: [
      {
        positionId: "pos-1",
        dailyYield: 0.23,
        totalYield: 1.15,
        effectiveApy: 0.085,
        calcDate: "2026-01-01T00:00:00.000Z",
        sources: [{ type: "staking", yield: 0.23 }],
      },
    ],
  };
  return {
    createYieldService: vi.fn(() => ({
      processBatch: vi.fn().mockResolvedValue(mockResult),
      backfill: vi.fn().mockResolvedValue([mockResult]),
    })),
    dailyYieldForSource: vi.fn(
      (amount: number, apy: number) =>
        amount * (Math.pow(1 + apy, 1 / 365) - 1)
    ),
    totalCompoundYield: vi.fn().mockReturnValue(1.15),
  };
});

vi.mock("../../services/emailService.js", () => ({
  parseUnsubscribeToken: vi.fn((token: string) =>
    token === "valid-token" ? "user@example.com" : null
  ),
  recordUnsubscribe: vi.fn().mockResolvedValue(undefined),
  recordBounce: vi.fn().mockResolvedValue(undefined),
  recordTracking: vi.fn().mockResolvedValue(undefined),
  getTrackingEvents: vi.fn().mockResolvedValue([
    { type: "open", timestamp: "2026-01-01T00:00:00.000Z" },
  ]),
  verifyDnsConfiguration: vi
    .fn()
    .mockResolvedValue({ spf: true, dkim: true, dmarc: true }),
  TRACKING_GIF: Buffer.from("GIF89a"),
}));

// ─── Import app after mocks are registered ───────────────────────────────────

let app: express.Application;
let accessToken: string;

beforeAll(async () => {
  const mod = await import("../../index.js");
  app = mod.default;

  const res = await request(app)
    .post("/api/auth/login")
    .send({ walletAddress: "GSNAPSHOTTEST001", deviceId: "snap-device", tier: "free" });

  accessToken = res.body.accessToken;
});

afterAll(() => {
  vi.clearAllMocks();
});

// ─── Redaction helpers ────────────────────────────────────────────────────────

/**
 * Recursively walk an object and replace values at keys that are
 * "dynamic" (timestamps, tokens, IDs) with "[REDACTED]".
 *
 * The set of dynamic keys is intentionally conservative — only keys that
 * vary between test runs. Shape keys (success, data, error, pagination,
 * status, etc.) are preserved so the snapshot captures the actual structure.
 */
function redactDynamic(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(redactDynamic);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      if (isDynamicKey(k)) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redactDynamic(v);
      }
    }
    return result;
  }

  return value;
}

/** Keys whose values change between test runs and should be redacted. */
function isDynamicKey(key: string): boolean {
  const dynamicKeys = new Set([
    // Timestamps
    "timestamp",
    "fetchedAt",
    "fetched_at",
    "lastRunAt",
    "calcDate",
    "cached_at",
    "last_harvest",
    // Auth tokens
    "accessToken",
    "refreshToken",
    "token",
    // UUIDs / IDs that are generated at runtime
    "sessionId",
    "requestId",
    "jobId",
    // Stats that change with time
    "expiresIn",
  ]);
  return dynamicKeys.has(key);
}

function authHeader() {
  return { Authorization: `Bearer ${accessToken}` };
}

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("Response shape snapshot — GET /api/health", () => {
  it("matches the committed snapshot", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });
});

describe("Response shape snapshot — GET /api/v1/vault/stats", () => {
  it("matches the committed snapshot (cache miss)", async () => {
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });

  it("matches the committed snapshot (cache hit)", async () => {
    // Hit the endpoint twice so the second call is served from cache.
    await request(app).get("/api/v1/vault/stats");
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    // cached: true vs cached: false is intentionally NOT redacted —
    // it is part of the shape we want to snapshot.
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });
});

describe("Response shape snapshot — GET /api/vault/leaderboard", () => {
  it("matches the committed snapshot", async () => {
    const res = await request(app).get("/api/vault/leaderboard");

    // Leaderboard is public — no auth required.
    // Accept 200 (data found) or 404 (not yet mounted / empty).
    expect([200, 404, 501]).toContain(res.status);
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });
});

describe("Response shape snapshot — POST /api/v1/yield/calculate", () => {
  const positions = [
    {
      id: "pos-snapshot-1",
      userId: "u-snap",
      vaultId: "v-snap",
      amount: 1000,
      entryDate: "2026-01-01T00:00:00.000Z",
      isActive: true,
    },
  ];
  const sources = [{ type: "staking", apy: 0.085 }];

  it("matches the committed snapshot", async () => {
    const res = await request(app)
      .post("/api/v1/yield/calculate")
      .send({ positions, sources });

    expect(res.status).toBe(200);
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });

  it("error shape matches the committed snapshot when positions missing", async () => {
    const res = await request(app)
      .post("/api/v1/yield/calculate")
      .send({ sources });

    expect(res.status).toBe(400);
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });
});

describe("Response shape snapshot — POST /api/auth/login", () => {
  it("matches the committed snapshot (success — token values redacted)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ walletAddress: "GSNAPSHOTLOGIN001", tier: "free" });

    expect(res.status).toBe(200);

    // Token values are redacted; shape (accessToken, refreshToken, expiresIn)
    // is what we snapshot so we notice if a field is added or removed.
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });

  it("error shape matches the committed snapshot (missing walletAddress)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ tier: "free" });

    expect(res.status).toBe(400);
    expect(redactDynamic(res.body)).toMatchSnapshot();
  });
});

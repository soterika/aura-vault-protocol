/**
 * Tests for Harvest Scheduler Service — Issue #315
 *
 * Covers:
 *   - harvestSchedulerConfig (loadHarvestConfig)
 *   - keeperKeypair (getKeeperKeypair, cache invalidation)
 *   - harvestQueue (enqueueHarvest, deduplication, retry, DLQ, tick)
 *   - harvestMetrics (record / read cycle via mocked Redis)
 *   - harvestScheduler (createHarvestScheduler — threshold, duplicate guard,
 *     too-soon guard, successful enqueue, error paths)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// ─── harvestSchedulerConfig ────────────────────────────────────────────────
// ---------------------------------------------------------------------------

import { loadHarvestConfig } from "./harvestSchedulerConfig.js";

describe("loadHarvestConfig", () => {
  it("returns defaults when env is empty (non-production)", () => {
    const cfg = loadHarvestConfig({ NODE_ENV: "development" });
    expect(cfg.thresholdAmount).toBe(1_000);
    expect(cfg.intervalMs).toBe(300_000);
    expect(cfg.minHarvestGapMs).toBe(240_000);
    expect(cfg.maxAttempts).toBe(3);
    expect(cfg.cooldownMs).toBe(60_000);
    expect(cfg.keeperSecretId).toBe("aura-vault/keeper-keypair");
    expect(cfg.vaultContractId).toBe("");
  });

  it("reads custom values from env", () => {
    const cfg = loadHarvestConfig({
      NODE_ENV: "development",
      HARVEST_THRESHOLD_AMOUNT: "5000",
      HARVEST_INTERVAL_MS: "60000",
      HARVEST_MIN_HARVEST_GAP_MS: "30000",
      HARVEST_MAX_ATTEMPTS: "5",
      HARVEST_COOLDOWN_MS: "10000",
      HARVEST_KEEPER_SECRET_ID: "my/secret",
      VAULT_CONTRACT_ID: "CONTRACT123",
    });
    expect(cfg.thresholdAmount).toBe(5_000);
    expect(cfg.intervalMs).toBe(60_000);
    expect(cfg.minHarvestGapMs).toBe(30_000);
    expect(cfg.maxAttempts).toBe(5);
    expect(cfg.cooldownMs).toBe(10_000);
    expect(cfg.keeperSecretId).toBe("my/secret");
    expect(cfg.vaultContractId).toBe("CONTRACT123");
  });

  it("throws in production when HARVEST_KEEPER_SECRET_ID is missing", () => {
    expect(() =>
      loadHarvestConfig({ NODE_ENV: "production", VAULT_CONTRACT_ID: "C1" })
    ).toThrow("HARVEST_KEEPER_SECRET_ID is required in production");
  });

  it("throws in production when VAULT_CONTRACT_ID is missing", () => {
    expect(() =>
      loadHarvestConfig({
        NODE_ENV: "production",
        HARVEST_KEEPER_SECRET_ID: "my/secret",
      })
    ).toThrow("VAULT_CONTRACT_ID is required in production");
  });

  it("throws when HARVEST_THRESHOLD_AMOUNT is not a positive integer", () => {
    expect(() =>
      loadHarvestConfig({ HARVEST_THRESHOLD_AMOUNT: "-50" })
    ).toThrow("HARVEST_THRESHOLD_AMOUNT");
  });

  it("throws when HARVEST_INTERVAL_MS is zero", () => {
    expect(() =>
      loadHarvestConfig({ HARVEST_INTERVAL_MS: "0" })
    ).toThrow("HARVEST_INTERVAL_MS");
  });
});

// ---------------------------------------------------------------------------
// ─── keeperKeypair ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

import { getKeeperKeypair, invalidateKeeperKeypairCache } from "./keeperKeypair.js";

vi.mock("../secrets.js", () => ({
  getSecret: vi.fn(async (name: string) => {
    if (name.endsWith(":secretKey")) return "S" + "A".repeat(55); // 56 chars, starts with S
    if (name.endsWith(":publicKey")) return "GKEEPER123";
    return undefined;
  }),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Shared import so we can spy on it across describe blocks
let mockGetSecret: ReturnType<typeof vi.fn>;

// Pull the mocked module reference once (vitest resolves the mock synchronously)
const secretsMod = await import("../secrets.js");
mockGetSecret = vi.mocked(secretsMod.getSecret);

describe("getKeeperKeypair", () => {
  beforeEach(() => {
    invalidateKeeperKeypairCache();
    // Reset to a valid default implementation before each test
    mockGetSecret.mockImplementation(async (name: string) => {
      if (name.endsWith(":secretKey")) return "S" + "A".repeat(55);
      if (name.endsWith(":publicKey")) return "GKEEPER123";
      return undefined;
    });
    mockGetSecret.mockClear();
  });

  it("returns a keypair with secretKey and publicKey", async () => {
    const kp = await getKeeperKeypair("test/secret");
    expect(kp.secretKey).toHaveLength(56);
    expect(kp.secretKey.startsWith("S")).toBe(true);
    expect(kp.publicKey).toBe("GKEEPER123");
  });

  it("caches the result on subsequent calls", async () => {
    await getKeeperKeypair("test/secret");
    await getKeeperKeypair("test/secret");
    // getSecret should have been called for secretKey + publicKey in the first call only
    expect(mockGetSecret.mock.calls.filter((c) => c[0].endsWith(":secretKey"))).toHaveLength(1);
  });

  it("re-fetches after cache invalidation", async () => {
    await getKeeperKeypair("test/secret");
    invalidateKeeperKeypairCache();
    await getKeeperKeypair("test/secret");
    expect(mockGetSecret.mock.calls.filter((c) => c[0].endsWith(":secretKey"))).toHaveLength(2);
  });

  it("throws when secret key is missing", async () => {
    mockGetSecret.mockResolvedValueOnce(undefined); // secretKey missing
    await expect(getKeeperKeypair("bad/secret")).rejects.toThrow("Secret key not found");
  });

  it("throws when secret key has invalid format", async () => {
    mockGetSecret.mockResolvedValueOnce("NOTASTELLARKEY"); // too short, wrong prefix
    await expect(getKeeperKeypair("bad/secret")).rejects.toThrow("valid Stellar secret key");
  });
});

// ---------------------------------------------------------------------------
// ─── harvestQueue ──────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

import {
  enqueueHarvest,
  tickHarvest,
  setHarvestProcessor,
  listHarvestJobs,
  getHarvestDeadLetterJobs,
  resetHarvestQueue,
  harvestQueueMetrics,
  type HarvestJob,
} from "./harvestQueue.js";

// Mock queueDb to avoid DB calls
vi.mock("./queueDb.js", () => ({
  saveJob: vi.fn().mockResolvedValue(undefined),
}));

const VAULT_ID = "CONTRACT_VAULT_ABC";
const SAMPLE_JOB_DATA = {
  vaultContractId: VAULT_ID,
  keeperPublicKey: "GKEEPER456",
  yieldAmount: 5_000,
  triggeredAt: new Date().toISOString(),
};

describe("harvestQueue — enqueueHarvest", () => {
  beforeEach(() => {
    resetHarvestQueue();
    setHarvestProcessor(async () => "tx_hash");
  });

  it("creates a harvest job in waiting status", () => {
    const job = enqueueHarvest(SAMPLE_JOB_DATA);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("waiting");
    expect(job!.data.yieldAmount).toBe(5_000);
    expect(job!.data.vaultContractId).toBe(VAULT_ID);
  });

  it("returns null when a job for the same vault is already waiting", () => {
    enqueueHarvest(SAMPLE_JOB_DATA);
    const duplicate = enqueueHarvest({ ...SAMPLE_JOB_DATA, yieldAmount: 9_000 });
    expect(duplicate).toBeNull();
  });

  it("allows a new job after the previous one is completed", async () => {
    enqueueHarvest(SAMPLE_JOB_DATA);
    await tickHarvest(); // completes the job
    const next = enqueueHarvest({ ...SAMPLE_JOB_DATA, yieldAmount: 7_000 });
    expect(next).not.toBeNull();
    expect(next!.status).toBe("waiting");
  });

  it("adds the job to the waiting list", () => {
    enqueueHarvest(SAMPLE_JOB_DATA);
    expect(listHarvestJobs("waiting")).toHaveLength(1);
  });
});

describe("harvestQueue — tickHarvest", () => {
  beforeEach(() => {
    resetHarvestQueue();
  });

  it("calls the registered processor and marks job completed", async () => {
    const processor = vi.fn().mockResolvedValue("TX_HASH_OK");
    setHarvestProcessor(processor);
    enqueueHarvest(SAMPLE_JOB_DATA);

    await tickHarvest();

    expect(processor).toHaveBeenCalledOnce();
    const completed = listHarvestJobs("completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].result).toBe("TX_HASH_OK");
  });

  it("retries up to MAX_ATTEMPTS on failure", async () => {
    const processor = vi.fn().mockRejectedValue(new Error("horizon unavailable"));
    setHarvestProcessor(processor);
    enqueueHarvest(SAMPLE_JOB_DATA);

    // 3 ticks to exhaust retries (attempts 1, 2, 3)
    // But retry schedule uses time-based delay — simulate by ticking enough times.
    // The first tick fails and schedules a retry with a delay.
    // We override Date.now to bypass back-off in tests.
    const originalNow = Date.now;
    let fakeTime = 0;
    Date.now = () => (fakeTime += 100_000); // advance time fast

    await tickHarvest(); // attempt 1 → waiting (scheduled retry)
    await tickHarvest(); // retry promoted → attempt 2 → waiting
    await tickHarvest(); // retry promoted → attempt 3 → dead

    Date.now = originalNow;

    const dead = getHarvestDeadLetterJobs();
    expect(dead).toHaveLength(1);
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it("is a no-op when the queue is empty", async () => {
    await expect(tickHarvest()).resolves.toBeUndefined();
  });
});

describe("harvestQueueMetrics", () => {
  beforeEach(() => {
    resetHarvestQueue();
    setHarvestProcessor(async () => "ok");
  });

  it("counts total and completed jobs", async () => {
    enqueueHarvest(SAMPLE_JOB_DATA);
    await tickHarvest();
    const m = harvestQueueMetrics();
    expect(m.total).toBe(1);
    expect(m.completed).toBe(1);
    expect(m.waiting).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ─── harvestMetrics ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

import {
  recordHarvestAttempt,
  recordHarvestSuccess,
  recordHarvestFailure,
  getHarvestMetrics,
  getHarvestHistory,
} from "./harvestMetrics.js";

// ---------------------------------------------------------------------------
// Redis mock — minimal in-memory implementation
// ---------------------------------------------------------------------------

const redisStore = new Map<string, string>();
const redisSortedSets = new Map<string, Array<{ score: number; member: string }>>();

// Auto-incrementing counter used as a secondary sort key to guarantee insertion-order
// stability when scores are identical (e.g., multiple calls within the same ms).
let _zaddCounter = 0;

vi.mock("../redis.js", () => ({
  getRedis: () => ({
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      redisStore.set(key, value);
      return "OK";
    },
    incr: async (key: string) => {
      const v = parseInt(redisStore.get(key) ?? "0", 10) + 1;
      redisStore.set(key, String(v));
      return v;
    },
    incrbyfloat: async (key: string, delta: number) => {
      const v = parseFloat(redisStore.get(key) ?? "0") + delta;
      redisStore.set(key, String(v));
      return v;
    },
    zadd: async (key: string, score: number, member: string) => {
      if (!redisSortedSets.has(key)) redisSortedSets.set(key, []);
      // Use counter to break ties so insertion order is preserved
      redisSortedSets.get(key)!.push({ score: score + _zaddCounter++, member });
      return 1;
    },
    zremrangebyrank: async () => 0,
    zrangebyscore: async (key: string, min: number) => {
      const set = redisSortedSets.get(key) ?? [];
      return set.filter((e) => e.score >= min).map((e) => e.member);
    },
    zrevrange: async (key: string, start: number, stop: number) => {
      const set = redisSortedSets.get(key) ?? [];
      const sorted = [...set].sort((a, b) => b.score - a.score);
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end).map((e) => e.member);
    },
  }),
}));

describe("harvestMetrics", () => {
  beforeEach(() => {
    redisStore.clear();
    redisSortedSets.clear();
    _zaddCounter = 0;
  });

  it("starts at zero", async () => {
    const m = await getHarvestMetrics();
    expect(m.totalAttempted).toBe(0);
    expect(m.totalSucceeded).toBe(0);
    expect(m.totalFailed).toBe(0);
    expect(m.cumulativeYield).toBe(0);
    expect(m.averageYieldPerHarvest).toBe(0);
    expect(m.lastHarvestAt).toBe("");
    expect(m.harvestsLast24h).toBe(0);
  });

  it("increments totalAttempted on recordHarvestAttempt", async () => {
    await recordHarvestAttempt();
    await recordHarvestAttempt();
    const m = await getHarvestMetrics();
    expect(m.totalAttempted).toBe(2);
  });

  it("increments totalSucceeded and cumulativeYield on recordHarvestSuccess", async () => {
    await recordHarvestSuccess(3_000);
    await recordHarvestSuccess(7_000);
    const m = await getHarvestMetrics();
    expect(m.totalSucceeded).toBe(2);
    expect(m.cumulativeYield).toBe(10_000);
    expect(m.averageYieldPerHarvest).toBe(5_000);
  });

  it("records lastHarvestAt as an ISO string", async () => {
    await recordHarvestSuccess(1_000);
    const m = await getHarvestMetrics();
    expect(m.lastHarvestAt).not.toBe("");
    expect(() => new Date(m.lastHarvestAt)).not.toThrow();
  });

  it("counts harvestsLast24h from the sorted set", async () => {
    await recordHarvestSuccess(500);
    await recordHarvestSuccess(1_500);
    const m = await getHarvestMetrics();
    expect(m.harvestsLast24h).toBe(2);
  });

  it("increments totalFailed on recordHarvestFailure", async () => {
    await recordHarvestFailure("rpc timeout");
    const m = await getHarvestMetrics();
    expect(m.totalFailed).toBe(1);
  });

  it("getHarvestHistory returns entries newest first", async () => {
    await recordHarvestSuccess(100);
    await recordHarvestSuccess(200);
    const history = await getHarvestHistory(10);
    expect(history).toHaveLength(2);
    // Newest first — second harvest (200) should be first in the result
    expect(history[0].yieldAmount).toBe(200);
    expect(history[1].yieldAmount).toBe(100);
  });

  it("averageYieldPerHarvest is 0 when no successes", async () => {
    await recordHarvestAttempt();
    await recordHarvestFailure("error");
    const m = await getHarvestMetrics();
    expect(m.averageYieldPerHarvest).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ─── harvestScheduler ──────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

import { createHarvestScheduler } from "./harvestScheduler.js";
import type { HarvestSchedulerOptions } from "./harvestScheduler.js";

/** Build scheduler options with sensible defaults for unit tests. */
function makeOpts(overrides: Partial<HarvestSchedulerOptions> & {
  yieldAmount?: number;
  harvestResult?: string;
  harvestError?: Error;
} = {}): HarvestSchedulerOptions {
  const { yieldAmount = 0, harvestResult = "TX_OK", harvestError, ...rest } = overrides;

  return {
    getAccumulatedYield: vi.fn().mockResolvedValue(yieldAmount),
    executeHarvest: harvestError
      ? vi.fn().mockRejectedValue(harvestError)
      : vi.fn().mockResolvedValue(harvestResult),
    config: {
      thresholdAmount: 1_000,
      intervalMs: 300_000,
      minHarvestGapMs: 240_000,
      maxAttempts: 3,
      cooldownMs: 60_000,
      keeperSecretId: "test/keeper",
      vaultContractId: VAULT_ID,
    },
    ...rest,
  };
}

describe("createHarvestScheduler — triggerTick", () => {
  beforeEach(() => {
    resetHarvestQueue();
    invalidateKeeperKeypairCache();
    redisStore.clear();
    redisSortedSets.clear();
    _zaddCounter = 0;

    // Reset keeper mock to a valid key for each test
    mockGetSecret.mockImplementation(async (name: string) => {
      if (name.endsWith(":secretKey")) return "S" + "A".repeat(55);
      if (name.endsWith(":publicKey")) return "GKEEPER123";
      return undefined;
    });
  });

  afterEach(() => {
    resetHarvestQueue();
  });

  it("returns below_threshold when yield is under the minimum", async () => {
    const scheduler = createHarvestScheduler(makeOpts({ yieldAmount: 500 }));
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("below_threshold");
    expect(result.accumulatedYield).toBe(500);
  });

  it("returns enqueued when yield exceeds threshold", async () => {
    const scheduler = createHarvestScheduler(makeOpts({ yieldAmount: 2_000 }));
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("enqueued");
    expect(result.accumulatedYield).toBe(2_000);
    expect(result.jobId).toBeDefined();
  });

  it("returns duplicate when a harvest is already waiting", async () => {
    const scheduler = createHarvestScheduler(makeOpts({ yieldAmount: 2_000 }));
    await scheduler.triggerTick(); // enqueues
    const result = await scheduler.triggerTick(); // duplicate
    expect(result.outcome).toBe("duplicate");
  });

  it("returns too_soon when last harvest was within minHarvestGapMs", async () => {
    const executeHarvest = vi.fn().mockResolvedValue("TX_OK");
    const scheduler = createHarvestScheduler({
      ...makeOpts({ yieldAmount: 2_000 }),
      executeHarvest,
      config: {
        thresholdAmount: 1_000,
        intervalMs: 300_000,
        minHarvestGapMs: 9_999_999, // huge gap → always too soon after first harvest
        maxAttempts: 3,
        cooldownMs: 60_000,
        keeperSecretId: "test/keeper",
        vaultContractId: VAULT_ID,
      },
    });

    // First tick: enqueue
    await scheduler.triggerTick();
    // Process the job so lastHarvestCompletedAt is set
    await tickHarvest();

    // Second tick: too soon
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("too_soon");
    expect(result.lastHarvestAt).toBeDefined();
  });

  it("returns error when getAccumulatedYield throws", async () => {
    const scheduler = createHarvestScheduler({
      ...makeOpts(),
      getAccumulatedYield: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    });
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("error");
    expect(result.error).toContain("RPC timeout");
  });

  it("returns error when keeper keypair cannot be loaded", async () => {
    invalidateKeeperKeypairCache();
    // Override mock to return no secret key
    mockGetSecret.mockResolvedValue(undefined);

    const scheduler = createHarvestScheduler(makeOpts({ yieldAmount: 2_000 }));
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("error");
  });

  it("executes exactly at threshold boundary (equal to threshold)", async () => {
    const scheduler = createHarvestScheduler(makeOpts({ yieldAmount: 1_000 }));
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("enqueued");
  });

  it("does not enqueue when yield is one unit below threshold", async () => {
    const scheduler = createHarvestScheduler(makeOpts({ yieldAmount: 999 }));
    const result = await scheduler.triggerTick();
    expect(result.outcome).toBe("below_threshold");
  });
});

describe("createHarvestScheduler — start / stop", () => {
  afterEach(() => {
    resetHarvestQueue();
  });

  it("isRunning returns false before start", () => {
    const scheduler = createHarvestScheduler(makeOpts());
    expect(scheduler.isRunning()).toBe(false);
  });

  it("isRunning returns true after start and false after stop", () => {
    const scheduler = createHarvestScheduler(makeOpts());
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it("calling start twice is a no-op (no error)", () => {
    const scheduler = createHarvestScheduler(makeOpts());
    expect(() => {
      scheduler.start();
      scheduler.start(); // second call should be ignored
    }).not.toThrow();
    scheduler.stop();
  });

  it("calling stop when not running does not throw", () => {
    const scheduler = createHarvestScheduler(makeOpts());
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("invokes onTick callback after each tick", async () => {
    const onTick = vi.fn();
    const scheduler = createHarvestScheduler({
      ...makeOpts({ yieldAmount: 500 }), // below threshold
      onTick,
    });
    scheduler.start();
    // Give the immediate tick time to fire
    await new Promise((r) => setTimeout(r, 20));
    scheduler.stop();
    expect(onTick).toHaveBeenCalledWith(expect.objectContaining({ outcome: "below_threshold" }));
  });
});

describe("createHarvestScheduler — metrics", () => {
  beforeEach(() => {
    redisStore.clear();
    redisSortedSets.clear();
    _zaddCounter = 0;
    resetHarvestQueue();
    invalidateKeeperKeypairCache();
  });

  afterEach(() => {
    resetHarvestQueue();
  });

  it("metrics() returns HarvestMetrics shape", async () => {
    const scheduler = createHarvestScheduler(makeOpts());
    const m = await scheduler.metrics();
    expect(m).toMatchObject({
      totalAttempted: expect.any(Number),
      totalSucceeded: expect.any(Number),
      totalFailed: expect.any(Number),
      cumulativeYield: expect.any(Number),
      lastHarvestAt: expect.any(String),
      harvestsLast24h: expect.any(Number),
      averageYieldPerHarvest: expect.any(Number),
    });
  });

  it("history() returns an array", async () => {
    const scheduler = createHarvestScheduler(makeOpts());
    const h = await scheduler.history();
    expect(Array.isArray(h)).toBe(true);
  });
});

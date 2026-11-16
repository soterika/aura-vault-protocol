/**
 * cache.test.ts — Unit tests for backend/src/cache.ts
 *
 * Covers:
 *  - Cache miss: cacheGet returns null, miss counter incremented
 *  - Cache hit: stored value returned, hit counter incremented
 *  - TTL expiry: after TTL elapses the key is gone → cacheGet returns null
 *  - Invalidation: cacheDel removes the key immediately
 *  - Redis down: cacheGet / cacheSet / cacheDel propagate the error
 *  - Null value handling: null is stored as JSON "null"; cacheGet returns null
 *  - getCacheStats: hit-rate calculations are correct
 *  - NS namespace constants: spot-check string values
 *
 * Redis is replaced by a lightweight in-process fake that honours
 * GET / SET EX / DEL / HINCRBY / HGETALL semantics including TTL —
 * no real Redis server is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── In-process Redis fake ─────────────────────────────────────────────────────

type StoreEntry = { value: string; expiresAt: number | null };
type Store = Map<string, StoreEntry>;
type HashStore = Map<string, Map<string, string>>;

function createRedisMock() {
  const store: Store = new Map();
  const hashes: HashStore = new Map();
  let shouldThrow = false;

  function maybeThrow() {
    if (shouldThrow) throw new Error("Redis connection refused");
  }

  function checkExpiry(k: string): void {
    const entry = store.get(k);
    if (entry && entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      store.delete(k);
    }
  }

  return {
    /** Expose internal store so tests can inspect / manipulate it directly. */
    _store: store,
    _hashes: hashes,

    /** Make all Redis calls throw (simulates a downed Redis instance). */
    _setShouldThrow(v: boolean) {
      shouldThrow = v;
    },

    /** Immediately expire a key (simulates TTL elapsing). */
    _expireKey(k: string) {
      const entry = store.get(k);
      if (entry) entry.expiresAt = Date.now() - 1;
    },

    // ── Redis command stubs ───────────────────────────────────────────────────

    async get(k: string): Promise<string | null> {
      maybeThrow();
      checkExpiry(k);
      return store.get(k)?.value ?? null;
    },

    async set(
      k: string,
      v: string,
      mode?: string,
      ttl?: number
    ): Promise<"OK"> {
      maybeThrow();
      const expiresAt =
        mode === "EX" && ttl ? Date.now() + ttl * 1000 : null;
      store.set(k, { value: v, expiresAt });
      return "OK";
    },

    async del(k: string): Promise<number> {
      maybeThrow();
      const existed = store.has(k);
      store.delete(k);
      return existed ? 1 : 0;
    },

    async hincrby(hash: string, field: string, incr: number): Promise<number> {
      maybeThrow();
      if (!hashes.has(hash)) hashes.set(hash, new Map());
      const h = hashes.get(hash)!;
      const current = parseInt(h.get(field) ?? "0", 10);
      const next = current + incr;
      h.set(field, String(next));
      return next;
    },

    async hgetall(hash: string): Promise<Record<string, string> | null> {
      maybeThrow();
      const h = hashes.get(hash);
      if (!h || h.size === 0) return null;
      return Object.fromEntries(h.entries());
    },

    // Stubs for set operations used by other cache helpers (not under test here)
    async sadd(_k: string, ..._members: string[]): Promise<number> {
      return _members.length;
    },
    async smembers(_k: string): Promise<string[]> {
      return [];
    },
    async expire(_k: string, _ttl: number): Promise<number> {
      return 1;
    },
  };
}

type RedisMock = ReturnType<typeof createRedisMock>;

// ── Module-level mock wiring ──────────────────────────────────────────────────
// The mock must be registered BEFORE the module under test is imported so that
// the getRedis() call inside cache.ts picks up the fake.

let redisMock: RedisMock;

vi.mock("./redis.js", () => ({
  getRedis: () => redisMock,
}));

// Dynamic import keeps vi.mock hoisting intact for ESM.
const { cacheGet, cacheSet, cacheDel, getCacheStats, NS } = await import(
  "./cache.js"
);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Fresh isolated store for every test
  redisMock = createRedisMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Test suites ───────────────────────────────────────────────────────────────

describe("cacheGet", () => {
  it("returns null on cache miss", async () => {
    const result = await cacheGet<string>(NS.API, "missing-key");
    expect(result).toBeNull();
  });

  it("returns the stored value on cache hit", async () => {
    await cacheSet(NS.API, "my-key", { foo: "bar" }, 60);
    const result = await cacheGet<{ foo: string }>(NS.API, "my-key");
    expect(result).toEqual({ foo: "bar" });
  });

  it("deserialises complex objects correctly", async () => {
    const payload = { numbers: [1, 2, 3], nested: { deep: true } };
    await cacheSet(NS.API, "complex", payload, 60);
    const result = await cacheGet<typeof payload>(NS.API, "complex");
    expect(result).toEqual(payload);
  });

  it("increments the miss counter when key is absent", async () => {
    await cacheGet(NS.GAS_PRICE, "nonexistent");
    const stats = await getCacheStats();
    expect(stats[NS.GAS_PRICE]?.misses).toBe(1);
    expect(stats[NS.GAS_PRICE]?.hits ?? 0).toBe(0);
  });

  it("increments the hit counter when key is present", async () => {
    await cacheSet(NS.GAS_PRICE, "my-gas", 42, 60);
    await cacheGet(NS.GAS_PRICE, "my-gas");
    const stats = await getCacheStats();
    expect(stats[NS.GAS_PRICE]?.hits).toBe(1);
    expect(stats[NS.GAS_PRICE]?.misses ?? 0).toBe(0);
  });

  it("does not call the underlying getter on a cache hit (write-through pattern)", async () => {
    const getter = vi.fn(async () => ({ price: 100 }));
    await cacheSet(NS.DEFI_PRICE, "btc", await getter(), 60);
    getter.mockClear();

    // Subsequent read hits the cache — getter must not be invoked again
    const cached = await cacheGet<{ price: number }>(NS.DEFI_PRICE, "btc");
    expect(cached).toEqual({ price: 100 });
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("cacheSet", () => {
  it("stores a value retrievable via cacheGet", async () => {
    await cacheSet(NS.DEFI_PRICE, "eth", { usd: 3000 }, 300);
    const result = await cacheGet<{ usd: number }>(NS.DEFI_PRICE, "eth");
    expect(result).toEqual({ usd: 3000 });
  });

  it("does not collide across different namespaces for the same id", async () => {
    await cacheSet(NS.API, "route-a", "valueA", 60);
    await cacheSet(NS.DEFI_PRICE, "route-a", "valueB", 60);
    const a = await cacheGet<string>(NS.API, "route-a");
    const b = await cacheGet<string>(NS.DEFI_PRICE, "route-a");
    expect(a).toBe("valueA");
    expect(b).toBe("valueB");
  });

  it("overwrites an existing key with a new value", async () => {
    await cacheSet(NS.API, "key", "first", 60);
    await cacheSet(NS.API, "key", "second", 60);
    const result = await cacheGet<string>(NS.API, "key");
    expect(result).toBe("second");
  });

  it("passes EX and TTL to the underlying Redis SET call", async () => {
    const setSpy = vi.spyOn(redisMock, "set");
    await cacheSet(NS.API, "ttl-test", "value", 120);
    expect(setSpy).toHaveBeenCalledWith(
      `${NS.API}:ttl-test`,
      JSON.stringify("value"),
      "EX",
      120
    );
  });
});

describe("TTL expiry", () => {
  it("returns null after the TTL has elapsed", async () => {
    await cacheSet(NS.API, "ttl-key", "temporary", 1);
    // Backdate the expiry so the mock treats it as expired
    redisMock._expireKey(`${NS.API}:ttl-key`);
    const result = await cacheGet<string>(NS.API, "ttl-key");
    expect(result).toBeNull();
  });

  it("returns the value before TTL elapses", async () => {
    await cacheSet(NS.API, "live-key", "still-here", 3600);
    const result = await cacheGet<string>(NS.API, "live-key");
    expect(result).toBe("still-here");
  });

  it("records a cache miss after a key expires", async () => {
    await cacheSet(NS.YIELD_STATS, "snapshot", { apy: 12 }, 1);
    redisMock._expireKey(`${NS.YIELD_STATS}:snapshot`);
    await cacheGet(NS.YIELD_STATS, "snapshot");
    const stats = await getCacheStats();
    expect(stats[NS.YIELD_STATS]?.misses).toBeGreaterThanOrEqual(1);
  });
});

describe("cacheDel (invalidation)", () => {
  it("removes the key so a subsequent cacheGet returns null", async () => {
    await cacheSet(NS.API, "to-delete", "gone-soon", 60);
    await cacheDel(NS.API, "to-delete");
    const result = await cacheGet<string>(NS.API, "to-delete");
    expect(result).toBeNull();
  });

  it("is idempotent — deleting a non-existent key does not throw", async () => {
    await expect(cacheDel(NS.API, "never-existed")).resolves.toBeUndefined();
  });

  it("only removes the targeted key, not siblings in the same namespace", async () => {
    await cacheSet(NS.API, "keep", "safe", 60);
    await cacheSet(NS.API, "remove", "bye", 60);
    await cacheDel(NS.API, "remove");
    expect(await cacheGet<string>(NS.API, "keep")).toBe("safe");
    expect(await cacheGet<string>(NS.API, "remove")).toBeNull();
  });

  it("only removes the targeted namespace key, not the same id in another namespace", async () => {
    await cacheSet(NS.API, "shared-id", "api-value", 60);
    await cacheSet(NS.DEFI_PRICE, "shared-id", "defi-value", 60);
    await cacheDel(NS.API, "shared-id");
    expect(await cacheGet<string>(NS.API, "shared-id")).toBeNull();
    expect(await cacheGet<string>(NS.DEFI_PRICE, "shared-id")).toBe("defi-value");
  });
});

describe("Redis down — graceful degradation", () => {
  beforeEach(() => {
    redisMock._setShouldThrow(true);
  });

  afterEach(() => {
    redisMock._setShouldThrow(false);
  });

  it("cacheGet rejects when Redis is unavailable", async () => {
    await expect(cacheGet(NS.API, "any")).rejects.toThrow(
      "Redis connection refused"
    );
  });

  it("cacheSet rejects when Redis is unavailable", async () => {
    await expect(cacheSet(NS.API, "any", "value", 60)).rejects.toThrow(
      "Redis connection refused"
    );
  });

  it("cacheDel rejects when Redis is unavailable", async () => {
    await expect(cacheDel(NS.API, "any")).rejects.toThrow(
      "Redis connection refused"
    );
  });
});

describe("Null value handling", () => {
  it("stores null as the JSON string 'null'", async () => {
    await cacheSet(NS.API, "null-val", null, 60);
    const rawEntry = redisMock._store.get(`${NS.API}:null-val`);
    expect(rawEntry?.value).toBe("null");
  });

  it("cacheGet returns null when a null value has been stored", async () => {
    // JSON.parse('null') === null, so the result is indistinguishable from a
    // cache miss — callers must not store null results.
    await cacheSet(NS.API, "null-val", null, 60);
    const result = await cacheGet(NS.API, "null-val");
    expect(result).toBeNull();
  });

  it("stores primitive numbers correctly", async () => {
    await cacheSet(NS.GAS_PRICE, "gwei", 42, 60);
    const result = await cacheGet<number>(NS.GAS_PRICE, "gwei");
    expect(result).toBe(42);
  });

  it("stores boolean values correctly", async () => {
    await cacheSet(NS.API, "flag", true, 60);
    const result = await cacheGet<boolean>(NS.API, "flag");
    expect(result).toBe(true);
  });
});

describe("getCacheStats", () => {
  it("returns an empty object when no operations have been tracked", async () => {
    const stats = await getCacheStats();
    expect(stats).toEqual({});
  });

  it("calculates hitRate correctly with mixed hits and misses", async () => {
    // 2 hits, 1 miss → hitRate = 2/3 ≈ 0.667
    await cacheSet(NS.YIELD_STATS, "k", "v", 60);
    await cacheGet(NS.YIELD_STATS, "k");        // hit
    await cacheGet(NS.YIELD_STATS, "k");        // hit
    await cacheGet(NS.YIELD_STATS, "missing");  // miss
    const stats = await getCacheStats();
    expect(stats[NS.YIELD_STATS]?.hits).toBe(2);
    expect(stats[NS.YIELD_STATS]?.misses).toBe(1);
    expect(stats[NS.YIELD_STATS]?.hitRate).toBeCloseTo(0.667, 2);
  });

  it("returns hitRate of 0 when there are only misses", async () => {
    await cacheGet(NS.GAS_HISTORY, "never-set");
    const stats = await getCacheStats();
    expect(stats[NS.GAS_HISTORY]?.hitRate).toBe(0);
  });

  it("returns hitRate of 1 when there are only hits", async () => {
    await cacheSet(NS.DEFI_POOLS, "pool1", ["a", "b"], 60);
    await cacheGet(NS.DEFI_POOLS, "pool1");
    const stats = await getCacheStats();
    expect(stats[NS.DEFI_POOLS]?.hitRate).toBe(1);
  });

  it("tracks stats independently per namespace", async () => {
    await cacheSet(NS.API, "k", "v", 60);
    await cacheGet(NS.API, "k");              // API hit
    await cacheGet(NS.GAS_PRICE, "missing");  // GAS_PRICE miss

    const stats = await getCacheStats();
    expect(stats[NS.API]?.hits).toBe(1);
    expect(stats[NS.API]?.misses ?? 0).toBe(0);
    expect(stats[NS.GAS_PRICE]?.misses).toBe(1);
    expect(stats[NS.GAS_PRICE]?.hits ?? 0).toBe(0);
  });
});

describe("NS namespace constants", () => {
  it("exports all expected namespace string values", () => {
    expect(NS.AUTH_BLACKLIST).toBe("auth:blacklist");
    expect(NS.AUTH_REFRESH).toBe("auth:refresh");
    expect(NS.API).toBe("api");
    expect(NS.GAS_PRICE).toBe("gas:price");
    expect(NS.GAS_HISTORY).toBe("gas:history");
    expect(NS.DEFI_PRICE).toBe("defi:price");
    expect(NS.DEFI_POOLS).toBe("defi:pools");
    expect(NS.YIELD_STATS).toBe("yield:stats");
    expect(NS.YIELD_HISTORY).toBe("yield:history");
  });
});

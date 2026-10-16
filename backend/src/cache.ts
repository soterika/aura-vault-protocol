import crypto from "crypto";
import { getRedis } from "./redis.js";
import { logger } from "./logger.js";

export const NS = {
  AUTH_BLACKLIST: "auth:blacklist",
  AUTH_REFRESH: "auth:refresh",
  AUTH_SESSIONS: "auth:sessions",
  AUTH_SESSIONS_TOKENS: "auth:sessions:tokens", // per-session refresh token tracking for bulk logout
  API: "api",
  GAS_PRICE: "gas:price",
  GAS_HISTORY: "gas:history",
  DEFI_PRICE: "defi:price",
  DEFI_POOLS: "defi:pools",
  // Email service
  EMAIL_UNSUBSCRIBED: "email:unsubscribed",
  EMAIL_BOUNCE_HARD: "email:bounce:hard",
  EMAIL_BOUNCE_SOFT: "email:bounce:soft",
  EMAIL_TRACKING: "email:tracking",
  EMAIL_QUEUE_HIGH: "email:queue:high",
  EMAIL_QUEUE_NORMAL: "email:queue:normal",
  EMAIL_QUEUE_LOW: "email:queue:low",
  EMAIL_RETRY: "email:retry",
  EMAIL_DEAD: "email:dead",
  EMAIL_INFLIGHT: "email:inflight",
  // Yield worker
  YIELD_STATS: "yield:stats",
  YIELD_HISTORY: "yield:history",
  // Vault simulation
  VAULT_SIMULATE: "vault:simulate",
  ANALYTICS_LEADERBOARD: "analytics:leaderboard",
  ANALYTICS_APY: "analytics:apy",
  ANALYTICS_USER_VOLUME: "analytics:user-volume",
  // Per-user transaction volume aggregation
  USER_VOLUME: "user:volume",
} as const;

export type Namespace = (typeof NS)[keyof typeof NS];

function key(ns: string, id: string): string {
  return `${ns}:${id}`;
}

// Hash long keys (e.g. full JWTs) to a fixed-length Redis key
export function hashKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function track(ns: string, hit: boolean): Promise<void> {
  const field = hit ? "hit" : "miss";
  await getRedis().hincrby("cache:stats", `${ns}:${field}`, 1);
}

export async function cacheGet<T>(ns: string, id: string): Promise<T | null> {
  const value = await getRedis().get(key(ns, id));
  await track(ns, value !== null);
  if (value === null) {
    logger.warn({ namespace: ns, cacheKey: id }, "Redis cache miss");
    return null;
  }
  return JSON.parse(value) as T;
}

export async function cacheSet(
  ns: string,
  id: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  await getRedis().set(key(ns, id), JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(ns: string, id: string): Promise<void> {
  await getRedis().del(key(ns, id));
}

export async function cacheHashGet<T>(
  ns: string,
  id: string,
  field: string
): Promise<T | null> {
  const value = await getRedis().hget(key(ns, id), field);
  await track(ns, value !== null);
  if (value === null) {
    logger.warn({ namespace: ns, cacheKey: id, field }, "Redis hash cache miss");
    return null;
  }
  return JSON.parse(value) as T;
}

export async function cacheHashGetAll<T>(
  ns: string,
  id: string
): Promise<Record<string, T> | null> {
  const values = await getRedis().hgetall(key(ns, id));
  const fields = Object.keys(values);
  await track(ns, fields.length > 0);
  if (fields.length === 0) {
    logger.warn({ namespace: ns, cacheKey: id }, "Redis hash cache miss");
    return null;
  }
  return Object.fromEntries(
    fields.map((field) => [field, JSON.parse(values[field]) as T])
  );
}

export async function cacheHashSet<T>(
  ns: string,
  id: string,
  field: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
  const cacheKey = key(ns, id);
  await redis.hset(cacheKey, field, JSON.stringify(value));
  await redis.expire(cacheKey, ttlSeconds);
}

export async function cacheHashSetMany<T>(
  ns: string,
  id: string,
  fields: Record<string, T>,
  ttlSeconds: number
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const redis = getRedis();
  const cacheKey = key(ns, id);
  const serialized = Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [field, JSON.stringify(value)])
  );
  await redis.hset(cacheKey, serialized);
  await redis.expire(cacheKey, ttlSeconds);
}

export async function cacheHashDel(ns: string, id: string): Promise<void> {
  await getRedis().del(key(ns, id));
}

export async function cacheHashFieldDel(
  ns: string,
  id: string,
  field: string
): Promise<void> {
  await getRedis().hdel(key(ns, id), field);
}

export interface SortedCacheEntry {
  member: string;
  score: number;
}

export async function cacheSortedSetGet(
  ns: string,
  id: string
): Promise<SortedCacheEntry[] | null> {
  const cacheKey = key(ns, id);
  const values = await getRedis().zrevrange(cacheKey, 0, -1, "WITHSCORES");
  await track(ns, values.length > 0);
  if (values.length === 0) {
    logger.warn({ namespace: ns, cacheKey: id }, "Redis sorted-set cache miss");
    return null;
  }
  const entries: SortedCacheEntry[] = [];
  for (let index = 0; index < values.length; index += 2) {
    if (values[index] !== "__empty__") {
      entries.push({ member: values[index], score: Number(values[index + 1]) });
    }
  }
  return entries;
}

export async function cacheSortedSetSet(
  ns: string,
  id: string,
  entries: SortedCacheEntry[],
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
  const cacheKey = key(ns, id);
  await redis.del(cacheKey);
  const values = entries.length > 0
    ? entries.flatMap(({ member, score }) => [score, member])
    : [0, "__empty__"];
  await redis.zadd(cacheKey, ...values);
  await redis.expire(cacheKey, ttlSeconds);
}

// Redis SET operations for session tracking
export async function setAdd(
  ns: string,
  id: string,
  member: string,
  ttlSeconds?: number
): Promise<void> {
  const redis = getRedis();
  const k = key(ns, id);
  await redis.sadd(k, member);
  if (ttlSeconds) await redis.expire(k, ttlSeconds);
}

export async function setMembers(ns: string, id: string): Promise<string[]> {
  return getRedis().smembers(key(ns, id));
}

export async function setDel(ns: string, id: string): Promise<void> {
  await getRedis().del(key(ns, id));
}

export interface CacheNamespaceStat {
  hits: number;
  misses: number;
  hitRate: number;
}

export async function getCacheStats(): Promise<
  Record<string, CacheNamespaceStat>
> {
  const raw = await getRedis().hgetall("cache:stats");
  if (!raw) return {};

  const accumulator: Record<string, { hits: number; misses: number }> = {};

  for (const [field, val] of Object.entries(raw)) {
    const lastColon = field.lastIndexOf(":");
    const ns = field.slice(0, lastColon);
    const type = field.slice(lastColon + 1) as "hit" | "miss";
    if (!accumulator[ns]) accumulator[ns] = { hits: 0, misses: 0 };
    if (type === "hit") accumulator[ns].hits = parseInt(val, 10);
    else accumulator[ns].misses = parseInt(val, 10);
  }

  const result: Record<string, CacheNamespaceStat> = {};
  for (const [ns, { hits, misses }] of Object.entries(accumulator)) {
    const total = hits + misses;
    result[ns] = {
      hits,
      misses,
      hitRate: total > 0 ? Math.round((hits / total) * 1000) / 1000 : 0,
    };
  }
  return result;
}

export async function cacheStatsPrometheusText(): Promise<string> {
  const stats = await getCacheStats();
  const lines = [
    "# HELP aura_cache_hit_ratio Cache hits divided by total cache lookups",
    "# TYPE aura_cache_hit_ratio gauge",
  ];
  for (const [namespace, values] of Object.entries(stats)) {
    const label = namespace.replaceAll('\\', "\\\\").replaceAll('"', '\\"');
    lines.push(`aura_cache_hit_ratio{namespace="${label}"} ${values.hitRate}`);
  }
  return `${lines.join("\n")}\n`;
}

import crypto from "crypto";
import { getRedis } from "./redis.js";
export const NS = {
    AUTH_BLACKLIST: "auth:blacklist",
    AUTH_REFRESH: "auth:refresh",
    AUTH_SESSIONS: "auth:sessions",
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
};
function key(ns, id) {
    return `${ns}:${id}`;
}
// Hash long keys (e.g. full JWTs) to a fixed-length Redis key
export function hashKey(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}
async function track(ns, hit) {
    const field = hit ? "hit" : "miss";
    await getRedis().hincrby("cache:stats", `${ns}:${field}`, 1);
}
export async function cacheGet(ns, id) {
    const value = await getRedis().get(key(ns, id));
    await track(ns, value !== null);
    if (value === null)
        return null;
    return JSON.parse(value);
}
export async function cacheSet(ns, id, value, ttlSeconds) {
    await getRedis().set(key(ns, id), JSON.stringify(value), "EX", ttlSeconds);
}
export async function cacheDel(ns, id) {
    await getRedis().del(key(ns, id));
}
// Redis SET operations for session tracking
export async function setAdd(ns, id, member, ttlSeconds) {
    const redis = getRedis();
    const k = key(ns, id);
    await redis.sadd(k, member);
    if (ttlSeconds)
        await redis.expire(k, ttlSeconds);
}
export async function setMembers(ns, id) {
    return getRedis().smembers(key(ns, id));
}
export async function setDel(ns, id) {
    await getRedis().del(key(ns, id));
}
export async function getCacheStats() {
    const raw = await getRedis().hgetall("cache:stats");
    if (!raw)
        return {};
    const accumulator = {};
    for (const [field, val] of Object.entries(raw)) {
        const lastColon = field.lastIndexOf(":");
        const ns = field.slice(0, lastColon);
        const type = field.slice(lastColon + 1);
        if (!accumulator[ns])
            accumulator[ns] = { hits: 0, misses: 0 };
        if (type === "hit")
            accumulator[ns].hits = parseInt(val, 10);
        else
            accumulator[ns].misses = parseInt(val, 10);
    }
    const result = {};
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

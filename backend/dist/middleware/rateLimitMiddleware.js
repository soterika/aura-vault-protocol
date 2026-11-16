import { getRedis } from "../redis.js";
export const TIER_LIMITS = {
    free: { capacity: 60, refillRate: 1 }, // 60 req/min steady-state
    paid: { capacity: 600, refillRate: 10 }, // 600 req/min steady-state
};
const IP_LIMIT = { capacity: 30, refillRate: 0.5 }; // 30/min
const AUTH_LIMIT = { capacity: 20, refillRate: 20 / 900 }; // 20/15 min
// Atomic token bucket implemented as a Lua script to eliminate race conditions.
// KEYS[1] — Redis hash key for this bucket
// ARGV[1] — capacity, ARGV[2] — refillRate (tokens/sec), ARGV[3] — now (ms), ARGV[4] — TTL (s)
// Returns: [allowed (0|1), remaining_floor, capacity_floor, retry_after_ceil]
const TOKEN_BUCKET_LUA = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

local data   = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last   = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last   = now
end

local elapsed = (now - last) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed     = 0
local retry_after = 0

if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
else
  retry_after = math.ceil((1 - tokens) / rate)
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'last', tostring(now))
redis.call('EXPIRE', key, ttl)

return {allowed, math.floor(tokens), math.floor(capacity), retry_after}
`;
async function consumeToken(redisKey, config) {
    const now = Date.now();
    // TTL slightly longer than full-refill time so keys self-clean
    const ttl = Math.ceil(config.capacity / config.refillRate) + 60;
    const raw = (await getRedis().eval(TOKEN_BUCKET_LUA, 1, redisKey, config.capacity, config.refillRate, now, ttl));
    return {
        allowed: raw[0] === 1,
        remaining: raw[1],
        limit: raw[2],
        retryAfter: raw[3],
    };
}
function applyHeaders(res, result, config) {
    const secondsToFull = Math.ceil((config.capacity - result.remaining) / config.refillRate);
    res.set({
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + secondsToFull),
    });
}
function clientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string")
        return forwarded.split(",")[0].trim();
    return req.socket.remoteAddress ?? "unknown";
}
// IP-based token bucket. keyPrefix isolates auth limits from global limits.
export function ipRateLimiter(config = IP_LIMIT, keyPrefix = "rl:global:ip") {
    return async (req, res, next) => {
        const redisKey = `${keyPrefix}:${clientIp(req)}`;
        try {
            const result = await consumeToken(redisKey, config);
            applyHeaders(res, result, config);
            if (!result.allowed) {
                res.set("Retry-After", String(result.retryAfter));
                res.status(429).json({ error: "Too many requests", retryAfter: result.retryAfter });
                return;
            }
            next();
        }
        catch (err) {
            // Fail open on Redis errors — availability > strict enforcement
            console.error("[RateLimit] Redis error:", err.message);
            next();
        }
    };
}
// Per-user tiered limiter. Must run after the authenticate middleware sets req.user.
export function userRateLimiter() {
    return async (req, res, next) => {
        const user = req.user;
        if (!user) {
            next();
            return;
        }
        const tier = user.tier ?? "free";
        const config = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
        const redisKey = `rl:user:${user.sub}`;
        try {
            const result = await consumeToken(redisKey, config);
            applyHeaders(res, result, config);
            if (!result.allowed) {
                res.set("Retry-After", String(result.retryAfter));
                res.status(429).json({
                    error: "Rate limit exceeded",
                    tier,
                    retryAfter: result.retryAfter,
                });
                return;
            }
            next();
        }
        catch (err) {
            console.error("[RateLimit] Redis error:", err.message);
            next();
        }
    };
}
// Tight IP-based limiter for auth endpoints (20 req / 15 min).
export function authRateLimiter() {
    return ipRateLimiter(AUTH_LIMIT, "rl:auth:ip");
}
// Global IP limiter suitable for use as app.use(), with an optional path exclusion list.
export function globalIpRateLimiter(excludePaths = []) {
    const limiter = ipRateLimiter();
    return (req, res, next) => {
        if (excludePaths.includes(req.path)) {
            next();
            return;
        }
        limiter(req, res, next);
    };
}

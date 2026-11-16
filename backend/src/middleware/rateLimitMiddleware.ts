/**
 * Rate Limiting Middleware — Issue #289
 *
 * Implements per-IP and per-user token bucket rate limiters backed by Redis.
 * All counters are stored in Redis so limits are consistent across multiple
 * server instances.
 *
 * Limits enforced:
 *  - Global IP limit:       200 req/min per IP (health check exempt)
 *  - Auth endpoints:         10 req/min per IP
 *  - Transaction endpoints:  30 req/min per authenticated user
 *  - Tiered user limit:      60 req/min (free) / 600 req/min (paid)
 *
 * All 429 responses include a Retry-After header (seconds until next token).
 * Redis errors fail open — availability is prioritised over strict enforcement.
 */

import { logger } from "../logger.js";
import { Request, Response, NextFunction, RequestHandler } from "express";
import { getRedis } from "../redis.js";

export type Tier = "free" | "paid";

interface BucketConfig {
  capacity: number;    // max tokens (burst ceiling)
  refillRate: number;  // tokens added per second
}

interface BucketResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfter: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucket configurations — all limits expressed in req/min
// ─────────────────────────────────────────────────────────────────────────────

/** Global: 200 req/min per IP */
export const GLOBAL_IP_LIMIT: BucketConfig = {
  capacity: 200,
  refillRate: 200 / 60, // ≈ 3.33 tokens/s
};

/** Auth endpoints: 10 req/min per IP */
export const AUTH_IP_LIMIT: BucketConfig = {
  capacity: 10,
  refillRate: 10 / 60, // ≈ 0.167 tokens/s
};

/** Transaction endpoints: 30 req/min per authenticated user */
export const TRANSACTION_USER_LIMIT: BucketConfig = {
  capacity: 30,
  refillRate: 30 / 60, // 0.5 tokens/s
};

/** Tiered user limits */
export const TIER_LIMITS: Record<Tier, BucketConfig> = {
  free: { capacity: 60, refillRate: 1 },     // 60 req/min
  paid: { capacity: 600, refillRate: 10 },    // 600 req/min
};

// ─────────────────────────────────────────────────────────────────────────────
// Atomic token bucket Lua script
// ─────────────────────────────────────────────────────────────────────────────

// KEYS[1] — Redis hash key for this bucket
// ARGV[1] — capacity, ARGV[2] — refillRate (tokens/sec), ARGV[3] — now (ms),
// ARGV[4] — TTL (s)
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

// ─────────────────────────────────────────────────────────────────────────────
// Core token bucket implementation
// ─────────────────────────────────────────────────────────────────────────────

async function consumeToken(
  redisKey: string,
  config: BucketConfig,
): Promise<BucketResult> {
  const now = Date.now();
  const ttl = Math.ceil(config.capacity / config.refillRate) + 60;

  const raw = (await getRedis().eval(
    TOKEN_BUCKET_LUA,
    1,
    redisKey,
    config.capacity,
    config.refillRate,
    now,
    ttl,
  )) as [number, number, number, number];

  return {
    allowed: raw[0] === 1,
    remaining: raw[1],
    limit: raw[2],
    retryAfter: raw[3],
  };
}

function applyRateLimitHeaders(
  res: Response,
  result: BucketResult,
  config: BucketConfig,
): void {
  const secondsToFull = Math.ceil(
    (config.capacity - result.remaining) / config.refillRate,
  );
  res.set({
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + secondsToFull),
  });
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported middleware factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IP-based token bucket limiter.
 * keyPrefix isolates different limit tiers (global vs auth).
 */
export function ipRateLimiter(
  config: BucketConfig = GLOBAL_IP_LIMIT,
  keyPrefix = "rl:global:ip",
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const redisKey = `${keyPrefix}:${clientIp(req)}`;
    try {
      const result = await consumeToken(redisKey, config);
      applyRateLimitHeaders(res, result, config);
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfter));
        res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests",
            retryAfter: result.retryAfter,
          },
        });
        return;
      }
      next();
    } catch (err) {
      // Fail open — Redis unavailability must not block legitimate traffic
      logger.error({ err: (err as Error).message }, "[RateLimit] Redis error — failing open");
      next();
    }
  };
}

/**
 * Per-user tiered limiter (free / paid).
 * Must run after authenticate middleware which sets req.user.
 */
export function userRateLimiter(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user as { sub: string; tier?: Tier } | undefined;
    if (!user) { next(); return; }

    const tier = user.tier ?? "free";
    const config = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
    const redisKey = `rl:user:${user.sub}`;

    try {
      const result = await consumeToken(redisKey, config);
      applyRateLimitHeaders(res, result, config);
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfter));
        res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Rate limit exceeded",
            tier,
            retryAfter: result.retryAfter,
          },
        });
        return;
      }
      next();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[RateLimit] Redis error — failing open");
      next();
    }
  };
}

/**
 * Auth endpoint limiter: 10 req/min per IP.
 * Applied to POST /api/auth/login and POST /api/auth/refresh.
 */
export function authRateLimiter(): RequestHandler {
  return ipRateLimiter(AUTH_IP_LIMIT, "rl:auth:ip");
}

/**
 * Transaction endpoint limiter: 30 req/min per authenticated user.
 * Applied to deposit / withdraw / harvest routes.
 */
export function transactionRateLimiter(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user as { sub: string } | undefined;
    if (!user) { next(); return; }

    const redisKey = `rl:txn:user:${user.sub}`;
    try {
      const result = await consumeToken(redisKey, TRANSACTION_USER_LIMIT);
      applyRateLimitHeaders(res, result, TRANSACTION_USER_LIMIT);
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfter));
        res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Transaction rate limit exceeded",
            retryAfter: result.retryAfter,
          },
        });
        return;
      }
      next();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[RateLimit] Redis error — failing open");
      next();
    }
  };
}

/**
 * Global IP limiter suitable for app.use() with optional path exclusions.
 * Health check paths are excluded by default (callers may extend the list).
 *
 * @param excludePaths - Exact paths to skip (e.g. ["/api/health"])
 */
export function globalIpRateLimiter(excludePaths: string[] = []): RequestHandler {
  const limiter = ipRateLimiter(GLOBAL_IP_LIMIT, "rl:global:ip");
  return (req: Request, res: Response, next: NextFunction): void => {
    if (excludePaths.includes(req.path)) { next(); return; }
    limiter(req, res, next);
  };
}

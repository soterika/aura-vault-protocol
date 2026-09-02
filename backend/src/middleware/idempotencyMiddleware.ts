/**
 * idempotencyMiddleware.ts — Express middleware for API transaction idempotency.
 *
 * Implements safe network retries using the `Idempotency-Key` header:
 *   1. Accepts `Idempotency-Key` header (must be a valid UUID).
 *   2. Rejects invalid UUID formats with 400 Bad Request.
 *   3. Checks Redis for an existing record with 24-hour TTL (86,400s).
 *   4. If key exists with the SAME request payload hash, returns the cached response (no re-execution).
 *   5. If key exists with a DIFFERENT request payload hash, rejects with 400 Bad Request.
 *   6. On first execution, caches the successful response in Redis with a 24-hour TTL.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "crypto";
import { getRedis } from "../redis.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

interface CachedIdempotencyRecord {
  requestHash: string;
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function idempotency(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.header("Idempotency-Key") || req.header("idempotency-key") || req.header("x-idempotency-key");

    // If no idempotency key header provided, pass through
    if (!rawKey) {
      return next();
    }

    const key = Array.isArray(rawKey) ? rawKey[0].trim() : rawKey.trim();

    // Validate UUID format server-side
    if (!UUID_REGEX.test(key)) {
      res.status(400).json({
        error: "Idempotency-Key must be a valid UUID",
        code: "INVALID_IDEMPOTENCY_KEY",
      });
      return;
    }

    // Deterministic payload hash for collision/reuse detection
    const payloadString = JSON.stringify(req.body ?? {});
    const requestHash = crypto.createHash("sha256").update(payloadString).digest("hex");
    const redisKey = `idempotency:${key}`;

    try {
      const redis = getRedis();
      const cachedData = await redis.get(redisKey);

      if (cachedData) {
        const record: CachedIdempotencyRecord = JSON.parse(cachedData);

        // Check if key is reused with a different request payload
        if (record.requestHash !== requestHash) {
          res.status(400).json({
            error: "Idempotency key reused with different request payload",
            code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
          });
          return;
        }

        // Return cached response without re-executing
        res.setHeader("X-Idempotent-Replay", "true");
        res.status(record.statusCode).json(record.body);
        return;
      }
    } catch (err) {
      console.warn("[idempotency] Redis error during lookup, proceeding without cache:", err);
    }

    // Intercept response to cache on completion
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      // Restore original res.json
      res.json = originalJson;

      // Only cache successful or intentional responses
      if (res.statusCode >= 200 && res.statusCode < 500) {
        try {
          const redis = getRedis();
          const record: CachedIdempotencyRecord = {
            requestHash,
            statusCode: res.statusCode,
            body,
          };
          redis.set(redisKey, JSON.stringify(record), "EX", IDEMPOTENCY_TTL_SECONDS).catch((err) => {
            console.warn("[idempotency] Failed to cache response in Redis:", err);
          });
        } catch (err) {
          console.warn("[idempotency] Redis client error during caching:", err);
        }
      }

      return originalJson(body);
    };

    next();
  };
}

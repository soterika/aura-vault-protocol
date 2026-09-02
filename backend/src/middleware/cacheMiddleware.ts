import { logger } from "../logger.js";
import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { cacheGet, cacheSet, NS } from "../cache.js";

interface CachedResponse {
  status: number;
  body: unknown;
}

export function cacheMiddleware(ttlSeconds: number) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (req.method !== "GET") {
      next();
      return;
    }

    const raw = `${req.path}:${JSON.stringify(req.query)}`;
    const cacheKey = crypto.createHash("md5").update(raw).digest("hex");

    const cached = await cacheGet<CachedResponse>(NS.API, cacheKey);
    if (cached) {
      res.status(cached.status).set("X-Cache", "HIT").json(cached.body);
      return;
    }

    // Intercept res.json to capture and store the response
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 400) {
        cacheSet(
          NS.API,
          cacheKey,
          { status: res.statusCode, body },
          ttlSeconds
        ).catch((err) => logger.error({ err }, "[Cache] Failed to store response"));
      }
      res.set("X-Cache", "MISS");
      return originalJson(body);
    };

    next();
  };
}

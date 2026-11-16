import crypto from "crypto";
import { cacheGet, cacheSet, NS } from "../cache.js";
export function cacheMiddleware(ttlSeconds) {
    return async (req, res, next) => {
        if (req.method !== "GET") {
            next();
            return;
        }
        const raw = `${req.path}:${JSON.stringify(req.query)}`;
        const cacheKey = crypto.createHash("md5").update(raw).digest("hex");
        const cached = await cacheGet(NS.API, cacheKey);
        if (cached) {
            res.status(cached.status).set("X-Cache", "HIT").json(cached.body);
            return;
        }
        // Intercept res.json to capture and store the response
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            if (res.statusCode < 400) {
                cacheSet(NS.API, cacheKey, { status: res.statusCode, body }, ttlSeconds).catch((err) => console.error("[Cache] Failed to store response:", err));
            }
            res.set("X-Cache", "MISS");
            return originalJson(body);
        };
        next();
    };
}

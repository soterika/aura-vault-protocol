import express from "express";
import rateLimit from "express-rate-limit";
import { parsePagination, paginateArray, } from "./middleware/paginationMiddleware.js";
const router = express.Router();
// In-memory cache: cacheKey -> { data, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 30_000;
const portfolioLimiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    keyGenerator: (req) => req.user?.sub ?? req.ip ?? "unknown",
    message: { error: "Rate limit exceeded" },
});
// Synthetic data builder — replace with real Soroban RPC calls
function buildAllPositions() {
    return [
        {
            contractId: process.env.VAULT_CONTRACT_ID ?? "CAURA_VAULT_TESTNET",
            shares: "1000",
            underlyingBalance: "1050",
            apy: 8.5,
            yieldEarned: "50",
            createdAt: "2026-01-01T00:00:00.000Z",
        },
    ];
}
/**
 * GET /api/v1/user/portfolio
 * Query params: cursor (opaque base64), limit (default 20, max 100)
 */
router.get("/", portfolioLimiter, (req, res) => {
    const user = req.user;
    if (!user?.sub) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const userId = user.sub;
    const { limit, cursor } = parsePagination(req);
    const cacheKey = `${userId}:${limit}:${cursor ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached.data);
        return;
    }
    try {
        const allPositions = buildAllPositions();
        const { data, nextCursor } = paginateArray(allPositions, (pos) => ({
            id: pos.contractId,
            timestamp: pos.createdAt,
        }), limit, cursor);
        const totalBalance = data
            .reduce((sum, p) => sum + BigInt(p.underlyingBalance), 0n)
            .toString();
        const response = {
            userId,
            totalBalance,
            data,
            nextCursor,
        };
        cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
        res.setHeader("X-Cache", "MISS");
        res.json(response);
    }
    catch (err) {
        console.error("[portfolio]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
export default router;

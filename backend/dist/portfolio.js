import express from "express";
import rateLimit from "express-rate-limit";
const router = express.Router();
// In-memory cache: userId -> { data, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 30_000;
const portfolioLimiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    keyGenerator: (req) => req.user?.sub ?? req.ip ?? "unknown",
    message: { error: "Rate limit exceeded" },
});
// Synthetic data builder — replace with real Soroban RPC calls
function buildPortfolio(userId, page, pageSize) {
    const allPositions = [
        {
            contractId: process.env.VAULT_CONTRACT_ID ?? "CAURA_VAULT_TESTNET",
            shares: "1000",
            underlyingBalance: "1050",
            apy: 8.5,
            yieldEarned: "50",
        },
    ];
    const total = allPositions.length;
    const start = (page - 1) * pageSize;
    const positions = allPositions.slice(start, start + pageSize);
    const totalBalance = positions
        .reduce((sum, p) => sum + BigInt(p.underlyingBalance), 0n)
        .toString();
    return { userId, totalBalance, positions, pagination: { page, pageSize, total } };
}
/**
 * GET /api/v1/user/portfolio
 * Query params: page (default 1), pageSize (default 20, max 100)
 */
router.get("/", portfolioLimiter, (req, res) => {
    const user = req.user;
    if (!user?.sub) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const userId = user.sub;
    // Validate pagination
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? "20", 10) || 20));
    const cacheKey = `${userId}:${page}:${pageSize}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached.data);
        return;
    }
    try {
        const data = buildPortfolio(userId, page, pageSize);
        cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        res.setHeader("X-Cache", "MISS");
        res.json(data);
    }
    catch (err) {
        console.error("[portfolio]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
export default router;

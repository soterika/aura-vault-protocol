import { Router } from "express";
import { createGasPriceService } from "../services/gasService.js";
import { parsePagination, paginateArray, MAX_LIMIT } from "../middleware/paginationMiddleware.js";
const gasService = createGasPriceService();
function parseChainId(value) {
    const parsed = value ? Number.parseInt(value, 10) : Number.parseInt(process.env.EVM_CHAIN_ID ?? "1", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
function parseGasLimit(value) {
    if (!value)
        return undefined;
    try {
        return BigInt(value);
    }
    catch {
        return undefined;
    }
}
export const gasRouter = Router();
/**
 * GET /api/v1/gas/prices
 * Returns Low / Standard / Fast fee options, backed by an RPC sample and cached for 1 minute.
 */
gasRouter.get("/prices", async (req, res) => {
    const chainId = parseChainId(req.query.chainId);
    const gasLimit = parseGasLimit(req.query.gasLimit);
    const forceRefresh = String(req.query.forceRefresh ?? "false") === "true";
    try {
        const estimate = await gasService.estimate(chainId, gasLimit, forceRefresh);
        res.json(estimate);
    }
    catch (err) {
        console.error("[gas]", err);
        res.status(500).json({ error: "Unable to estimate gas prices" });
    }
});
/**
 * GET /api/v1/gas/history
 * Returns cursor-paginated gas price samples for the requested chain.
 * Query params: chainId, cursor (opaque), limit (default 20, max 100)
 */
gasRouter.get("/history", async (req, res) => {
    const chainId = parseChainId(req.query.chainId);
    const { limit, cursor } = parsePagination(req);
    try {
        // Fetch up to MAX_LIMIT records from the service; paginate in-memory
        const allHistory = await gasService.history(chainId, MAX_LIMIT);
        const { data, nextCursor } = paginateArray(allHistory, (item, index) => ({
            id: String(index),
            timestamp: typeof item.fetchedAt === "string" ? item.fetchedAt : String(index),
        }), limit, cursor);
        res.json({ chainId, data, nextCursor });
    }
    catch (err) {
        console.error("[gas-history]", err);
        res.status(500).json({ error: "Unable to load gas history" });
    }
});
/**
 * GET /api/v1/gas/metrics
 * Returns service performance metrics (cache hit rate, accuracy tracking).
 */
gasRouter.get("/metrics", async (_req, res) => {
    try {
        const metrics = gasService.getMetrics();
        res.json(metrics);
    }
    catch (err) {
        console.error("[gas-metrics]", err);
        res.status(500).json({ error: "Unable to load metrics" });
    }
});

import { Router } from "express";
import { createGasPriceService } from "../services/gasService.js";
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
 * Returns the recent tracked gas samples for the requested chain.
 */
gasRouter.get("/history", async (req, res) => {
    const chainId = parseChainId(req.query.chainId);
    const limitRaw = Number.parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, limitRaw) : 10;
    try {
        const history = await gasService.history(chainId, limit);
        res.json({ chainId, history });
    }
    catch (err) {
        console.error("[gas-history]", err);
        res.status(500).json({ error: "Unable to load gas history" });
    }
});

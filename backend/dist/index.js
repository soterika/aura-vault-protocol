import cors from "cors";
import express from "express";
import { authenticate } from "./middleware/authMiddleware.js";
import { authRateLimiter, globalIpRateLimiter, userRateLimiter, } from "./middleware/rateLimitMiddleware.js";
import { generateTokens, getUserSessions, logout, refreshAccessToken, revokeAllSessions, } from "./auth.js";
import { pingRedis, disconnectRedis } from "./redis.js";
import { webhookRouter } from "./webhook.js";
import portfolioRouter from "./portfolio.js";
import { emailRouter } from "./routes/emailRoutes.js";
import { gasRouter } from "./routes/gasRoutes.js";
import { yieldRouter } from "./routes/yieldRoutes.js";
import { startWorker, stopWorker } from "./queue.js";
import { queueRouter } from "./routes/queueRoutes.js";
import { warmCache } from "./services/defi.js";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue.js";
const app = express();
app.use(cors());
app.use(express.json());
app.use(globalIpRateLimiter(["/api/health"]));
app.post("/api/auth/login", authRateLimiter(), async (req, res) => {
    const { walletAddress, deviceId, tier } = req.body;
    if (!walletAddress) {
        res.status(400).json({ error: "walletAddress required" });
        return;
    }
    const validTier = tier === "paid" ? "paid" : "free";
    const tokens = await generateTokens(walletAddress, deviceId, validTier);
    res.json(tokens);
});
app.post("/api/auth/refresh", authRateLimiter(), async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        res.status(400).json({ error: "refreshToken required" });
        return;
    }
    const tokens = await refreshAccessToken(refreshToken);
    if (!tokens) {
        res.status(401).json({ error: "Invalid or expired refresh token" });
        return;
    }
    res.json(tokens);
});
app.post("/api/auth/logout", authenticate, userRateLimiter(), async (req, res) => {
    const token = req.headers.authorization?.slice(7);
    if (!token) {
        res.status(401).json({ error: "Missing token" });
        return;
    }
    const { refreshToken } = req.body;
    await logout(token, refreshToken);
    res.json({ success: true });
});
app.get("/api/auth/sessions", authenticate, userRateLimiter(), async (req, res) => {
    const sessions = await getUserSessions(req.user.sub);
    res.json({ sessions });
});
app.post("/api/auth/revoke-all", authenticate, userRateLimiter(), async (req, res) => {
    await revokeAllSessions(req.user.sub);
    res.json({ success: true });
});
app.use("/api/webhooks", authenticate, webhookRouter);
app.use("/api/email", emailRouter);
app.use("/api/v1/user/portfolio", authenticate, portfolioRouter);
app.use("/api/v1/gas", gasRouter);
app.use("/api/v1/yield", yieldRouter);
app.use("/api/v1/queue", queueRouter);
app.get("/api/health", async (_req, res) => {
    const redisHealthy = await pingRedis();
    res.json({
        status: redisHealthy ? "ok" : "degraded",
        redis: redisHealthy,
        timestamp: new Date().toISOString(),
    });
});
const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const server = app.listen(PORT, () => {
    startWorker();
    startEmailWorker();
    void warmCache();
    console.log(`Aura Vault backend running on port ${PORT}`);
});
async function shutdown(signal) {
    console.log(`[shutdown] received ${signal}`);
    stopWorker();
    stopEmailWorker();
    server.close(async () => {
        await disconnectRedis().catch((err) => {
            console.error("[shutdown] redis disconnect failed:", err);
        });
        process.exit(0);
    });
}
for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
        void shutdown(signal);
    });
}
export default app;

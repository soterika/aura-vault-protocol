// ── OpenTelemetry — must be initialised before all other imports ─────────────
import { initTracing, tracingMiddleware, shutdownTracing } from "./tracing.js";
initTracing();

import express from "express";
import cors from "cors";
import { authenticate } from "./middleware/authMiddleware.js";
import {
  authRateLimiter,
  globalIpRateLimiter,
  userRateLimiter,
} from "./middleware/rateLimitMiddleware.js";
import {
  loggingMiddleware,
  errorLoggingMiddleware,
} from "./middleware/loggingMiddleware.js";
import {
  generateTokens,
  getUserSessions,
  logout,
  refreshAccessToken,
  revokeAllSessions,
  type Tier,
} from "./auth.js";
import { pingRedis, disconnectRedis } from "./redis.js";
import { webhookRouter } from "./webhook.js";
import { emailRouter } from "./routes/emailRoutes.js";
import { gasRouter } from "./routes/gasRoutes.js";
import { yieldRouter } from "./routes/yieldRoutes.js";
import { queueRouter } from "./routes/queueRoutes.js";
import { startWorker, stopWorker } from "./queue.js";
import { analyticsRouter } from "./routes/analyticsRoutes.js";
import { warmCache } from "./services/defi.js";
import { runCacheWarmup, getWarmupStatus } from "./services/cacheWarmup.js";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue.js";
import { startYieldWorker, stopYieldWorker } from "./services/yieldWorker.js";
import { vaultRouter } from "./routes/vaultRoutes.js";
import { vaultTransactionRouter } from "./routes/vaultTransactionRoutes.js";
import { userPreferencesRouter } from "./routes/userPreferencesRoutes.js";
import { leaderboardRouter } from "./routes/leaderboardRoutes.js";
import { swaggerRouter } from "./routes/swaggerRoutes.js";
import {
  applySecurityHeaders,
  corsOptions,
} from "./middleware/securityMiddleware.js";
import {
  correlationIdMiddleware,
  createRequestLogger,
} from "./logger.js";
import {
  validate,
  loginSchema,
  refreshSchema,
} from "./validation.js";
import { getDegradationStatus, degradationStatusMiddleware } from "./middleware/degradationMiddleware.js";
import {
  getCircuitBreakerState,
  getCircuitBreakerStats,
} from "./services/horizonCircuitBreakerService.js";
import {
  getDatabaseCircuitBreakerState,
  getDatabaseCircuitBreakerStats,
} from "./services/databaseCircuitBreakerService.js";
import {
  getRedisCircuitBreakerState,
  getRedisCircuitBreakerStats,
} from "./services/redisCircuitBreakerService.js";

const app = express();

// ── OpenTelemetry tracing middleware ─────────────────────────────────────────
// Attaches trace spans to every HTTP request and propagates
// X-Trace-Id / X-Correlation-Id headers on the response.
app.use(tracingMiddleware());

// ── A05 Security Misconfiguration: security headers (Helmet) ─────────────────
applySecurityHeaders(app);

// ── A05 Security Misconfiguration: strict CORS ───────────────────────────────
app.use(cors(corsOptions));

// ── A09 Logging Failures: correlation IDs + structured request logging ────────
app.use(correlationIdMiddleware());
app.use(createRequestLogger());
app.use(loggingMiddleware());

app.use(express.json({ limit: "1mb" }));

// Global IP rate limiter — health check excluded so load-balancer probes are not throttled
app.use(globalIpRateLimiter(["/api/health"]));

// ── Issue #869: Graceful Degradation — monitor circuit breaker states ────────
app.use(degradationStatusMiddleware);

// ── A03 Injection / A07 Auth Failures: validate login input with Zod ─────────
app.post(
  "/api/auth/login",
  authRateLimiter(),
  validate(loginSchema),
  async (req, res) => {
    const { walletAddress, deviceId, tier } = req.body as {
      walletAddress: string;
      deviceId?: string;
      tier: Tier;
    };

    const tokens = await generateTokens(walletAddress, deviceId, tier);
    res.json(tokens);
  }
);

app.post(
  "/api/auth/refresh",
  authRateLimiter(),
  validate(refreshSchema),
  async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };

    const tokens = await refreshAccessToken(refreshToken);
    if (!tokens) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    res.json(tokens);
  }
);

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
  const sessions = await getUserSessions((req as any).user.sub);
  res.json({ sessions });
});

app.post("/api/auth/revoke-all", authenticate, userRateLimiter(), async (req, res) => {
  await revokeAllSessions((req as any).user.sub);
  res.json({ success: true });
});

// ── A01 Broken Access Control: all protected routes use `authenticate` ────────
app.use("/api/webhooks", authenticate, webhookRouter);
app.use("/api/email", emailRouter);
app.use("/api/v1/user/portfolio", authenticate, portfolioRouter);
app.use("/api/v1/gas", gasRouter);
app.use("/api/v1/yield", yieldRouter);
app.use("/api/v1/queue", queueRouter);
app.use("/api/v1/vault", vaultRouter);
// Issue #322: Public leaderboard endpoint — no auth required (truncated addresses only)
app.use("/api/vault/leaderboard", leaderboardRouter);
// Issue #318: User preferences — requires authentication
app.use("/api/users/preferences", authenticate, userPreferencesRouter);
app.use("/api/analytics", analyticsRouter);

// Issue #302: Vault transaction endpoints (deposit / withdraw / harvest)
app.use("/api/v1/vault", vaultTransactionRouter);

// Issue #868: OpenAPI 3.1 Spec and Swagger UI at /api/docs
app.use("/api/docs", swaggerRouter);

app.get("/api/health", async (_req, res) => {
  const redisHealthy = await pingRedis();
  const warmup = getWarmupStatus();
  const degradationStatus = getDegradationStatus();
  const horizonStats = getCircuitBreakerStats();
  const databaseStats = getDatabaseCircuitBreakerStats();
  const redisStats = getRedisCircuitBreakerStats();

  // Return 'starting' until cache warm-up completes (issue #325)
  let status: string;
  if (warmup === "pending" || warmup === "warming") {
    status = "starting";
  } else if (degradationStatus.isDegraded) {
    status = "degraded";
  } else {
    status = "ok";
  }

  res.json({
    status,
    timestamp: new Date().toISOString(),
    // Legacy fields for backwards compatibility
    redis: redisHealthy,
    warmup,
    // Issue #869: Circuit breaker states and stats
    circuits: {
      horizon: {
        state: getCircuitBreakerState(),
        stats: horizonStats,
      },
      database: {
        state: getDatabaseCircuitBreakerState(),
        stats: databaseStats,
      },
      redis: {
        state: getRedisCircuitBreakerState(),
        stats: redisStats,
      },
    },
    degradation: degradationStatus,
  });
});

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const server = app.listen(PORT, () => {
  void autoMigrate();         // issue #293: run pending SQL migrations on startup
  startWorker();
  startEmailWorker();
  startYieldWorker();
  void warmCache();           // existing DeFi price warm-up
  void runCacheWarmup();      // issue #325: vault stats / share price / top depositors
  console.log(`Aura Vault backend running on port ${PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] received ${signal}`);
  stopWorker();
  stopEmailWorker();
  stopYieldWorker();
  await shutdownTracing();
  server.close(async () => {
    await disconnectRedis().catch((err) => {
      console.error("[shutdown] redis disconnect failed:", err);
    });
    process.exit(0);
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

export default app;

// ── OpenTelemetry — must be initialised before all other imports ─────────────
import { initTracing, tracingMiddleware, shutdownTracing } from "./tracing.js";
initTracing();

import express from "express";
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
import { notificationRouter } from "./routes/notificationRoutes.js";
import { gasRouter } from "./routes/gasRoutes.js";
import { yieldRouter } from "./routes/yieldRoutes.js";
import { queueRouter } from "./routes/queueRoutes.js";
import { startWorker, stopWorker } from "./queue.js";
import { analyticsRouter } from "./routes/analyticsRoutes.js";
import { apyRouter } from "./routes/apyRoutes.js";
// Issue #285: Contract event stream (SSE)
import { eventsRouter } from "./routes/eventsRoutes.js";
// Issue #286: Stellar wallet JWT authentication
import { stellarAuthRouter } from "./routes/stellarAuthRoutes.js";
// Issue #288: BullMQ vault transaction queue
import { vaultQueueRouter } from "./routes/vaultQueueRoutes.js";
import { initVaultQueue, stopVaultQueue } from "./vaultQueue.js";
import { warmCache } from "./services/defi.js";
import {
  startAnalyticsCacheWarmer,
  stopAnalyticsCacheWarmer,
} from "./services/analyticsCache.js";
import { cacheStatsPrometheusText } from "./cache.js";
import { responseEnvelopeMiddleware } from "./middleware/responseEnvelope.js";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { runCacheWarmup, getWarmupStatus } from "./services/cacheWarmup.js";
import { startEmailWorker, stopEmailWorker } from "./services/emailQueue.js";
import {
  startDigestScheduler,
  stopDigestScheduler,
} from "./services/digestScheduler.js";
import { openApiValidationMiddleware } from "./middleware/requestValidationMiddleware.js";
import {
  startUserExportWorker,
  stopUserExportWorker,
} from "./services/userExportService.js";
import { startYieldWorker, stopYieldWorker } from "./services/yieldWorker.js";
import { startHarvestRepeatableJob, stopHarvestRepeatableJob } from "./services/harvestRepeatableJob.js";
import { startAlertEvaluationJob, stopAlertEvaluationJob } from "./services/alertEvaluationJob.js";
import { startSharePriceAlertWorker, stopSharePriceAlertWorker } from "./services/sharePriceAlertWorker.js";
import { vaultRouter } from "./routes/vaultRoutes.js";
import { vaultTransactionRouter } from "./routes/vaultTransactionRoutes.js";
import { vaultRegistryRouter } from "./routes/vaultRegistryRoutes.js";
import { startVaultSyncJob, stopVaultSyncJob } from "./services/vaultRegistryService.js";
import { vaultSubmitRouter } from "./routes/vaultSubmitRoutes.js";
import { balanceOfRouter } from "./routes/balanceOfRoutes.js";
import { userPreferencesRouter } from "./routes/userPreferencesRoutes.js";
import { leaderboardRouter } from "./routes/leaderboardRoutes.js";
import { referralRouter } from "./routes/referralRoutes.js";
import { userExportRouter } from "./routes/userExportRoutes.js";
import { indexerRouter } from "./routes/indexerRoutes.js";
import { portfolioHistoryRouter } from "./routes/portfolioHistoryRoutes.js";
import { swaggerRouter } from "./routes/swaggerRoutes.js";
// Issue #1268: Governance proposals API
import { governanceRouter } from "./routes/governanceRoutes.js";
// Issue #1271: SSE vault events endpoint
import { vaultEventsRouter } from "./routes/vaultEventsRoutes.js";
// Issue #263: Admin panel — router + middleware
import { adminRouter } from "./routes/adminRoutes.js";
import { federationRouter } from "./routes/federationRoutes.js";
import { authenticateAdmin } from "./middleware/adminMiddleware.js";
import {
  applySecurityHeaders,
  applyCors,
} from "./middleware/securityMiddleware.js";
import {
  correlationIdMiddleware,
  createRequestLogger,
  logger,
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
import { metricsRouter, metricsMiddleware } from "./metrics.js";
// Issue #1272: response compression
import { compressionMiddleware } from "./middleware/compressionMiddleware.js";
// Issue #1269: safe startup log — import only non-sensitive config sections
import { serverConfig, redisConfig, databaseConfig } from "./config/index.js";

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
app.use(metricsMiddleware());

app.use(express.json({ limit: "1mb" }));
// Issue #1272: compress responses before they leave the server
app.use(compressionMiddleware);
app.use(responseEnvelopeMiddleware);

// ── Issue #945: OpenAPI request validation (disabled in test env) ────────────
if (process.env.NODE_ENV !== "test") {
  app.use(openApiValidationMiddleware());
}

// Global IP rate limiter — health check and metrics excluded so load-balancer probes and scrapers are not throttled
app.use(globalIpRateLimiter(["/api/health", "/metrics"]));

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

// Issue #292: Prometheus metrics endpoint — bearer-token protected
app.use("/metrics", metricsRouter);

// ── A01 Broken Access Control: all protected routes use `authenticate` ────────
app.use("/api/webhooks", authenticate, webhookRouter);
app.use("/api/email", emailRouter);
app.use("/api/notifications/email", notificationRouter);
app.use("/api/v1/user/portfolio", authenticate, portfolioRouter);
// Issue #290: Portfolio history — public read; address is in the path param
app.use("/api/portfolio", portfolioHistoryRouter);
app.use("/api/v1/gas", gasRouter);
app.use("/api/v1/yield", yieldRouter);
app.use("/api/v1/queue", queueRouter);
app.use("/api/v1/vault", vaultRouter);
// Issue #322: Public leaderboard endpoint — no auth required (truncated addresses only)
app.use("/api/vault/leaderboard", leaderboardRouter);
// Issue #318: User preferences — requires authentication
app.use("/api/users/preferences", authenticate, userPreferencesRouter);
app.use("/api/users/export", userExportRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/v1/vault/apy", apyRouter);
app.use("/api/v1/indexer", indexerRouter);

// Issue #302: Vault transaction endpoints (deposit / withdraw / harvest)
app.use("/api/v1/vault", vaultTransactionRouter);

// Issue #942: Vault registry CRUD — public read, admin-only write
app.use("/api/v1/vaults", vaultRegistryRouter);

// Vault transaction submit — lightweight UI modal endpoint
app.use("/api/vault/transactions", vaultSubmitRouter);
// Public read-only account share lookup used by portfolio analysis.
app.use("/api/vault", balanceOfRouter);

// Referral tracking — public routes (register, stats, deposit webhook)
app.use("/api/referrals", referralRouter);

// Issue #868: OpenAPI 3.1 Spec and Swagger UI at /api/docs
app.use("/api/docs", swaggerRouter);

// Issue #1268: Governance proposals API
app.use("/api/v1/governance", governanceRouter);

// Issue #1271: SSE vault events endpoint
app.use("/api/v1/vault", vaultEventsRouter);

// ── Issue #285: Contract event stream (SSE) ───────────────────────────────────
app.use("/api/v1/events", eventsRouter);
app.use("/api/federation", federationRouter);

// ── Issue #286: Stellar wallet challenge/verify JWT authentication ────────────
app.use("/api/auth", stellarAuthRouter);

// ── Issue #288: BullMQ vault transaction queue endpoints ──────────────────────
app.use("/api/vault", authenticate, vaultQueueRouter);

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

app.get("/metrics/cache", async (_req, res) => {
  try {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(await cacheStatsPrometheusText());
  } catch (err) {
    logger.error({ err }, "Failed to render cache metrics");
    res.status(500).send("# error generating cache metrics\n");
  }
});

app.use(errorLoggingMiddleware);
app.use(errorHandler);

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const server = app.listen(PORT, () => {
  void autoMigrate();         // issue #293: run pending SQL migrations on startup
  startWorker();
  startEmailWorker();
  startDigestScheduler();     // issue #935: weekly portfolio digest cron job
  startUserExportWorker();
  startYieldWorker();
  startVaultSyncJob();        // issue #942: background TVL/APY sync for vault registry
  void startHarvestRepeatableJob(); // issue #944: BullMQ repeatable harvest cron job
  void startAlertEvaluationJob();  // issue #946: alert threshold evaluation every 5 min
  startSharePriceAlertWorker();    // issue #908: hourly share price alert evaluation
  startAnalyticsCacheWarmer();
  void warmCache();           // existing DeFi price warm-up
  void runCacheWarmup();      // issue #325: vault stats / share price / top depositors

  // Issue #288: Initialise BullMQ and mount bull-board admin UI
  try {
    const bullBoardAdapter = initVaultQueue();
    // Mount admin UI — protected by authenticate middleware
    app.use("/admin/queues", authenticate, bullBoardAdapter.getRouter());
    logger.info("[startup] Bull Board mounted at /admin/queues");
  } catch (err) {
    logger.warn({ err }, "[startup] BullMQ init failed — vault queue unavailable");
  }

  // Issue #1269: emit a safe startup log — no secrets, passwords, or full connection URLs.
  // Extract only the hostname portion from connection strings so credentials never appear in logs.
  const redisHost = (() => { try { return new URL(redisConfig.url).hostname; } catch { return "unknown"; } })();
  const dbHost   = (() => { try { return new URL(databaseConfig.url).hostname; } catch { return "unknown"; } })();
  logger.info(
    { port: PORT, nodeEnv: serverConfig.nodeEnv, redisHost, dbHost },
    `Aura Vault backend running on port ${PORT}`,
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, `[shutdown] received ${signal}`);
  stopWorker();
  stopEmailWorker();
  stopDigestScheduler();      // issue #935
  stopUserExportWorker();
  stopYieldWorker();
  stopSharePriceAlertWorker(); // issue #908
  stopVaultSyncJob();         // issue #942
  await stopHarvestRepeatableJob(); // issue #944
  await stopAlertEvaluationJob();  // issue #946
  stopAnalyticsCacheWarmer();
  await stopVaultQueue(); // Issue #288: graceful BullMQ shutdown
  await shutdownTracing();
  server.close(async () => {
    await disconnectRedis().catch((err) => {
      logger.error({ err }, "[shutdown] redis disconnect failed");
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

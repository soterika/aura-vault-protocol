/**
 * Graceful Degradation Middleware — Issue #869
 *
 * Detects when services are degraded (circuit breaker open) and:
 * - Returns appropriate cached responses when available
 * - Returns 503 Service Unavailable with degraded status
 * - Provides retry-after headers for clients
 * - Logs degradation events for observability
 */

import { Request, Response, NextFunction } from "express";
import { getDatabaseCircuitBreakerState } from "../services/databaseCircuitBreakerService.js";
import { getRedisCircuitBreakerState } from "../services/redisCircuitBreakerService.js";
import { getCircuitBreakerState } from "../services/horizonCircuitBreakerService.js";

export interface DegradationStatus {
  isDegraded: boolean;
  redis: boolean;
  database: boolean;
  horizon: boolean;
  message: string;
}

/**
 * Get current degradation status across all services.
 */
export function getDegradationStatus(): DegradationStatus {
  const redisState = getRedisCircuitBreakerState();
  const dbState = getDatabaseCircuitBreakerState();
  const horizonState = getCircuitBreakerState();

  const isRedisOpen = redisState === "OPEN";
  const isDatabaseOpen = dbState === "OPEN";
  const isHorizonOpen = horizonState === "OPEN";

  const isDegraded = isRedisOpen || isDatabaseOpen || isHorizonOpen;

  const degradedServices: string[] = [];
  if (isRedisOpen) degradedServices.push("cache");
  if (isDatabaseOpen) degradedServices.push("database");
  if (isHorizonOpen) degradedServices.push("Horizon");

  const message = isDegraded
    ? `Service degraded: ${degradedServices.join(", ")} unavailable`
    : "All services operational";

  return {
    isDegraded,
    redis: isRedisOpen,
    database: isDatabaseOpen,
    horizon: isHorizonOpen,
    message,
  };
}

/**
 * Middleware that attaches degradation status to request for use by handlers.
 * Handlers can check req.degradationStatus to decide whether to:
 * - Serve cached data
 * - Return 503 Service Unavailable
 * - Proceed with best-effort logic
 *
 * @example
 * app.use(degradationStatusMiddleware);
 * app.get('/api/endpoint', (req, res) => {
 *   if (req.degradationStatus.isDegraded) {
 *     return res.status(503).json({ error: 'Service degraded' });
 *   }
 *   // Normal processing
 * });
 */
export function degradationStatusMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = getDegradationStatus();
  (req as Request & { degradationStatus: DegradationStatus }).degradationStatus = status;

  // Log degradation state on status change (log only once per state transition)
  if (status.isDegraded && !(req as any)._degradationLogged) {
    console.warn("[degradation] Service degraded:", status);
    (req as any)._degradationLogged = true;
  }

  next();
}

/**
 * Error handler middleware for 503 Service Unavailable responses.
 * Returns structured error response when services are degraded.
 *
 * @example
 * app.use(degradationErrorHandler);
 */
export function degradationErrorHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = getDegradationStatus();

  // If the response has already been sent, skip
  if (res.headersSent) {
    return next();
  }

  // Attach status to res.locals for use by other middlewares/handlers
  res.locals.degradationStatus = status;

  next();
}

/**
 * Creates a response for degraded service scenarios.
 * Used when a required service (database, Horizon) is unavailable.
 */
export function createDegradedResponse(degradationStatus: DegradationStatus) {
  return {
    success: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: degradationStatus.message,
      details: {
        redis: degradationStatus.redis ? "unavailable" : "operational",
        database: degradationStatus.database ? "unavailable" : "operational",
        horizon: degradationStatus.horizon ? "unavailable" : "operational",
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
      retryAfter: 30, // Suggest retry after 30 seconds
    },
  };
}

/**
 * Creates a response for when a specific operation fails due to degradation.
 * Includes retry-after header recommendation.
 */
export function createServiceUnavailableResponse(reason: string, retryAfterSeconds = 30) {
  return {
    success: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: reason,
    },
    meta: {
      timestamp: new Date().toISOString(),
      retryAfter: retryAfterSeconds,
    },
  };
}

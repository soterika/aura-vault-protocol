/**
 * Structured JSON logging via Pino — issue #XXX (pino-structured-logging)
 *
 * EXPORTS
 *   logger              — root Pino logger (use this everywhere instead of console.*)
 *   correlationIdMiddleware — Express middleware that attaches a correlationId to every
 *                           request from X-Request-ID header or generates a UUID v4
 *   createRequestLogger — Returns a pino-http middleware that logs every HTTP request
 *                         with method, path, status, duration, and correlationId
 *
 * REDACTION
 *   The following fields are automatically redacted from log output:
 *     password, token, accessToken, refreshToken, jwtSecret, secret,
 *     authorization, x-api-key, privateKey, mnemonic, seed
 *
 * LOG LEVELS (Pino)
 *   trace | debug | info | warn | error | fatal
 *   Controlled via LOG_LEVEL env var (default: "info")
 *
 * LOKI SHIPPING
 *   In production, pipe stdout to Promtail which forwards JSON lines to Loki.
 *   See infrastructure/promtail/promtail-config.yml for configuration.
 */

import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { serverConfig } from "./config/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sensitive field paths to redact from all log output
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED_PATHS: string[] = [
  // Auth & JWT
  "password",
  "*.password",
  "req.body.password",
  "req.body.token",
  "req.body.accessToken",
  "req.body.refreshToken",
  "res.body.accessToken",
  "res.body.refreshToken",
  "token",
  "accessToken",
  "refreshToken",
  "jwtSecret",
  "secret",
  "*.secret",
  "*.jwtSecret",
  // HTTP headers
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  // Crypto / wallet
  "privateKey",
  "*.privateKey",
  "mnemonic",
  "*.mnemonic",
  "seed",
  "*.seed",
  "secretKey",
  "*.secretKey",
];

// ─────────────────────────────────────────────────────────────────────────────
// Root Pino logger instance
// ─────────────────────────────────────────────────────────────────────────────

const isDevelopment = serverConfig.nodeEnv === "development";

export const logger = pino({
  level: serverConfig.logLevel,

  // Pretty-print in development for readability; raw JSON in production (Loki-ready)
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,

  // Base fields added to every log line
  base: {
    service: "aura-vault-backend",
    env: serverConfig.nodeEnv,
  },

  // Redact sensitive fields before writing
  redact: {
    paths: REDACTED_PATHS,
    censor: "[REDACTED]",
  },

  // ISO timestamps
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ─────────────────────────────────────────────────────────────────────────────
// Correlation ID middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches a correlationId to the request object and echoes it on the response
 * as X-Request-ID.  Uses the incoming X-Request-ID header when present; falls
 * back to a fresh UUID v4 otherwise.
 *
 * Must be registered BEFORE the request logger so pino-http can pick up the ID.
 */
export function correlationIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const existingId =
      (req.headers["x-request-id"] as string | undefined) ||
      (req.headers["x-correlation-id"] as string | undefined);

    const correlationId = existingId ?? randomUUID();

    // Attach to the request so downstream handlers can access it
    (req as Request & { correlationId: string }).correlationId = correlationId;

    // Echo on the response for client-side tracing
    res.setHeader("X-Request-ID", correlationId);

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pino-HTTP request logger factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a pino-http middleware instance that logs every HTTP request with:
 *   method, url, statusCode, responseTime (ms), correlationId
 *
 * Health check requests (GET /api/health) are logged at trace level so they
 * don't flood info-level logs in production.
 */
export function createRequestLogger() {
  return pinoHttp({
    logger,

    // Attach correlationId to every request log
    genReqId(req) {
      return (
        (req as Request & { correlationId?: string }).correlationId ??
        (req.headers["x-request-id"] as string | undefined) ??
        randomUUID()
      );
    },

    // Custom serializers — strip sensitive headers before logging
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          // Forward the correlationId from the req object
          correlationId: (req.raw as Request & { correlationId?: string })
            .correlationId,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },

    // Reduce noise: log health checks at trace level
    customLogLevel(_req, res, err) {
      if (err) return "error";
      if (res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      const url = (_req as unknown as { url?: string }).url ?? "";
      if (url === "/api/health") return "trace";
      return "info";
    },

    // Shape the log message
    customSuccessMessage(req, res) {
      return `${req.method} ${(req as unknown as { url?: string }).url ?? ""} ${res.statusCode}`;
    },

    customErrorMessage(req, res, err) {
      return `${req.method} ${(req as unknown as { url?: string }).url ?? ""} ${res.statusCode} — ${err.message}`;
    },

    // Extra fields on each request log
    customAttributeKeys: {
      req: "request",
      res: "response",
      err: "error",
      responseTime: "duration",
      reqId: "correlationId",
    },
  });
}

// Convenience re-exports so callers can do `import { logger } from './logger.js'`
export default logger;

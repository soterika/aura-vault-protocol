/**
 * Structured logger — Pino
 *
 * Replaces Winston with Pino for structured JSON logging.
 *
 * Features:
 *   - JSON output on every line (Loki / Promtail compatible)
 *   - Log level driven by LOG_LEVEL env var (default: info)
 *   - Sensitive fields redacted at serialisation time
 *   - correlationIdMiddleware() stamps every request with a UUID
 *   - createRequestLogger() logs method, path, status, durationMs, correlationId
 *   - Correlation ID read from X-Request-ID or X-Correlation-ID header;
 *     generated as UUID v4 when absent
 */

import pino, { type Logger as PinoLogger } from 'pino';
import { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';

// ─── Sensitive field redaction ────────────────────────────────────────────────
// Pino redacts these paths before serialising each log line.

const REDACTED_PATHS = [
  'authorization',
  'password',
  'passwd',
  'token',
  'accessToken',
  'refreshToken',
  'privateKey',
  'private_key',
  'apiKey',
  'api_key',
  'secret',
  'mnemonic',
  'seed',
  'seedPhrase',
  'seed_phrase',
  // Nested variants (pino dot-notation)
  'req.headers.authorization',
  'body.password',
  'body.token',
  'body.privateKey',
  'body.mnemonic',
];

// ─── Logger instance ──────────────────────────────────────────────────────────

export const logger: PinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    /** Emit the level as a human-readable label instead of an integer. */
    level(label: string) {
      return { level: label };
    },
  },
  /** Remove default pid/hostname fields to keep log lines lean. */
  base: null,
});

// ─── Express type augmentation ────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** UUID assigned to every request for end-to-end tracing. */
      correlationId?: string;
      /** Child Pino logger pre-bound with correlationId for downstream use. */
      log?: PinoLogger;
    }
  }
}

// ─── Correlation ID middleware ────────────────────────────────────────────────

/**
 * Assigns a correlation ID to every incoming request.
 *
 * Priority order:
 *   1. X-Request-ID header (de-facto standard forwarded by API gateways)
 *   2. X-Correlation-ID header (echoed from a previous response)
 *   3. freshly generated UUID v4
 *
 * The resolved ID is attached to `req.correlationId` and echoed back in
 * the `X-Correlation-ID` response header so clients can track request chains.
 *
 * Mount this middleware before any route handlers.
 */
export function correlationIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const fromHeader =
      req.headers['x-request-id'] ??
      req.headers['x-correlation-id'];

    const correlationId =
      typeof fromHeader === 'string' && fromHeader.length > 0
        ? fromHeader
        : randomUUID();

    req.correlationId = correlationId;

    // Echo ID back so clients can correlate their request
    res.setHeader('X-Correlation-ID', correlationId);

    // Bind a child logger so downstream code can use req.log.info(...)
    req.log = logger.child({ correlationId });

    next();
  };
}

// ─── Request logger middleware ────────────────────────────────────────────────

/**
 * Logs a single structured line per request/response pair with:
 *   correlationId, method, path, status, durationMs, ip
 *
 * The health endpoint is excluded to reduce log noise.
 *
 * Mount this middleware after correlationIdMiddleware().
 */
export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip health-check polling to avoid flooding logs
    if (req.path === '/api/health') {
      next();
      return;
    }

    const start = Date.now();
    const correlationId = req.correlationId;
    const childLogger = req.log ?? logger.child({ correlationId });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const status = res.statusCode;

      // Choose log level based on HTTP status
      const level: 'error' | 'warn' | 'info' =
        status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

      childLogger[level](
        {
          correlationId,
          method: req.method,
          path: req.path,
          status,
          durationMs,
          ip: req.ip,
        },
        'HTTP request',
      );
    });

    next();
  };
}

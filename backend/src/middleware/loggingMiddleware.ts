/**
 * Express logging middleware — delegates to the Pino logger.
 *
 * This file provides `loggingMiddleware` and `errorLoggingMiddleware` which are
 * mounted in src/index.ts.  Both are thin wrappers around the root Pino logger
 * exported from src/logger.ts.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";
import type { ApiError } from "./errorMiddleware.js";

/**
 * General-purpose logging middleware.
 * Currently a no-op at the middleware level because pino-http (mounted via
 * createRequestLogger() in index.ts) already handles per-request logging.
 * Kept here as the mount-point so index.ts stays stable while giving us a
 * place to add app-level log enrichment in the future.
 */
export function loggingMiddleware() {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

/**
 * Error logging middleware — logs unhandled errors with full context before
 * passing them to the error handler.
 *
 * Mount AFTER all routes but BEFORE the generic errorHandler in index.ts.
 */
export function errorLoggingMiddleware(
  err: Error | ApiError,
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const correlationId =
    (req as Request & { correlationId?: string }).correlationId ?? "unknown";

  const apiError = err as ApiError;

  logger.error(
    {
      correlationId,
      err: {
        message: err.message,
        stack: err.stack,
        statusCode: apiError.statusCode,
        isOperational: apiError.isOperational,
      },
      req: {
        method: req.method,
        url: req.url,
        ip: req.ip,
      },
    },
    "Unhandled request error"
  );

  next(err);
}

import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

// ── Module augmentation: extend Express types ─────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
    interface Response {
      /**
       * Send a standardised success envelope.
       *
       * Shape: { success: true, data, meta: { requestId, timestamp, version } }
       */
      success(data: unknown, statusCode?: number): void;

      /**
       * Send a standardised error envelope.
       *
       * Shape: { success: false, error: { code, message, details }, meta: {...} }
       */
      failure(
        code: string,
        message: string,
        statusCode?: number,
        details?: unknown
      ): void;
    }
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

export function responseEnvelopeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Attach a unique request ID to every request
  req.requestId = uuidv4();

  // ── res.success() helper ─────────────────────────────────────────────────
  res.success = function (data: unknown, statusCode = 200): void {
    this.status(statusCode).json({
      success: true,
      data,
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      },
    });
  };

  // ── res.failure() helper ─────────────────────────────────────────────────
  res.failure = function (
    code: string,
    message: string,
    statusCode = 400,
    details?: unknown
  ): void {
    this.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined && { details }),
      },
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      },
    });
  };

  next();
}

/**
 * Request Validation Middleware — Issue #316
 *
 * Enforces:
 *  - 64 KB maximum body size on all endpoints (returns 413 Payload Too Large)
 *  - application/json Content-Type on all POST and PUT requests (returns 415 Unsupported Media Type)
 *  - multipart/form-data explicitly blocked to eliminate file-upload attack vectors
 *
 * Usage:
 *   app.use(bodySizeLimit());
 *   app.use(contentTypeEnforcement());
 *   app.use(express.json({ limit: "64kb" }));   // size limit also enforced at parser level
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import express from "express";

/** 64 KB in bytes */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Returns the raw Content-Length from the request headers as a number,
 * or -1 when the header is absent / unparseable.
 */
function contentLengthBytes(req: Request): number {
  const header = req.headers["content-length"];
  if (!header) return -1;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) ? n : -1;
}

/**
 * Extracts the media-type portion of a Content-Type header, stripping
 * any parameters (e.g. "application/json; charset=utf-8" → "application/json").
 */
function mediaType(req: Request): string {
  const ct = req.headers["content-type"] ?? "";
  return ct.split(";")[0].trim().toLowerCase();
}

/**
 * Middleware — rejects requests whose Content-Length exceeds MAX_BODY_BYTES.
 *
 * Note: This is a first-pass guard based on the declared Content-Length header.
 * The express.json({ limit }) call further enforces the limit during actual
 * body streaming.
 */
export function bodySizeLimit(limitBytes: number = MAX_BODY_BYTES): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const len = contentLengthBytes(req);
    if (len > limitBytes) {
      res.status(413).json({
        error: "Payload Too Large",
        message: `Request body must not exceed ${limitBytes} bytes`,
      });
      return;
    }
    next();
  };
}

/**
 * Middleware — enforces application/json Content-Type on POST and PUT requests.
 *
 * Explicitly blocks:
 *  - multipart/form-data  (no file-upload vectors on API endpoints)
 *  - application/x-www-form-urlencoded
 *  - any other non-JSON type
 *
 * GET, DELETE, HEAD, OPTIONS, PATCH requests without a body are passed through
 * unchanged.  PATCH requests that carry a body must also be application/json.
 */
export function contentTypeEnforcement(): RequestHandler {
  const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!BODY_METHODS.has(req.method)) {
      next();
      return;
    }

    // Requests with no body (Content-Length: 0 or no content-length and no content-type)
    // can be let through — the JSON parser will handle an empty body gracefully.
    const hasBody =
      contentLengthBytes(req) > 0 ||
      req.headers["transfer-encoding"] !== undefined ||
      req.headers["content-type"] !== undefined;

    if (!hasBody) {
      next();
      return;
    }

    const mt = mediaType(req);

    // Explicitly block multipart to prevent any file-upload vector
    if (mt === "multipart/form-data") {
      res.status(415).json({
        error: "Unsupported Media Type",
        message: "multipart/form-data is not accepted on API endpoints",
      });
      return;
    }

    if (mt !== "application/json") {
      res.status(415).json({
        error: "Unsupported Media Type",
        message: "Content-Type must be application/json",
      });
      return;
    }

    next();
  };
}

/**
 * Convenience factory: returns a pre-configured express.json() parser that
 * enforces the same 64 KB limit at the streaming level, ensuring that even
 * requests omitting Content-Length are capped correctly.
 */
export function jsonBodyParser(limitBytes: number = MAX_BODY_BYTES): RequestHandler {
  return express.json({ limit: limitBytes });
}

/**
 * Security middleware — OWASP A05 Security Misconfiguration
 *
 * - Helmet: sets all recommended HTTP security headers
 * - HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
 * - Strict CORS: only allows origins listed in CORS_ORIGIN env var
 */

import helmet from "helmet";
import cors, { type CorsOptions } from "cors";
import { type Application } from "express";
import { logger } from "../logger.js";

// ── CORS ──────────────────────────────────────────────────────────────────────

function buildAllowedOrigins(): (string | RegExp)[] {
  const raw = process.env.CORS_ORIGIN ?? "";
  if (raw.trim() === "" || raw.trim() === "*") {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        "[security] CORS_ORIGIN is not set in production — defaulting to deny all."
      );
      return [];
    }
    return [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
  }
  return raw.split(",").map((o) => o.trim());
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      if (process.env.NODE_ENV !== "production") {
        callback(null, true);
      } else {
        callback(new Error("No origin header"), false);
      }
      return;
    }
    const allowed = buildAllowedOrigins();
    const isAllowed = allowed.some((pattern) =>
      typeof pattern === "string" ? pattern === origin : pattern.test(origin)
    );
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} is not allowed by CORS policy`), false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Correlation-ID"],
  exposedHeaders: ["X-Correlation-ID"],
  maxAge: 86400,
};

// ── Helmet ────────────────────────────────────────────────────────────────────

/**
 * Applies all security headers to the Express app.
 * Call this before registering any routes.
 */
export function applySecurityHeaders(app: Application): void {
  app.use(
    helmet({
      hsts: {
        maxAge: 63072000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xssFilter: true,
      hidePoweredBy: true,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      permittedCrossDomainPolicies: { permittedPolicies: "none" },
    })
  );

  // Permissions-Policy (not in Helmet yet)
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    next();
  });
}

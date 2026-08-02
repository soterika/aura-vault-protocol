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

// ── CORS ──────────────────────────────────────────────────────────────────────

function buildAllowedOrigins(): (string | RegExp)[] {
  const raw = process.env.CORS_ORIGIN ?? "";

  if (raw.trim() === "" || raw.trim() === "*") {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[security] CORS_ORIGIN is not set in production — defaulting to deny browser origins."
      );

      // Do not allow browser origins, but allow non-browser requests
      // (Kubernetes probes, internal services, CLI tools)
      return [];
    }

    return [
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    ];
  }

  return raw.split(",").map((o) => o.trim());
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    /**
     * Kubernetes probes, backend-to-backend requests,
     * curl, and internal service calls do not send Origin.
     *
     * Allow these requests.
     */
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowed = buildAllowedOrigins();

    const isAllowed = allowed.some((pattern) =>
      typeof pattern === "string"
        ? pattern === origin
        : pattern.test(origin)
    );

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(
        new Error(`Origin ${origin} is not allowed by CORS policy`),
        false
      );
    }
  },

  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "X-Correlation-ID",
  ],
  exposedHeaders: [
    "X-Correlation-ID",
  ],
  maxAge: 86400,
};

// ── Helmet ────────────────────────────────────────────────────────────────────

/**
 * Applies all security headers to the Express app.
 * Call this before registering routes.
 */
export function applySecurityHeaders(app: Application): void {
  app.use(
    helmet({
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },

      noSniff: true,

      frameguard: {
        action: "deny",
      },

      referrerPolicy: {
        policy: "strict-origin-when-cross-origin",
      },

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

      crossOriginOpenerPolicy: {
        policy: "same-origin",
      },

      crossOriginResourcePolicy: {
        policy: "cross-origin",
      },

      permittedCrossDomainPolicies: {
        permittedPolicies: "none",
      },
    })
  );

  // Permissions-Policy
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );

    next();
  });
}
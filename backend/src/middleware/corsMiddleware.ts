/**
 * Strict CORS middleware — Issue #297
 *
 * Loads allowed origins from the CORS_ORIGINS environment variable
 * (comma-separated list) and builds a per-request origin check that:
 *
 *  - Allows only explicitly listed origins in production
 *  - Falls back to localhost patterns in development when CORS_ORIGINS is unset
 *  - Rejects wildcard (*) in production to prevent accidental open policies
 *  - Enables credentials only on /api/auth/* routes (cookie / Authorization header)
 *  - Handles preflight OPTIONS requests correctly (204, no body)
 *  - Exposes X-Correlation-ID to browser clients
 *
 * USAGE
 *   import { createCorsMiddleware, corsPreflightHandler } from './corsMiddleware.js';
 *   app.use(corsPreflightHandler());
 *   app.use(createCorsMiddleware());
 *
 * ENV
 *   CORS_ORIGINS — comma-separated allowed origins, e.g.:
 *     CORS_ORIGINS=https://app.aura-vault.xyz,https://staging.aura-vault.xyz
 */

import cors, { type CorsOptions } from 'cors';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Routes where credentials (cookies / Authorization) are permitted. */
const AUTH_ROUTE_PREFIXES = ['/api/auth'];

/** Headers browsers may send to the backend. */
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Correlation-ID',
  'X-Request-ID',
];

/** Headers browsers may read from the response. */
const EXPOSED_HEADERS = ['X-Correlation-ID'];

/** How long browsers cache the preflight response (24 h). */
const PREFLIGHT_MAX_AGE = 86_400;

// ─── Origin list builder ──────────────────────────────────────────────────────

/**
 * Parse the CORS_ORIGINS environment variable into a list of allowed origins.
 *
 * Rules:
 *  - Production + empty/wildcard → deny all (return empty list)
 *  - Development + empty/wildcard → allow localhost patterns
 *  - Otherwise → parse comma-separated strings as exact-match origins
 */
export function buildAllowedOrigins(): (string | RegExp)[] {
  const raw = (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (raw === '' || raw === '*') {
    if (isProduction) {
      console.warn(
        '[cors] CORS_ORIGINS is not set (or is "*") in production — ' +
        'defaulting to deny-all. Set CORS_ORIGINS to your frontend domain(s).'
      );
      return [];
    }
    // Development / test: allow any localhost port
    return [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ];
  }

  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

// ─── Origin callback ──────────────────────────────────────────────────────────

/**
 * CORS origin callback used by the `cors` npm package.
 *
 * Server-to-server requests without an Origin header are allowed in
 * non-production environments (e.g. CLI tools, Postman, integration tests).
 * In production they are rejected to prevent misconfigured callers.
 */
function originCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!origin) {
    // No Origin header (same-origin request, server-side caller, or curl)
    callback(null, !isProduction);
    return;
  }

  const allowed = buildAllowedOrigins();

  const isAllowed = allowed.some((pattern) =>
    typeof pattern === 'string'
      ? pattern === origin
      : pattern.test(origin)
  );

  if (isAllowed) {
    callback(null, true);
  } else {
    callback(
      new Error(`Origin "${origin}" is not permitted by the CORS policy`)
    );
  }
}

// ─── Per-request credentials check ───────────────────────────────────────────

/**
 * Build a CorsOptions object for the given request.
 *
 * Credentials (cookies, Authorization headers) are only enabled for auth
 * routes so other public endpoints do not unnecessarily allow cross-origin
 * cookies, reducing the risk of CSRF on endpoints that serve public data.
 */
function buildCorsOptions(req: Request): CorsOptions {
  const isAuthRoute = AUTH_ROUTE_PREFIXES.some((prefix) =>
    req.path.startsWith(prefix)
  );

  return {
    origin: originCallback,
    credentials: isAuthRoute,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: PREFLIGHT_MAX_AGE,
    optionsSuccessStatus: 204,
  };
}

// ─── Middleware factories ─────────────────────────────────────────────────────

/**
 * Creates the main CORS middleware with per-request credential scoping.
 *
 * Mount this after your security-headers middleware and before your routes.
 */
export function createCorsMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    cors(buildCorsOptions(req))(req, res, next);
  };
}

/**
 * Preflight handler — answers OPTIONS requests immediately with 204.
 *
 * Must be mounted BEFORE route handlers so preflight requests are not
 * caught by auth middleware or rate limiters.
 *
 * Mount at the top of the Express middleware stack:
 *   app.options('*', corsPreflightHandler());
 */
export function corsPreflightHandler(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'OPTIONS') {
      next();
      return;
    }
    cors(buildCorsOptions(req))(req, res, next);
  };
}

/**
 * Convenience export: pre-built CorsOptions for the common case where
 * per-request credential scoping is not needed (e.g. unit tests, static
 * analysis of the config shape).
 */
export const defaultCorsOptions: CorsOptions = {
  origin: originCallback,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ALLOWED_HEADERS,
  exposedHeaders: EXPOSED_HEADERS,
  maxAge: PREFLIGHT_MAX_AGE,
  optionsSuccessStatus: 204,
};

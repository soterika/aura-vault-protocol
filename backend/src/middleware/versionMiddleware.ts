/**
 * API Versioning Middleware — Issue #857
 *
 * - versionEnvelope(): wraps response bodies with { version, data }
 * - deprecationHeader(): adds RFC 8594 Deprecation/Sunset/Link headers
 * - CURRENT_API_VERSION: single source of truth for the active version
 */

import { Request, Response, NextFunction } from 'express';

export const CURRENT_API_VERSION = 'v1';

/**
 * Wraps all non-error JSON responses with { version, data } envelope.
 * Also sets the API-Version response header on every response.
 *
 * Error responses (bodies with an "error" key) pass through unwrapped
 * so error format stays consistent.
 */
export function versionEnvelope(version: string = CURRENT_API_VERSION) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // Set version header on every response from this router
    res.setHeader('API-Version', version);

    const originalJson = res.json.bind(res) as (body?: unknown) => Response;

    res.json = function (body?: unknown): Response {
      // Pass through if already versioned or if it's an error/health response
      if (
        body !== null &&
        typeof body === 'object' &&
        body !== undefined &&
        ('version' in (body as Record<string, unknown>) ||
          'error' in (body as Record<string, unknown>) ||
          'status' in (body as Record<string, unknown>))
      ) {
        return originalJson(body);
      }
      return originalJson({ version, data: body });
    };

    next();
  };
}

/**
 * Marks a route path as deprecated per RFC 8594.
 * Adds Deprecation: true, optional Sunset date, and a Link header
 * pointing to the successor version.
 */
export function deprecationHeader(sunsetDate?: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `</api/${CURRENT_API_VERSION}>; rel="successor-version"`);
    if (sunsetDate) {
      res.setHeader('Sunset', sunsetDate);
    }
    next();
  };
}

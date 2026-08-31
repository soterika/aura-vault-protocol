/**
 * API Documentation Routes — Issue #857
 *
 * GET /api/docs         — API overview + OpenAPI reference info
 * GET /api/docs/version — Current version, latest alias, deprecated versions
 */

import { Router } from 'express';
import { CURRENT_API_VERSION } from '../middleware/versionMiddleware.js';

export const docsRouter = Router();

docsRouter.get('/version', (_req, res) => {
  res.json({
    version: CURRENT_API_VERSION,
    latest: `/api/latest`,
    versioned: `/api/${CURRENT_API_VERSION}`,
    deprecated: [],
    releaseDate: '2026-08-30',
    sunsetDate: null,
  });
});

docsRouter.get('/', (_req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Aura Vault Protocol API',
      version: '1.0.0',
      description:
        'REST API for the Aura Vault Protocol backend. ' +
        'All routes are versioned under /api/v1. ' +
        'Use /api/latest as a stable alias that always resolves to the current version.',
    },
    servers: [
      { url: '/api/v1', description: 'Stable — current version (v1)' },
      { url: '/api/latest', description: 'Alias — always resolves to current version' },
    ],
    'x-version-policy': {
      current: CURRENT_API_VERSION,
      deprecatedVersions: [],
      sunsetPolicy: 'Deprecated versions receive a Sunset header 6 months before removal.',
    },
    links: {
      openapi_yaml: '/docs/openapi.yaml',
      docs: '/api/docs',
      version: '/api/docs/version',
    },
  });
});

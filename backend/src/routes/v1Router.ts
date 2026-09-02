/**
 * API v1 Router — Issue #857
 *
 * Aggregates all /api/v1/* routes under a single router.
 * Applies versionEnvelope middleware so every response includes
 * { version: 'v1', data: ... } and the API-Version header.
 *
 * Mount at /api/v1 in index.ts.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import { versionEnvelope } from '../middleware/versionMiddleware.js';
import portfolioRouter from '../portfolio.js';
import { gasRouter } from './gasRoutes.js';
import { yieldRouter } from './yieldRoutes.js';
import { queueRouter } from './queueRoutes.js';
import { vaultRouter } from './vaultRoutes.js';
import { userPreferencesRouter } from './userPreferencesRoutes.js';
import { analyticsRouter } from './analyticsRoutes.js';

export const v1Router = Router();

// Apply version envelope to all v1 responses
v1Router.use(versionEnvelope('v1'));

// ── v1 Routes ───────────────────────────────────────────────────────────────
v1Router.use('/user/portfolio', authenticate, portfolioRouter);
v1Router.use('/gas', gasRouter);
v1Router.use('/yield', yieldRouter);
v1Router.use('/queue', queueRouter);
v1Router.use('/vault', vaultRouter);
v1Router.use('/users/preferences', authenticate, userPreferencesRouter);
v1Router.use('/analytics', analyticsRouter);

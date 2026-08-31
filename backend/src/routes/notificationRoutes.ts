/**
 * Notification Routes — email alert subscriptions
 *
 * POST   /api/notifications/email  — register or update an alert subscription
 * DELETE /api/notifications/email  — unsubscribe an email from all alerts
 * GET    /api/notifications/email  — list active subscriptions for a wallet
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate, validateQuery } from '../validation.js';
import {
  subscribeAlert,
  unsubscribeAlert,
  getSubscriptionsForWallet,
} from '../services/alertSubscriptionService.js';
import { successResponse, errorResponse } from '../dto/ApiResponseDto.js';

export const notificationRouter = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const subscribeSchema = z.object({
  walletAddress: z
    .string()
    .min(1, 'walletAddress is required')
    .max(100, 'walletAddress too long'),
  email: z
    .string()
    .email('email must be a valid email address')
    .max(255, 'email too long')
    .transform((v) => v.toLowerCase()),
  threshold: z.coerce
    .number()
    .nonnegative('threshold must be >= 0')
    .default(0),
  eventTypes: z
    .array(z.enum(['deposit', 'withdrawal']))
    .min(1, 'eventTypes must contain at least one type')
    .default(['deposit', 'withdrawal']),
});

const unsubscribeQuerySchema = z.object({
  email: z
    .string()
    .email('email must be a valid email address')
    .transform((v) => v.toLowerCase()),
});

const listQuerySchema = z.object({
  walletAddress: z
    .string()
    .min(1, 'walletAddress is required'),
});

// ─── POST /api/notifications/email ───────────────────────────────────────────

/**
 * Register or update an email alert subscription.
 *
 * Body:
 *   walletAddress  {string}   Stellar wallet address to watch
 *   email          {string}   Recipient email address
 *   threshold      {number}   Minimum amount to trigger alert (default 0)
 *   eventTypes     {string[]} ['deposit','withdrawal'] (default both)
 *
 * Returns 201 with the created/updated subscription.
 */
notificationRouter.post(
  '/',
  validate(subscribeSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, email, threshold, eventTypes } = req.body as z.infer<typeof subscribeSchema>;

      const subscription = await subscribeAlert({ walletAddress, email, threshold, eventTypes });

      res.status(201).json(successResponse(subscription));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create subscription';
      res.status(500).json(errorResponse('SUBSCRIPTION_ERROR', message));
    }
  }
);

// ─── DELETE /api/notifications/email?email=... ────────────────────────────────

/**
 * Unsubscribe an email address from all alert notifications.
 * This is the same action as the one-click unsubscribe link in emails.
 */
notificationRouter.delete(
  '/',
  validateQuery(unsubscribeQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = (req as Request & { validatedQuery: { email: string } }).validatedQuery;

      await unsubscribeAlert(email);

      res.status(200).json(successResponse({ unsubscribed: true, email }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to unsubscribe';
      res.status(500).json(errorResponse('UNSUBSCRIBE_ERROR', message));
    }
  }
);

// ─── GET /api/notifications/email?walletAddress=... ───────────────────────────

/**
 * List all active alert subscriptions for a wallet address.
 */
notificationRouter.get(
  '/',
  validateQuery(listQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress } = (
        req as Request & { validatedQuery: { walletAddress: string } }
      ).validatedQuery;

      const subscriptions = await getSubscriptionsForWallet(walletAddress);

      res.status(200).json(successResponse(subscriptions));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch subscriptions';
      res.status(500).json(errorResponse('FETCH_ERROR', message));
    }
  }
);

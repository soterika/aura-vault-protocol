/**
 * Alert Subscription Routes — Issue #946
 *
 * GET    /api/v1/alerts       — list authenticated user's subscriptions
 * POST   /api/v1/alerts       — create a new subscription
 * DELETE /api/v1/alerts/:id   — delete (soft-deactivate) a subscription
 *
 * All routes require a valid JWT (authenticate middleware).
 * The wallet address is taken from the JWT payload (req.user.sub) so users
 * can only manage their own subscriptions.
 *
 * Closes #946
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../validation.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  ALERT_EVENT_TYPES,
  createSubscription,
  listSubscriptions,
  deleteSubscription,
} from '../services/alertSubscriptionServiceV2.js';
import { successResponse, errorResponse } from '../dto/ApiResponseDto.js';
import { logger } from '../logger.js';

export const alertsRouter = Router();

// All alert routes require authentication
alertsRouter.use(authenticate);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSubscriptionSchema = z.object({
  /** Which event types to watch. */
  eventTypes: z
    .array(z.enum(ALERT_EVENT_TYPES))
    .min(1, 'eventTypes must contain at least one event type')
    .max(7, 'eventTypes cannot exceed 7 entries'),

  /** Delivery channel. */
  channel: z.enum(['email', 'webhook']),

  /** Required when channel = 'webhook'. Must be a valid HTTPS URL. */
  webhookUrl: z
    .string()
    .url('webhookUrl must be a valid URL')
    .refine((url) => url.startsWith('https://'), 'webhookUrl must use HTTPS')
    .optional(),

  /** Recipient email (required when channel = 'email'). */
  email: z
    .string()
    .email('email must be a valid email address')
    .max(255, 'email is too long')
    .transform((v) => v.toLowerCase())
    .optional(),

  /** Minimum transaction amount for deposit/withdrawal/large_deposit alerts. */
  threshold: z.coerce
    .number()
    .nonnegative('threshold must be >= 0')
    .default(0),

  /** Percentage movement for share_price_change alerts (e.g. 5 = 5%). */
  priceThreshold: z.coerce
    .number()
    .positive('priceThreshold must be a positive percentage')
    .max(100)
    .optional(),

  /** Token amount for large_deposit alerts. */
  amountThreshold: z.coerce
    .number()
    .positive('amountThreshold must be positive')
    .optional(),

  /** Optional human-readable label. */
  label: z.string().max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.channel === 'email' && !data.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: 'email is required when channel is email',
    });
  }
  if (data.channel === 'webhook' && !data.webhookUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['webhookUrl'],
      message: 'webhookUrl is required when channel is webhook',
    });
  }
  if (data.eventTypes.includes('share_price_change') && !data.priceThreshold) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priceThreshold'],
      message: 'priceThreshold is required for share_price_change alerts',
    });
  }
  if (data.eventTypes.includes('large_deposit') && !data.amountThreshold) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amountThreshold'],
      message: 'amountThreshold is required for large_deposit alerts',
    });
  }
});

// ─── GET /api/v1/alerts ───────────────────────────────────────────────────────

/**
 * List all active alert subscriptions for the authenticated user.
 *
 * Response 200:
 *   { success: true, data: AlertSubscription[] }
 */
alertsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const walletAddress = (req as Request & { user: { sub: string } }).user.sub;
    const subscriptions = await listSubscriptions(walletAddress);
    res.status(200).json(successResponse(subscriptions));
  } catch (err) {
    logger.error({ err }, '[alerts] list failed');
    res
      .status(500)
      .json(errorResponse('INTERNAL_ERROR', 'Failed to fetch alert subscriptions'));
  }
});

// ─── POST /api/v1/alerts ──────────────────────────────────────────────────────

/**
 * Create a new alert subscription for the authenticated user.
 *
 * Body: CreateSubscriptionInput (validated by createSubscriptionSchema)
 *
 * Response 201:
 *   { success: true, data: AlertSubscription }
 *
 * Response 400: validation error or subscription cap exceeded
 */
alertsRouter.post(
  '/',
  validate(createSubscriptionSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const walletAddress = (req as Request & { user: { sub: string } }).user.sub;
      const input = req.body as z.infer<typeof createSubscriptionSchema>;

      const subscription = await createSubscription({
        walletAddress,
        email: input.email ?? '',
        eventTypes: input.eventTypes,
        channel: input.channel,
        webhookUrl: input.webhookUrl,
        threshold: input.threshold,
        priceThreshold: input.priceThreshold,
        amountThreshold: input.amountThreshold,
        label: input.label,
      });

      res.status(201).json(successResponse(subscription));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create subscription';

      // Distinguish user-facing errors (cap exceeded, bad input) from server errors
      if (message.includes('Maximum of')) {
        res.status(400).json(errorResponse('SUBSCRIPTION_LIMIT_EXCEEDED', message));
        return;
      }
      if (message.includes('required when channel')) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', message));
        return;
      }

      logger.error({ err }, '[alerts] create failed');
      res.status(500).json(errorResponse('INTERNAL_ERROR', message));
    }
  },
);

// ─── DELETE /api/v1/alerts/:id ────────────────────────────────────────────────

/**
 * Soft-delete (deactivate) a subscription by ID.
 * A user can only delete their own subscriptions.
 *
 * Response 200: { success: true, data: { deleted: true } }
 * Response 404: subscription not found or not owned by caller
 */
alertsRouter.delete(
  '/:id',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const walletAddress = (req as Request & { user: { sub: string } }).user.sub;
      const { id } = req.params;

      if (!id) {
        res.status(400).json(errorResponse('MISSING_ID', 'Subscription ID is required'));
        return;
      }

      const deleted = await deleteSubscription(id, walletAddress);

      if (!deleted) {
        res.status(404).json(
          errorResponse('NOT_FOUND', 'Subscription not found or already inactive'),
        );
        return;
      }

      res.status(200).json(successResponse({ deleted: true, id }));
    } catch (err) {
      logger.error({ err }, '[alerts] delete failed');
      res
        .status(500)
        .json(errorResponse('INTERNAL_ERROR', 'Failed to delete alert subscription'));
    }
  },
);

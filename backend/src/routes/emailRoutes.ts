import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/authMiddleware.js';
import { userRateLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  parseUnsubscribeToken,
  recordUnsubscribe,
  recordBounce,
  recordTracking,
  getTrackingEvents,
  TRACKING_GIF,
  verifyDnsConfiguration,
} from '../services/emailService.js';
import { enqueueEmail, enqueueBulk, getQueueStats } from '../services/emailQueue.js';
import type { BounceEvent, EmailProvider } from '../types/email.js';

export const emailRouter = Router();

// ─── Send / enqueue ───────────────────────────────────────────────────────────

/**
 * POST /api/email/send
 * Enqueue a single transactional email. Requires authentication.
 */
emailRouter.post('/send', authenticate, userRateLimiter(), async (req: Request, res: Response): Promise<void> => {
  const { to, template, data, subject, priority, attachments, maxAttempts } = req.body;

  if (!to || !template) {
    res.status(400).json({ error: '"to" and "template" are required' });
    return;
  }

  try {
    const jobId = await enqueueEmail({ to, template, data: data ?? {}, subject, priority, attachments, maxAttempts });
    res.status(202).json({ queued: true, jobId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/email/send/bulk
 * Enqueue multiple emails in one call. Requires authentication.
 */
emailRouter.post('/send/bulk', authenticate, userRateLimiter(), async (req: Request, res: Response): Promise<void> => {
  const { jobs } = req.body;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    res.status(400).json({ error: '"jobs" must be a non-empty array' });
    return;
  }

  try {
    const ids = await enqueueBulk(jobs);
    res.status(202).json({ queued: true, count: ids.length, jobIds: ids });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

/**
 * GET /api/email/unsubscribe?token=...
 * One-click unsubscribe link embedded in every email.
 * HMAC-signed so the email address cannot be guessed or forged.
 */
emailRouter.get('/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query.token ?? '');

  const email = parseUnsubscribeToken(token);
  if (!email) {
    res.status(400).send('Invalid or expired unsubscribe link.');
    return;
  }

  await recordUnsubscribe(email);
  res.status(200).send(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#e0e0f0;">' +
    '<h2 style="color:#6366f1;">&#x2714; Unsubscribed</h2>' +
    `<p>You've been removed from Aura Vault email notifications for <strong>${email}</strong>.</p>` +
    '</body></html>'
  );
});

// ─── Bounce webhooks ──────────────────────────────────────────────────────────

/**
 * POST /api/email/webhooks/sendgrid
 * Receives SendGrid Event Webhooks for bounces and spam reports.
 * Signature verification uses HMAC-SHA256 over the raw body.
 */
emailRouter.post('/webhooks/sendgrid', async (req: Request, res: Response): Promise<void> => {
  const webhookKey = process.env.SENDGRID_WEBHOOK_KEY;

  if (webhookKey) {
    const signature  = req.headers['x-twilio-email-event-webhook-signature'] as string | undefined;
    const timestamp  = req.headers['x-twilio-email-event-webhook-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing webhook signature headers' });
      return;
    }

    const payload  = timestamp + JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', webhookKey).update(payload).digest('base64');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  const events: Array<{ email?: string; event?: string; reason?: string }> =
    Array.isArray(req.body) ? req.body : [req.body];

  for (const ev of events) {
    if (!ev.email) continue;

    if (ev.event === 'bounce' || ev.event === 'blocked') {
      const bounceEvent: BounceEvent = {
        email:      ev.email,
        reason:     ev.reason ?? ev.event,
        bounceType: ev.event === 'bounce' ? 'hard' : 'soft',
        timestamp:  new Date().toISOString(),
        provider:   'sendgrid',
      };
      await recordBounce(bounceEvent);
    }

    if (ev.event === 'spamreport' || ev.event === 'unsubscribe' || ev.event === 'group_unsubscribe') {
      await recordUnsubscribe(ev.email);
    }
  }

  res.status(200).json({ ok: true });
});

/**
 * POST /api/email/webhooks/mailgun
 * Receives Mailgun webhooks (HMAC-SHA256 signed).
 */
emailRouter.post('/webhooks/mailgun', async (req: Request, res: Response): Promise<void> => {
  const apiKey = process.env.MAILGUN_API_KEY;

  if (apiKey) {
    const { timestamp, token, signature } = req.body?.signature ?? {};

    if (!timestamp || !token || !signature) {
      res.status(401).json({ error: 'Missing Mailgun signature fields' });
      return;
    }

    const expected = crypto
      .createHmac('sha256', apiKey)
      .update(String(timestamp) + String(token))
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected))) {
      res.status(401).json({ error: 'Invalid Mailgun signature' });
      return;
    }
  }

  const eventData = req.body?.['event-data'] ?? {};
  const email     = eventData.recipient as string | undefined;
  const event     = eventData.event as string | undefined;

  if (!email) {
    res.status(200).json({ ok: true });
    return;
  }

  if (event === 'failed') {
    const severity = eventData.severity as string | undefined;
    await recordBounce({
      email,
      reason:     eventData.reason ?? event,
      bounceType: severity === 'permanent' ? 'hard' : 'soft',
      timestamp:  new Date().toISOString(),
      provider:   'mailgun',
    });
  }

  if (event === 'unsubscribed' || event === 'complained') {
    await recordUnsubscribe(email);
  }

  res.status(200).json({ ok: true });
});

// ─── Tracking ─────────────────────────────────────────────────────────────────

/**
 * GET /api/email/track/open/:trackingId
 * Returns a 1×1 transparent GIF and records the open event.
 */
emailRouter.get('/track/open/:trackingId', async (req: Request, res: Response): Promise<void> => {
  const trackingId = String(req.params['trackingId']);

  await recordTracking({
    type:       'open',
    email:      '',               // email unknown at this point — correlate via trackingId
    trackingId,
    timestamp:  new Date().toISOString(),
    userAgent:  String(req.headers['user-agent'] ?? ''),
  }).catch(() => {/* non-critical */});

  res.set({
    'Content-Type':  'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma:          'no-cache',
    Expires:         '0',
  });
  res.send(TRACKING_GIF);
});

/**
 * GET /api/email/track/click/:trackingId?url=...
 * Records the click event and redirects to the destination URL.
 */
emailRouter.get('/track/click/:trackingId', async (req: Request, res: Response): Promise<void> => {
  const trackingId = String(req.params['trackingId']);
  const url = String(req.query.url ?? '');

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    res.status(400).send('Invalid redirect URL');
    return;
  }

  await recordTracking({
    type:       'click',
    email:      '',
    trackingId,
    url,
    timestamp:  new Date().toISOString(),
    userAgent:  String(req.headers['user-agent'] ?? ''),
  }).catch(() => {/* non-critical */});

  res.redirect(302, url);
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/email/stats
 * Queue depth and delivery stats. Requires authentication.
 */
emailRouter.get('/stats', authenticate, async (_req: Request, res: Response): Promise<void> => {
  const stats = await getQueueStats();
  res.json({ queue: stats });
});

/**
 * GET /api/email/track/:trackingId/events
 * Retrieve tracking events for a specific email. Requires authentication.
 */
emailRouter.get('/track/:trackingId/events', authenticate, async (req: Request, res: Response): Promise<void> => {
  const events = await getTrackingEvents(String(req.params['trackingId']));
  res.json({ events });
});

/**
 * GET /api/email/dns?domain=auravault.io&selector=s1
 * Verify DKIM/SPF/DMARC DNS records for the sending domain.
 */
emailRouter.get('/dns', authenticate, async (req: Request, res: Response): Promise<void> => {
  const domain   = String(req.query.domain ?? process.env.MAILGUN_DOMAIN ?? '');
  const selector = String(req.query.selector ?? 's1');

  if (!domain) {
    res.status(400).json({ error: '"domain" query param is required' });
    return;
  }

  const result = await verifyDnsConfiguration(domain, selector);
  res.json({ dns: result });
});

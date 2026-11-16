import Handlebars from 'handlebars';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';
import dns from 'dns/promises';
import { getRedis } from '../redis.js';
import { NS } from '../cache.js';
import { getSecret } from '../secrets.js';
import { EMAIL_TEMPLATES } from '../templates/emailTemplates.js';
import type {
  EmailJob,
  EmailMessage,
  EmailResult,
  EmailTemplate,
  TrackingEvent,
  BounceEvent,
  DnsVerificationResult,
  EmailAttachment,
} from '../types/email.js';
import { logger } from "../logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@auravault.io';
const FROM_NAME    = process.env.EMAIL_FROM_NAME || 'Aura Vault';
const BASE_URL     = process.env.APP_BASE_URL || 'https://auravault.io';

// 1×1 transparent GIF — served by the open-tracking endpoint
const TRACKING_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ─── Template compilation ─────────────────────────────────────────────────────

interface CompiledTemplate {
  html: HandlebarsTemplateDelegate;
  text: HandlebarsTemplateDelegate;
  defaultSubject: string;
}

const compiled = new Map<EmailTemplate, CompiledTemplate>();

function getTemplate(name: EmailTemplate): CompiledTemplate {
  const cached = compiled.get(name);
  if (cached) return cached;

  const def = EMAIL_TEMPLATES[name];
  const entry: CompiledTemplate = {
    html: Handlebars.compile(def.html),
    text: Handlebars.compile(def.text),
    defaultSubject: def.defaultSubject,
  };
  compiled.set(name, entry);
  return entry;
}

function renderTemplate(
  name: EmailTemplate,
  data: Record<string, unknown>
): { html: string; text: string; defaultSubject: string } {
  const tmpl = getTemplate(name);
  return {
    html: tmpl.html(data),
    text: tmpl.text(data),
    defaultSubject: tmpl.defaultSubject,
  };
}

// ─── Unsubscribe tokens ───────────────────────────────────────────────────────

export function generateUnsubscribeToken(email: string): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('UNSUBSCRIBE_SECRET is not loaded');
  }
  const hmac = crypto.createHmac('sha256', secret || 'local-dev-only').update(email).digest('hex');
  const encoded = Buffer.from(email).toString('base64url');
  return `${encoded}.${hmac}`;
}

export function parseUnsubscribeToken(token: string): string | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return null;

  const encoded = token.slice(0, dotIdx);
  const hmac    = token.slice(dotIdx + 1);

  // SHA-256 produces exactly 32 bytes → 64 hex characters; reject anything else before Buffer.from
  // (Buffer.from(hex, 'hex') silently drops odd trailing chars, opening a bypass)
  if (hmac.length !== 64) return null;

  let email: string;
  try {
    email = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') return null;

  const expected = crypto.createHmac('sha256', secret || 'local-dev-only').update(email).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) {
      return null;
    }
  } catch {
    return null;
  }

  return email;
}

// ─── Delivery blocking ────────────────────────────────────────────────────────

export async function isBlocked(email: string): Promise<{ blocked: boolean; reason?: string }> {
  const redis = getRedis();
  const key   = email.toLowerCase();

  const [hardBounce, unsubscribed] = await Promise.all([
    redis.exists(`${NS.EMAIL_BOUNCE_HARD}:${key}`),
    redis.exists(`${NS.EMAIL_UNSUBSCRIBED}:${key}`),
  ]);

  if (hardBounce)   return { blocked: true, reason: 'hard-bounce' };
  if (unsubscribed) return { blocked: true, reason: 'unsubscribed' };
  return { blocked: false };
}

export async function recordUnsubscribe(email: string): Promise<void> {
  await getRedis().set(`${NS.EMAIL_UNSUBSCRIBED}:${email.toLowerCase()}`, '1');
}

export async function recordBounce(event: BounceEvent): Promise<void> {
  const key = event.email.toLowerCase();
  const ns  = event.bounceType === 'hard' ? NS.EMAIL_BOUNCE_HARD : NS.EMAIL_BOUNCE_SOFT;
  const ttl = event.bounceType === 'hard' ? undefined : 7 * 24 * 3600; // soft: 7 days

  const payload = JSON.stringify(event);
  if (ttl) {
    await getRedis().set(`${ns}:${key}`, payload, 'EX', ttl);
  } else {
    await getRedis().set(`${ns}:${key}`, payload);
  }
}

// ─── Event tracking ───────────────────────────────────────────────────────────

export async function recordTracking(event: TrackingEvent): Promise<void> {
  const redis = getRedis();
  const k     = `${NS.EMAIL_TRACKING}:${event.trackingId}`;
  await redis.rpush(k, JSON.stringify(event));
  await redis.expire(k, 90 * 24 * 3600); // 90-day retention
}

export async function getTrackingEvents(trackingId: string): Promise<TrackingEvent[]> {
  const raw = await getRedis().lrange(`${NS.EMAIL_TRACKING}:${trackingId}`, 0, -1);
  return raw.map((r) => JSON.parse(r) as TrackingEvent);
}

export { TRACKING_GIF };

// ─── Provider abstraction ─────────────────────────────────────────────────────

async function initSendGrid(): Promise<void> {
  const key = await getSecret('SENDGRID_API_KEY');
  if (key) sgMail.setApiKey(key);
}

async function sendViaSendGrid(msg: EmailMessage): Promise<string> {
  const [response] = await sgMail.send({
    to:      msg.to,
    from:    { email: msg.from, name: msg.fromName },
    subject: msg.subject,
    html:    msg.html,
    text:    msg.text,
    attachments: msg.attachments?.map((a) => ({
      filename:    a.filename,
      content:     a.content,
      type:        a.contentType,
      disposition: 'attachment',
    })),
  });
  return (response.headers['x-message-id'] as string | undefined) ?? 'sg-unknown';
}

async function sendViaMailgun(msg: EmailMessage): Promise<string> {
  const [domain, apiKey] = await Promise.all([
    getSecret('MAILGUN_DOMAIN'),
    getSecret('MAILGUN_API_KEY'),
  ]);
  if (!domain || !apiKey) throw new Error('Mailgun credentials not configured');

  const region = process.env.MAILGUN_REGION === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const url    = `https://${region}/v3/${domain}/messages`;

  const body = new URLSearchParams({
    from:    `${msg.fromName} <${msg.from}>`,
    to:      msg.to,
    subject: msg.subject,
    html:    msg.html,
    text:    msg.text,
  });

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Mailgun ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as { id: string };
  return json.id;
}

// ─── Core send ────────────────────────────────────────────────────────────────

function validateAttachments(attachments?: EmailAttachment[]): void {
  if (!attachments) return;
  for (const att of attachments) {
    if (att.size > 5 * 1024 * 1024) {
      throw new Error(`Attachment "${att.filename}" exceeds 5 MB limit (${att.size} bytes)`);
    }
  }
}

export async function sendEmail(job: EmailJob): Promise<EmailResult> {
  process.env.UNSUBSCRIBE_SECRET ??= await getSecret('UNSUBSCRIBE_SECRET');
  await initSendGrid();

  const blocked = await isBlocked(job.to);
  if (blocked.blocked) {
    return { success: false, error: `Blocked: ${blocked.reason}` };
  }

  validateAttachments(job.attachments);

  const unsubscribeUrl = `${BASE_URL}/api/email/unsubscribe?token=${generateUnsubscribeToken(job.to)}`;
  const trackingPixelUrl = job.trackingId
    ? `${BASE_URL}/api/email/track/open/${job.trackingId}`
    : '';
  const trackingPixelHtml = trackingPixelUrl
    ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
    : '';

  const rendered = renderTemplate(job.template, {
    ...job.data,
    unsubscribeUrl,
    trackingPixel: trackingPixelHtml,
  });

  const msg: EmailMessage = {
    to:          job.to,
    from:        FROM_ADDRESS,
    fromName:    FROM_NAME,
    subject:     job.subject || rendered.defaultSubject,
    html:        rendered.html,
    text:        rendered.text,
    attachments: job.attachments,
  };

  const primary: 'sendgrid' | 'mailgun' =
    process.env.EMAIL_PROVIDER === 'mailgun' ? 'mailgun' : 'sendgrid';
  const secondary: 'sendgrid' | 'mailgun' = primary === 'sendgrid' ? 'mailgun' : 'sendgrid';

  for (const provider of [primary, secondary]) {
    try {
      const messageId = provider === 'sendgrid'
        ? await sendViaSendGrid(msg)
        : await sendViaMailgun(msg);
      return { success: true, messageId, provider };
    } catch (err) {
      logger.error(`[Email] ${provider} failed:`, (err as Error).message);
    }
  }

  return { success: false, error: 'All providers failed' };
}

// ─── DNS verification ─────────────────────────────────────────────────────────

export async function verifyDnsConfiguration(
  domain: string,
  dkimSelector = 's1'
): Promise<DnsVerificationResult> {
  const check = async (host: string, pattern: RegExp): Promise<boolean> => {
    try {
      const records = await dns.resolveTxt(host);
      return records.flat().some((r) => pattern.test(r));
    } catch {
      return false;
    }
  };

  const [spf, dkim, dmarc] = await Promise.all([
    check(domain, /^v=spf1/),
    check(`${dkimSelector}._domainkey.${domain}`, /^v=DKIM1/),
    check(`_dmarc.${domain}`, /^v=DMARC1/),
  ]);

  return { domain, spf, dkim, dmarc, allPassed: spf && dkim && dmarc };
}

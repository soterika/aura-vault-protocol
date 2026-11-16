import Handlebars from 'handlebars';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';
import dns from 'dns/promises';
import { getRedis } from '../redis.js';
import { NS } from '../cache.js';
import { EMAIL_TEMPLATES } from '../templates/emailTemplates.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@auravault.io';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Aura Vault';
const BASE_URL = process.env.APP_BASE_URL || 'https://auravault.io';
const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET || 'aura-vault-unsub-dev-secret';
// 1×1 transparent GIF — served by the open-tracking endpoint
const TRACKING_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const compiled = new Map();
function getTemplate(name) {
    const cached = compiled.get(name);
    if (cached)
        return cached;
    const def = EMAIL_TEMPLATES[name];
    const entry = {
        html: Handlebars.compile(def.html),
        text: Handlebars.compile(def.text),
        defaultSubject: def.defaultSubject,
    };
    compiled.set(name, entry);
    return entry;
}
function renderTemplate(name, data) {
    const tmpl = getTemplate(name);
    return {
        html: tmpl.html(data),
        text: tmpl.text(data),
        defaultSubject: tmpl.defaultSubject,
    };
}
// ─── Unsubscribe tokens ───────────────────────────────────────────────────────
export function generateUnsubscribeToken(email) {
    const hmac = crypto.createHmac('sha256', UNSUB_SECRET).update(email).digest('hex');
    const encoded = Buffer.from(email).toString('base64url');
    return `${encoded}.${hmac}`;
}
export function parseUnsubscribeToken(token) {
    const dotIdx = token.indexOf('.');
    if (dotIdx === -1)
        return null;
    const encoded = token.slice(0, dotIdx);
    const hmac = token.slice(dotIdx + 1);
    // SHA-256 produces exactly 32 bytes → 64 hex characters; reject anything else before Buffer.from
    // (Buffer.from(hex, 'hex') silently drops odd trailing chars, opening a bypass)
    if (hmac.length !== 64)
        return null;
    let email;
    try {
        email = Buffer.from(encoded, 'base64url').toString('utf8');
    }
    catch {
        return null;
    }
    const expected = crypto.createHmac('sha256', UNSUB_SECRET).update(email).digest('hex');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) {
            return null;
        }
    }
    catch {
        return null;
    }
    return email;
}
// ─── Delivery blocking ────────────────────────────────────────────────────────
export async function isBlocked(email) {
    const redis = getRedis();
    const key = email.toLowerCase();
    const [hardBounce, unsubscribed] = await Promise.all([
        redis.exists(`${NS.EMAIL_BOUNCE_HARD}:${key}`),
        redis.exists(`${NS.EMAIL_UNSUBSCRIBED}:${key}`),
    ]);
    if (hardBounce)
        return { blocked: true, reason: 'hard-bounce' };
    if (unsubscribed)
        return { blocked: true, reason: 'unsubscribed' };
    return { blocked: false };
}
export async function recordUnsubscribe(email) {
    await getRedis().set(`${NS.EMAIL_UNSUBSCRIBED}:${email.toLowerCase()}`, '1');
}
export async function recordBounce(event) {
    const key = event.email.toLowerCase();
    const ns = event.bounceType === 'hard' ? NS.EMAIL_BOUNCE_HARD : NS.EMAIL_BOUNCE_SOFT;
    const ttl = event.bounceType === 'hard' ? undefined : 7 * 24 * 3600; // soft: 7 days
    const payload = JSON.stringify(event);
    if (ttl) {
        await getRedis().set(`${ns}:${key}`, payload, 'EX', ttl);
    }
    else {
        await getRedis().set(`${ns}:${key}`, payload);
    }
}
// ─── Event tracking ───────────────────────────────────────────────────────────
export async function recordTracking(event) {
    const redis = getRedis();
    const k = `${NS.EMAIL_TRACKING}:${event.trackingId}`;
    await redis.rpush(k, JSON.stringify(event));
    await redis.expire(k, 90 * 24 * 3600); // 90-day retention
}
export async function getTrackingEvents(trackingId) {
    const raw = await getRedis().lrange(`${NS.EMAIL_TRACKING}:${trackingId}`, 0, -1);
    return raw.map((r) => JSON.parse(r));
}
export { TRACKING_GIF };
// ─── Provider abstraction ─────────────────────────────────────────────────────
function initSendGrid() {
    const key = process.env.SENDGRID_API_KEY;
    if (key)
        sgMail.setApiKey(key);
}
initSendGrid();
async function sendViaSendGrid(msg) {
    const [response] = await sgMail.send({
        to: msg.to,
        from: { email: msg.from, name: msg.fromName },
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            type: a.contentType,
            disposition: 'attachment',
        })),
    });
    return response.headers['x-message-id'] ?? 'sg-unknown';
}
async function sendViaMailgun(msg) {
    const domain = process.env.MAILGUN_DOMAIN;
    const apiKey = process.env.MAILGUN_API_KEY;
    if (!domain || !apiKey)
        throw new Error('Mailgun credentials not configured');
    const region = process.env.MAILGUN_REGION === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
    const url = `https://${region}/v3/${domain}/messages`;
    const body = new URLSearchParams({
        from: `${msg.fromName} <${msg.from}>`,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
    });
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Mailgun ${resp.status}: ${text}`);
    }
    const json = (await resp.json());
    return json.id;
}
// ─── Core send ────────────────────────────────────────────────────────────────
function validateAttachments(attachments) {
    if (!attachments)
        return;
    for (const att of attachments) {
        if (att.size > 5 * 1024 * 1024) {
            throw new Error(`Attachment "${att.filename}" exceeds 5 MB limit (${att.size} bytes)`);
        }
    }
}
export async function sendEmail(job) {
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
    const msg = {
        to: job.to,
        from: FROM_ADDRESS,
        fromName: FROM_NAME,
        subject: job.subject || rendered.defaultSubject,
        html: rendered.html,
        text: rendered.text,
        attachments: job.attachments,
    };
    const primary = process.env.EMAIL_PROVIDER === 'mailgun' ? 'mailgun' : 'sendgrid';
    const secondary = primary === 'sendgrid' ? 'mailgun' : 'sendgrid';
    for (const provider of [primary, secondary]) {
        try {
            const messageId = provider === 'sendgrid'
                ? await sendViaSendGrid(msg)
                : await sendViaMailgun(msg);
            return { success: true, messageId, provider };
        }
        catch (err) {
            console.error(`[Email] ${provider} failed:`, err.message);
        }
    }
    return { success: false, error: 'All providers failed' };
}
// ─── DNS verification ─────────────────────────────────────────────────────────
export async function verifyDnsConfiguration(domain, dkimSelector = 's1') {
    const check = async (host, pattern) => {
        try {
            const records = await dns.resolveTxt(host);
            return records.flat().some((r) => pattern.test(r));
        }
        catch {
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

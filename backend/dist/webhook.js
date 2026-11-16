import crypto from "crypto";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
// ── In-memory stores ─────────────────────────────────────────────────────────
const endpoints = new Map();
const events = new Map();
const deliveries = new Map();
// Per-endpoint rate limiter: max 100 dispatches per 60 s
const rateBuckets = new Map();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60_000;
// ── Helpers ──────────────────────────────────────────────────────────────────
function sign(secret, body) {
    return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}
function isRateLimited(endpointId) {
    const now = Date.now();
    let bucket = rateBuckets.get(endpointId);
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + RATE_WINDOW };
        rateBuckets.set(endpointId, bucket);
    }
    if (bucket.count >= RATE_LIMIT)
        return true;
    bucket.count++;
    return false;
}
// ── Delivery with exponential backoff (retries for 24 h) ─────────────────────
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
// Delays: 10 s, 30 s, 1 m, 5 m, 15 m, 1 h, 3 h, 6 h → covers 24 h window
const BACKOFF_MS = [10_000, 30_000, 60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000];
async function attemptDelivery(delivery, endpoint, event) {
    if (isRateLimited(endpoint.id)) {
        // Re-queue after current rate-limit window resets
        const bucket = rateBuckets.get(endpoint.id);
        delivery.nextRetryAt = new Date(bucket.resetAt).toISOString();
        delivery.updatedAt = new Date().toISOString();
        scheduleRetry(delivery, endpoint, event, bucket.resetAt - Date.now());
        return;
    }
    const body = JSON.stringify({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt });
    delivery.attempts++;
    delivery.updatedAt = new Date().toISOString();
    try {
        const res = await fetch(endpoint.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Aura-Signature": sign(endpoint.secret, body),
                "X-Aura-Event": event.type,
                "X-Aura-Delivery": delivery.id,
            },
            body,
            signal: AbortSignal.timeout(10_000),
        });
        delivery.lastStatusCode = res.status;
        if (res.ok) {
            delivery.status = "success";
            delivery.nextRetryAt = null;
        }
        else {
            scheduleNextRetry(delivery, endpoint, event);
        }
    }
    catch {
        delivery.lastStatusCode = null;
        scheduleNextRetry(delivery, endpoint, event);
    }
    delivery.updatedAt = new Date().toISOString();
}
function scheduleNextRetry(delivery, endpoint, event) {
    const delay = BACKOFF_MS[Math.min(delivery.attempts - 1, BACKOFF_MS.length - 1)];
    const createdAt = new Date(delivery.createdAt).getTime();
    if (Date.now() + delay - createdAt > MAX_RETRY_MS) {
        delivery.status = "failed";
        delivery.nextRetryAt = null;
        return;
    }
    scheduleRetry(delivery, endpoint, event, delay);
}
function scheduleRetry(delivery, endpoint, event, delayMs) {
    delivery.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    setTimeout(() => attemptDelivery(delivery, endpoint, event), delayMs);
}
// ── Public dispatch API ───────────────────────────────────────────────────────
export function dispatchEvent(type, payload) {
    const event = { id: uuidv4(), type, payload, createdAt: new Date().toISOString() };
    events.set(event.id, event);
    for (const endpoint of endpoints.values()) {
        if (endpoint.events.length > 0 && !endpoint.events.includes(type))
            continue;
        const delivery = {
            id: uuidv4(),
            endpointId: endpoint.id,
            eventId: event.id,
            status: "pending",
            attempts: 0,
            nextRetryAt: null,
            lastStatusCode: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        deliveries.set(delivery.id, delivery);
        // fire-and-forget
        attemptDelivery(delivery, endpoint, event);
    }
    return event;
}
// ── REST router ───────────────────────────────────────────────────────────────
export const webhookRouter = Router();
// POST /api/webhooks — register endpoint
webhookRouter.post("/", (req, res) => {
    const { url, secret, events: evts = [] } = req.body;
    if (!url || !secret) {
        res.status(400).json({ error: "url and secret required" });
        return;
    }
    try {
        new URL(url);
    }
    catch {
        res.status(400).json({ error: "invalid url" });
        return;
    }
    const endpoint = { id: uuidv4(), url, secret, events: evts, createdAt: new Date().toISOString() };
    endpoints.set(endpoint.id, endpoint);
    res.status(201).json({ id: endpoint.id, url: endpoint.url, events: endpoint.events, createdAt: endpoint.createdAt });
});
// GET /api/webhooks — list endpoints (secret omitted)
webhookRouter.get("/", (_req, res) => {
    const list = Array.from(endpoints.values()).map(({ secret: _s, ...rest }) => rest);
    res.json(list);
});
// GET /api/webhooks/:id
webhookRouter.get("/:id", (req, res) => {
    const ep = endpoints.get(req.params.id);
    if (!ep) {
        res.status(404).json({ error: "not found" });
        return;
    }
    const { secret: _s, ...rest } = ep;
    res.json(rest);
});
// PATCH /api/webhooks/:id — update url / events
webhookRouter.patch("/:id", (req, res) => {
    const ep = endpoints.get(req.params.id);
    if (!ep) {
        res.status(404).json({ error: "not found" });
        return;
    }
    const { url, secret, events: evts } = req.body;
    if (url) {
        try {
            new URL(url);
        }
        catch {
            res.status(400).json({ error: "invalid url" });
            return;
        }
        ep.url = url;
    }
    if (secret)
        ep.secret = secret;
    if (evts)
        ep.events = evts;
    const { secret: _s, ...rest } = ep;
    res.json(rest);
});
// DELETE /api/webhooks/:id
webhookRouter.delete("/:id", (req, res) => {
    if (!endpoints.delete(req.params.id)) {
        res.status(404).json({ error: "not found" });
        return;
    }
    res.status(204).send();
});
// GET /api/webhooks/:id/deliveries — delivery history for an endpoint
webhookRouter.get("/:id/deliveries", (req, res) => {
    if (!endpoints.has(req.params.id)) {
        res.status(404).json({ error: "not found" });
        return;
    }
    const records = Array.from(deliveries.values()).filter(d => d.endpointId === req.params.id);
    res.json(records);
});
// POST /api/webhooks/verify — verify incoming signature (utility for callers)
webhookRouter.post("/verify", (req, res) => {
    const { secret, body, signature } = req.body;
    if (!secret || !body || !signature) {
        res.status(400).json({ error: "secret, body, signature required" });
        return;
    }
    const expected = sign(secret, body);
    const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    res.json({ valid });
});

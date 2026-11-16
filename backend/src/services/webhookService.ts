/**
 * Webhook Service — Issue #291
 *
 * Provides PostgreSQL-backed webhook registration, delivery, retry logic,
 * and automatic cleanup of inactive endpoints.
 *
 * Delivery guarantees:
 *  - Events dispatched within 5 seconds of being queued (fire-and-forget async)
 *  - Signed with X-Aura-Signature (HMAC-SHA256)
 *  - Exponential backoff on non-2xx: delays 10s, 30s, 1m, 5m, 15m (max 5 attempts)
 *  - Endpoint deactivated after 30 consecutive failures
 */

import crypto from "crypto";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { getWritePool, getReadPool } from "../db.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 5;
export const INACTIVE_THRESHOLD = 30; // consecutive failures before removal

/** Exponential backoff delays in milliseconds (one per attempt, 0-indexed) */
export const BACKOFF_MS = [10_000, 30_000, 60_000, 300_000, 900_000];

export type VaultEventType =
  | "deposit"
  | "withdraw"
  | "harvest"
  | "pause"
  | "unpause"
  | "suspicious"
  | "upgrade";

// ─────────────────────────────────────────────────────────────────────────────
// HMAC signing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign a request body with the endpoint's HMAC-SHA256 secret.
 * Returns the value to place in the X-Aura-Signature header.
 */
export function signPayload(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateWebhookInput {
  url: string;
  secret: string;
  eventTypes?: VaultEventType[]; // empty = all events
}

export interface WebhookRow {
  id: string;
  url: string;
  event_types: VaultEventType[];
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

/** Register a new webhook endpoint. Returns the created row (secret omitted). */
export async function createWebhook(input: CreateWebhookInput): Promise<WebhookRow> {
  const pool = getWritePool();
  const result = await pool.query<WebhookRow>(
    `INSERT INTO webhooks (url, secret, event_types)
     VALUES ($1, $2, $3)
     RETURNING id, url, event_types, consecutive_failures, created_at, updated_at`,
    [input.url, input.secret, input.eventTypes ?? []],
  );
  return result.rows[0]!;
}

/** Fetch a single webhook by ID (secret omitted). */
export async function getWebhook(id: string): Promise<WebhookRow | null> {
  const pool = getReadPool();
  const result = await pool.query<WebhookRow>(
    `SELECT id, url, event_types, consecutive_failures, created_at, updated_at
     FROM webhooks WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** List all webhooks (secret omitted). */
export async function listWebhooks(): Promise<WebhookRow[]> {
  const pool = getReadPool();
  const result = await pool.query<WebhookRow>(
    `SELECT id, url, event_types, consecutive_failures, created_at, updated_at
     FROM webhooks
     ORDER BY created_at DESC`,
  );
  return result.rows;
}

/** Update url, secret, or event_types for a webhook. */
export async function updateWebhook(
  id: string,
  patch: Partial<Pick<CreateWebhookInput, "url" | "secret" | "eventTypes">>,
): Promise<WebhookRow | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (patch.url !== undefined) {
    sets.push(`url = $${idx++}`);
    params.push(patch.url);
  }
  if (patch.secret !== undefined) {
    sets.push(`secret = $${idx++}`);
    params.push(patch.secret);
  }
  if (patch.eventTypes !== undefined) {
    sets.push(`event_types = $${idx++}`);
    params.push(patch.eventTypes);
  }

  params.push(id);
  const pool = getWritePool();
  const result = await pool.query<WebhookRow>(
    `UPDATE webhooks SET ${sets.join(", ")}
     WHERE id = $${idx}
     RETURNING id, url, event_types, consecutive_failures, created_at, updated_at`,
    params,
  );
  return result.rows[0] ?? null;
}

/** Delete a webhook endpoint. */
export async function deleteWebhook(id: string): Promise<boolean> {
  const pool = getWritePool();
  const result = await pool.query("DELETE FROM webhooks WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery log
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "success" | "failed";
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Fetch the delivery log for a webhook (most recent first). */
export async function getDeliveries(webhookId: string): Promise<DeliveryRow[]> {
  const pool = getReadPool();
  const result = await pool.query<DeliveryRow>(
    `SELECT id, webhook_id, event_id, event_type, payload, status, attempts,
            last_status_code, last_error, next_retry_at, created_at, updated_at
     FROM webhook_deliveries
     WHERE webhook_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [webhookId],
  );
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

interface WebhookWithSecret {
  id: string;
  url: string;
  secret: string;
  event_types: VaultEventType[];
}

/** Attempt a single HTTP delivery and update the delivery row + webhook failure counter. */
async function attemptDelivery(
  delivery: DeliveryRow,
  webhook: WebhookWithSecret,
): Promise<void> {
  const pool = getWritePool();
  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.event_type,
    payload: delivery.payload,
    created_at: delivery.created_at,
  });
  const signature = signPayload(webhook.secret, body);

  let statusCode: number | null = null;
  let error: string | null = null;
  let success = false;

  try {
    statusCode = await postWebhook(webhook.url, body, {
      "Content-Type": "application/json",
      "X-Aura-Signature": signature,
      "X-Aura-Event": delivery.event_type,
      "X-Aura-Delivery": delivery.id,
    });
    success = statusCode >= 200 && statusCode < 300;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const newAttempts = delivery.attempts + 1;

  if (success) {
    // Mark success and reset consecutive failures
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'success', attempts = $1, last_status_code = $2,
           last_error = NULL, next_retry_at = NULL, updated_at = NOW()
       WHERE id = $3`,
      [newAttempts, statusCode, delivery.id],
    );
    await pool.query(
      `UPDATE webhooks SET consecutive_failures = 0, updated_at = NOW() WHERE id = $1`,
      [webhook.id],
    );
    return;
  }

  // Failed — increment failure counters
  const newConsecutive = await incrementFailures(pool, webhook.id);

  // Remove webhook after 30 consecutive failures
  if (newConsecutive >= INACTIVE_THRESHOLD) {
    logger.warn(
      { webhookId: webhook.id, url: webhook.url },
      "[webhook] Removing inactive webhook after 30 consecutive failures",
    );
    await pool.query("DELETE FROM webhooks WHERE id = $1", [webhook.id]);
    return;
  }

  if (newAttempts >= MAX_ATTEMPTS) {
    // Exhausted all retries
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'failed', attempts = $1, last_status_code = $2,
           last_error = $3, next_retry_at = NULL, updated_at = NOW()
       WHERE id = $4`,
      [newAttempts, statusCode, error ?? `HTTP ${statusCode}`, delivery.id],
    );
    return;
  }

  // Schedule next retry with exponential backoff
  const delayMs = BACKOFF_MS[newAttempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
  const nextRetry = new Date(Date.now() + delayMs).toISOString();

  await pool.query(
    `UPDATE webhook_deliveries
     SET attempts = $1, last_status_code = $2, last_error = $3,
         next_retry_at = $4, updated_at = NOW()
     WHERE id = $5`,
    [newAttempts, statusCode, error ?? `HTTP ${statusCode}`, nextRetry, delivery.id],
  );

  // Schedule retry
  setTimeout(
    () => {
      void retryDelivery(delivery.id, webhook);
    },
    delayMs,
  );
}

function postWebhook(url: string, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const destination = new URL(url);
    const transport = destination.protocol === "https:" ? https : http;
    const request = transport.request(destination, { method: "POST", headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 500));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Webhook request timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

async function incrementFailures(pool: ReturnType<typeof getWritePool>, webhookId: string): Promise<number> {
  const result = await pool.query<{ consecutive_failures: number }>(
    `UPDATE webhooks
     SET consecutive_failures = consecutive_failures + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING consecutive_failures`,
    [webhookId],
  );
  return result.rows[0]?.consecutive_failures ?? 0;
}

async function retryDelivery(deliveryId: string, webhook: WebhookWithSecret): Promise<void> {
  const pool = getReadPool();
  const result = await pool.query<DeliveryRow>(
    `SELECT * FROM webhook_deliveries WHERE id = $1`,
    [deliveryId],
  );
  const delivery = result.rows[0];
  if (!delivery || delivery.status !== "pending") return;
  await attemptDelivery(delivery, webhook);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public dispatch API — called when a vault event occurs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch a vault event to all matching registered webhooks.
 * Delivery is fire-and-forget; the function returns immediately after
 * creating the delivery rows and scheduling the first attempt.
 * Target: first attempt within 5 seconds of being called.
 */
export async function dispatchWebhookEvent(
  eventType: VaultEventType,
  payload: Record<string, unknown>,
  eventId: string,
): Promise<void> {
  if (!eventId.trim()) throw new TypeError("eventId must be a stable, non-empty event identifier");
  const pool = getWritePool();

  // Fetch all webhooks subscribed to this event type
  const webhooksResult = await pool.query<WebhookWithSecret>(
    `SELECT id, url, secret, event_types
     FROM webhooks
     WHERE consecutive_failures < $1
       AND (event_types = '{}' OR $2 = ANY(event_types))`,
    [INACTIVE_THRESHOLD, eventType],
  );

  for (const webhook of webhooksResult.rows) {
    // Create delivery row
    const deliveryResult = await pool.query<DeliveryRow>(
      `INSERT INTO webhook_deliveries (webhook_id, event_id, event_type, payload, next_retry_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (webhook_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [webhook.id, eventId, eventType, JSON.stringify(payload)],
    );
    const delivery = deliveryResult.rows[0];
    if (!delivery) continue;

    // Fire immediately (within milliseconds, well within the 5-second window)
    setImmediate(() => {
      void attemptDelivery(delivery, webhook);
    });
  }
}

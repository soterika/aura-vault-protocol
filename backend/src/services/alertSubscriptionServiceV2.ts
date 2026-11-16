/**
 * alertSubscriptionServiceV2.ts
 *
 * Full CRUD service for the extended alert_subscriptions table (migration 012).
 * Supports all event types from issue #946:
 *   share_price_change | vault_paused | vault_unpaused |
 *   harvest_completed  | large_deposit | deposit | withdrawal
 *
 * Delivery channels: email | webhook
 *
 * Closes #946
 */

import { getWritePool, getReadPool } from '../db.js';
import { enqueueEmail } from './emailQueue.js';
import { isBlocked } from './emailService.js';
import { logger } from '../logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ALERT_EVENT_TYPES = [
  'deposit',
  'withdrawal',
  'share_price_change',
  'vault_paused',
  'vault_unpaused',
  'harvest_completed',
  'large_deposit',
] as const;

export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];

export type AlertChannel = 'email' | 'webhook';

export interface AlertSubscription {
  id: string;
  walletAddress: string;
  email: string;
  threshold: number;
  eventTypes: AlertEventType[];
  channel: AlertChannel;
  webhookUrl: string | null;
  priceThreshold: number | null;
  amountThreshold: number | null;
  label: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubscriptionInput {
  walletAddress: string;
  email: string;
  eventTypes: AlertEventType[];
  channel: AlertChannel;
  /** Required when channel = 'webhook' */
  webhookUrl?: string;
  /** Minimum transaction amount (deposit/withdrawal/large_deposit threshold) */
  threshold?: number;
  /** Percentage movement for share_price_change (e.g. 5 = 5%) */
  priceThreshold?: number;
  /** Token amount threshold for large_deposit alerts */
  amountThreshold?: number;
  label?: string;
}

// Max active subscriptions per user (enforced here rather than in SQL)
const MAX_SUBSCRIPTIONS_PER_USER = 10;

// ─── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * Create a new alert subscription.
 * Rejects if the user already has MAX_SUBSCRIPTIONS_PER_USER active subscriptions.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<AlertSubscription> {
  const {
    walletAddress,
    email,
    eventTypes,
    channel,
    webhookUrl = null,
    threshold = 0,
    priceThreshold = null,
    amountThreshold = null,
    label = null,
  } = input;

  if (channel === 'webhook' && !webhookUrl) {
    throw new Error('webhookUrl is required when channel is webhook');
  }

  // Enforce per-user subscription cap
  const { rows: countRows } = await getReadPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM alert_subscriptions
     WHERE wallet_address = $1 AND active = TRUE`,
    [walletAddress],
  );
  const existingCount = parseInt(countRows[0]?.count ?? '0', 10);
  if (existingCount >= MAX_SUBSCRIPTIONS_PER_USER) {
    throw new Error(
      `Maximum of ${MAX_SUBSCRIPTIONS_PER_USER} active subscriptions per user reached`,
    );
  }

  const { rows } = await getWritePool().query<DbRow>(
    `INSERT INTO alert_subscriptions
       (wallet_address, email, threshold, event_types, channel,
        webhook_url, price_threshold, amount_threshold, label, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
     RETURNING *`,
    [
      walletAddress,
      email.toLowerCase(),
      threshold,
      eventTypes,
      channel,
      webhookUrl,
      priceThreshold,
      amountThreshold,
      label,
    ],
  );

  return mapRow(rows[0]!);
}

/**
 * List all active subscriptions for the authenticated wallet address.
 */
export async function listSubscriptions(
  walletAddress: string,
): Promise<AlertSubscription[]> {
  const { rows } = await getReadPool().query<DbRow>(
    `SELECT * FROM alert_subscriptions
     WHERE wallet_address = $1 AND active = TRUE
     ORDER BY created_at ASC`,
    [walletAddress],
  );
  return rows.map(mapRow);
}

/**
 * Delete (soft-deactivate) a subscription by ID.
 * Only the owning wallet address may delete their own subscription.
 * Returns true if a row was deactivated, false if not found / already inactive.
 */
export async function deleteSubscription(
  id: string,
  walletAddress: string,
): Promise<boolean> {
  const { rowCount } = await getWritePool().query(
    `UPDATE alert_subscriptions
     SET active = FALSE, updated_at = NOW()
     WHERE id = $1 AND wallet_address = $2 AND active = TRUE`,
    [id, walletAddress],
  );
  return (rowCount ?? 0) > 0;
}

// ─── Background threshold evaluator ──────────────────────────────────────────

/**
 * VaultSnapshot is the current state of the vault used by the background job
 * to evaluate subscriptions. Fetched every 5 minutes from the vault stats service.
 */
export interface VaultSnapshot {
  sharePriceChangePercent: number | null;
  isPaused: boolean;
  lastHarvestCompletedAt: string | null;
  /** Was a new harvest event recorded since the last evaluation cycle? */
  harvestOccurredSinceLastCheck: boolean;
  /** Deposits since the last evaluation: [{amount, walletAddress}] */
  recentDeposits: Array<{ amount: number; walletAddress: string }>;
  /** Previous snapshot for delta comparisons */
  previousSharePrice?: number;
  currentSharePrice?: number;
}

/**
 * Evaluate all active subscriptions against the current vault snapshot.
 * Called by the background job every 5 minutes.
 *
 * Returns the number of notifications dispatched.
 */
export async function evaluateSubscriptions(
  snapshot: VaultSnapshot,
): Promise<number> {
  const BATCH_SIZE = 100;
  let offset = 0;
  let dispatched = 0;

  for (;;) {
    const { rows } = await getReadPool().query<DbRow>(
      `SELECT * FROM alert_subscriptions
       WHERE active = TRUE
         AND (last_evaluated_at IS NULL OR last_evaluated_at < NOW() - INTERVAL '4 minutes')
       ORDER BY last_evaluated_at NULLS FIRST
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset],
    );

    if (rows.length === 0) break;

    const ids: string[] = [];

    await Promise.allSettled(
      rows.map(async (row) => {
        const sub = mapRow(row);
        ids.push(sub.id);

        const triggered = checkSubscription(sub, snapshot);
        if (triggered.length === 0) return;

        for (const eventType of triggered) {
          try {
            await dispatchNotification(sub, eventType, snapshot);
            dispatched++;
          } catch (err) {
            logger.error({ err, subscriptionId: sub.id, eventType }, 'Failed to dispatch alert');
          }
        }
      }),
    );

    // Mark all processed subscriptions as evaluated
    if (ids.length > 0) {
      await getWritePool().query(
        `UPDATE alert_subscriptions
         SET last_evaluated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    }

    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return dispatched;
}

/** Determine which event types in a subscription are triggered by the snapshot. */
function checkSubscription(
  sub: AlertSubscription,
  snapshot: VaultSnapshot,
): AlertEventType[] {
  const triggered: AlertEventType[] = [];

  for (const eventType of sub.eventTypes) {
    switch (eventType) {
      case 'share_price_change': {
        const threshold = sub.priceThreshold ?? 5;
        const change = Math.abs(snapshot.sharePriceChangePercent ?? 0);
        if (snapshot.sharePriceChangePercent !== null && change >= threshold) {
          triggered.push(eventType);
        }
        break;
      }
      case 'vault_paused': {
        if (snapshot.isPaused) triggered.push(eventType);
        break;
      }
      case 'vault_unpaused': {
        if (!snapshot.isPaused) triggered.push(eventType);
        break;
      }
      case 'harvest_completed': {
        if (snapshot.harvestOccurredSinceLastCheck) triggered.push(eventType);
        break;
      }
      case 'large_deposit': {
        const amtThreshold = sub.amountThreshold ?? sub.threshold;
        const matchingDeposit = snapshot.recentDeposits.find(
          (d) => d.walletAddress === sub.walletAddress && d.amount >= amtThreshold,
        );
        if (matchingDeposit) triggered.push(eventType);
        break;
      }
      case 'deposit':
      case 'withdrawal':
        // Legacy event types — handled by the original triggerAlerts() function
        break;
    }
  }

  return triggered;
}

/** Dispatch a notification via the subscription's configured channel. */
async function dispatchNotification(
  sub: AlertSubscription,
  eventType: AlertEventType,
  snapshot: VaultSnapshot,
): Promise<void> {
  if (sub.channel === 'email') {
    await dispatchEmailNotification(sub, eventType, snapshot);
  } else {
    await dispatchWebhookNotification(sub, eventType, snapshot);
  }
}

async function dispatchEmailNotification(
  sub: AlertSubscription,
  eventType: AlertEventType,
  snapshot: VaultSnapshot,
): Promise<void> {
  const blocked = await isBlocked(sub.email);
  if (blocked.blocked) return;

  await enqueueEmail({
    to: sub.email,
    template: 'generic',
    subject: buildSubject(eventType, sub, snapshot),
    data: buildEmailData(eventType, sub, snapshot),
    priority: eventType === 'vault_paused' ? 'high' : 'normal',
  });
}

async function dispatchWebhookNotification(
  sub: AlertSubscription,
  eventType: AlertEventType,
  snapshot: VaultSnapshot,
): Promise<void> {
  if (!sub.webhookUrl) return;

  const payload = {
    event: eventType,
    walletAddress: sub.walletAddress,
    subscriptionId: sub.id,
    timestamp: new Date().toISOString(),
    data: buildWebhookData(eventType, sub, snapshot),
  };

  // Fire-and-forget HTTP POST via Node's built-in http/https
  const { default: https } = await import('node:https');
  const { default: http } = await import('node:http');
  const { URL } = await import('node:url');

  const url = new URL(sub.webhookUrl);
  const body = JSON.stringify(payload);
  const lib = url.protocol === 'https:' ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'AuraVault-AlertService/1.0',
        },
      },
      (res) => {
        res.resume(); // drain response body
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
      },
    );
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Webhook request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Notification copy helpers ────────────────────────────────────────────────

function buildSubject(
  eventType: AlertEventType,
  sub: AlertSubscription,
  snapshot: VaultSnapshot,
): string {
  const addr = truncateAddress(sub.walletAddress);
  switch (eventType) {
    case 'share_price_change':
      return `Share Price Alert: ${snapshot.sharePriceChangePercent?.toFixed(2) ?? '?'}% change detected`;
    case 'vault_paused':
      return 'Vault Paused — All operations halted';
    case 'vault_unpaused':
      return 'Vault Resumed — Operations restored';
    case 'harvest_completed':
      return 'Harvest Completed — Yield compounded into vault';
    case 'large_deposit':
      return `Large Deposit Alert on ${addr}`;
    default:
      return `Vault Alert: ${eventType}`;
  }
}

function buildEmailData(
  eventType: AlertEventType,
  sub: AlertSubscription,
  snapshot: VaultSnapshot,
): Record<string, unknown> {
  return {
    eventType,
    walletAddress: sub.walletAddress,
    subscriptionLabel: sub.label ?? eventType,
    timestamp: new Date().toISOString(),
    ...(eventType === 'share_price_change' && {
      priceChange: snapshot.sharePriceChangePercent,
      previousPrice: snapshot.previousSharePrice,
      currentPrice: snapshot.currentSharePrice,
    }),
    ...(eventType === 'large_deposit' && {
      deposits: snapshot.recentDeposits.filter((d) => d.walletAddress === sub.walletAddress),
    }),
  };
}

function buildWebhookData(
  eventType: AlertEventType,
  sub: AlertSubscription,
  snapshot: VaultSnapshot,
): Record<string, unknown> {
  return buildEmailData(eventType, sub, snapshot);
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface DbRow {
  id: string;
  wallet_address: string;
  email: string;
  threshold: string;
  event_types: AlertEventType[];
  channel: AlertChannel;
  webhook_url: string | null;
  price_threshold: string | null;
  amount_threshold: string | null;
  label: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DbRow): AlertSubscription {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    email: row.email,
    threshold: parseFloat(row.threshold),
    eventTypes: row.event_types,
    channel: row.channel,
    webhookUrl: row.webhook_url,
    priceThreshold: row.price_threshold !== null ? parseFloat(row.price_threshold) : null,
    amountThreshold: row.amount_threshold !== null ? parseFloat(row.amount_threshold) : null,
    label: row.label,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Alert Subscription Service
 *
 * Manages per-wallet email alert subscriptions. When a deposit or withdrawal
 * exceeds a user-configured threshold, an HTML email is dispatched via the
 * existing email queue.
 *
 * Schema: alert_subscriptions (migration 010)
 */

import { getWritePool, getReadPool } from '../db.js';
import { enqueueEmail } from './emailQueue.js';
import { isBlocked } from './emailService.js';
import type { EmailTemplate } from '../types/email.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertEventType = 'deposit' | 'withdrawal';

export interface AlertSubscription {
  id: string;
  walletAddress: string;
  email: string;
  threshold: number;
  eventTypes: AlertEventType[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscribeAlertInput {
  walletAddress: string;
  email: string;
  /** Minimum transaction amount that triggers the alert (default 0 = all). */
  threshold?: number;
  /** Which event types to watch (default: both deposit and withdrawal). */
  eventTypes?: AlertEventType[];
}

export interface AlertTriggerEvent {
  type: AlertEventType;
  /** On-chain wallet address that made the deposit/withdrawal. */
  walletAddress: string;
  amount: number;
  asset: string;
  txHash: string;
  timestamp: string;
  /** Stellar explorer base URL (optional; falls back to stellarchain.io). */
  explorerBaseUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate a long wallet address for display: GABCD…WXYZ (first 6 + last 4). */
function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Subscribe / Unsubscribe ─────────────────────────────────────────────────

/**
 * Create or update an alert subscription for a wallet+email pair.
 * Uses an UPSERT so calling this endpoint again simply updates the threshold.
 */
export async function subscribeAlert(
  input: SubscribeAlertInput
): Promise<AlertSubscription> {
  const { walletAddress, email, threshold = 0, eventTypes = ['deposit', 'withdrawal'] } = input;

  const { rows } = await getWritePool().query<{
    id: string;
    wallet_address: string;
    email: string;
    threshold: string;
    event_types: AlertEventType[];
    active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO alert_subscriptions
       (wallet_address, email, threshold, event_types, active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (wallet_address, email)
     DO UPDATE SET
       threshold   = EXCLUDED.threshold,
       event_types = EXCLUDED.event_types,
       active      = TRUE,
       updated_at  = NOW()
     RETURNING *`,
    [walletAddress, email.toLowerCase(), threshold, eventTypes]
  );

  const row = rows[0];
  return mapRow(row);
}

/**
 * Deactivate all active subscriptions for a given email address.
 * Called from the one-click unsubscribe link and the DELETE endpoint.
 */
export async function unsubscribeAlert(email: string): Promise<void> {
  await getWritePool().query(
    `UPDATE alert_subscriptions
     SET active = FALSE, updated_at = NOW()
     WHERE email = $1 AND active = TRUE`,
    [email.toLowerCase()]
  );
}

/**
 * Return all active subscriptions for a wallet address.
 */
export async function getSubscriptionsForWallet(
  walletAddress: string
): Promise<AlertSubscription[]> {
  const { rows } = await getReadPool().query<{
    id: string;
    wallet_address: string;
    email: string;
    threshold: string;
    event_types: AlertEventType[];
    active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM alert_subscriptions
     WHERE wallet_address = $1 AND active = TRUE
     ORDER BY created_at ASC`,
    [walletAddress]
  );

  return rows.map(mapRow);
}

// ─── Threshold trigger ────────────────────────────────────────────────────────

/**
 * Called by the Horizon event listener (or any source) when a deposit or
 * withdrawal event is observed.  Finds matching subscriptions and enqueues
 * an HTML email for each one.
 */
export async function triggerAlerts(event: AlertTriggerEvent): Promise<void> {
  const { type, walletAddress, amount, asset, txHash, timestamp, explorerBaseUrl } = event;

  // Find all active subscriptions that match:
  //   - same wallet address
  //   - threshold <= event amount
  //   - event type is in the subscription's event_types array
  const { rows } = await getReadPool().query<{
    id: string;
    wallet_address: string;
    email: string;
    threshold: string;
    event_types: AlertEventType[];
    active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM alert_subscriptions
     WHERE wallet_address = $1
       AND active         = TRUE
       AND threshold      <= $2
       AND $3             = ANY(event_types)`,
    [walletAddress, amount, type]
  );

  if (rows.length === 0) return;

  const explorerBase = explorerBaseUrl ?? 'https://stellarchain.io/transactions';
  const explorerLink = `${explorerBase}/${txHash}`;
  const humanTs = new Date(timestamp).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';

  const template: EmailTemplate = type === 'deposit' ? 'deposit' : 'withdrawal';

  await Promise.allSettled(
    rows.map(async (row) => {
      const sub = mapRow(row);

      // Respect global unsubscribe / hard-bounce list
      const blocked = await isBlocked(sub.email);
      if (blocked.blocked) return;

      const templateData =
        type === 'deposit'
          ? {
              userName:      truncateAddress(walletAddress),
              amount:        amount.toLocaleString('en-US', { maximumFractionDigits: 7 }),
              asset,
              source:        walletAddress,
              txHash,
              explorerLink,
              timestamp:     humanTs,
            }
          : {
              userName:      truncateAddress(walletAddress),
              amount:        amount.toLocaleString('en-US', { maximumFractionDigits: 7 }),
              asset,
              destination:   walletAddress,
              fee:           '0',
              txHash,
              explorerLink,
              timestamp:     humanTs,
              supportUrl:    `${process.env.APP_BASE_URL ?? 'https://auravault.io'}/support`,
            };

      await enqueueEmail({
        to:       sub.email,
        template,
        data:     templateData,
        subject:  type === 'deposit'
          ? `Deposit Alert: ${amount} ${asset} on ${truncateAddress(walletAddress)}`
          : `Withdrawal Alert: ${amount} ${asset} on ${truncateAddress(walletAddress)}`,
        priority: 'high',
      });
    })
  );
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(row: {
  id: string;
  wallet_address: string;
  email: string;
  threshold: string;
  event_types: AlertEventType[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
}): AlertSubscription {
  return {
    id:            row.id,
    walletAddress: row.wallet_address,
    email:         row.email,
    threshold:     parseFloat(row.threshold),
    eventTypes:    row.event_types,
    active:        row.active,
    createdAt:     row.created_at.toISOString(),
    updatedAt:     row.updated_at.toISOString(),
  };
}

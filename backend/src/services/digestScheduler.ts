/**
 * Daily Digest Scheduler — fires at 08:00 UTC
 *
 * Loads all recipients, filters out zero-value portfolios, checks user
 * preferences and email block lists, then enqueues a portfolio-digest email
 * for each eligible recipient.
 *
 * Pattern mirrors yieldScheduler.ts.
 *
 * Usage:
 *   import { startDigestScheduler, stopDigestScheduler } from "./digestScheduler.js";
 *
 *   // In server startup:
 *   startDigestScheduler(loadRecipients);
 *
 *   // In server shutdown:
 *   stopDigestScheduler();
 */

import { Queue } from 'bullmq';
import { enqueueEmail } from './emailQueue.js';
import { isBlocked } from './emailService.js';
import { getUserPreferences } from './userPreferencesService.js';
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single digest recipient with their portfolio snapshot. */
export interface DigestRecipient {
  /** Stellar wallet address */
  address: string;
  /** Email address to deliver the digest to */
  email: string;
  /** Current vault value as a string, e.g. "1234.56" */
  currentValue: string;
  /** Asset symbol, e.g. "USDC" */
  asset: string;
  /** Absolute 24-hour change, e.g. "12.34" */
  change24h: string;
  /** Sign of the 24h change */
  changeSign: '+' | '-';
  /** Yield accrued since last harvest, e.g. "0.87" */
  accruedYield: string;
  /** Human-readable last harvest date/time, e.g. "2026-08-28 07:00 UTC" */
  lastHarvest: string;
}

/** Async function that returns all potential digest recipients. */
export type RecipientLoader = () => Promise<DigestRecipient[]>;

/** A single vault event relevant to the weekly digest. */
export interface VaultEvent {
  /** Event type, e.g. "harvest" or "pause" */
  type: string;
  /** Human-readable description, e.g. "Harvest completed — 120.45 USDC" */
  description: string;
  /** Human-readable timestamp, e.g. "2026-08-28 07:00 UTC" */
  timestamp: string;
}

/** A single weekly digest recipient with their portfolio snapshot. */
export interface WeeklyDigestRecipient {
  /** Stellar wallet address */
  address: string;
  /** Email address to deliver the digest to */
  email: string;
  /** Current share balance as a string, e.g. "1000.00" */
  shareBalance: string;
  /** Current vault value in USD as a string, e.g. "1234.56" */
  currentValueUsd: string;
  /** Absolute week-over-week change, e.g. "12.34" */
  changeWoW: string;
  /** Sign of the week-over-week change */
  changeSign: '+' | '-';
  /** APY for this week, e.g. "5.20" */
  apyThisWeek: string;
  /** APY for last week, e.g. "4.80" */
  apyLastWeek: string;
  /** Vault events (harvests, pauses) during the week */
  vaultEvents: VaultEvent[];
}

/** Async function that returns all potential weekly digest recipients. */
export type WeeklyRecipientLoader = () => Promise<WeeklyDigestRecipient[]>;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

let weeklyTimer: ReturnType<typeof setTimeout> | null = null;
let weeklyRunning = false;
let weeklyQueue: Queue | null = null;

/** Cron pattern: every Monday at 08:00 UTC. */
export const WEEKLY_DIGEST_CRON = '0 8 * * 1';

/** BullMQ repeatable job name for the weekly digest. */
export const WEEKLY_DIGEST_JOB_NAME = 'weekly-digest';

// ---------------------------------------------------------------------------
// Scheduler helpers
// ---------------------------------------------------------------------------

/**
 * Compute the milliseconds until the next 08:00 UTC.
 * e.g. called at 06:00 UTC → ~2 hours in ms.
 * Called at 09:00 UTC → ~23 hours in ms.
 */
/**
 * Compute the milliseconds until the next Monday 08:00 UTC.
 * Called on a Monday at 06:00 UTC → ~2 hours in ms.
 * Called on a Monday at 09:00 UTC → ~6 days 23 hours in ms.
 */
export function msUntilNextMonday0800UTC(now: Date = new Date()): number {
  const ms = now.getTime();

  const candidate = new Date(now);
  candidate.setUTCHours(8, 0, 0, 0);
  // Advance to the next Monday (1) if today isn't Monday or 08:00 has passed.
  const day = candidate.getUTCDay();
  let daysAhead = (1 - day + 7) % 7;
  if (daysAhead === 0 && candidate.getTime() <= ms) {
    daysAhead = 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + daysAhead);

  return Math.max(candidate.getTime() - ms, 1_000);
}

export function msUntilNext0800UTC(now: Date = new Date()): number {
  const ms = now.getTime();

  // Build the candidate 08:00 UTC for today
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(8, 0, 0, 0);
  const todayMs = todayUtc.getTime();

  if (todayMs > ms) {
    // 08:00 UTC hasn't happened yet today — return the remaining wait
    return Math.max(todayMs - ms, 1_000);
  }

  // 08:00 UTC has already passed today — target tomorrow's 08:00 UTC
  const tomorrowMs = todayMs + 24 * 60 * 60 * 1_000;
  return Math.max(tomorrowMs - ms, 1_000);
}

// ---------------------------------------------------------------------------
// Zero-value guard
// ---------------------------------------------------------------------------

function isZeroValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '0' || trimmed === '0.00';
}

// ---------------------------------------------------------------------------
// Core: send digest to a single recipient
// ---------------------------------------------------------------------------

/**
 * Enqueue a portfolio-digest email for one recipient.
 *
 * Skips silently if:
 * - currentValue is zero ('0' or '0.00')
 * - the address email is blocked (unsubscribed / hard-bounced)
 * - the user's emailNotifications preference is false
 */
export async function sendDigestToRecipient(recipient: DigestRecipient): Promise<void> {
  // Guard: zero-value portfolio
  if (isZeroValue(recipient.currentValue)) {
    return;
  }

  // Guard: delivery block list
  const blockStatus = await isBlocked(recipient.email);
  if (blockStatus.blocked) {
    return;
  }

  // Guard: user preference
  const prefs = await getUserPreferences(recipient.address);
  if (!prefs.emailNotifications) {
    return;
  }

  await enqueueEmail({
    to:       recipient.email,
    template: 'portfolio-digest',
    data: {
      userName:      recipient.address,
      walletAddress: recipient.address,
      currentValue:  recipient.currentValue,
      asset:         recipient.asset,
      change24h:     recipient.change24h,
      changeSign:    recipient.changeSign,
      accruedYield:  recipient.accruedYield,
      lastHarvest:   recipient.lastHarvest,
    },
    priority: 'low',
  });
}

// ---------------------------------------------------------------------------
// Core: send weekly digest to a single recipient
// ---------------------------------------------------------------------------

/**
 * Enqueue a weekly-digest email for one recipient.
 *
 * Skips silently if:
 * - currentValueUsd is zero ('0' or '0.00')
 * - the address email is blocked (unsubscribed / hard-bounced)
 * - the user's emailNotifications preference is false
 */
export async function sendWeeklyDigestToRecipient(
  recipient: WeeklyDigestRecipient
): Promise<void> {
  // Guard: zero-value portfolio
  if (isZeroValue(recipient.currentValueUsd)) {
    return;
  }

  // Guard: delivery block list
  const blockStatus = await isBlocked(recipient.email);
  if (blockStatus.blocked) {
    return;
  }

  // Guard: user preference (email_notifications: true)
  const prefs = await getUserPreferences(recipient.address);
  if (!prefs.emailNotifications) {
    return;
  }

  await enqueueEmail({
    to:       recipient.email,
    template: 'weekly-digest',
    data: {
      userName:       recipient.address,
      walletAddress:  recipient.address,
      shareBalance:   recipient.shareBalance,
      currentValueUsd: recipient.currentValueUsd,
      changeWoW:      recipient.changeWoW,
      changeSign:     recipient.changeSign,
      apyThisWeek:    recipient.apyThisWeek,
      apyLastWeek:    recipient.apyLastWeek,
      vaultEvents:    recipient.vaultEvents,
      unsubscribeUrl: buildUnsubscribeUrl(recipient.address),
    },
    priority: 'low',
  });
}

/** Build a one-click unsubscribe URL for the given wallet address. */
function buildUnsubscribeUrl(address: string): string {
  const base = process.env.APP_BASE_URL ?? 'https://app.example.com';
  return `${base}/unsubscribe?address=${encodeURIComponent(address)}`;
}

// ---------------------------------------------------------------------------
// Core tick
// ---------------------------------------------------------------------------

async function runTick(loadRecipients: RecipientLoader): Promise<void> {
  let recipients: DigestRecipient[];
  try {
    recipients = await loadRecipients();
  } catch (err) {
    logger.error('[DigestScheduler] Failed to load recipients:', err);
    return;
  }

  // Pre-filter obvious zero-value entries before issuing per-recipient checks
  const candidates = recipients.filter((r) => !isZeroValue(r.currentValue));

  const results = await Promise.allSettled(
    candidates.map((r) => sendDigestToRecipient(r))
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    logger.error(
      `[DigestScheduler] ${failed.length}/${candidates.length} recipient(s) failed to enqueue`
    );
  }

  logger.info(
    `[DigestScheduler] Digest run complete — ${candidates.length - failed.length} enqueued, ` +
    `${recipients.length - candidates.length} skipped (zero value)`
  );
}

// ---------------------------------------------------------------------------
// Weekly tick
// ---------------------------------------------------------------------------

async function runWeeklyTick(loadRecipients: WeeklyRecipientLoader): Promise<void> {
  let recipients: WeeklyDigestRecipient[];
  try {
    recipients = await loadRecipients();
  } catch (err) {
    logger.error('[DigestScheduler] Failed to load weekly recipients:', err);
    return;
  }

  // Pre-filter obvious zero-value entries before issuing per-recipient checks
  const candidates = recipients.filter((r) => !isZeroValue(r.currentValueUsd));

  const results = await Promise.allSettled(
    candidates.map((r) => sendWeeklyDigestToRecipient(r))
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    logger.error(
      `[DigestScheduler] ${failed.length}/${candidates.length} weekly recipient(s) failed to enqueue`
    );
  }

  logger.info(
    `[DigestScheduler] Weekly digest run complete — ${candidates.length - failed.length} enqueued, ` +
    `${recipients.length - candidates.length} skipped (zero value)`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the daily 08:00 UTC digest scheduler.
 * Calling start while already running is a no-op.
 */
export function startDigestScheduler(
  loadRecipients: RecipientLoader,
  opts: { runImmediately?: boolean; intervalMs?: number } = {}
): void {
  if (running) return;
  running = true;

  const { runImmediately = false, intervalMs } = opts;

  const tick = () => runTick(loadRecipients);

  function scheduleNext(): void {
    // If a custom intervalMs is provided (e.g. for tests), use it;
    // otherwise compute ms until the next real 08:00 UTC.
    const delay = intervalMs !== undefined
      ? intervalMs
      : msUntilNext0800UTC(new Date());

    timer = setTimeout(() => {
      void tick().finally(scheduleNext);
    }, delay);
  }

  if (runImmediately) {
    void tick().finally(scheduleNext);
  } else {
    scheduleNext();
  }
}

/**
 * Stop the digest scheduler.
 * Safe to call if the scheduler is not running.
 */
export function stopDigestScheduler(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  running = false;
}

/** Returns true if the scheduler is currently active. */
export function isDigestSchedulerRunning(): boolean {
  return running;
}

/**
 * Start the weekly digest scheduler.
 *
 * Registers a BullMQ repeatable job on the existing email queue that runs
 * every Monday at 08:00 UTC (cron '0 8 * * 1'). The job loads opted-in
 * recipients, renders the weekly-digest template and enqueues emails.
 *
 * Calling start while already running is a no-op.
 */
export function startWeeklyDigestScheduler(
  loadRecipients: WeeklyRecipientLoader,
  opts: { runImmediately?: boolean; intervalMs?: number; queue?: Queue } = {}
): void {
  if (weeklyRunning) return;
  weeklyRunning = true;

  const { runImmediately = false, intervalMs, queue } = opts;
  weeklyQueue = queue ?? null;

  const tick = () => runWeeklyTick(loadRecipients);

  // Register the BullMQ repeatable cron job when a queue is available.
  if (weeklyQueue) {
    void weeklyQueue
      .add(
        WEEKLY_DIGEST_JOB_NAME,
        {},
        {
          repeat: { pattern: WEEKLY_DIGEST_CRON },
          removeOnComplete: true,
          removeOnFail: 100,
        }
      )
      .catch((err) => {
        logger.error('[DigestScheduler] Failed to register weekly cron job:', err);
      });
  }

  function scheduleNext(): void {
    // If a custom intervalMs is provided (e.g. for tests), use it;
    // otherwise compute ms until the next real Monday 08:00 UTC.
    const delay = intervalMs !== undefined
      ? intervalMs
      : msUntilNextMonday0800UTC(new Date());

    weeklyTimer = setTimeout(() => {
      void tick().finally(scheduleNext);
    }, delay);
  }

  if (runImmediately) {
    void tick().finally(scheduleNext);
  } else {
    scheduleNext();
  }
}

/**
 * Stop the weekly digest scheduler.
 * Safe to call if the scheduler is not running.
 */
export function stopWeeklyDigestScheduler(): void {
  if (weeklyTimer !== null) {
    clearTimeout(weeklyTimer);
    weeklyTimer = null;
  }
  weeklyRunning = false;
  weeklyQueue = null;
}

/** Returns true if the weekly digest scheduler is currently active. */
export function isWeeklyDigestSchedulerRunning(): boolean {
  return weeklyRunning;
}

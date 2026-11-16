/**
 * sharePriceAlertWorker.ts
 *
 * Hourly background worker that evaluates user share price alert subscriptions.
 * Checks thresholds for all users configured in user preferences against the current
 * vault share price.
 *
 * Triggers when the price moves up ('above'), down ('below'), or either direction ('either')
 * by the user's defined threshold percentage (1%–50%).
 *
 * Dispatches:
 *   - Email notification via emailQueue
 *   - In-app toast notification
 *
 * Issue #908
 */

import { preferencesStore, type SharePriceAlert } from "../preferences.js";
import { getVaultStats } from "./vaultStatsService.js";
import { enqueueEmail } from "./emailQueue.js";
import { logger } from "../logger.js";

const DEFAULT_HOURLY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let workerTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownPrice: number | null = null;

// In-memory record of triggered toast alerts for active sessions
export interface InAppToastNotification {
  id: string;
  walletAddress: string;
  alertId: string;
  title: string;
  message: string;
  price: number;
  changePct: number;
  timestamp: string;
}

export const pendingToasts: InAppToastNotification[] = [];

/**
 * Check all user preferences price alerts against current vault share price.
 */
export async function checkPriceAlertThresholds(): Promise<{
  checked: number;
  triggered: number;
  currentPrice: number | null;
}> {
  let currentPrice: number | null = null;

  try {
    const stats = await getVaultStats();
    if (stats.total_shares > 0 && stats.total_assets > 0) {
      currentPrice = stats.total_assets / stats.total_shares;
    } else {
      currentPrice = 1.0;
    }
  } catch (err) {
    logger.warn({ err }, "[SharePriceAlertWorker] Failed to fetch vault stats");
  }

  if (currentPrice === null || isNaN(currentPrice) || currentPrice <= 0) {
    logger.info(
      "[SharePriceAlertWorker] No valid current price available for threshold evaluation",
    );
    return { checked: 0, triggered: 0, currentPrice: null };
  }

  let checked = 0;
  let triggered = 0;

  for (const [walletAddress, prefs] of preferencesStore.entries()) {
    if (!prefs.priceAlerts || prefs.priceAlerts.length === 0) continue;

    for (const alert of prefs.priceAlerts) {
      if (!alert.active) continue;

      checked++;

      // Baseline price is initialPrice, or lastCheckedPrice, or lastKnownPrice
      const baselinePrice =
        alert.initialPrice ?? alert.lastCheckedPrice ?? lastKnownPrice ?? currentPrice;

      if (!baselinePrice || baselinePrice <= 0) {
        alert.initialPrice = currentPrice;
        alert.lastCheckedPrice = currentPrice;
        continue;
      }

      const diff = currentPrice - baselinePrice;
      const pctChange = (diff / baselinePrice) * 100;
      const absChange = Math.abs(pctChange);

      let isTriggered = false;

      if (alert.direction === "above" && pctChange >= alert.threshold) {
        isTriggered = true;
      } else if (alert.direction === "below" && -pctChange >= alert.threshold) {
        isTriggered = true;
      } else if (alert.direction === "either" && absChange >= alert.threshold) {
        isTriggered = true;
      }

      if (isTriggered) {
        triggered++;
        const now = new Date().toISOString();
        alert.lastTriggeredAt = now;
        alert.lastCheckedPrice = currentPrice;

        const directionText = pctChange >= 0 ? "risen" : "dropped";
        const title = `Share Price Alert: ${absChange.toFixed(2)}% ${directionText}`;
        const message = `Vault share price has moved from ${baselinePrice.toFixed(4)} to ${currentPrice.toFixed(4)} (${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%), meeting your ${alert.threshold}% threshold (${alert.direction}).`;

        // Handle in-app toast channel
        if (alert.channels.includes("toast")) {
          const toast: InAppToastNotification = {
            id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            walletAddress,
            alertId: alert.id,
            title,
            message,
            price: currentPrice,
            changePct: pctChange,
            timestamp: now,
          };
          pendingToasts.push(toast);
          if (pendingToasts.length > 500) pendingToasts.shift();

          logger.info(
            { walletAddress, alertId: alert.id, pctChange },
            `[SharePriceAlertWorker] In-app toast queued: ${title}`,
          );
        }

        // Handle email channel
        if (alert.channels.includes("email") && alert.email) {
          try {
            await enqueueEmail({
              to: alert.email,
              subject: `[Aura Vault] ${title}`,
              template: "security-alert",
              data: {
                title,
                message,
                walletAddress,
                currentPrice,
                baselinePrice,
                threshold: alert.threshold,
                direction: alert.direction,
                timestamp: now,
              },
              priority: "high",
            });
            logger.info(
              { email: alert.email, alertId: alert.id },
              "[SharePriceAlertWorker] Alert email enqueued",
            );
          } catch (emailErr) {
            logger.error(
              { emailErr, email: alert.email },
              "[SharePriceAlertWorker] Failed to enqueue alert email",
            );
          }
        }
      } else {
        alert.lastCheckedPrice = currentPrice;
      }
    }
  }

  lastKnownPrice = currentPrice;
  return { checked, triggered, currentPrice };
}

/**
 * Start hourly alert evaluation worker.
 */
export function startSharePriceAlertWorker(opts?: {
  intervalMs?: number;
}): void {
  const interval = opts?.intervalMs ?? DEFAULT_HOURLY_INTERVAL_MS;

  if (workerTimer) {
    clearInterval(workerTimer);
  }

  workerTimer = setInterval(async () => {
    try {
      const res = await checkPriceAlertThresholds();
      logger.info(
        { checked: res.checked, triggered: res.triggered, price: res.currentPrice },
        "[SharePriceAlertWorker] Hourly price alert evaluation completed",
      );
    } catch (err) {
      logger.error({ err }, "[SharePriceAlertWorker] Hourly check error");
    }
  }, interval);

  // Run first check in background
  void checkPriceAlertThresholds();

  logger.info(
    { intervalMs: interval },
    "[SharePriceAlertWorker] Started hourly share price alert worker",
  );
}

/**
 * Stop the worker.
 */
export function stopSharePriceAlertWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info("[SharePriceAlertWorker] Stopped worker");
  }
}

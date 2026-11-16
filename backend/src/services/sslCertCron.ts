/**
 * SSL Certificate Renewal Cron Job
 *
 * Runs daily to check certificate expiry for all domains listed in the
 * SSL_CHECK_DOMAINS environment variable.  Results are recorded as a
 * Prometheus gauge metric (`ssl_cert_expiry_days`) so that Alertmanager
 * can fire alerts when < 30 days (warning) or < 7 days (critical) remain.
 *
 * Schedule: every day at 02:00 UTC (configurable via SSL_CHECK_CRON)
 *
 * Environment variables:
 *   SSL_CHECK_DOMAINS  Comma-separated list of domain[:port] to monitor
 *                      e.g. "example.com,api.example.com:8443"
 *   SSL_CHECK_CRON     Cron expression (default: "0 2 * * *")
 */

import { checkCertExpiry, parseDomainsFromEnv } from "./sslCertService.js";
import { updateSslMetric } from "./sslMetrics.js";
import { logger } from "../logger.js";

/** Cron expression — daily at 02:00 UTC by default. */
const CRON_EXPRESSION =
  process.env.SSL_CHECK_CRON ?? "0 2 * * *";

/** Internal timer handle so the cron can be stopped cleanly. */
let cronHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Converts a cron expression to milliseconds until the next trigger.
 * This is a lightweight parser supporting only the daily `"0 H * * *"` pattern
 * needed for this use case.  For full cron support, a library such as
 * `node-cron` can replace this function.
 */
function msUntilNextRun(cronExpr: string): number {
  const parts = cronExpr.split(" ");
  if (parts.length !== 5) {
    // Fallback: run every 24 hours from now
    return 24 * 60 * 60 * 1000;
  }

  const [minutePart, hourPart] = parts;
  const minute = Number.parseInt(minutePart!, 10);
  const hour = Number.parseInt(hourPart!, 10);

  if (!Number.isFinite(minute) || !Number.isFinite(hour)) {
    return 24 * 60 * 60 * 1000;
  }

  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    // Already past today's time — schedule for tomorrow
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Runs the SSL certificate check for all configured domains and updates
 * the Prometheus metrics.
 */
export async function runSslCheck(): Promise<void> {
  const domainEntries = parseDomainsFromEnv(process.env.SSL_CHECK_DOMAINS);

  if (domainEntries.length === 0) {
    logger.info("[ssl-cron] No domains configured (SSL_CHECK_DOMAINS not set). Skipping.");
    return;
  }

  logger.info(`[ssl-cron] Checking ${domainEntries.length} domain(s)…`);

  for (const { domain, port } of domainEntries) {
    const result = await checkCertExpiry(domain, port);

    if (result.error) {
      logger.error(`[ssl-cron] ${domain}: ERROR — ${result.error}`);
      // Record -1 to signal a check failure to dashboards
      updateSslMetric(domain, -1);
    } else {
      logger.info(
        `[ssl-cron] ${domain}: ${result.daysUntilExpiry} days remaining (expires ${result.expiresAt})`
      );
      updateSslMetric(domain, result.daysUntilExpiry!);
    }
  }
}

/**
 * Schedules the SSL check to run daily.
 * The first run is scheduled at the next occurrence of the configured
 * cron time; subsequent runs repeat every 24 hours.
 */
export function startSslCron(): void {
  const delayMs = msUntilNextRun(CRON_EXPRESSION);
  const delayHours = (delayMs / 3_600_000).toFixed(1);

  logger.info(
    `[ssl-cron] Scheduled — next run in ${delayHours}h (cron: "${CRON_EXPRESSION}")`
  );

  // First run after computed delay
  const firstRunHandle = setTimeout(() => {
    void runSslCheck();

    // Subsequent runs every 24 hours
    cronHandle = setInterval(() => {
      void runSslCheck();
    }, 24 * 60 * 60 * 1000);
  }, delayMs);

  // Keep a single stop handle that clears the timeout before first run fires
  // if stopSslCron() is called early.
  (firstRunHandle as unknown as { _sslCronRef: boolean })._sslCronRef = true;
  cronHandle = firstRunHandle as unknown as ReturnType<typeof setInterval>;
}

/** Stops the running cron job (used during graceful shutdown). */
export function stopSslCron(): void {
  if (cronHandle !== null) {
    clearInterval(cronHandle);
    clearTimeout(cronHandle as unknown as ReturnType<typeof setTimeout>);
    cronHandle = null;
    logger.info("[ssl-cron] Stopped.");
  }
}

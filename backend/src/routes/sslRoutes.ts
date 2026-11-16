/**
 * SSL Certificate Check routes
 *
 * GET  /api/v1/ssl/check   — On-demand check of all configured domains
 * GET  /metrics            — Prometheus text metrics endpoint (ssl_cert_expiry_days)
 *
 * The /metrics route is mounted at the app level (not under /api) to match
 * the standard Prometheus scrape path.
 */

import { Router, Request, Response } from "express";
import { checkAllCerts, parseDomainsFromEnv } from "../services/sslCertService.js";
import { renderSslMetricsText, updateSslMetric } from "../services/sslMetrics.js";

export const sslRouter = Router();

/**
 * GET /api/v1/ssl/check
 *
 * Triggers an immediate certificate check for all domains in SSL_CHECK_DOMAINS
 * and returns the results as JSON.  Also updates the Prometheus metrics.
 */
sslRouter.get("/check", async (_req: Request, res: Response): Promise<void> => {
  const domainEntries = parseDomainsFromEnv(process.env.SSL_CHECK_DOMAINS);

  if (domainEntries.length === 0) {
    res.status(200).json({
      message: "No domains configured. Set SSL_CHECK_DOMAINS environment variable.",
      results: [],
    });
    return;
  }

  const results = await checkAllCerts(domainEntries.map((e) => e.domain));

  // Update Prometheus metrics with fresh readings
  for (const r of results) {
    if (r.daysUntilExpiry !== null) {
      updateSslMetric(r.domain, r.daysUntilExpiry);
    } else {
      updateSslMetric(r.domain, -1);
    }
  }

  const statusCode = results.every((r) => r.error === null) ? 200 : 207;
  res.status(statusCode).json({ results });
});

/**
 * GET /metrics
 *
 * Prometheus text exposition endpoint.  Scraped by Prometheus at the
 * configured scrape_interval (default 15s in prometheus.yml).
 */
export const metricsRouter = Router();

metricsRouter.get("/", (_req: Request, res: Response): void => {
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderSslMetricsText());
});

/**
 * Prometheus metrics for SSL certificate expiry.
 *
 * Exposes a single gauge:
 *   ssl_cert_expiry_days{domain="..."}
 *     — days remaining until the certificate expires.
 *     — value is -1 when the check itself failed (connection error, timeout).
 *
 * The /metrics endpoint in the Express app renders the current snapshot
 * of all registered gauges in the Prometheus text exposition format.
 */

/** In-memory store: domain → days remaining */
const sslExpiryGauge = new Map<string, number>();

/**
 * Records the current expiry reading for a domain.
 * Pass -1 to indicate that the check failed.
 */
export function updateSslMetric(domain: string, daysRemaining: number): void {
  sslExpiryGauge.set(domain, daysRemaining);
}

/**
 * Returns a snapshot of all current SSL expiry readings.
 */
export function getSslMetrics(): ReadonlyMap<string, number> {
  return sslExpiryGauge;
}

/**
 * Renders the ssl_cert_expiry_days gauge in Prometheus text exposition format.
 *
 * Example output:
 *   # HELP ssl_cert_expiry_days Days until SSL certificate expires
 *   # TYPE ssl_cert_expiry_days gauge
 *   ssl_cert_expiry_days{domain="example.com"} 42
 *   ssl_cert_expiry_days{domain="api.example.com"} 15
 */
export function renderSslMetricsText(): string {
  if (sslExpiryGauge.size === 0) return "";

  const lines: string[] = [
    "# HELP ssl_cert_expiry_days Days until SSL certificate expires",
    "# TYPE ssl_cert_expiry_days gauge",
  ];

  for (const [domain, days] of sslExpiryGauge) {
    // Escape label value per Prometheus text format spec
    const escapedDomain = domain.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    lines.push(`ssl_cert_expiry_days{domain="${escapedDomain}"} ${days}`);
  }

  return lines.join("\n") + "\n";
}

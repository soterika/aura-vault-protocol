/**
 * SSL Certificate Expiry Check Service
 *
 * Connects to each configured domain via TLS and reads the certificate's
 * `valid_to` date.  Results are recorded as a Prometheus gauge metric
 * (`ssl_cert_expiry_days`) so Alertmanager rules can fire at < 30 days
 * (warning) and < 7 days (critical).
 *
 * Designed to be invoked by a cron job (daily) or on-demand via the
 * /api/v1/ssl/check endpoint.
 */

import tls from "tls";

export interface CertCheckResult {
  domain: string;
  daysUntilExpiry: number | null;
  expiresAt: string | null;
  error: string | null;
}

/** Timeout in milliseconds for each TLS handshake. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Returns the number of whole days until `date` from now.
 * Negative if already expired.
 */
function daysUntil(date: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((date.getTime() - Date.now()) / msPerDay);
}

/**
 * Checks the TLS certificate for a single domain and returns the days
 * remaining until expiry.
 *
 * @param domain  Hostname to check (e.g. "example.com")
 * @param port    TLS port, defaults to 443
 */
export function checkCertExpiry(
  domain: string,
  port = 443
): Promise<CertCheckResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({
        domain,
        daysUntilExpiry: null,
        expiresAt: null,
        error: `Connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
      });
    }, CONNECT_TIMEOUT_MS);

    const socket = tls.connect(
      {
        host: domain,
        port,
        servername: domain,
        rejectUnauthorized: false, // we check the cert ourselves
      },
      () => {
        clearTimeout(timeout);
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            socket.destroy();
            resolve({
              domain,
              daysUntilExpiry: null,
              expiresAt: null,
              error: "No certificate returned",
            });
            return;
          }

          const expiresAt = new Date(cert.valid_to);
          const daysUntilExpiry = daysUntil(expiresAt);
          socket.destroy();
          resolve({
            domain,
            daysUntilExpiry,
            expiresAt: expiresAt.toISOString(),
            error: null,
          });
        } catch (err) {
          socket.destroy();
          resolve({
            domain,
            daysUntilExpiry: null,
            expiresAt: null,
            error: String(err),
          });
        }
      }
    );

    socket.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        domain,
        daysUntilExpiry: null,
        expiresAt: null,
        error: err.message,
      });
    });
  });
}

/**
 * Checks all domains in parallel and returns an array of results.
 */
export async function checkAllCerts(
  domains: string[]
): Promise<CertCheckResult[]> {
  return Promise.all(domains.map((d) => checkCertExpiry(d)));
}

/**
 * Parses a comma-separated list of domain:port pairs or plain domains
 * from an environment variable.
 *
 * Example: "example.com,api.example.com:8443"
 */
export function parseDomainsFromEnv(
  envValue: string | undefined
): Array<{ domain: string; port: number }> {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [domain, portStr] = entry.split(":");
      const port = portStr ? Number.parseInt(portStr, 10) : 443;
      return {
        domain: domain!,
        port: Number.isFinite(port) && port > 0 ? port : 443,
      };
    });
}

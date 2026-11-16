/**
 * Sentry client-side configuration for Next.js 15.
 * Loaded automatically by Next.js when `withSentryConfig` is applied in next.config.ts.
 *
 * See src/lib/sentry.ts for the shared init logic (DSN, PII scrubbing, tracing options).
 */
import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",

    // Performance tracing on page transitions (BrowserTracing is auto-included)
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Disable session replay (GDPR — opt-in only)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // ── PII scrubbing ─────────────────────────────────────────────────────
    beforeSend(event) {
      // Strip sensitive breadcrumbs (private keys, seed phrases)
      if (event.breadcrumbs?.values) {
        event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => {
          if (crumb.message) {
            crumb.message = redactSensitive(crumb.message);
          }
          if (crumb.data) {
            crumb.data = redactObject(crumb.data as Record<string, unknown>);
          }
          return crumb;
        });
      }
      return event;
    },

    ignoreErrors: [
      "Network request failed",
      "Failed to fetch",
      "Load failed",
      "ResizeObserver loop limit exceeded",
    ],
  });
}

const SENSITIVE_KEY_NAMES = [
  "key", "seed", "mnemonic", "secret", "private", "passphrase",
];

const SENSITIVE_PATTERNS = [
  /S[A-Z2-7]{55}/g,           // Stellar secret key
  /[0-9a-fA-F]{64}/g,         // 64-char hex private key
];

function redactSensitive(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_NAMES.some((s) => k.toLowerCase().includes(s))) {
      result[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      result[k] = redactSensitive(v);
    } else if (typeof v === "object" && v !== null) {
      result[k] = redactObject(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

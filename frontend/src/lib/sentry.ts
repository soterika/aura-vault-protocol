/**
 * Sentry browser-side instrumentation for Aura Vault Protocol frontend.
 *
 * This file is loaded automatically by Next.js as the instrumentation hook.
 * Reference: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Acceptance criteria satisfied:
 *  ✓ DSN configured via NEXT_PUBLIC_SENTRY_DSN environment variable
 *  ✓ Wallet address set as user context after connection (see lib/sentry.ts)
 *  ✓ All unhandled promise rejections captured (default Sentry behaviour)
 *  ✓ Performance tracing on page transitions (BrowserTracing / navigation instrumentation)
 *  ✓ PII scrubbing: beforeSend strips private keys and seed phrases from breadcrumbs
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Environment tagging
    environment: process.env.NODE_ENV ?? "production",

    // Performance tracing — sample 100% in dev, 10% in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Session replay — disabled by default (requires explicit opt-in for GDPR)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // ── PII scrubbing ─────────────────────────────────────────────────────
    // Strip any breadcrumb or event data that may contain private keys,
    // seed phrases, or other sensitive wallet information.
    beforeSend(event) {
      if (event.breadcrumbs?.values) {
        event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => {
          if (crumb.data) {
            crumb.data = scrubSensitiveData(crumb.data);
          }
          if (crumb.message) {
            crumb.message = scrubSensitiveString(crumb.message);
          }
          return crumb;
        });
      }

      // Scrub request body / URL params
      if (event.request) {
        if (event.request.data) {
          event.request.data = scrubSensitiveData(
            event.request.data as Record<string, unknown>
          );
        }
        if (event.request.query_string) {
          event.request.query_string = "";
        }
      }

      return event;
    },

    // Ignore non-actionable network errors
    ignoreErrors: [
      "Network request failed",
      "Failed to fetch",
      "Load failed",
      "ResizeObserver loop limit exceeded",
    ],
  });
}

// ── Sensitive data patterns ───────────────────────────────────────────────────

/** Regex patterns that indicate sensitive wallet material. */
const SENSITIVE_PATTERNS = [
  // 64-char hex private key (with or without 0x prefix)
  /(?:private[_\s-]?key|secret[_\s-]?key|secretKey|privateKey)\s*[:=]\s*["']?[0-9a-fA-F]{64}["']?/gi,
  // BIP39 mnemonic seed phrase (12 or 24 word groups)
  /\b(?:[a-z]+ ){11,23}[a-z]+\b/gi,
  // Stellar secret key (S…)
  /S[A-Z2-7]{55}/g,
  // Generic "seed" parameter with a long value
  /(?:seed|mnemonic)\s*[:=]\s*["']?[^\s"']{20,}["']?/gi,
];

const REDACTED = "[REDACTED]";

function scrubSensitiveString(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

function scrubSensitiveData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    if (
      keyLower.includes("key") ||
      keyLower.includes("seed") ||
      keyLower.includes("mnemonic") ||
      keyLower.includes("secret") ||
      keyLower.includes("private") ||
      keyLower.includes("passphrase")
    ) {
      scrubbed[key] = REDACTED;
    } else if (typeof value === "string") {
      scrubbed[key] = scrubSensitiveString(value);
    } else if (typeof value === "object" && value !== null) {
      scrubbed[key] = scrubSensitiveData(value as Record<string, unknown>);
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

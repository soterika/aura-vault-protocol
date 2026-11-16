/**
 * Web Vitals reporting for Aura Vault Protocol.
 *
 * Sends Core Web Vitals (LCP, FID, CLS, FCP, TTFB) to /api/metrics/vitals
 * on every page load via the Next.js reportWebVitals hook.
 *
 * Targets (p75 budget):
 *   LCP  < 2 500 ms  (good: < 2 500, needs improvement: < 4 000, poor: ≥ 4 000)
 *   FID  < 100 ms    (good: < 100,   needs improvement: < 300,   poor: ≥ 300)
 *   CLS  < 0.1       (good: < 0.1,   needs improvement: < 0.25,  poor: ≥ 0.25)
 *   FCP  < 1 800 ms
 *   TTFB < 800 ms
 */

export interface WebVitalsPayload {
  /** Metric name e.g. "LCP", "FID", "CLS", "FCP", "TTFB" */
  name: string;
  /** Measured value (ms for time-based, score for CLS) */
  value: number;
  /** Unique metric ID for deduplication */
  id: string;
  /** "good" | "needs-improvement" | "poor" */
  rating: "good" | "needs-improvement" | "poor";
  /** Navigation entry type */
  navigationType: string;
  /** Current page path */
  path: string;
  /** ISO timestamp of the measurement */
  timestamp: string;
}

/**
 * Classify a metric value against its Good/Needs-improvement/Poor thresholds.
 * Thresholds follow the Google Web Vitals spec (2023).
 */
function getRating(name: string, value: number): "good" | "needs-improvement" | "poor" {
  switch (name) {
    case "LCP":
      return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
    case "FID":
      return value <= 100 ? "good" : value <= 300 ? "needs-improvement" : "poor";
    case "CLS":
      return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
    case "FCP":
      return value <= 1800 ? "good" : value <= 3000 ? "needs-improvement" : "poor";
    case "TTFB":
      return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
    case "INP":
      return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
    default:
      return "good";
  }
}

/**
 * Send a single Web Vitals metric to the backend ingest endpoint.
 * Uses `navigator.sendBeacon` when available (non-blocking on page unload),
 * falls back to a fire-and-forget `fetch`.
 */
export function sendWebVitals(metric: {
  name: string;
  value: number;
  id: string;
  navigationType?: string;
}): void {
  const payload: WebVitalsPayload = {
    name: metric.name,
    value: metric.value,
    id: metric.id,
    rating: getRating(metric.name, metric.value),
    navigationType: metric.navigationType ?? "navigate",
    path: typeof window !== "undefined" ? window.location.pathname : "/",
    timestamp: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const endpoint = "/api/metrics/vitals";
  const contentType = "application/json";

  // Prefer beacon for reliability during page dismissal
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: contentType });
    const sent = navigator.sendBeacon(endpoint, blob);
    if (sent) return;
  }

  // Fallback: fire-and-forget fetch (errors are intentionally swallowed)
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    keepalive: true,
  }).catch(() => {
    // Silently ignore — vitals reporting must never break the user experience
  });
}

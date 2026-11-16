/**
 * POST /api/metrics/vitals
 *
 * Ingest endpoint for Core Web Vitals reported by the frontend.
 * Validates and logs the payload; in production this should forward to
 * a time-series store (Prometheus push gateway, InfluxDB, Datadog, etc.).
 *
 * Expected body (JSON):
 * {
 *   name:           "LCP" | "FID" | "CLS" | "FCP" | "TTFB" | "INP" | ...
 *   value:          number
 *   id:             string   // unique metric ID
 *   rating:         "good" | "needs-improvement" | "poor"
 *   navigationType: string
 *   path:           string
 *   timestamp:      string   // ISO-8601
 * }
 */

import { type NextRequest, NextResponse } from "next/server";

// ── Validation ────────────────────────────────────────────────────────────────

const ALLOWED_METRICS = new Set([
  "LCP", "FID", "CLS", "FCP", "TTFB", "INP",
  // Next.js custom metrics
  "Next.js-hydration",
  "Next.js-route-change-to-render",
  "Next.js-render",
]);

const ALLOWED_RATINGS = new Set(["good", "needs-improvement", "poor"]);

interface VitalsPayload {
  name: string;
  value: number;
  id: string;
  rating: string;
  navigationType: string;
  path: string;
  timestamp: string;
}

function isValidPayload(body: unknown): body is VitalsPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.name === "string" &&
    ALLOWED_METRICS.has(b.name) &&
    typeof b.value === "number" &&
    Number.isFinite(b.value) &&
    b.value >= 0 &&
    typeof b.id === "string" &&
    b.id.length > 0 &&
    typeof b.rating === "string" &&
    ALLOWED_RATINGS.has(b.rating) &&
    typeof b.path === "string" &&
    typeof b.timestamp === "string"
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json({ error: "Invalid vitals payload" }, { status: 422 });
  }

  // Structured log — in production replace with your observability sink
  console.info(
    JSON.stringify({
      event: "web_vitals",
      metric: body.name,
      value: body.value,
      rating: body.rating,
      navigationType: body.navigationType,
      // Sanitise the path to avoid logging PII in query strings
      path: body.path.split("?")[0],
      id: body.id,
      timestamp: body.timestamp,
    })
  );

  /**
   * TODO: forward to your observability backend, e.g.:
   *
   * await fetch(process.env.PROMETHEUS_PUSH_GATEWAY + "/metrics/job/web_vitals", {
   *   method: "POST",
   *   body: `web_vital{metric="${body.name}",rating="${body.rating}"} ${body.value}\n`,
   * });
   */

  return NextResponse.json({ ok: true }, { status: 202 });
}

/** Reject all other HTTP methods. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

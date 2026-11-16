/**
 * Prometheus Metrics — Issue #292
 *
 * Exposes a GET /metrics endpoint in Prometheus exposition format.
 * Protected by bearer token (METRICS_TOKEN env var).
 * Tracks:
 *   - http_requests_total{method, route, status_code}
 *   - http_request_duration_seconds{method, route, status_code} histogram
 *   - queue_depth gauge
 *   - cache_hit_ratio gauge
 *   - contract_call_errors_total counter
 *
 * Histogram buckets are tuned for expected latencies: 5ms–10s.
 */

import { Router, Request, Response, NextFunction } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabelSet {
  method: string;
  route: string;
  status_code: string;
}

interface HistogramBucket {
  le: number;
  count: number;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/** Latency buckets tuned for 5ms–10s range */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const httpRequestsTotal = new Map<string, number>();
const httpRequestDurationSums = new Map<string, number>();
const httpRequestDurationCounts = new Map<string, number>();
const httpRequestDurationBuckets = new Map<string, number[]>(); // label_key → counts per bucket

/** Mutable gauges — updated by external callers */
let queueDepth = 0;
let cacheHits = 0;
let cacheMisses = 0;
let contractCallErrors = 0;
let horizonRateLimitTotal = 0;
let horizonRateLimitTimestamps: number[] = [];

// Lifecycle timestamps
const processStartTime = Date.now();

// ─── Label helpers ────────────────────────────────────────────────────────────

function labelKey(labels: LabelSet): string {
  return `${labels.method}:${labels.route}:${labels.status_code}`;
}

function normalizeRoute(path: string): string {
  // Replace numeric path segments and UUIDs with placeholders
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+/g, "/:id");
}

// ─── Public API for updating metrics ─────────────────────────────────────────

/** Record one completed HTTP request. durationSecs is the wall-clock time. */
export function recordRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSecs: number
): void {
  const labels: LabelSet = {
    method: method.toUpperCase(),
    route: normalizeRoute(route),
    status_code: String(statusCode),
  };
  const key = labelKey(labels);

  httpRequestsTotal.set(key, (httpRequestsTotal.get(key) ?? 0) + 1);
  httpRequestDurationSums.set(key, (httpRequestDurationSums.get(key) ?? 0) + durationSecs);
  httpRequestDurationCounts.set(key, (httpRequestDurationCounts.get(key) ?? 0) + 1);

  // Update bucket counts
  const existing = httpRequestDurationBuckets.get(key) ?? new Array(DURATION_BUCKETS.length).fill(0);
  for (let i = 0; i < DURATION_BUCKETS.length; i++) {
    if (durationSecs <= DURATION_BUCKETS[i]) {
      existing[i] += 1;
    }
  }
  httpRequestDurationBuckets.set(key, existing);
}

/** Set current queue depth */
export function setQueueDepth(depth: number): void {
  queueDepth = depth;
}

/** Record a cache hit */
export function recordCacheHit(): void {
  cacheHits++;
}

/** Record a cache miss */
export function recordCacheMiss(): void {
  cacheMisses++;
}

/** Increment contract call error counter */
export function incrementContractCallErrors(): void {
  contractCallErrors++;
}

/** Record Horizon throttling for the event listener and five-minute alert. */
export function recordHorizonRateLimit(at = Date.now()): void {
  horizonRateLimitTotal++;
  horizonRateLimitTimestamps.push(at);
}

// ─── Prometheus text format renderer ─────────────────────────────────────────

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelStr(labels: LabelSet): string {
  return (
    `method="${escapeLabelValue(labels.method)}",` +
    `route="${escapeLabelValue(labels.route)}",` +
    `status_code="${escapeLabelValue(labels.status_code)}"`
  );
}

function keyToLabels(key: string): LabelSet {
  const [method, ...rest] = key.split(":");
  const status_code = rest[rest.length - 1];
  const route = rest.slice(0, rest.length - 1).join(":");
  return { method, route, status_code };
}

export function renderPrometheusText(): string {
  const lines: string[] = [];
  const rateLimitCutoff = Date.now() - 5 * 60_000;
  horizonRateLimitTimestamps = horizonRateLimitTimestamps.filter((timestamp) => timestamp >= rateLimitCutoff);

  // ── http_requests_total ───────────────────────────────────────────────
  lines.push("# HELP http_requests_total Total number of HTTP requests by method, route, and status.");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, count] of httpRequestsTotal) {
    const labels = keyToLabels(key);
    lines.push(`http_requests_total{${labelStr(labels)}} ${count}`);
  }

  // ── http_request_duration_seconds ────────────────────────────────────
  lines.push("");
  lines.push("# HELP http_request_duration_seconds HTTP request latency histogram (seconds).");
  lines.push("# TYPE http_request_duration_seconds histogram");
  for (const [key] of httpRequestDurationCounts) {
    const labels = keyToLabels(key);
    const bucketCounts = httpRequestDurationBuckets.get(key) ?? [];

    // Cumulative bucket counts (Prometheus convention)
    let cumulative = 0;
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      cumulative += bucketCounts[i] ?? 0;
      lines.push(
        `http_request_duration_seconds_bucket{${labelStr(labels)},le="${DURATION_BUCKETS[i]}"} ${cumulative}`
      );
    }
    // +Inf bucket
    lines.push(`http_request_duration_seconds_bucket{${labelStr(labels)},le="+Inf"} ${httpRequestDurationCounts.get(key) ?? 0}`);
    lines.push(`http_request_duration_seconds_sum{${labelStr(labels)}} ${(httpRequestDurationSums.get(key) ?? 0).toFixed(6)}`);
    lines.push(`http_request_duration_seconds_count{${labelStr(labels)}} ${httpRequestDurationCounts.get(key) ?? 0}`);
  }

  // ── queue_depth ───────────────────────────────────────────────────────
  lines.push("");
  lines.push("# HELP queue_depth Current number of jobs in the processing queue.");
  lines.push("# TYPE queue_depth gauge");
  lines.push(`queue_depth ${queueDepth}`);

  // ── cache_hit_ratio ───────────────────────────────────────────────────
  const totalCacheOps = cacheHits + cacheMisses;
  const hitRatio = totalCacheOps > 0 ? cacheHits / totalCacheOps : 0;
  lines.push("");
  lines.push("# HELP cache_hit_ratio Ratio of cache hits to total cache operations (0–1).");
  lines.push("# TYPE cache_hit_ratio gauge");
  lines.push(`cache_hit_ratio ${hitRatio.toFixed(6)}`);

  // ── contract_call_errors_total ────────────────────────────────────────
  lines.push("");
  lines.push("# HELP contract_call_errors_total Total number of Soroban contract call errors.");
  lines.push("# TYPE contract_call_errors_total counter");
  lines.push(`contract_call_errors_total ${contractCallErrors}`);

  lines.push("");
  lines.push("# HELP horizon_rate_limit_total Total Horizon HTTP 429 responses.");
  lines.push("# TYPE horizon_rate_limit_total counter");
  lines.push(`horizon_rate_limit_total ${horizonRateLimitTotal}`);
  lines.push("# HELP horizon_rate_limit_events_5m Horizon HTTP 429 responses in the last five minutes.");
  lines.push("# TYPE horizon_rate_limit_events_5m gauge");
  lines.push(`horizon_rate_limit_events_5m ${horizonRateLimitTimestamps.length}`);

  // ── process / lifecycle metrics ───────────────────────────────────────
  lines.push("");
  lines.push("# HELP process_start_time_seconds Unix timestamp when the process started.");
  lines.push("# TYPE process_start_time_seconds gauge");
  lines.push(`process_start_time_seconds ${(processStartTime / 1000).toFixed(3)}`);

  lines.push("");
  lines.push("# HELP process_uptime_seconds Number of seconds the process has been running.");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${((Date.now() - processStartTime) / 1000).toFixed(3)}`);

  lines.push(""); // trailing newline
  return lines.join("\n");
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Automatically records latency + request count for every response.
 * Attach to the Express app before routes.
 */
export function metricsMiddleware() {
  return function (req: Request, res: Response, next: NextFunction): void {
    const startNs = process.hrtime.bigint();

    res.on("finish", () => {
      const durationNs = process.hrtime.bigint() - startNs;
      const durationSecs = Number(durationNs) / 1e9;
      recordRequest(req.method, req.path, res.statusCode, durationSecs);
    });

    next();
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const METRICS_TOKEN = process.env.METRICS_TOKEN ?? "";

export const metricsRouter = Router();

/**
 * GET /metrics
 * Returns Prometheus text exposition. Requires Authorization: Bearer <METRICS_TOKEN>.
 * Responds 401 when the token is missing/wrong.
 * Responds 503 when METRICS_TOKEN is not configured (secure-fail-closed).
 */
metricsRouter.get("/", (req: Request, res: Response): void => {
  // Fail closed: if METRICS_TOKEN is not set in env, refuse all requests.
  if (!METRICS_TOKEN) {
    res.status(503).send("# metrics endpoint not configured\n");
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token || token !== METRICS_TOKEN) {
    res.status(401).set("WWW-Authenticate", 'Bearer realm="metrics"').send("# unauthorized\n");
    return;
  }

  const body = renderPrometheusText();
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8").send(body);
});

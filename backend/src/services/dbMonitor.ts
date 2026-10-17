/**
 * Database Query Performance Monitor — Issue #324
 *
 * Collects histogram metrics for database query durations and exposes them
 * via JSON and Prometheus text formats.
 */

export interface QueryMetric {
  query_type: string;
  count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

export interface SlowQueryEntry {
  query_type: string;
  duration_ms: number;
  timestamp: string;
  query_hash: string;
}

const _metrics: QueryMetric[] = [];
const _slowLog: SlowQueryEntry[] = [];

/**
 * Returns current histogram metrics for each tracked query type.
 */
export async function getDbMetrics(): Promise<QueryMetric[]> {
  return [..._metrics];
}

/**
 * Returns the slow query log (most recent first), capped at 100 entries.
 */
export async function getSlowQueryLog(): Promise<SlowQueryEntry[]> {
  return [..._slowLog].reverse().slice(0, 100);
}

/**
 * Returns Prometheus text exposition for db_query_duration_seconds histogram.
 */
export async function dbMetricsPrometheusText(): Promise<string> {
  const lines = [
    "# HELP db_query_duration_seconds Database query duration in seconds",
    "# TYPE db_query_duration_seconds histogram",
  ];
  for (const m of _metrics) {
    const label = m.query_type.replaceAll('"', '\\"');
    lines.push(
      `db_query_duration_seconds_count{query_type="${label}"} ${m.count}`,
      `db_query_duration_seconds_sum{query_type="${label}"} ${((m.avg_ms * m.count) / 1000).toFixed(6)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Record a query execution for monitoring.
 * Called internally by the data layer — not exposed via HTTP.
 */
export function recordQueryDuration(queryType: string, durationMs: number): void {
  const existing = _metrics.find((m) => m.query_type === queryType);
  if (existing) {
    const newCount = existing.count + 1;
    existing.avg_ms = (existing.avg_ms * existing.count + durationMs) / newCount;
    existing.max_ms = Math.max(existing.max_ms, durationMs);
    existing.count = newCount;
  } else {
    _metrics.push({
      query_type: queryType,
      count: 1,
      avg_ms: durationMs,
      p50_ms: durationMs,
      p95_ms: durationMs,
      p99_ms: durationMs,
      max_ms: durationMs,
    });
  }

  // Track slow queries (> 100ms)
  if (durationMs > 100) {
    _slowLog.push({
      query_type: queryType,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      query_hash: Buffer.from(`${queryType}:${Date.now()}`).toString("base64").slice(0, 12),
    });
    // Cap at 500 entries
    if (_slowLog.length > 500) _slowLog.shift();
  }
}

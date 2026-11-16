/**
 * Database Circuit Breaker — Issue #869
 *
 * Wraps PostgreSQL queries with circuit breaker pattern to detect and handle
 * database unavailability gracefully.
 *
 * Configuration:
 *   - Opens after 80% error rate within 5-call rolling window (min 5 calls)
 *   - Half-open probe after 30 seconds
 *   - Returns 503 Service Unavailable when circuit is open
 *   - Prometheus metrics exposed for monitoring
 *
 * Usage:
 *   import { getDatabaseCircuitBreakerState, withDatabaseCircuitBreaker } from './databaseCircuitBreakerService.js';
 *   
 *   const result = await withDatabaseCircuitBreaker(
 *     () => getWritePool().query('SELECT * FROM users'),
 *     'query:get_users'
 *   );
 */

import CircuitBreaker from "opossum";
import { logger } from "../logger.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface DatabaseCircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  fallbacks: number;
  rejects: number;
  timeouts: number;
  latencyMean: number;
}

// Prometheus metrics counters
const promCounters = {
  opened: 0,
  closed: 0,
  half_opened: 0,
  fallback: 0,
  success: 0,
  failure: 0,
  timeout: 0,
  reject: 0,
};

function incrementCounter(name: keyof typeof promCounters): void {
  promCounters[name]++;
}

// Circuit breaker options
const circuitBreakerOptions: CircuitBreaker.Options = {
  errorThresholdPercentage: 80,   // 80% failure triggers open
  volumeThreshold: 5,             // Minimum 5 calls before evaluating
  timeout: 5_000,                 // 5s per-query timeout (database should respond quickly)
  resetTimeout: 30_000,           // Half-open probe after 30s
  rollingCountTimeout: 15_000,    // 15s rolling window
  rollingCountBuckets: 10,
  name: "database",
  group: "database",
};

type DatabaseAction<T> = () => Promise<T>;

const breaker = new CircuitBreaker(
  async (fn: DatabaseAction<unknown>) => fn(),
  circuitBreakerOptions
);

// Event hooks
breaker.on("open", () => {
  incrementCounter("opened");
  logger.warn("[database-circuit-breaker] Circuit OPENED — database may be unavailable");
});

breaker.on("close", () => {
  incrementCounter("closed");
  logger.info("[database-circuit-breaker] Circuit CLOSED — database operational");
});

breaker.on("halfOpen", () => {
  incrementCounter("half_opened");
  logger.info("[database-circuit-breaker] Circuit HALF-OPEN — probing database");
});

breaker.on("fallback", () => {
  incrementCounter("fallback");
});

breaker.on("success", () => {
  incrementCounter("success");
});

breaker.on("failure", () => {
  incrementCounter("failure");
});

breaker.on("timeout", () => {
  incrementCounter("timeout");
});

breaker.on("reject", () => {
  incrementCounter("reject");
});

/**
 * Execute a database query through the circuit breaker.
 *
 * @param fn     Async function that executes the query
 * @param queryName Optional name for logging
 * @returns      Query result or error
 * @throws       When circuit is open
 */
export async function withDatabaseCircuitBreaker<T>(
  fn: DatabaseAction<T>,
  queryName?: string
): Promise<T> {
  try {
    return await breaker.fire(fn) as T;
  } catch (err: unknown) {
    logger.error(
      `[database-circuit-breaker] Query failed${queryName ? ` (${queryName})` : ''}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    throw err;
  }
}

/**
 * Get current database circuit breaker state.
 */
export function getDatabaseCircuitBreakerState(): CircuitState {
  if (breaker.opened) return "OPEN";
  if (breaker.halfOpen) return "HALF_OPEN";
  return "CLOSED";
}

/**
 * Get full database circuit breaker stats.
 */
export function getDatabaseCircuitBreakerStats(): DatabaseCircuitBreakerStats {
  const stats = breaker.stats;
  return {
    state: getDatabaseCircuitBreakerState(),
    failures: stats.failures ?? 0,
    successes: stats.successes ?? 0,
    fallbacks: stats.fallbacks ?? 0,
    rejects: stats.rejects ?? 0,
    timeouts: stats.timeouts ?? 0,
    latencyMean: stats.latencyMean ?? 0,
  };
}

/**
 * Generate Prometheus text format metrics for database circuit breaker.
 */
export function getDatabaseCircuitBreakerPrometheusText(): string {
  const state = getDatabaseCircuitBreakerState();
  const stateCode = state === "CLOSED" ? 0 : state === "OPEN" ? 1 : 2;

  const lines = [
    "# HELP database_circuit_breaker_state Current circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)",
    "# TYPE database_circuit_breaker_state gauge",
    `database_circuit_breaker_state{circuit="database"} ${stateCode}`,
    "",
    "# HELP database_circuit_breaker_events_total State transition events",
    "# TYPE database_circuit_breaker_events_total counter",
    `database_circuit_breaker_events_total{event="open"} ${promCounters.opened}`,
    `database_circuit_breaker_events_total{event="close"} ${promCounters.closed}`,
    `database_circuit_breaker_events_total{event="half_open"} ${promCounters.half_opened}`,
    "",
    "# HELP database_circuit_breaker_calls_total Call outcomes",
    "# TYPE database_circuit_breaker_calls_total counter",
    `database_circuit_breaker_calls_total{outcome="success"} ${promCounters.success}`,
    `database_circuit_breaker_calls_total{outcome="failure"} ${promCounters.failure}`,
    `database_circuit_breaker_calls_total{outcome="timeout"} ${promCounters.timeout}`,
    `database_circuit_breaker_calls_total{outcome="reject"} ${promCounters.reject}`,
    `database_circuit_breaker_calls_total{outcome="fallback"} ${promCounters.fallback}`,
    "",
  ];

  return lines.join("\n");
}

export { breaker as databaseCircuitBreaker };

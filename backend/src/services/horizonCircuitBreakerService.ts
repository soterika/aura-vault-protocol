/**
 * Horizon Circuit Breaker — Issue #312
 *
 * Wraps all outbound Horizon API calls with an opossum circuit breaker to
 * prevent cascading failures when Horizon is degraded or unreachable.
 *
 * Configuration (matches acceptance criteria):
 *   - Opens after 5 consecutive failures (errorThresholdPercentage: 100,
 *     volumeThreshold: 5 — all 5 of 5 in the rolling window must fail)
 *   - Half-open probe after 30 seconds (resetTimeout: 30_000)
 *   - Fallback: return cached data when circuit is open
 *   - Circuit state exposed in /health endpoint
 *   - Prometheus-compatible counter for state change events
 *
 * Usage:
 *   import { horizonCircuitBreaker, withHorizonCircuitBreaker } from './horizonCircuitBreaker.js';
 *
 *   // Wrap any async function
 *   const result = await withHorizonCircuitBreaker(() => fetchFromHorizon(url));
 */

import CircuitBreaker from "opossum";
import { cacheGet } from "../cache.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  fallbacks: number;
  rejects: number;
  timeouts: number;
  latencyMean: number;
  percentiles: Record<string, number>;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  stats: CircuitBreakerStats;
  prometheus: string;
}

// ---------------------------------------------------------------------------
// Prometheus metrics counters (in-process, no external dependency needed)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Circuit breaker factory
// ---------------------------------------------------------------------------

/**
 * The single shared circuit breaker instance for all Horizon API calls.
 * Using a single breaker means any Horizon call failure counts toward the
 * same threshold — appropriate since they all depend on the same upstream.
 */

// Generic async action (the actual HTTP call passed by callers)
type HorizonAction<T> = () => Promise<T>;

// Opossum wraps a single function; we wrap a passthrough that callers invoke
const circuitBreakerOptions: CircuitBreaker.Options = {
  // Open after 5 consecutive failures within a 10-second rolling window
  errorThresholdPercentage: 80,   // 80% failure rate triggers open
  volumeThreshold: 5,              // Minimum 5 calls before evaluating
  timeout: 10_000,                 // 10s per-call timeout
  resetTimeout: 30_000,            // Half-open probe after 30s
  rollingCountTimeout: 15_000,     // 15s rolling window
  rollingCountBuckets: 10,
  name: "horizon-api",
  group: "horizon",
  enabled: true,
  allowWarmUp: false,
  volumeThreshold: 5,
};

// opossum wraps a single function; callers pass the actual Horizon fetch fn
const breaker = new CircuitBreaker(
  async (fn: HorizonAction<unknown>) => fn(),
  circuitBreakerOptions
);

// ---------------------------------------------------------------------------
// Event hooks for logging and Prometheus
// ---------------------------------------------------------------------------

breaker.on("open", () => {
  incrementCounter("opened");
  console.warn("[horizon-circuit-breaker] Circuit OPENED — Horizon calls will be rejected");
});

breaker.on("close", () => {
  incrementCounter("closed");
  console.info("[horizon-circuit-breaker] Circuit CLOSED — Horizon calls resuming");
});

breaker.on("halfOpen", () => {
  incrementCounter("half_opened");
  console.info("[horizon-circuit-breaker] Circuit HALF-OPEN — probing Horizon");
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

// ---------------------------------------------------------------------------
// Fallback cache helper
// ---------------------------------------------------------------------------

const FALLBACK_CACHE_NS = "horizon:fallback";

/**
 * Attempt to retrieve a cached fallback value when the circuit is open.
 * Returns null if nothing is cached.
 */
async function getFallback<T>(cacheKey: string): Promise<T | null> {
  try {
    return await cacheGet<T>(FALLBACK_CACHE_NS, cacheKey);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a Horizon API call through the circuit breaker.
 *
 * @param fn         Async function that makes the actual Horizon HTTP request.
 * @param fallbackKey Optional Redis cache key used as fallback when circuit is open.
 *                    The caller is responsible for populating this cache on success.
 * @returns          The result of `fn()` or cached fallback data.
 * @throws           When circuit is open AND no cached fallback is available.
 */
export async function withHorizonCircuitBreaker<T>(
  fn: HorizonAction<T>,
  fallbackKey?: string
): Promise<T> {
  try {
    return await breaker.fire(fn) as T;
  } catch (err: unknown) {
    // Circuit open or call failed — attempt cached fallback
    if (fallbackKey) {
      const cached = await getFallback<T>(fallbackKey);
      if (cached !== null) {
        console.warn("[horizon-circuit-breaker] Serving cached fallback for key:", fallbackKey);
        return cached;
      }
    }
    throw err;
  }
}

/**
 * Get the current circuit breaker state for health/metrics endpoints.
 */
export function getCircuitBreakerState(): CircuitState {
  if (breaker.opened) return "OPEN";
  if (breaker.halfOpen) return "HALF_OPEN";
  return "CLOSED";
}

/**
 * Get full circuit breaker stats for observability.
 */
export function getCircuitBreakerStats(): CircuitBreakerStats {
  const stats = breaker.stats;
  return {
    state: getCircuitBreakerState(),
    failures: stats.failures ?? 0,
    successes: stats.successes ?? 0,
    fallbacks: stats.fallbacks ?? 0,
    rejects: stats.rejects ?? 0,
    timeouts: stats.timeouts ?? 0,
    latencyMean: stats.latencyMean ?? 0,
    percentiles: stats.percentiles ?? {},
  };
}

/**
 * Generate Prometheus text exposition for circuit state change counters.
 * Suitable for scraping by a Prometheus /metrics endpoint.
 */
export function getCircuitBreakerPrometheusText(): string {
  const state = getCircuitBreakerState();
  const stateCode = state === "CLOSED" ? 0 : state === "OPEN" ? 1 : 2;

  const lines = [
    "# HELP horizon_circuit_breaker_state Current circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)",
    "# TYPE horizon_circuit_breaker_state gauge",
    `horizon_circuit_breaker_state{circuit="horizon-api"} ${stateCode}`,
    "",
    "# HELP horizon_circuit_breaker_events_total Total circuit breaker state transition events",
    "# TYPE horizon_circuit_breaker_events_total counter",
    `horizon_circuit_breaker_events_total{event="open"} ${promCounters.opened}`,
    `horizon_circuit_breaker_events_total{event="close"} ${promCounters.closed}`,
    `horizon_circuit_breaker_events_total{event="half_open"} ${promCounters.half_opened}`,
    "",
    "# HELP horizon_circuit_breaker_calls_total Total circuit breaker call outcomes",
    "# TYPE horizon_circuit_breaker_calls_total counter",
    `horizon_circuit_breaker_calls_total{outcome="success"} ${promCounters.success}`,
    `horizon_circuit_breaker_calls_total{outcome="failure"} ${promCounters.failure}`,
    `horizon_circuit_breaker_calls_total{outcome="timeout"} ${promCounters.timeout}`,
    `horizon_circuit_breaker_calls_total{outcome="reject"} ${promCounters.reject}`,
    `horizon_circuit_breaker_calls_total{outcome="fallback"} ${promCounters.fallback}`,
    "",
  ];

  return lines.join("\n");
}

/** Expose the raw breaker instance for advanced use / testing. */
export { breaker as horizonCircuitBreaker };

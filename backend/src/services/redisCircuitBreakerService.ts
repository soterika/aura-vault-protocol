/**
 * Redis Circuit Breaker — Issue #869
 *
 * Wraps Redis operations with circuit breaker pattern to handle Redis unavailability.
 *
 * Configuration:
 *   - Opens after 80% error rate (minimum 3 calls in rolling window)
 *   - Half-open probe after 20 seconds (faster recovery for cache)
 *   - Fail-open on circuit open (returns null/default instead of erroring)
 *   - Prometheus metrics for observability
 *
 * Usage:
 *   import { withRedisCircuitBreaker, getRedisCircuitBreakerState } from './redisCircuitBreakerService.js';
 *   
 *   const value = await withRedisCircuitBreaker(() => getRedis().get('key'));
 */

import CircuitBreaker from "opossum";
import { logger } from "../logger.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface RedisCircuitBreakerStats {
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

// Circuit breaker options (more lenient than database due to cache nature)
const circuitBreakerOptions: CircuitBreaker.Options = {
  errorThresholdPercentage: 80,   // 80% failure triggers open
  volumeThreshold: 3,             // Lower threshold (cache less critical)
  timeout: 2_000,                 // 2s timeout (cache should be fast)
  resetTimeout: 20_000,           // Faster recovery (20s) since cache is less critical
  rollingCountTimeout: 15_000,    // 15s rolling window
  rollingCountBuckets: 10,
  name: "redis",
  group: "cache",
};

type RedisAction<T> = () => Promise<T>;

const breaker = new CircuitBreaker(
  async (fn: RedisAction<unknown>) => fn(),
  circuitBreakerOptions
);

// Event hooks
breaker.on("open", () => {
  incrementCounter("opened");
  logger.warn("[redis-circuit-breaker] Circuit OPENED — Redis unavailable, cache disabled");
});

breaker.on("close", () => {
  incrementCounter("closed");
  logger.info("[redis-circuit-breaker] Circuit CLOSED — Redis operational");
});

breaker.on("halfOpen", () => {
  incrementCounter("half_opened");
  logger.info("[redis-circuit-breaker] Circuit HALF-OPEN — testing Redis connection");
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
 * Execute a Redis operation through the circuit breaker.
 * Fail-open: returns null on error instead of throwing.
 *
 * @param fn   Async function that executes Redis operation
 * @param operationName Optional name for logging
 * @returns    Operation result or null if circuit is open
 */
export async function withRedisCircuitBreaker<T>(
  fn: RedisAction<T>,
  operationName?: string
): Promise<T | null> {
  try {
    return await breaker.fire(fn) as T;
  } catch (err: unknown) {
    // Fail-open for cache: log but don't throw
    logger.warn(
      `[redis-circuit-breaker] Operation failed${operationName ? ` (${operationName})` : ''}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return null;
  }
}

/**
 * Get current Redis circuit breaker state.
 */
export function getRedisCircuitBreakerState(): CircuitState {
  if (breaker.opened) return "OPEN";
  if (breaker.halfOpen) return "HALF_OPEN";
  return "CLOSED";
}

/**
 * Get full Redis circuit breaker stats.
 */
export function getRedisCircuitBreakerStats(): RedisCircuitBreakerStats {
  const stats = breaker.stats;
  return {
    state: getRedisCircuitBreakerState(),
    failures: stats.failures ?? 0,
    successes: stats.successes ?? 0,
    fallbacks: stats.fallbacks ?? 0,
    rejects: stats.rejects ?? 0,
    timeouts: stats.timeouts ?? 0,
    latencyMean: stats.latencyMean ?? 0,
  };
}

/**
 * Generate Prometheus text format metrics for Redis circuit breaker.
 */
export function getRedisCircuitBreakerPrometheusText(): string {
  const state = getRedisCircuitBreakerState();
  const stateCode = state === "CLOSED" ? 0 : state === "OPEN" ? 1 : 2;

  const lines = [
    "# HELP redis_circuit_breaker_state Current circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)",
    "# TYPE redis_circuit_breaker_state gauge",
    `redis_circuit_breaker_state{circuit="redis"} ${stateCode}`,
    "",
    "# HELP redis_circuit_breaker_events_total State transition events",
    "# TYPE redis_circuit_breaker_events_total counter",
    `redis_circuit_breaker_events_total{event="open"} ${promCounters.opened}`,
    `redis_circuit_breaker_events_total{event="close"} ${promCounters.closed}`,
    `redis_circuit_breaker_events_total{event="half_open"} ${promCounters.half_opened}`,
    "",
    "# HELP redis_circuit_breaker_calls_total Call outcomes",
    "# TYPE redis_circuit_breaker_calls_total counter",
    `redis_circuit_breaker_calls_total{outcome="success"} ${promCounters.success}`,
    `redis_circuit_breaker_calls_total{outcome="failure"} ${promCounters.failure}`,
    `redis_circuit_breaker_calls_total{outcome="timeout"} ${promCounters.timeout}`,
    `redis_circuit_breaker_calls_total{outcome="reject"} ${promCounters.reject}`,
    `redis_circuit_breaker_calls_total{outcome="fallback"} ${promCounters.fallback}`,
    "",
  ];

  return lines.join("\n");
}

export { breaker as redisCircuitBreaker };

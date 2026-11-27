import { afterEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  ping: vi.fn(),
  get: vi.fn(),
}));

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    ping = redisState.ping;
    get = redisState.get;
    quit = vi.fn().mockResolvedValue(undefined);
  },
  Cluster: class FakeCluster {},
}));

import { pingRedis, getRedis } from "./redis.js";
import {
  getRedisCircuitBreakerState,
  withRedisCircuitBreaker,
  redisCircuitBreaker,
} from "./services/redisCircuitBreakerService.js";
import {
  createDegradedResponse,
  getDegradationStatus,
} from "./middleware/degradationMiddleware.js";

describe("Redis unavailability impact on the API", () => {
  afterEach(() => {
    vi.clearAllMocks();
    redisCircuitBreaker.close();
  });

  it("reports Redis as down when the ping probe rejects", async () => {
    redisState.ping.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(pingRedis()).resolves.toBe(false);
  });

  it("reports Redis as available again after the probe succeeds", async () => {
    redisState.ping.mockResolvedValueOnce("PONG");

    await expect(pingRedis()).resolves.toBe(true);
  });

  it("fails open for cache reads while Redis is unavailable", async () => {
    redisState.get.mockRejectedValueOnce(new Error("READONLY"));

    const value = await withRedisCircuitBreaker(
      () => getRedis().get("vault:stats:current"),
      "vault-stats-read"
    );

    expect(value).toBeNull();
  });

  it("exposes an open Redis circuit as a degraded API response", () => {
    redisCircuitBreaker.open();
    expect(getRedisCircuitBreakerState()).toBe("OPEN");

    const status = getDegradationStatus();
    expect(status.isDegraded).toBe(true);
    expect(status.redis).toBe(true);
    expect(status.message).toContain("cache");

    const response = createDegradedResponse(status);
    expect(response.success).toBe(false);
    expect(response.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(response.error.details.redis).toBe("unavailable");
    expect(response.meta.retryAfter).toBe(30);
  });
});

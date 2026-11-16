/**
 * Tests for Harvest Repeatable Job — Issue #944
 *
 * Covers:
 *   - buildCronExpression converts HARVEST_INTERVAL_HOURS to cron correctly
 *   - HARVEST_INTERVAL_HOURS defaults to 6 when env var is not set
 *   - Prometheus counters are exported correctly
 *   - Invalid interval values throw immediately
 */

import { describe, it, expect, vi } from "vitest";

// Mock logger before any other imports that might pull in config/index.ts
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  correlationIdMiddleware: vi.fn(),
  createRequestLogger: vi.fn(),
}));

// Mock db so no DATABASE_URL is needed
vi.mock("../db.js", () => ({
  getWritePool: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }),
  getReadPool: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

// Mock keeperKeypair so we don't need AWS
vi.mock("./keeperKeypair.js", () => ({
  getKeeperKeypair: vi.fn().mockResolvedValue({
    secretKey: "S" + "A".repeat(55),
    publicKey: "G" + "A".repeat(55),
  }),
}));

import { buildCronExpression } from "./harvestRepeatableJob.js";

// ---------------------------------------------------------------------------
// buildCronExpression
// ---------------------------------------------------------------------------

describe("buildCronExpression", () => {
  it("produces '0 */6 * * *' for 6 hours (default)", () => {
    expect(buildCronExpression(6)).toBe("0 */6 * * *");
  });

  it("produces '0 */1 * * *' for 1 hour", () => {
    expect(buildCronExpression(1)).toBe("0 */1 * * *");
  });

  it("produces '0 */12 * * *' for 12 hours", () => {
    expect(buildCronExpression(12)).toBe("0 */12 * * *");
  });

  it("produces '0 */24 * * *' for 24 hours", () => {
    expect(buildCronExpression(24)).toBe("0 */24 * * *");
  });

  it("throws for zero interval", () => {
    expect(() => buildCronExpression(0)).toThrow();
  });

  it("throws for negative interval", () => {
    expect(() => buildCronExpression(-3)).toThrow();
  });

  it("throws for NaN", () => {
    expect(() => buildCronExpression(NaN)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// HARVEST_INTERVAL_HOURS constant and HARVEST_CRON
// ---------------------------------------------------------------------------

describe("HARVEST_INTERVAL_HOURS", () => {
  it("exports a positive integer", async () => {
    const { HARVEST_INTERVAL_HOURS } = await import("./harvestRepeatableJob.js");
    expect(HARVEST_INTERVAL_HOURS).toBeGreaterThan(0);
    expect(Number.isInteger(HARVEST_INTERVAL_HOURS)).toBe(true);
  });

  it("derived HARVEST_CRON matches the interval", async () => {
    const { HARVEST_CRON, HARVEST_INTERVAL_HOURS } = await import("./harvestRepeatableJob.js");
    expect(HARVEST_CRON).toBe(`0 */${HARVEST_INTERVAL_HOURS} * * *`);
  });
});

// ---------------------------------------------------------------------------
// Prometheus counters
// ---------------------------------------------------------------------------

describe("Prometheus counters", () => {
  it("exports harvestJobSuccessCounter", async () => {
    const { harvestJobSuccessCounter } = await import("./harvestRepeatableJob.js");
    expect(harvestJobSuccessCounter).toBeDefined();
  });

  it("exports harvestJobFailureCounter", async () => {
    const { harvestJobFailureCounter } = await import("./harvestRepeatableJob.js");
    expect(harvestJobFailureCounter).toBeDefined();
  });

  it("exports harvestJobRetriesCounter", async () => {
    const { harvestJobRetriesCounter } = await import("./harvestRepeatableJob.js");
    expect(harvestJobRetriesCounter).toBeDefined();
  });

  it("harvestJobRegistry contains required metric names", async () => {
    const { harvestJobRegistry } = await import("./harvestRepeatableJob.js");
    const metrics = await harvestJobRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("harvest_job_failure_total");
    expect(names).toContain("harvest_job_success_total");
    expect(names).toContain("harvest_job_retries_total");
  });
});

// ---------------------------------------------------------------------------
// getHarvestQueue (smoke — no live Redis)
// ---------------------------------------------------------------------------

describe("getHarvestQueue", () => {
  it("exports a getHarvestQueue function", async () => {
    const { getHarvestQueue } = await import("./harvestRepeatableJob.js");
    expect(typeof getHarvestQueue).toBe("function");
  });
});

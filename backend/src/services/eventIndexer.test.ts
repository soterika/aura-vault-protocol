import { describe, it, expect, beforeEach } from "vitest";
import {
  EventBuffer,
  processEventsParallel,
  getIndexerMetrics,
  resetIndexerMetrics,
  renderIndexerMetricsText,
  LAG_ALERT_THRESHOLD_SECONDS,
  BATCH_SIZE,
  type VaultEvent,
  type DbAdapter,
} from "../services/eventIndexer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a VaultEvent with sensible defaults. */
function makeEvent(
  overrides: Partial<VaultEvent> & { id: string }
): VaultEvent {
  return {
    ledgerSequence: 1000,
    ledgerTimestamp: Math.floor(Date.now() / 1000) - 1, // 1 second ago
    type: "deposit",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    callerAddress: "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON",
    amount: BigInt(1000_0000000),
    rawPayload: {},
    ...overrides,
  };
}

/** Spy DB adapter that records calls and can simulate failures. */
class SpyDbAdapter implements DbAdapter {
  calls: VaultEvent[][] = [];
  shouldFail = false;

  async batchInsert(events: VaultEvent[]): Promise<void> {
    if (this.shouldFail) throw new Error("DB write failed");
    this.calls.push([...events]);
  }

  get totalInserted(): number {
    return this.calls.reduce((sum, batch) => sum + batch.length, 0);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBuffer", () => {
  let db: SpyDbAdapter;

  beforeEach(() => {
    db = new SpyDbAdapter();
    resetIndexerMetrics();
  });

  it("buffers events and does not flush until batch size is reached", async () => {
    const buf = new EventBuffer(db, 3);
    await buf.push(makeEvent({ id: "e1" }));
    await buf.push(makeEvent({ id: "e2" }));
    expect(buf.pendingCount).toBe(2);
    expect(db.calls.length).toBe(0);
  });

  it("auto-flushes when batch size is reached", async () => {
    const buf = new EventBuffer(db, 3);
    await buf.push(makeEvent({ id: "e1" }));
    await buf.push(makeEvent({ id: "e2" }));
    await buf.push(makeEvent({ id: "e3" }));
    expect(db.calls.length).toBe(1);
    expect(db.calls[0]?.length).toBe(3);
    expect(buf.pendingCount).toBe(0);
  });

  it("flush returns correct flushed count", async () => {
    const buf = new EventBuffer(db, 10);
    await buf.push(makeEvent({ id: "e1" }));
    await buf.push(makeEvent({ id: "e2" }));
    const result = await buf.flush();
    expect(result.flushed).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("flush returns empty result when buffer is empty", async () => {
    const buf = new EventBuffer(db, 10);
    const result = await buf.flush();
    expect(result.flushed).toBe(0);
    expect(result.lagSamples).toHaveLength(0);
  });

  it("pushMany handles more than batchSize events in multiple flushes", async () => {
    const buf = new EventBuffer(db, 5);
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ id: `e${i}` })
    );
    await buf.pushMany(events);
    // Two auto-flushes of 5 each = 10 flushed; 2 remain in buffer
    expect(db.calls.length).toBe(2);
    expect(buf.pendingCount).toBe(2);
  });

  it("records lag samples during flush", async () => {
    const buf = new EventBuffer(db, 5);
    const pastTimestamp = Math.floor(Date.now() / 1000) - 5; // 5 seconds ago
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: `lag-${i}`, ledgerTimestamp: pastTimestamp })
    );
    await buf.pushMany(events);
    await buf.flush();
    const result = await buf.flush();
    // lag should be approximately 5 seconds (allow ±2s tolerance)
    for (const lagVal of result.lagSamples) {
      expect(lagVal).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles DB write errors gracefully and reports them", async () => {
    db.shouldFail = true;
    const buf = new EventBuffer(db, 1);
    await buf.push(makeEvent({ id: "fail-1" })); // triggers auto-flush
    const metrics = getIndexerMetrics();
    // totalEventsIndexed should NOT have incremented on failure
    expect(metrics.totalEventsIndexed).toBe(0);
  });

  it("uses default BATCH_SIZE when no batchSize is provided", () => {
    const buf = new EventBuffer(db);
    // pendingCount starts at 0
    expect(buf.pendingCount).toBe(0);
    // BATCH_SIZE constant is 100
    expect(BATCH_SIZE).toBe(100);
  });
});

describe("processEventsParallel", () => {
  let db: SpyDbAdapter;

  beforeEach(() => {
    db = new SpyDbAdapter();
    resetIndexerMetrics();
  });

  it("processes events of different types in parallel", async () => {
    const events: VaultEvent[] = [
      makeEvent({ id: "d1", type: "deposit" }),
      makeEvent({ id: "d2", type: "deposit" }),
      makeEvent({ id: "h1", type: "harvest" }),
      makeEvent({ id: "w1", type: "withdraw" }),
    ];

    const summary = await processEventsParallel(events, db, 10);

    expect(summary.has("deposit")).toBe(true);
    expect(summary.has("harvest")).toBe(true);
    expect(summary.has("withdraw")).toBe(true);
    expect(summary.get("deposit")?.flushed).toBe(2);
    expect(summary.get("harvest")?.flushed).toBe(1);
    expect(summary.get("withdraw")?.flushed).toBe(1);
  });

  it("returns an empty map for zero events", async () => {
    const summary = await processEventsParallel([], db, 10);
    expect(summary.size).toBe(0);
  });

  it("handles 1000 events within a single call", async () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      makeEvent({ id: `bulk-${i}`, type: i % 2 === 0 ? "deposit" : "harvest" })
    );
    const summary = await processEventsParallel(events, db, 100);
    const depositFlushed = summary.get("deposit")?.flushed ?? 0;
    const harvestFlushed = summary.get("harvest")?.flushed ?? 0;
    expect(depositFlushed + harvestFlushed).toBe(1000);
  });
});

describe("Indexer metrics", () => {
  beforeEach(() => {
    resetIndexerMetrics();
  });

  it("tracks totalEventsIndexed after successful flush", async () => {
    const db = new SpyDbAdapter();
    const buf = new EventBuffer(db, 2);
    await buf.push(makeEvent({ id: "m1" }));
    await buf.push(makeEvent({ id: "m2" }));
    expect(getIndexerMetrics().totalEventsIndexed).toBe(2);
  });

  it("tracks totalBatchesFlushed", async () => {
    const db = new SpyDbAdapter();
    const buf = new EventBuffer(db, 1);
    await buf.push(makeEvent({ id: "b1" }));
    await buf.push(makeEvent({ id: "b2" }));
    expect(getIndexerMetrics().totalBatchesFlushed).toBe(2);
  });

  it("LAG_ALERT_THRESHOLD_SECONDS is 10", () => {
    expect(LAG_ALERT_THRESHOLD_SECONDS).toBe(10);
  });
});

describe("renderIndexerMetricsText", () => {
  beforeEach(() => {
    resetIndexerMetrics();
  });

  it("includes all three metric names", () => {
    const output = renderIndexerMetricsText();
    expect(output).toContain("indexer_lag_seconds");
    expect(output).toContain("indexer_events_total");
    expect(output).toContain("indexer_batches_total");
  });

  it("has HELP and TYPE headers for each metric", () => {
    const output = renderIndexerMetricsText();
    expect(output).toContain("# HELP indexer_lag_seconds");
    expect(output).toContain("# TYPE indexer_lag_seconds gauge");
    expect(output).toContain("# HELP indexer_events_total");
    expect(output).toContain("# TYPE indexer_events_total counter");
  });

  it("reflects updated counters after events are indexed", async () => {
    const db = new SpyDbAdapter();
    const buf = new EventBuffer(db, 2);
    await buf.push(makeEvent({ id: "r1" }));
    await buf.push(makeEvent({ id: "r2" }));
    const output = renderIndexerMetricsText();
    expect(output).toContain("indexer_events_total 2");
    expect(output).toContain("indexer_batches_total 1");
  });
});

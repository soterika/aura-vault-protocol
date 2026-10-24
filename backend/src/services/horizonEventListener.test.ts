/**
 * Issue #468 — Integration tests for Horizon event stream listener
 *
 * Acceptance criteria:
 *  ✅ Mock Horizon SSE stream that delivers test events
 *  ✅ Test: deposit event parsed and stored in database
 *  ✅ Test: harvest event triggers cache invalidation
 *  ✅ Test: malformed event logged but does not crash
 *  ✅ Test: stream reconnect on disconnect (cursor preserved)
 *  ✅ Test: duplicate events not stored twice
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import {
  createHorizonEventListener,
  parseHorizonEvent,
  type RawHorizonEvent,
  type ParsedVaultEvent,
  type EventStore,
  type CacheInvalidator,
  type Logger,
  type HorizonSSESource,
} from "./horizonEventListener.js";

// ---------------------------------------------------------------------------
// Test helpers — mock SSE source
// ---------------------------------------------------------------------------

function makeRaw(overrides: Partial<RawHorizonEvent> = {}): RawHorizonEvent {
  return {
    id: "cursor-001",
    event: "contract_event",
    data: JSON.stringify({ type: "deposit", caller: "GABC123", amount: 1000, shares: 1000 }),
    ...overrides,
  };
}

function makeHarvestRaw(overrides: Partial<RawHorizonEvent> = {}): RawHorizonEvent {
  return {
    id: "cursor-002",
    event: "contract_event",
    data: JSON.stringify({ type: "harvest", caller: "GKEEPER", amount: 500 }),
    ...overrides,
  };
}

/** A controllable SSE source: call emit() to push messages, emitError() to simulate disconnect */
function makeMockSSESource(): {
  source: HorizonSSESource;
  emit: (raw: RawHorizonEvent) => void;
  emitError: (err?: Error) => void;
  connectCallCount: () => number;
  lastCursor: () => string;
} {
  let emitter: EventEmitter | null = null;
  let connectCount = 0;
  let lastSeenCursor = "0";

  const source: HorizonSSESource = {
    connect(cursor: string) {
      connectCount++;
      lastSeenCursor = cursor;
      emitter = new EventEmitter();
      return emitter;
    },
  };

  return {
    source,
    emit: (raw) => emitter?.emit("message", raw),
    emitError: (err = new Error("SSE disconnect")) => emitter?.emit("error", err),
    connectCallCount: () => connectCount,
    lastCursor: () => lastSeenCursor,
  };
}

/** Controllable in-memory event store */
function makeMockStore(): EventStore & { stored: ParsedVaultEvent[]; rejectNext: boolean } {
  const stored: ParsedVaultEvent[] = [];
  let rejectNext = false;
  const seenIds = new Set<string>();

  return {
    stored,
    rejectNext,
    async save(event) {
      if (rejectNext) throw new Error("DB write failure");
      if (seenIds.has(event.id)) return false; // duplicate
      seenIds.add(event.id);
      stored.push(event);
      return true;
    },
  };
}

function makeMockCache(): CacheInvalidator & { invalidationCount: number } {
  let invalidationCount = 0;
  return {
    get invalidationCount() { return invalidationCount; },
    async invalidateOnHarvest() { invalidationCount++; },
  };
}

function makeMockLogger(): Logger & {
  warns: Array<{ msg: string; meta: unknown }>;
  errors: Array<{ msg: string; meta: unknown }>;
} {
  const warns: Array<{ msg: string; meta: unknown }> = [];
  const errors: Array<{ msg: string; meta: unknown }> = [];
  return {
    warns,
    errors,
    warn(msg, meta) { warns.push({ msg, meta }); },
    error(msg, meta) { errors.push({ msg, meta }); },
    info() {},
  };
}

/** Flush the microtask queue so async handlers settle */
async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Unit tests for parseHorizonEvent
// ---------------------------------------------------------------------------

describe("parseHorizonEvent", () => {
  it("parses a well-formed deposit event", () => {
    const raw = makeRaw();
    const result = parseHorizonEvent(raw);
    expect(result.type).toBe("deposit");
    expect(result.caller).toBe("GABC123");
    expect(result.amount).toBe(1000);
    expect(result.shares).toBe(1000);
    expect(result.id).toBe("cursor-001");
  });

  it("parses a well-formed harvest event", () => {
    const raw = makeHarvestRaw();
    const result = parseHorizonEvent(raw);
    expect(result.type).toBe("harvest");
    expect(result.caller).toBe("GKEEPER");
    expect(result.amount).toBe(500);
  });

  it("parses snake_case unsuccessful-contract metadata", () => {
    const raw = makeHarvestRaw({
      data: JSON.stringify({ type: "harvest", in_successful_contract_call: false }),
    });
    expect(parseHorizonEvent(raw).inSuccessfulContractCall).toBe(false);
  });

  it("returns type=unknown for invalid JSON", () => {
    const raw = makeRaw({ data: "not-json{{{" });
    const result = parseHorizonEvent(raw);
    expect(result.type).toBe("unknown");
  });

  it("returns type=unknown for a JSON object with no type field", () => {
    const raw = makeRaw({ data: JSON.stringify({ foo: "bar" }) });
    expect(parseHorizonEvent(raw).type).toBe("unknown");
  });

  it("returns type=unknown for a non-vault event type string", () => {
    const raw = makeRaw({ data: JSON.stringify({ type: "transfer" }) });
    expect(parseHorizonEvent(raw).type).toBe("unknown");
  });

  it("preserves the raw event on every parse result", () => {
    const raw = makeRaw();
    expect(parseHorizonEvent(raw).raw).toBe(raw);
  });

  it("returns type=unknown for null JSON data", () => {
    const raw = makeRaw({ data: "null" });
    expect(parseHorizonEvent(raw).type).toBe("unknown");
  });

  it("returns type=unknown for an empty JSON object", () => {
    const raw = makeRaw({ data: "{}" });
    expect(parseHorizonEvent(raw).type).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Integration tests for the listener
// ---------------------------------------------------------------------------

describe("HorizonEventListener — deposit event parsed and stored", () => {
  it("stores a deposit event and does not invalidate cache", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();
    const cache = makeMockCache();
    const logger = makeMockLogger();

    const listener = createHorizonEventListener(source, store, cache, logger, {
      reconnectDelayMs: 60_000,
    });
    listener.start();

    emit(makeRaw());
    await flushPromises();

    expect(store.stored).toHaveLength(1);
    expect(store.stored[0].type).toBe("deposit");
    expect(store.stored[0].caller).toBe("GABC123");
    expect(store.stored[0].amount).toBe(1000);
    expect(cache.invalidationCount).toBe(0); // deposit must NOT invalidate cache

    listener.stop();
  });

  it("advances the cursor after receiving a deposit event", async () => {
    const mock = makeMockSSESource();
    const listener = createHorizonEventListener(
      mock.source, makeMockStore(), makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    expect(listener.getCursor()).toBe("0");
    mock.emit(makeRaw({ id: "cursor-042" }));
    await flushPromises();

    expect(listener.getCursor()).toBe("cursor-042");
    listener.stop();
  });
});

describe("HorizonEventListener — harvest event triggers cache invalidation", () => {
  it("calls cache.invalidateOnHarvest() exactly once per harvest event", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();
    const cache = makeMockCache();
    const logger = makeMockLogger();

    const listener = createHorizonEventListener(source, store, cache, logger, {
      reconnectDelayMs: 60_000,
    });
    listener.start();

    emit(makeHarvestRaw({ id: "h-001" }));
    await flushPromises();

    expect(store.stored).toHaveLength(1);
    expect(store.stored[0].type).toBe("harvest");
    expect(cache.invalidationCount).toBe(1);

    // A second harvest triggers a second invalidation
    emit(makeHarvestRaw({ id: "h-002" }));
    await flushPromises();

    expect(cache.invalidationCount).toBe(2);

    listener.stop();
  });

  it("skips reverted contract events without storing or invalidating cache", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();
    const cache = makeMockCache();
    const logger = makeMockLogger();
    const listener = createHorizonEventListener(source, store, cache, logger, {
      reconnectDelayMs: 60_000,
    });
    listener.start();

    emit(makeHarvestRaw({
      id: "reverted-harvest",
      data: JSON.stringify({
        type: "harvest",
        caller: "GKEEPER",
        amount: 500,
        inSuccessfulContractCall: false,
      }),
    }));
    await flushPromises();

    expect(store.stored).toHaveLength(0);
    expect(cache.invalidationCount).toBe(0);
    expect(logger.warns).toHaveLength(0);
    listener.stop();
  });

  it("does NOT invalidate cache on a deposit event", async () => {
    const { source, emit } = makeMockSSESource();
    const cache = makeMockCache();

    const listener = createHorizonEventListener(
      source, makeMockStore(), cache, makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();
    emit(makeRaw());
    await flushPromises();

    expect(cache.invalidationCount).toBe(0);
    listener.stop();
  });
});

describe("HorizonEventListener — malformed event logged but does not crash", () => {
  it("logs a warning and continues when JSON is invalid", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();
    const logger = makeMockLogger();

    const listener = createHorizonEventListener(
      source, store, makeMockCache(), logger,
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    // Send malformed event first
    emit(makeRaw({ id: "bad-001", data: "}{malformed" }));
    await flushPromises();

    // Store should be empty — malformed event is not stored
    expect(store.stored).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThanOrEqual(1);
    expect(logger.warns[0].msg).toMatch(/malformed|unknown/i);

    // Listener must still process subsequent valid events
    emit(makeRaw({ id: "good-001" }));
    await flushPromises();
    expect(store.stored).toHaveLength(1);
    expect(store.stored[0].type).toBe("deposit");

    listener.stop();
  });

  it("does not crash when data is valid JSON but missing type field", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();

    const listener = createHorizonEventListener(
      source, store, makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    emit(makeRaw({ id: "no-type", data: JSON.stringify({ foo: "bar" }) }));
    await flushPromises();

    expect(store.stored).toHaveLength(0); // unknown events are not stored

    listener.stop();
  });

  it("logs error and continues when store.save() throws", async () => {
    const { source, emit } = makeMockSSESource();
    const logger = makeMockLogger();

    // Store that always throws
    const throwingStore: EventStore = {
      async save() { throw new Error("DB down"); },
    };

    const listener = createHorizonEventListener(
      source, throwingStore, makeMockCache(), logger,
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    // Must not throw unhandled
    emit(makeRaw({ id: "fail-001" }));
    await flushPromises();

    expect(logger.errors.length).toBeGreaterThanOrEqual(1);
    expect(logger.errors[0].msg).toMatch(/store|fail/i);

    listener.stop();
  });
});

describe("HorizonEventListener — stream reconnect on disconnect (cursor preserved)", () => {
  it("reconnects when the SSE stream emits an error", async () => {
    vi.useFakeTimers();

    const mock = makeMockSSESource();
    const listener = createHorizonEventListener(
      mock.source, makeMockStore(), makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 100 }
    );
    listener.start();

    expect(mock.connectCallCount()).toBe(1);

    // Simulate disconnect
    mock.emitError(new Error("network timeout"));
    vi.advanceTimersByTime(200); // let back-off timer fire

    expect(mock.connectCallCount()).toBe(2);

    listener.stop();
    vi.useRealTimers();
  });

  it("preserves the cursor across reconnect", async () => {
    // Use real timers for this test; fake timers + async don't mix well here.
    const mock = makeMockSSESource();
    const listener = createHorizonEventListener(
      mock.source, makeMockStore(), makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 30 }
    );
    listener.start();

    // Emit a real message — the synchronous cursor update happens inside handleMessage
    mock.emit(makeRaw({ id: "cursor-999" }));
    // flushPromises lets the async handleMessage microtask run
    await flushPromises();
    expect(listener.getCursor()).toBe("cursor-999");

    // Simulate disconnect — reconnect is scheduled with setTimeout(30ms)
    mock.emitError();

    // Wait longer than reconnectDelayMs to let the reconnect fire
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Reconnect must have used the advanced cursor, not "0"
    expect(mock.lastCursor()).toBe("cursor-999");
    expect(mock.connectCallCount()).toBe(2);

    listener.stop();
  });

  it("applies exponential back-off on repeated disconnects", async () => {
    vi.useFakeTimers();

    const mock = makeMockSSESource();
    const listener = createHorizonEventListener(
      mock.source, makeMockStore(), makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 100, maxReconnectDelayMs: 3200 }
    );
    listener.start();

    // First reconnect after 100 ms
    mock.emitError();
    vi.advanceTimersByTime(100);
    expect(mock.connectCallCount()).toBe(2);

    // Second reconnect after 200 ms (doubled)
    mock.emitError();
    vi.advanceTimersByTime(200);
    expect(mock.connectCallCount()).toBe(3);

    listener.stop();
    vi.useRealTimers();
  });

  it("does not reconnect after stop() is called", async () => {
    vi.useFakeTimers();

    const mock = makeMockSSESource();
    const listener = createHorizonEventListener(
      mock.source, makeMockStore(), makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 50 }
    );
    listener.start();

    listener.stop();            // stop before disconnect
    mock.emitError();
    vi.advanceTimersByTime(200);

    expect(mock.connectCallCount()).toBe(1); // no reconnect
    vi.useRealTimers();
  });
});

describe("HorizonEventListener — duplicate events not stored twice", () => {
  it("stores an event only once when the same SSE id is received twice", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();
    const cache = makeMockCache();

    const listener = createHorizonEventListener(
      source, store, cache, makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    const raw = makeRaw({ id: "dup-001" });
    emit(raw);
    await flushPromises();
    emit(raw); // duplicate
    await flushPromises();

    expect(store.stored).toHaveLength(1);
    listener.stop();
  });

  it("stores two distinct events when ids differ", async () => {
    const { source, emit } = makeMockSSESource();
    const store = makeMockStore();

    const listener = createHorizonEventListener(
      source, store, makeMockCache(), makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    emit(makeRaw({ id: "evt-001" }));
    emit(makeRaw({ id: "evt-002" }));
    await flushPromises();

    expect(store.stored).toHaveLength(2);
    listener.stop();
  });

  it("does not trigger cache invalidation for a duplicate harvest", async () => {
    const { source, emit } = makeMockSSESource();
    const cache = makeMockCache();

    const listener = createHorizonEventListener(
      source, makeMockStore(), cache, makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    const harvestRaw = makeHarvestRaw({ id: "harvest-dup-001" });
    emit(harvestRaw);
    await flushPromises();
    emit(harvestRaw); // duplicate
    await flushPromises();

    expect(cache.invalidationCount).toBe(1); // only the first delivery triggers invalidation
    listener.stop();
  });

  it("counts store.save returning false as a duplicate (no cache invalidation)", async () => {
    const { source, emit } = makeMockSSESource();
    const cache = makeMockCache();

    // Store that always reports duplicate
    const dupStore: EventStore = { async save() { return false; } };

    const listener = createHorizonEventListener(
      source, dupStore, cache, makeMockLogger(),
      { reconnectDelayMs: 60_000 }
    );
    listener.start();

    emit(makeHarvestRaw({ id: "dup-harvest" }));
    await flushPromises();

    expect(cache.invalidationCount).toBe(0); // duplicate harvest → no invalidation
    listener.stop();
  });
});

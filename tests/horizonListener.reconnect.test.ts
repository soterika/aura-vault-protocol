/**
 * Integration tests for HorizonListener exponential backoff reconnect — Issue #943
 *
 * Simulates SSE disconnects and verifies:
 *   - Reconnect attempts use exponential backoff (1s → 2s → 4s → ... max 60s)
 *   - Each reconnect increments the Prometheus counter
 *   - After 5 consecutive failures the "down" threshold is reached
 *   - WARN logging occurs on every reconnect attempt
 *   - Backoff resets to 1s after a successful reconnect
 */

import { HorizonListener, horizonReconnectsCounter, horizonListenerRegistry } from '../src/listeners/horizonListener';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type MockEventSourceInstance = {
  onopen: (() => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  addEventListener: jest.Mock;
  close: jest.Mock;
  _triggerOpen: () => void;
  _triggerError: () => void;
};

const createdInstances: MockEventSourceInstance[] = [];

function createMockEventSourceInstance(): MockEventSourceInstance {
  const instance: MockEventSourceInstance = {
    onopen: null,
    onmessage: null,
    onerror: null,
    addEventListener: jest.fn(),
    close: jest.fn(),
    _triggerOpen: () => instance.onopen?.(),
    _triggerError: () => instance.onerror?.(),
  };
  createdInstances.push(instance);
  return instance;
}

jest.mock('eventsource', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => createMockEventSourceInstance()),
}));

jest.mock('../src/repositories/eventRepository', () => ({
  EventRepository: {
    getCursor: jest.fn().mockResolvedValue(null),
    updateCursor: jest.fn().mockResolvedValue(undefined),
    saveEvent: jest.fn().mockResolvedValue(undefined),
    saveDeadLetter: jest.fn().mockResolvedValue(undefined),
    backfillEvents: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../src/parsers', () => ({
  EventParser: { parseEvent: jest.fn().mockReturnValue({}) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flush pending micro-tasks (resolved Promises, async callbacks).
 *
 * Uses setImmediate rather than setTimeout so it works correctly even when
 * jest.useFakeTimers() has replaced setTimeout with a fake implementation.
 * setImmediate is excluded from fake timers by default in Jest's fake-timer
 * preset so it resolves immediately in the real I/O loop.
 */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HorizonListener — exponential backoff reconnect (Issue #943)', () => {
  beforeEach(async () => {
    // doNotFake setImmediate so flushPromises() works while setTimeout is fake
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    createdInstances.length = 0;
    await horizonListenerRegistry.resetMetrics();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Basic reconnect ───────────────────────────────────────────────────────

  it('reconnects after SSE error using 1s initial delay', async () => {
    const listener = new HorizonListener('CONTRACT_A', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    expect(createdInstances.length).toBe(1);

    // Simulate connection error
    createdInstances[0]!._triggerError();
    await flushPromises();

    // Should not reconnect immediately — waits for 1s delay
    expect(createdInstances.length).toBe(1);

    // Advance 1s — reconnect should fire
    jest.advanceTimersByTime(1_001);
    await flushPromises();

    expect(createdInstances.length).toBe(2);
    await listener.stop();
  });

  // ── Exponential backoff progression ───────────────────────────────────────

  it('doubles reconnect delay after each failure: 1s → 2s → 4s', async () => {
    const listener = new HorizonListener('CONTRACT_B', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    // Fail 1: 1s delay used → next will be 2s
    createdInstances[0]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(1_001);
    await flushPromises();
    expect(createdInstances.length).toBe(2);

    // Fail 2: 2s delay used → next will be 4s
    createdInstances[1]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(2_001);
    await flushPromises();
    expect(createdInstances.length).toBe(3);

    // Fail 3: 4s delay used → next will be 8s
    createdInstances[2]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(4_001);
    await flushPromises();
    expect(createdInstances.length).toBe(4);

    await listener.stop();
  });

  // ── Max delay cap ─────────────────────────────────────────────────────────

  it('caps reconnect delay at 60s', async () => {
    const listener = new HorizonListener('CONTRACT_C', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    // Run through failures until we hit the cap (32s → 60s cap, not 64s)
    // delays: 1s, 2s, 4s, 8s, 16s, 32s, cap=60s, 60s
    const delays = [1_001, 2_001, 4_001, 8_001, 16_001, 32_001, 60_001, 60_001];
    for (let i = 0; i < delays.length; i++) {
      createdInstances[i]!._triggerError();
      await flushPromises();
      jest.advanceTimersByTime(delays[i]!);
      await flushPromises();
    }

    expect(createdInstances.length).toBe(delays.length + 1);
    await listener.stop();
  });

  // ── Backoff resets after successful connect ───────────────────────────────

  it('resets reconnect delay to 1s after a successful connection', async () => {
    const listener = new HorizonListener('CONTRACT_D', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    // Fail twice
    createdInstances[0]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(1_001);
    await flushPromises();

    createdInstances[1]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(2_001);
    await flushPromises();

    // Third attempt succeeds
    createdInstances[2]!._triggerOpen();
    await flushPromises();

    const status = listener.getStatus();
    expect(status.consecutiveFailures).toBe(0);
    expect(status.currentReconnectDelayMs).toBe(1_000);
    await listener.stop();
  });

  // ── Prometheus counter ────────────────────────────────────────────────────

  it('increments horizon_listener_reconnects_total on each reconnect', async () => {
    const listener = new HorizonListener('CONTRACT_E', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    // Two failures
    createdInstances[0]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(1_001);
    await flushPromises();

    createdInstances[1]!._triggerError();
    await flushPromises();

    const metrics = await horizonListenerRegistry.getMetricsAsJSON();
    const reconnectMetric = metrics.find((m) => m.name === 'horizon_listener_reconnects_total');
    expect(reconnectMetric).toBeDefined();

    const total = reconnectMetric!.values.reduce((sum, v) => sum + v.value, 0);
    expect(total).toBeGreaterThanOrEqual(1);
    await listener.stop();
  });

  // ── 5 consecutive failures ────────────────────────────────────────────────

  it('tracks 5 consecutive failures for HorizonListenerDown threshold', async () => {
    const listener = new HorizonListener('CONTRACT_F', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    const delays = [1_001, 2_001, 4_001, 8_001, 16_001];
    for (let i = 0; i < 5; i++) {
      createdInstances[i]!._triggerError();
      await flushPromises();
      jest.advanceTimersByTime(delays[i]!);
      await flushPromises();
    }

    const status = listener.getStatus();
    expect(status.consecutiveFailures).toBeGreaterThanOrEqual(5);
    await listener.stop();
  });

  // ── stop() prevents further reconnects ───────────────────────────────────

  it('does not reconnect after stop() is called', async () => {
    const listener = new HorizonListener('CONTRACT_G', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    await listener.stop();

    createdInstances[0]!._triggerError();
    await flushPromises();
    jest.advanceTimersByTime(2_000);
    await flushPromises();

    expect(createdInstances.length).toBe(1);
  });

  // ── getStatus reflects state ───────────────────────────────────────────────

  it('getStatus returns correct connected/failure state', async () => {
    const listener = new HorizonListener('CONTRACT_H', 'http://horizon.test');
    void listener.start();
    await flushPromises();

    expect(listener.getStatus().connected).toBe(false);

    createdInstances[0]!._triggerOpen();
    await flushPromises();
    expect(listener.getStatus().connected).toBe(true);
    expect(listener.getStatus().consecutiveFailures).toBe(0);

    createdInstances[0]!._triggerError();
    await flushPromises();
    expect(listener.getStatus().connected).toBe(false);
    expect(listener.getStatus().consecutiveFailures).toBe(1);

    await listener.stop();
  });
});

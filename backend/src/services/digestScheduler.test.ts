import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks must be declared before imports ─────────────────────────────────────

vi.mock('./emailService.js', () => ({
  isBlocked: vi.fn(),
}));

vi.mock('./emailQueue.js', () => ({
  enqueueEmail: vi.fn(),
}));

vi.mock('./userPreferencesService.js', () => ({
  getUserPreferences: vi.fn(),
}));

// ── Now import the modules under test ─────────────────────────────────────────

import {
  msUntilNext0800UTC,
  sendDigestToRecipient,
  startDigestScheduler,
  stopDigestScheduler,
  isDigestSchedulerRunning,
  type DigestRecipient,
} from './digestScheduler.js';

import { isBlocked } from './emailService.js';
import { enqueueEmail } from './emailQueue.js';
import { getUserPreferences } from './userPreferencesService.js';

// Typed mocks
const mockIsBlocked = vi.mocked(isBlocked);
const mockEnqueueEmail = vi.mocked(enqueueEmail);
const mockGetUserPreferences = vi.mocked(getUserPreferences);

// ── Shared fixture ────────────────────────────────────────────────────────────

const baseRecipient: DigestRecipient = {
  address:      'GABC123',
  email:        'user@example.com',
  currentValue: '1500.00',
  asset:        'USDC',
  change24h:    '25.00',
  changeSign:   '+',
  accruedYield: '3.50',
  lastHarvest:  '2026-08-28 07:00 UTC',
};

// ── msUntilNext0800UTC ────────────────────────────────────────────────────────

describe('msUntilNext0800UTC', () => {
  it('returns positive ms when called before 08:00 UTC', () => {
    // 06:30 UTC — 08:00 is 1.5 hours away
    const now = new Date('2026-08-29T06:30:00.000Z');
    const ms = msUntilNext0800UTC(now);
    expect(ms).toBeGreaterThan(0);
    // Expected: 5400000 ms (1.5 hours)
    expect(ms).toBe(5400_000);
  });

  it('returns ms to next-day 08:00 UTC when called at exactly 08:00 UTC', () => {
    // Exactly 08:00 UTC — should point to next day
    const now = new Date('2026-08-29T08:00:00.000Z');
    const ms = msUntilNext0800UTC(now);
    // Should be ~24 hours worth of ms (minus up to a few ms jitter from Math.max)
    expect(ms).toBeGreaterThanOrEqual(24 * 60 * 60 * 1_000 - 1_000);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1_000 + 1_000);
  });

  it('returns ms to next-day 08:00 UTC when called after 08:00 UTC', () => {
    // 14:39 UTC — next 08:00 is ~17h 21m away
    const now = new Date('2026-08-29T14:39:20.000Z');
    const ms = msUntilNext0800UTC(now);
    // 08:00 next day = 2026-08-30T08:00:00Z
    const expected = new Date('2026-08-30T08:00:00.000Z').getTime() - now.getTime();
    expect(ms).toBe(expected);
  });

  it('returns at least 1000 ms (never schedules in the past)', () => {
    const now = new Date('2026-08-29T07:59:59.999Z');
    const ms = msUntilNext0800UTC(now);
    expect(ms).toBeGreaterThanOrEqual(1_000);
  });

  it('returns positive ms well before 08:00 UTC (midnight)', () => {
    const now = new Date('2026-08-29T00:00:00.000Z');
    const ms = msUntilNext0800UTC(now);
    expect(ms).toBe(8 * 60 * 60 * 1_000); // exactly 8 hours
  });
});

// ── sendDigestToRecipient ─────────────────────────────────────────────────────

describe('sendDigestToRecipient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not blocked, email notifications on
    mockIsBlocked.mockResolvedValue({ blocked: false });
    mockGetUserPreferences.mockResolvedValue({
      address:            baseRecipient.address,
      currency:           'USD',
      language:           'en',
      emailNotifications: true,
      harvestAlerts:      true,
    });
    mockEnqueueEmail.mockResolvedValue('mock-job-id');
  });

  it('skips when currentValue is "0"', async () => {
    await sendDigestToRecipient({ ...baseRecipient, currentValue: '0' });
    expect(mockIsBlocked).not.toHaveBeenCalled();
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('skips when currentValue is "0.00"', async () => {
    await sendDigestToRecipient({ ...baseRecipient, currentValue: '0.00' });
    expect(mockIsBlocked).not.toHaveBeenCalled();
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('skips when email is blocked (unsubscribed)', async () => {
    mockIsBlocked.mockResolvedValue({ blocked: true, reason: 'unsubscribed' });
    await sendDigestToRecipient(baseRecipient);
    expect(mockIsBlocked).toHaveBeenCalledWith(baseRecipient.email);
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('skips when email is blocked (hard-bounce)', async () => {
    mockIsBlocked.mockResolvedValue({ blocked: true, reason: 'hard-bounce' });
    await sendDigestToRecipient(baseRecipient);
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('skips when emailNotifications preference is false', async () => {
    mockGetUserPreferences.mockResolvedValue({
      address:            baseRecipient.address,
      currency:           'USD',
      language:           'en',
      emailNotifications: false,
      harvestAlerts:      true,
    });
    await sendDigestToRecipient(baseRecipient);
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('enqueues the email when all checks pass', async () => {
    await sendDigestToRecipient(baseRecipient);

    expect(mockIsBlocked).toHaveBeenCalledWith(baseRecipient.email);
    expect(mockGetUserPreferences).toHaveBeenCalledWith(baseRecipient.address);
    expect(mockEnqueueEmail).toHaveBeenCalledOnce();

    const call = mockEnqueueEmail.mock.calls[0][0];
    expect(call.to).toBe(baseRecipient.email);
    expect(call.template).toBe('portfolio-digest');
    expect(call.data).toMatchObject({
      walletAddress: baseRecipient.address,
      currentValue:  baseRecipient.currentValue,
      asset:         baseRecipient.asset,
      change24h:     baseRecipient.change24h,
      changeSign:    baseRecipient.changeSign,
      accruedYield:  baseRecipient.accruedYield,
      lastHarvest:   baseRecipient.lastHarvest,
    });
    expect(call.priority).toBe('low');
  });

  it('enqueues with negative changeSign correctly', async () => {
    const recipient: DigestRecipient = {
      ...baseRecipient,
      change24h:  '10.00',
      changeSign: '-',
    };
    await sendDigestToRecipient(recipient);
    const call = mockEnqueueEmail.mock.calls[0][0];
    expect(call.data.changeSign).toBe('-');
  });
});

// ── startDigestScheduler / stopDigestScheduler ─────────────────────────────────

describe('startDigestScheduler / stopDigestScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure scheduler is stopped before each test
    stopDigestScheduler();
    vi.clearAllMocks();
    mockIsBlocked.mockResolvedValue({ blocked: false });
    mockGetUserPreferences.mockResolvedValue({
      address:            baseRecipient.address,
      currency:           'USD',
      language:           'en',
      emailNotifications: true,
      harvestAlerts:      true,
    });
    mockEnqueueEmail.mockResolvedValue('job-id');
  });

  afterEach(() => {
    stopDigestScheduler();
    vi.useRealTimers();
  });

  it('isDigestSchedulerRunning() returns false before start', () => {
    expect(isDigestSchedulerRunning()).toBe(false);
  });

  it('isDigestSchedulerRunning() returns true after startDigestScheduler()', () => {
    startDigestScheduler(async () => []);
    expect(isDigestSchedulerRunning()).toBe(true);
  });

  it('isDigestSchedulerRunning() returns false after stopDigestScheduler()', () => {
    startDigestScheduler(async () => []);
    expect(isDigestSchedulerRunning()).toBe(true);
    stopDigestScheduler();
    expect(isDigestSchedulerRunning()).toBe(false);
  });

  it('calling startDigestScheduler twice is a no-op (stays running)', () => {
    startDigestScheduler(async () => []);
    startDigestScheduler(async () => []);
    expect(isDigestSchedulerRunning()).toBe(true);
  });

  it('calling stopDigestScheduler when not running is safe', () => {
    expect(() => stopDigestScheduler()).not.toThrow();
    expect(isDigestSchedulerRunning()).toBe(false);
  });

  it('runs immediately when runImmediately is true', async () => {
    const loader = vi.fn().mockResolvedValue([]);
    startDigestScheduler(loader, { runImmediately: true, intervalMs: 999_999_999 });

    // Flush the microtask queue so the async tick completes
    // (the loader mock resolves immediately, so a few ticks suffice)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(loader).toHaveBeenCalled();
  });

  it('does not run immediately when runImmediately is false (default)', () => {
    const loader = vi.fn().mockResolvedValue([]);
    startDigestScheduler(loader, { intervalMs: 999_999_999 });
    expect(loader).not.toHaveBeenCalled();
  });

  it('fires the tick after intervalMs when not running immediately', async () => {
    const loader = vi.fn().mockResolvedValue([]);
    startDigestScheduler(loader, { runImmediately: false, intervalMs: 5_000 });

    expect(loader).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_001);
    expect(loader).toHaveBeenCalledOnce();
  });
});

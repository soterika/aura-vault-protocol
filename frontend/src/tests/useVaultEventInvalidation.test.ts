/**
 * Regression tests for useVaultEventInvalidation burst coalescing (Issue #1463).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createVaultInvalidationCoalescer,
  extractVaultIdFromEvent,
} from "@/lib/useVaultEventInvalidation";

describe("extractVaultIdFromEvent", () => {
  it("extracts vaultId or vault from JSON payloads", () => {
    expect(extractVaultIdFromEvent({ data: '{"vaultId":"vault-a"}' })).toBe("vault-a");
    expect(extractVaultIdFromEvent({ data: '{"vault":"vault-b"}' })).toBe("vault-b");
  });

  it("falls back to 'default' for empty or non-JSON payloads", () => {
    expect(extractVaultIdFromEvent({ data: "" })).toBe("default");
    expect(extractVaultIdFromEvent({ data: "ping" })).toBe("default");
  });
});

describe("createVaultInvalidationCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces repeated events across two vaults to one refresh per vault per window", () => {
    const onInvalidate = vi.fn();
    const coalescer = createVaultInvalidationCoalescer(onInvalidate, 200);

    // Burst of events across vault-a and vault-b
    coalescer.schedule("vault-a", false);
    coalescer.schedule("vault-a", true);
    coalescer.schedule("vault-a", false);
    coalescer.schedule("vault-b", false);
    coalescer.schedule("vault-b", false);

    expect(coalescer.pendingCount()).toBe(2);
    expect(onInvalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate).toHaveBeenCalledWith("vault-a", true);
    expect(onInvalidate).toHaveBeenCalledWith("vault-b", false);
    expect(coalescer.pendingCount()).toBe(0);

    // Next window triggers a fresh cycle
    coalescer.schedule("vault-a", false);
    vi.advanceTimersByTime(200);
    expect(onInvalidate).toHaveBeenCalledTimes(3);
    expect(onInvalidate).toHaveBeenLastCalledWith("vault-a", false);
  });

  it("cancels pending invalidations without invoking callback", () => {
    const onInvalidate = vi.fn();
    const coalescer = createVaultInvalidationCoalescer(onInvalidate, 200);

    coalescer.schedule("vault-a", true);
    coalescer.cancel();
    vi.advanceTimersByTime(500);

    expect(onInvalidate).not.toHaveBeenCalled();
    expect(coalescer.pendingCount()).toBe(0);
  });
});

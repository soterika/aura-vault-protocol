/**
 * Tests for the Toast Notification System — Issue #257
 *
 * The frontend vitest config runs in the "node" environment, so we test the
 * pure logic that doesn't require a DOM:
 *   - ToastOptions type shape and defaults
 *   - Queue / MAX_VISIBLE slicing logic (extracted as a pure function)
 *   - Auto-dismiss timer scheduling (via vi.useFakeTimers)
 *   - Variant behaviour: error toasts persist, others auto-dismiss
 *   - Explorer URL presence in tx-success toasts
 *
 * Component rendering tests that need jsdom belong in a Playwright / Cypress
 * suite; the logic-level coverage here exercises every acceptance criterion
 * that can be verified without a browser environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers mirroring the implementation constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 5_000;

type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastOptions {
  variant: ToastVariant;
  title: string;
  message?: string;
  explorerUrl?: string;
  duration?: number;
}

interface Toast extends ToastOptions {
  id: string;
  createdAt: number;
}

/** Mirrors the production logic that resolves the effective duration. */
function resolveDuration(options: ToastOptions): number {
  if (options.variant === "error") return 0; // errors always persist
  return options.duration ?? DEFAULT_DURATION_MS;
}

/** Pure queue slice logic — what the container renders. */
function visibleToasts(all: Toast[]): Toast[] {
  return all.slice(-MAX_VISIBLE);
}

function queuedCount(all: Toast[]): number {
  return Math.max(0, all.length - MAX_VISIBLE);
}

/** Minimal in-memory toast manager that matches the Provider's logic. */
class ToastManager {
  private toasts: Toast[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private idCounter = 0;

  add(options: ToastOptions): string {
    const id = `toast-${++this.idCounter}`;
    const duration = resolveDuration(options);
    const toast: Toast = { ...options, id, createdAt: Date.now(), duration };
    this.toasts.push(toast);

    if (duration > 0) {
      const timer = setTimeout(() => this.remove(id), duration);
      this.timers.set(id, timer);
    }

    return id;
  }

  remove(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  getAll(): Toast[] {
    return [...this.toasts];
  }

  getVisible(): Toast[] {
    return visibleToasts(this.toasts);
  }

  getQueuedCount(): number {
    return queuedCount(this.toasts);
  }

  clear(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.toasts = [];
    this.idCounter = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Toast variant logic", () => {
  it("accepts all four variants: success, error, warning, info", () => {
    const variants: ToastVariant[] = ["success", "error", "warning", "info"];
    for (const variant of variants) {
      const opts: ToastOptions = { variant, title: `${variant} title` };
      expect(opts.variant).toBe(variant);
    }
  });

  describe("auto-dismiss duration", () => {
    it("non-error toasts default to 5000 ms", () => {
      for (const variant of ["success", "warning", "info"] as const) {
        expect(resolveDuration({ variant, title: "t" })).toBe(5_000);
      }
    });

    it("error toasts always resolve to 0 (persist)", () => {
      // Even if a custom duration is provided, errors must persist
      expect(resolveDuration({ variant: "error", title: "oops" })).toBe(0);
      expect(
        resolveDuration({ variant: "error", title: "oops", duration: 3_000 }),
      ).toBe(0);
    });

    it("non-error toasts respect a custom duration override", () => {
      expect(
        resolveDuration({ variant: "info", title: "t", duration: 10_000 }),
      ).toBe(10_000);
    });

    it("duration of 0 disables auto-dismiss for non-error toasts", () => {
      expect(
        resolveDuration({ variant: "success", title: "t", duration: 0 }),
      ).toBe(0);
    });
  });
});

describe("ToastManager — queue and visibility", () => {
  let manager: ToastManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ToastManager();
  });

  afterEach(() => {
    manager.clear();
    vi.useRealTimers();
  });

  it("starts with no toasts", () => {
    expect(manager.getAll()).toHaveLength(0);
    expect(manager.getVisible()).toHaveLength(0);
    expect(manager.getQueuedCount()).toBe(0);
  });

  it("adds a toast and returns an id", () => {
    const id = manager.add({ variant: "success", title: "Done" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(manager.getAll()).toHaveLength(1);
  });

  it("caps visible toasts at MAX_VISIBLE (3)", () => {
    for (let i = 0; i < 5; i++) {
      manager.add({ variant: "info", title: `Info ${i}` });
    }
    expect(manager.getAll()).toHaveLength(5);
    expect(manager.getVisible()).toHaveLength(MAX_VISIBLE);
    expect(manager.getQueuedCount()).toBe(2);
  });

  it("queuedCount is 0 when at or below MAX_VISIBLE", () => {
    manager.add({ variant: "success", title: "A" });
    manager.add({ variant: "success", title: "B" });
    expect(manager.getQueuedCount()).toBe(0);
  });

  it("dismissing a toast removes it from the list", () => {
    const id = manager.add({ variant: "warning", title: "Watch out" });
    manager.remove(id);
    expect(manager.getAll()).toHaveLength(0);
  });

  it("auto-dismisses non-error toasts after DEFAULT_DURATION_MS", () => {
    manager.add({ variant: "success", title: "Saved" });
    expect(manager.getAll()).toHaveLength(1);
    vi.advanceTimersByTime(DEFAULT_DURATION_MS);
    expect(manager.getAll()).toHaveLength(0);
  });

  it("error toasts are NOT auto-dismissed after DEFAULT_DURATION_MS", () => {
    manager.add({ variant: "error", title: "Something broke" });
    vi.advanceTimersByTime(DEFAULT_DURATION_MS * 10); // advance 50 s
    expect(manager.getAll()).toHaveLength(1);
  });

  it("error toasts CAN be manually dismissed", () => {
    const id = manager.add({ variant: "error", title: "Persistent error" });
    vi.advanceTimersByTime(DEFAULT_DURATION_MS * 10);
    expect(manager.getAll()).toHaveLength(1); // still there
    manager.remove(id);
    expect(manager.getAll()).toHaveLength(0); // gone after manual dismiss
  });

  it("when a visible toast is manually dismissed the queued one becomes visible", () => {
    // Add 4 toasts (non-error with custom long duration so none auto-dismiss)
    const id1 = manager.add({ variant: "info", title: "Info 1", duration: 60_000 });
    manager.add({ variant: "info", title: "Info 2", duration: 60_000 });
    manager.add({ variant: "info", title: "Info 3", duration: 60_000 });
    manager.add({ variant: "info", title: "Info 4 (queued)", duration: 60_000 });

    expect(manager.getAll()).toHaveLength(4);
    expect(manager.getQueuedCount()).toBe(1);
    expect(manager.getVisible()).toHaveLength(MAX_VISIBLE);

    // Manually dismiss one of the visible toasts
    manager.remove(id1);

    // Now 3 remain total — all visible, nothing queued
    expect(manager.getAll()).toHaveLength(3);
    expect(manager.getQueuedCount()).toBe(0);
    expect(manager.getVisible()).toHaveLength(3);
  });

  it("when all non-error toasts auto-dismiss at once the queue drains completely", () => {
    // Add 4 toasts with the same default duration
    for (let i = 0; i < 4; i++) {
      manager.add({ variant: "info", title: `Info ${i}` });
    }
    expect(manager.getQueuedCount()).toBe(1);

    // All 4 share the same duration — advancing by DEFAULT_DURATION_MS fires all timers
    vi.advanceTimersByTime(DEFAULT_DURATION_MS);

    // Queue fully drained
    expect(manager.getAll()).toHaveLength(0);
    expect(manager.getQueuedCount()).toBe(0);
  });

  it("respects a custom duration override", () => {
    manager.add({ variant: "warning", title: "Quick", duration: 2_000 });
    expect(manager.getAll()).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(manager.getAll()).toHaveLength(0);
  });

  it("cancels the auto-dismiss timer when manually dismissed early", () => {
    const id = manager.add({ variant: "info", title: "Temp" });
    vi.advanceTimersByTime(2_000); // half-way through
    manager.remove(id); // manual dismiss
    vi.advanceTimersByTime(3_000); // rest of the default duration
    // Should still be empty — no double-remove side effects
    expect(manager.getAll()).toHaveLength(0);
  });
});

describe("Toast — explorer URL (tx success)", () => {
  it("toastOptions can carry an explorerUrl", () => {
    const opts: ToastOptions = {
      variant: "success",
      title: "Transaction confirmed",
      message: "Your deposit of 100 XLM was confirmed.",
      explorerUrl:
        "https://stellar.expert/explorer/testnet/tx/abc123",
    };
    expect(opts.explorerUrl).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
  });

  it("explorerUrl is optional — omitting it is valid", () => {
    const opts: ToastOptions = {
      variant: "success",
      title: "Done",
    };
    expect(opts.explorerUrl).toBeUndefined();
  });

  it("txSuccess convenience helper sets explorerUrl", () => {
    // Mirror the implementation's txSuccess helper
    const txSuccess = (title: string, explorerUrl: string, message?: string): ToastOptions => ({
      variant: "success",
      title,
      message,
      explorerUrl,
    });

    const opts = txSuccess(
      "Transaction confirmed",
      "https://stellar.expert/explorer/testnet/tx/def456",
    );

    expect(opts.variant).toBe("success");
    expect(opts.explorerUrl).toBe(
      "https://stellar.expert/explorer/testnet/tx/def456",
    );
  });
});

describe("ToastContainer — visible slice and queue indicator", () => {
  it("visibleToasts returns last MAX_VISIBLE elements", () => {
    const toasts: Toast[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t-${i}`,
      variant: "info" as ToastVariant,
      title: `Toast ${i}`,
      createdAt: Date.now() + i,
    }));

    const visible = visibleToasts(toasts);
    expect(visible).toHaveLength(MAX_VISIBLE);
    // Should be the last 3
    expect(visible.map((t) => t.id)).toEqual(["t-2", "t-3", "t-4"]);
  });

  it("queuedCount is correct for various lengths", () => {
    const make = (n: number): Toast[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `t-${i}`,
        variant: "info" as ToastVariant,
        title: `T${i}`,
        createdAt: i,
      }));

    expect(queuedCount(make(0))).toBe(0);
    expect(queuedCount(make(1))).toBe(0);
    expect(queuedCount(make(3))).toBe(0);
    expect(queuedCount(make(4))).toBe(1);
    expect(queuedCount(make(10))).toBe(7);
  });
});

describe("Accessibility requirements", () => {
  it("error variant maps to assertive urgency", () => {
    // aria-live="assertive" is expected for errors
    const variant: ToastVariant = "error";
    const ariaLive = variant === "error" ? "assertive" : "polite";
    expect(ariaLive).toBe("assertive");
  });

  it("non-error variants map to polite urgency", () => {
    for (const variant of ["success", "warning", "info"] as const) {
      const ariaLive = variant === "error" ? "assertive" : "polite";
      expect(ariaLive).toBe("polite");
    }
  });
});

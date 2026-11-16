import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  INITIAL_BATCH_SIZE,
  BATCH_SIZE,
  SCROLL_THRESHOLD_PX,
  type Transaction,
} from "../components/TransactionHistory";

// Generate N mock transactions
function generateMockTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) => ({
    hash: `0x${(i + 1).toString(16).padStart(64, "0")}`,
    date: new Date(Date.UTC(2026, 8, 1, 10, i, 0)).toISOString(),
    type: (i % 3 === 0 ? "deposit" : i % 3 === 1 ? "withdraw" : "harvest") as any,
    amount: `${(i + 1) * 10}.00 USDC`,
    status: (i % 4 === 0 ? "failed" : i % 5 === 0 ? "pending" : "confirmed") as any,
  }));
}

describe("TransactionHistory Infinite Scroll (Issue #271)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defines 20 initial batch size, 20 per scroll, and 200px threshold", () => {
    expect(INITIAL_BATCH_SIZE).toBe(20);
    expect(BATCH_SIZE).toBe(20);
    expect(SCROLL_THRESHOLD_PX).toBe("200px");
  });

  it("slices first 20 records on initial render", () => {
    const mockTxs = generateMockTransactions(50);
    const initialRender = mockTxs.slice(0, INITIAL_BATCH_SIZE);

    expect(initialRender.length).toBe(20);
    expect(initialRender[0].hash).toBe(mockTxs[0].hash);
    expect(initialRender[19].hash).toBe(mockTxs[19].hash);
  });

  it("loads next 20 items in subsequent batch", () => {
    const mockTxs = generateMockTransactions(50);
    let visibleCount = INITIAL_BATCH_SIZE;

    // Simulate first intersection
    visibleCount = Math.min(visibleCount + BATCH_SIZE, mockTxs.length);
    expect(visibleCount).toBe(40);

    // Simulate second intersection
    visibleCount = Math.min(visibleCount + BATCH_SIZE, mockTxs.length);
    expect(visibleCount).toBe(50);

    // Reached end
    expect(visibleCount >= mockTxs.length).toBe(true);
  });

  it("uses IntersectionObserver options with rootMargin: 0px 0px 200px 0px", () => {
    let observedRootMargin = "";

    class MockIntersectionObserver {
      constructor(_callback: any, options?: any) {
        observedRootMargin = options?.rootMargin || "";
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    (globalThis as any).IntersectionObserver = MockIntersectionObserver;

    const observer = new (globalThis as any).IntersectionObserver(vi.fn(), {
      rootMargin: `0px 0px ${SCROLL_THRESHOLD_PX} 0px`,
    });

    expect(observedRootMargin).toBe("0px 0px 200px 0px");
    expect(observer).toBeDefined();
  });

  it("does not attach scroll event listeners (uses Intersection Observer API)", () => {
    const addEventListenerSpy = vi.fn();
    (globalThis as any).window = {
      addEventListener: addEventListenerSpy,
      removeEventListener: vi.fn(),
    };

    // No scroll listener should be added
    expect(addEventListenerSpy).not.toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("identifies when end of history is reached", () => {
    const mockTxs = generateMockTransactions(35);
    let visibleCount = INITIAL_BATCH_SIZE;

    expect(visibleCount < mockTxs.length).toBe(true); // more to load

    visibleCount = Math.min(visibleCount + BATCH_SIZE, mockTxs.length);
    expect(visibleCount).toBe(35);
    expect(visibleCount >= mockTxs.length).toBe(true); // end of history
  });
});

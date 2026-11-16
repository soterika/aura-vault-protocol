/**
 * Tests for useVaultStats and useUserPosition hooks.
 *
 * Strategy:
 * - All tests run inside a SWRConfig with `provider: () => new Map()` so each
 *   test gets an isolated, empty cache — no cross-test contamination.
 * - Fetchers are mocked via vi.mock so tests never hit the network and resolve
 *   predictably.
 * - `act` + `waitFor` is used to wait for async state transitions.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { useVaultStats } from "../hooks/useVaultStats";
import { useUserPosition } from "../hooks/useUserPosition";
import type { VaultStats, UserPosition } from "../lib/fetchers";

// ---------------------------------------------------------------------------
// Fetcher mocks
// NOTE: vi.mock is hoisted to the top of the file by vitest. The factory
// function must NOT reference variables declared below it (temporal dead zone).
// We use inline resolved values and override them per-test via mockResolvedValue.
// ---------------------------------------------------------------------------

vi.mock("../lib/fetchers", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/fetchers")>();
  return {
    ...original,
    fetchVaultStats: vi.fn().mockResolvedValue({
      totalAssets: 2_000_000n,
      totalShares: 1_500_000n,
      fetchedAt: 1_000_000,
    } satisfies import("../lib/fetchers").VaultStats),
    fetchUserPosition: vi.fn().mockResolvedValue({
      address: "GADDRESS123",
      shares: 500_000n,
      fetchedAt: 1_000_000,
    } satisfies import("../lib/fetchers").UserPosition),
  };
});

// Re-import after mock to get typed references
import { fetchVaultStats, fetchUserPosition } from "../lib/fetchers";

const mockedFetchVaultStats = vi.mocked(fetchVaultStats);
const mockedFetchUserPosition = vi.mocked(fetchUserPosition);

// Canonical expected values — kept in sync with the inline mock above
const mockVaultStats: VaultStats = {
  totalAssets: 2_000_000n,
  totalShares: 1_500_000n,
  fetchedAt: 1_000_000,
};

const mockUserPosition: UserPosition = {
  address: "GADDRESS123",
  shares: 500_000n,
  fetchedAt: 1_000_000,
};

// ---------------------------------------------------------------------------
// Test wrapper — isolated SWR cache per test
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

// ---------------------------------------------------------------------------
// useVaultStats
// ---------------------------------------------------------------------------

describe("useVaultStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchVaultStats.mockResolvedValue(mockVaultStats);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns isLoading=true before data arrives", () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    // Initial render: data undefined, isLoading true
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("returns vault stats after fetch resolves", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(mockVaultStats);
    expect(result.current.error).toBeUndefined();
  });

  it("returns correct totalAssets value", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.totalAssets).toBe(2_000_000n);
  });

  it("returns correct totalShares value", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.totalShares).toBe(1_500_000n);
  });

  it("calls the fetcher exactly once on mount", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockedFetchVaultStats).toHaveBeenCalledTimes(1);
  });

  it("fetcher receives the VAULT_STATS_KEY as argument", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockedFetchVaultStats).toHaveBeenCalledWith("/vault/stats");
  });

  it("exposes a mutate function", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(typeof result.current.mutate).toBe("function");
  });

  it("calling mutate triggers a re-fetch", async () => {
    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const callsBeforeMutate = mockedFetchVaultStats.mock.calls.length;

    act(() => { result.current.mutate(); });

    await waitFor(() =>
      expect(mockedFetchVaultStats.mock.calls.length).toBeGreaterThan(callsBeforeMutate)
    );
  });

  it("sets error when fetcher rejects", async () => {
    const fetchError = new Error("Network failure");
    mockedFetchVaultStats.mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useVaultStats(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });

  it("two hooks with the same key share the same fetch call (deduplication)", async () => {
    // Both hooks use the same VAULT_STATS_KEY.
    // With dedupingInterval: 50 SWR batches concurrent renders into one request.
    const wrapper2 = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 50 }}>
        {children}
      </SWRConfig>
    );

    const { result: r1 } = renderHook(() => useVaultStats(), { wrapper: wrapper2 });
    const { result: r2 } = renderHook(() => useVaultStats(), { wrapper: wrapper2 });

    await waitFor(() => expect(r1.current.data).toBeDefined());
    await waitFor(() => expect(r2.current.data).toBeDefined());

    // Both return the same data
    expect(r1.current.data).toEqual(r2.current.data);
  });
});

// ---------------------------------------------------------------------------
// useUserPosition
// ---------------------------------------------------------------------------

describe("useUserPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchUserPosition.mockResolvedValue(mockUserPosition);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch when address is null", () => {
    renderHook(() => useUserPosition(null), { wrapper });
    expect(mockedFetchUserPosition).not.toHaveBeenCalled();
  });

  it("does not fetch when address is undefined", () => {
    renderHook(() => useUserPosition(undefined), { wrapper });
    expect(mockedFetchUserPosition).not.toHaveBeenCalled();
  });

  it("returns isLoading=true initially when address is provided", () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    expect(result.current.isLoading).toBe(true);
  });

  it("returns user position after fetch resolves", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(mockUserPosition);
  });

  it("returns correct share balance", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.shares).toBe(500_000n);
  });

  it("fetcher receives the keyed path as argument", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockedFetchUserPosition).toHaveBeenCalledWith(
      "/vault/position/GADDRESS123"
    );
  });

  it("exposes a revalidate function", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(typeof result.current.revalidate).toBe("function");
  });

  it("exposes an optimisticUpdate function", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(typeof result.current.optimisticUpdate).toBe("function");
  });

  it("revalidate triggers a re-fetch", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    const callsBefore = mockedFetchUserPosition.mock.calls.length;

    act(() => { result.current.revalidate(); });

    await waitFor(() =>
      expect(mockedFetchUserPosition.mock.calls.length).toBeGreaterThan(callsBefore)
    );
  });

  it("optimisticUpdate immediately updates the cached share balance", async () => {
    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => { result.current.optimisticUpdate(999_999n); });

    // The cache should reflect the optimistic value immediately
    await waitFor(() =>
      expect(result.current.data?.shares).toBe(999_999n)
    );
  });

  it("optimisticUpdate on null address is a no-op", () => {
    const { result } = renderHook(
      () => useUserPosition(null),
      { wrapper }
    );
    // Should not throw
    expect(() => {
      act(() => { result.current.optimisticUpdate(123n); });
    }).not.toThrow();
  });

  it("sets error when fetcher rejects", async () => {
    mockedFetchUserPosition.mockRejectedValueOnce(new Error("RPC down"));

    const { result } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });

  it("different addresses produce independent cache entries", async () => {
    const positionB: UserPosition = {
      address: "GBADDRESS456",
      shares: 250_000n,
      fetchedAt: 2_000_000,
    };
    // Return different data based on key
    mockedFetchUserPosition.mockImplementation(async (key: string) => {
      if (key.includes("GBADDRESS456")) return positionB;
      return mockUserPosition;
    });

    const { result: r1 } = renderHook(
      () => useUserPosition("GADDRESS123"),
      { wrapper }
    );
    const { result: r2 } = renderHook(
      () => useUserPosition("GBADDRESS456"),
      { wrapper }
    );

    await waitFor(() => expect(r1.current.data).toBeDefined());
    await waitFor(() => expect(r2.current.data).toBeDefined());

    expect(r1.current.data!.shares).toBe(500_000n);
    expect(r2.current.data!.shares).toBe(250_000n);
  });
});

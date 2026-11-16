import useSWR, { useSWRConfig } from "swr";
import {
  fetchUserPosition,
  userPositionKey,
  type UserPosition,
} from "../lib/fetchers";

export interface UseUserPositionResult {
  /** User's position when loaded, undefined while loading or if address is null. */
  data: UserPosition | undefined;
  /** True on the initial load (no cached data yet). */
  isLoading: boolean;
  /** True on any subsequent background revalidation. */
  isValidating: boolean;
  /** Fetch error, if the last request failed. */
  error: unknown;
  /**
   * Re-fetch the user's position from the chain.
   * Call this after a confirmed deposit or withdraw to get fresh share balance.
   */
  revalidate: () => void;
  /**
   * Optimistically update the cached share balance.
   * Call this immediately after submitting a deposit so the UI reflects the
   * expected new balance before the chain confirms.
   *
   * The balance will be corrected by the next revalidation if the optimistic
   * value turns out to be wrong (e.g. tx reverts).
   *
   * @param newShares  The expected share balance after the action.
   */
  optimisticUpdate: (newShares: bigint) => void;
}

/**
 * Returns the share balance for the connected user, keyed by wallet address.
 *
 * Pass `null` (disconnected wallet) to skip the fetch entirely — SWR treats
 * a null key as "do not fetch".
 *
 * Multiple components mounting this hook for the same address share the same
 * in-flight request and cache entry due to key deduplication.
 *
 * @example
 * const { data, revalidate, optimisticUpdate } = useUserPosition(address);
 */
export function useUserPosition(
  address: string | null | undefined
): UseUserPositionResult {
  const key = userPositionKey(address);
  const { mutate: globalMutate } = useSWRConfig();

  const { data, isLoading, isValidating, error, mutate } =
    useSWR<UserPosition>(key, fetchUserPosition, {
      // Position data is user-specific — revalidate on window focus so a user
      // returning to the tab sees fresh share counts.
      revalidateOnFocus: true,
      // Keep stale data during revalidation to avoid share-count flicker.
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 5_000,
    });

  /** Re-fetch from the chain (used after confirmed deposit/withdraw). */
  function revalidate(): void {
    mutate(); // bounded to this key
  }

  /**
   * Optimistically write a new share balance into the SWR cache.
   * The cache entry is updated immediately; the real value is re-fetched in the
   * background and will replace the optimistic value once confirmed.
   */
  function optimisticUpdate(newShares: bigint): void {
    if (!key) return; // no address, nothing to update
    const optimistic: UserPosition = {
      address: address ?? "",
      shares: newShares,
      fetchedAt: Date.now(),
    };
    // Optimistic update: write immediately, revalidate in background
    globalMutate(key, optimistic, { revalidate: true });
  }

  return { data, isLoading, isValidating, error, revalidate, optimisticUpdate };
}

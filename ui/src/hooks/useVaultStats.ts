import useSWR from "swr";
import {
  fetchVaultStats,
  VAULT_STATS_KEY,
  type VaultStats,
} from "../lib/fetchers";

/** Revalidation interval in milliseconds. */
const REVALIDATION_INTERVAL_MS = 30_000;

export interface UseVaultStatsResult {
  /** Vault stats when loaded, undefined while loading or on error. */
  data: VaultStats | undefined;
  /** True on the initial load (no cached data yet). */
  isLoading: boolean;
  /** True on any subsequent background revalidation. */
  isValidating: boolean;
  /** Fetch error, if the last request failed. */
  error: unknown;
  /** Imperatively re-trigger a fetch (e.g. after a harvest). */
  mutate: () => void;
}

/**
 * Returns global vault statistics, auto-refreshed every 30 seconds.
 *
 * Multiple components mounting this hook share the same in-flight request and
 * the same cache entry because they all use the same `VAULT_STATS_KEY`.
 *
 * @example
 * const { data, isLoading } = useVaultStats();
 * if (isLoading) return <Skeleton />;
 * return <p>Total assets: {data.totalAssets.toString()}</p>;
 */
export function useVaultStats(): UseVaultStatsResult {
  const { data, isLoading, isValidating, error, mutate } = useSWR<VaultStats>(
    VAULT_STATS_KEY,
    fetchVaultStats,
    {
      refreshInterval: REVALIDATION_INTERVAL_MS,
      // Keep stale data visible during background revalidation — no loading flash
      keepPreviousData: true,
      // Surface errors to the SWRErrorBoundary via suspense boundary, or handle
      // locally via the returned `error` field; do not swallow silently.
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 5_000,
    }
  );

  return { data, isLoading, isValidating, error, mutate };
}

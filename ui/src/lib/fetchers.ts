/**
 * Typed fetchers for SWR hooks.
 *
 * These are thin async functions that wrap the actual data-source calls.
 * In production, replace the simulated delays with real Soroban RPC / REST calls.
 * Keeping fetchers separate from hooks makes them independently unit-testable
 * and easy to swap out without touching hook logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Global vault statistics returned by the on-chain `total_assets` view. */
export interface VaultStats {
  /** Total underlying tokens held by the vault (stroop-denominated bigint). */
  totalAssets: bigint;
  /** Total shares in circulation (stroop-denominated bigint). */
  totalShares: bigint;
  /** Snapshot timestamp (ms since epoch). */
  fetchedAt: number;
}

/** Per-user position returned by the on-chain `balance_of` view. */
export interface UserPosition {
  /** The user's wallet address. */
  address: string;
  /** The user's current share balance (stroop-denominated bigint). */
  shares: bigint;
  /** Snapshot timestamp (ms since epoch). */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// SWR cache keys
// ---------------------------------------------------------------------------

/** Stable, serialisable key for vault-wide stats. */
export const VAULT_STATS_KEY = "/vault/stats" as const;

/** Returns a stable, serialisable key for a user's position. */
export function userPositionKey(address: string | null | undefined): string | null {
  if (!address) return null; // null tells SWR not to fetch
  return `/vault/position/${address}`;
}

// ---------------------------------------------------------------------------
// Fetcher implementations
// ---------------------------------------------------------------------------

/**
 * Fetches global vault statistics.
 *
 * The key parameter is accepted (and ignored) so the signature is compatible
 * with SWR's `fetcher(key)` convention, enabling easy key-based cache control.
 *
 * Replace the simulation below with:
 *   const server = new SorobanRpc.Server(RPC_URL);
 *   const contract = new Contract(VAULT_CONTRACT_ID);
 *   const totalAssets = await contract.call(server, "total_assets");
 *   const totalShares = await contract.call(server, "total_shares");
 */
export async function fetchVaultStats(_key: string): Promise<VaultStats> {
  // Simulated network call — swap with real Soroban RPC in production
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  return {
    totalAssets: 1_000_000n,
    totalShares: 1_000_000n,
    fetchedAt: Date.now(),
  };
}

/**
 * Fetches the share balance for a specific user address.
 *
 * The key encodes the address as `/vault/position/<address>` so SWR can
 * deduplicate concurrent requests from multiple components for the same user.
 *
 * Replace the simulation below with:
 *   const result = await contract.call(server, "balance_of", address);
 */
export async function fetchUserPosition(key: string): Promise<UserPosition> {
  // Parse address out of the SWR key format produced by userPositionKey()
  const address = key.replace("/vault/position/", "");

  // Simulated network call — swap with real Soroban RPC in production
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  return {
    address,
    shares: 500_000n,
    fetchedAt: Date.now(),
  };
}

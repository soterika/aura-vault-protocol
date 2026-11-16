/**
 * explorerLinks.ts — Network-aware URL builders for Stellar block explorers.
 *
 * Supported explorers:
 *   - Stellar Expert   https://stellar.expert/explorer/{network}/{type}/{id}
 *   - Stellarchain.io  https://stellarchain.io/transactions/{hash}  (mainnet)
 *                      https://testnet.stellarchain.io/transactions/{hash} (testnet)
 *
 * Network is resolved from the NEXT_PUBLIC_STELLAR_NETWORK env var at runtime.
 * Falls back to "testnet" so local dev is always safe.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StellarNetwork = "mainnet" | "testnet";

export interface ExplorerUrls {
  /** Human-readable label shown in the menu */
  label: string;
  /** Fully-qualified URL to the transaction or account page */
  url: string;
}

// ---------------------------------------------------------------------------
// Network resolution
// ---------------------------------------------------------------------------

/**
 * Returns the active Stellar network, driven by the env var.
 * Only "mainnet" and "testnet" are valid; anything else falls back to "testnet".
 */
export function resolveNetwork(
  override?: string | null
): StellarNetwork {
  const raw =
    override ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_STELLAR_NETWORK
      : undefined) ??
    "testnet";

  return raw === "mainnet" ? "mainnet" : "testnet";
}

// ---------------------------------------------------------------------------
// URL builders — Stellar Expert
// ---------------------------------------------------------------------------

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer";

/**
 * Returns the Stellar Expert URL for a transaction hash.
 *
 * @example
 * stellarExpertTxUrl("abc123", "testnet")
 * // → "https://stellar.expert/explorer/testnet/tx/abc123"
 */
export function stellarExpertTxUrl(
  hash: string,
  network: StellarNetwork = "testnet"
): string {
  return `${STELLAR_EXPERT_BASE}/${network}/tx/${hash}`;
}

/**
 * Returns the Stellar Expert URL for an account / address.
 *
 * @example
 * stellarExpertAccountUrl("GABC…", "mainnet")
 * // → "https://stellar.expert/explorer/mainnet/account/GABC…"
 */
export function stellarExpertAccountUrl(
  address: string,
  network: StellarNetwork = "testnet"
): string {
  return `${STELLAR_EXPERT_BASE}/${network}/account/${address}`;
}

// ---------------------------------------------------------------------------
// URL builders — Stellarchain.io
// ---------------------------------------------------------------------------

const STELLARCHAIN_MAINNET = "https://stellarchain.io";
const STELLARCHAIN_TESTNET = "https://testnet.stellarchain.io";

function stellarchainBase(network: StellarNetwork): string {
  return network === "mainnet" ? STELLARCHAIN_MAINNET : STELLARCHAIN_TESTNET;
}

/**
 * Returns the Stellarchain.io URL for a transaction hash.
 *
 * @example
 * stellarchainTxUrl("abc123", "testnet")
 * // → "https://testnet.stellarchain.io/transactions/abc123"
 */
export function stellarchainTxUrl(
  hash: string,
  network: StellarNetwork = "testnet"
): string {
  return `${stellarchainBase(network)}/transactions/${hash}`;
}

/**
 * Returns the Stellarchain.io URL for an account / address.
 *
 * @example
 * stellarchainAccountUrl("GABC…", "mainnet")
 * // → "https://stellarchain.io/accounts/GABC…"
 */
export function stellarchainAccountUrl(
  address: string,
  network: StellarNetwork = "testnet"
): string {
  return `${stellarchainBase(network)}/accounts/${address}`;
}

// ---------------------------------------------------------------------------
// Composite helpers — return both explorer URLs at once
// ---------------------------------------------------------------------------

/**
 * Returns both explorer URLs for a transaction hash.
 *
 * @example
 * txExplorerUrls("abc123", "testnet")
 * // → [
 * //     { label: "Stellar Expert",  url: "https://stellar.expert/explorer/testnet/tx/abc123" },
 * //     { label: "Stellarchain.io", url: "https://testnet.stellarchain.io/transactions/abc123" },
 * //   ]
 */
export function txExplorerUrls(
  hash: string,
  network: StellarNetwork = "testnet"
): ExplorerUrls[] {
  return [
    { label: "Stellar Expert",  url: stellarExpertTxUrl(hash, network) },
    { label: "Stellarchain.io", url: stellarchainTxUrl(hash, network) },
  ];
}

/**
 * Returns both explorer URLs for an account address.
 *
 * @example
 * accountExplorerUrls("GABC…", "testnet")
 * // → [
 * //     { label: "Stellar Expert",  url: "https://stellar.expert/explorer/testnet/account/GABC…" },
 * //     { label: "Stellarchain.io", url: "https://testnet.stellarchain.io/accounts/GABC…" },
 * //   ]
 */
export function accountExplorerUrls(
  address: string,
  network: StellarNetwork = "testnet"
): ExplorerUrls[] {
  return [
    { label: "Stellar Expert",  url: stellarExpertAccountUrl(address, network) },
    { label: "Stellarchain.io", url: stellarchainAccountUrl(address, network) },
  ];
}

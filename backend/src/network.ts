/**
 * network.ts — Multi-network support for Aura Vault Protocol (issue #328)
 *
 * Reads STELLAR_NETWORK from the environment to determine which Stellar network
 * the backend instance is connected to. Must be either 'testnet' or 'mainnet'.
 *
 * Call validateNetwork() once at startup to fail fast on misconfiguration.
 */

export type Network = "testnet" | "mainnet";

export type NetworkConfig = {
  network: Network;
  horizonUrl: string;
  contractId: string;
};

const HORIZON_URLS: Record<Network, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

/**
 * Validates the STELLAR_NETWORK environment variable.
 * Throws an Error on startup if the value is missing or not 'testnet'/'mainnet'.
 */
export function validateNetwork(): void {
  const network = process.env.STELLAR_NETWORK;

  if (!network) {
    throw new Error(
      "[network] STELLAR_NETWORK environment variable is not set. " +
        "Set it to 'testnet' or 'mainnet'."
    );
  }

  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(
      `[network] Invalid STELLAR_NETWORK value: '${network}'. ` +
        "Must be 'testnet' or 'mainnet'."
    );
  }
}

/**
 * Returns the current network ('testnet' or 'mainnet').
 * Assumes validateNetwork() has already been called.
 */
export function getNetwork(): Network {
  validateNetwork();
  return process.env.STELLAR_NETWORK as Network;
}

/**
 * Returns the Horizon RPC URL for the current network.
 */
export function getHorizonUrl(): string {
  const network = getNetwork();
  return HORIZON_URLS[network];
}

/**
 * Returns the vault contract ID for the current network.
 * Reads VAULT_CONTRACT_ID_TESTNET or VAULT_CONTRACT_ID_MAINNET from env.
 */
export function getContractId(): string {
  const network = getNetwork();

  if (network === "testnet") {
    return process.env.VAULT_CONTRACT_ID_TESTNET ?? "";
  }

  return process.env.VAULT_CONTRACT_ID_MAINNET ?? "";
}

/**
 * Returns a complete NetworkConfig object for the current network.
 */
export function getNetworkConfig(): NetworkConfig {
  return {
    network: getNetwork(),
    horizonUrl: getHorizonUrl(),
    contractId: getContractId(),
  };
}

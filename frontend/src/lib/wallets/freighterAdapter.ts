import type { SignTransactionOptions, WalletAdapter, WalletConnectionResult } from "./types";

interface FreighterApi {
  isConnected?: () => Promise<boolean | { isConnected?: boolean }>;
  requestAccess?: () => Promise<string | { address?: string; error?: unknown }>;
  getAddress?: () => Promise<string | { address?: string; error?: unknown }>;
  getPublicKey?: () => Promise<string>;
  getNetwork?: () => Promise<string | { network?: string }>;
  signTransaction?: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ) => Promise<string | { signedTxXdr?: string; error?: unknown }>;
}

function getFreighterApi(): FreighterApi | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as { freighterApi?: FreighterApi; freighter?: FreighterApi };
  return win.freighterApi ?? win.freighter;
}

function extractAddress(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "address" in value && typeof value.address === "string") {
    return value.address || null;
  }
  return null;
}

export class FreighterAdapter implements WalletAdapter {
  readonly id = "freighter" as const;
  readonly name = "Freighter";

  isInstalled(): boolean {
    return Boolean(getFreighterApi());
  }

  async connect(): Promise<WalletConnectionResult> {
    const api = getFreighterApi();
    if (!api) {
      throw new Error("Freighter wallet is not installed.");
    }

    const raw = api.requestAccess
      ? await api.requestAccess()
      : api.getPublicKey
        ? await api.getPublicKey()
        : null;

    const address = extractAddress(raw);
    if (!address) {
      throw new Error("Freighter connection did not return an address.");
    }

    let network = "TESTNET";
    if (api.getNetwork) {
      const net = await api.getNetwork();
      if (typeof net === "string" && net.length > 0) {
        network = net;
      } else if (net && typeof net === "object" && typeof net.network === "string") {
        network = net.network;
      }
    }

    return { address, network };
  }

  async disconnect(): Promise<void> {
    // Freighter extension manages session state client-side; no remote revoke API.
  }

  async getAddress(): Promise<string | null> {
    const api = getFreighterApi();
    if (!api) return null;

    if (api.getAddress) {
      return extractAddress(await api.getAddress());
    }
    if (api.getPublicKey) {
      return extractAddress(await api.getPublicKey());
    }
    return null;
  }

  async signTransaction(xdr: string, options?: SignTransactionOptions): Promise<string> {
    const api = getFreighterApi();
    if (!api?.signTransaction) {
      throw new Error("Freighter signTransaction is not available.");
    }

    const result = await api.signTransaction(xdr, {
      networkPassphrase: options?.networkPassphrase,
    });

    if (typeof result === "string") return result;
    if (result && typeof result === "object" && typeof result.signedTxXdr === "string") {
      return result.signedTxXdr;
    }
    throw new Error("Freighter failed to sign transaction.");
  }
}

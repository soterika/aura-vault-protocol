import type { SignTransactionOptions, WalletAdapter, WalletConnectionResult } from "./types";

interface Eip1193Provider {
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
}

const STELLAR_SNAP_ID = "npm:stellar-snap";

function getMetaMaskProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as { ethereum?: Eip1193Provider };
  const eth = win.ethereum;
  if (!eth) return undefined;

  if (Array.isArray(eth.providers)) {
    const found = eth.providers.find((p) => p.isMetaMask);
    if (found) return found;
  }

  return eth.isMetaMask ? eth : undefined;
}

export class MetaMaskAdapter implements WalletAdapter {
  readonly id = "metamask" as const;
  readonly name = "MetaMask";

  isInstalled(): boolean {
    return Boolean(getMetaMaskProvider());
  }

  async connect(): Promise<WalletConnectionResult> {
    const provider = getMetaMaskProvider();
    if (!provider) {
      throw new Error("MetaMask is not installed.");
    }

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[] | undefined;
    const evmAddress = accounts?.[0];
    if (!evmAddress) {
      throw new Error("MetaMask connection did not return an account.");
    }

    // Attempt Stellar Snap bridge if available, otherwise return EIP-1193 address
    let address = evmAddress;
    try {
      const snapRes = await provider.request({
        method: "wallet_invokeSnap",
        params: {
          snapId: STELLAR_SNAP_ID,
          request: { method: "getAddress" },
        },
      });
      if (typeof snapRes === "string" && snapRes.startsWith("G")) {
        address = snapRes;
      }
    } catch {
      // Stellar Snap not installed; fall back to EIP-1193 bridged address
    }

    return { address, network: "TESTNET" };
  }

  async disconnect(): Promise<void> {
    const provider = getMetaMaskProvider();
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Older MetaMask versions may not support wallet_revokePermissions
    }
  }

  async getAddress(): Promise<string | null> {
    const provider = getMetaMaskProvider();
    if (!provider) return null;

    const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
    return accounts?.[0] ?? null;
  }

  async signTransaction(xdr: string, options?: SignTransactionOptions): Promise<string> {
    const provider = getMetaMaskProvider();
    if (!provider) {
      throw new Error("MetaMask is not installed.");
    }

    // Try Stellar Snap bridge first
    try {
      const signed = await provider.request({
        method: "wallet_invokeSnap",
        params: {
          snapId: STELLAR_SNAP_ID,
          request: {
            method: "signTransaction",
            params: { xdr, networkPassphrase: options?.networkPassphrase },
          },
        },
      });
      if (typeof signed === "string") return signed;
    } catch {
      // Fallback to personal_sign over the XDR payload
    }

    const address = await this.getAddress();
    if (!address) {
      throw new Error("MetaMask account is not connected.");
    }

    const signature = await provider.request({
      method: "personal_sign",
      params: [xdr, address],
    });
    if (typeof signature !== "string") {
      throw new Error("MetaMask failed to sign transaction.");
    }
    return signature;
  }
}

import type { SignTransactionOptions, WalletAdapter, WalletConnectionResult } from "./types";

interface CoinbaseProvider {
  isCoinbaseWallet?: boolean;
  providers?: CoinbaseProvider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  disconnect?: () => Promise<void>;
}

function getCoinbaseProvider(): CoinbaseProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as {
    coinbaseWalletExtension?: CoinbaseProvider;
    ethereum?: CoinbaseProvider;
  };

  if (win.coinbaseWalletExtension) {
    return win.coinbaseWalletExtension;
  }

  const eth = win.ethereum;
  if (!eth) return undefined;

  if (Array.isArray(eth.providers)) {
    const found = eth.providers.find((p) => p.isCoinbaseWallet);
    if (found) return found;
  }

  return eth.isCoinbaseWallet ? eth : undefined;
}

export class CoinbaseAdapter implements WalletAdapter {
  readonly id = "coinbase" as const;
  readonly name = "Coinbase Wallet";

  isInstalled(): boolean {
    return Boolean(getCoinbaseProvider());
  }

  async connect(): Promise<WalletConnectionResult> {
    const provider = getCoinbaseProvider();
    if (!provider) {
      throw new Error("Coinbase Wallet is not installed.");
    }

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[] | undefined;
    const address = accounts?.[0];
    if (!address) {
      throw new Error("Coinbase Wallet connection did not return an account.");
    }

    return { address, network: "TESTNET" };
  }

  async disconnect(): Promise<void> {
    const provider = getCoinbaseProvider();
    if (provider?.disconnect) {
      await provider.disconnect();
    }
  }

  async getAddress(): Promise<string | null> {
    const provider = getCoinbaseProvider();
    if (!provider) return null;

    const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
    return accounts?.[0] ?? null;
  }

  async signTransaction(xdr: string, _options?: SignTransactionOptions): Promise<string> {
    const provider = getCoinbaseProvider();
    if (!provider) {
      throw new Error("Coinbase Wallet is not installed.");
    }

    const address = await this.getAddress();
    if (!address) {
      throw new Error("Coinbase Wallet account is not connected.");
    }

    const signature = await provider.request({
      method: "personal_sign",
      params: [xdr, address],
    });
    if (typeof signature !== "string") {
      throw new Error("Coinbase Wallet failed to sign transaction.");
    }
    return signature;
  }
}

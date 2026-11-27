export type WalletAdapterId = "freighter" | "metamask" | "coinbase";

export interface WalletConnectionResult {
  address: string;
  network: string;
}

export interface SignTransactionOptions {
  networkPassphrase?: string;
}

export interface WalletAdapter {
  readonly id: WalletAdapterId;
  readonly name: string;
  isInstalled(): boolean;
  connect(): Promise<WalletConnectionResult>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, options?: SignTransactionOptions): Promise<string>;
  getAddress(): Promise<string | null>;
}

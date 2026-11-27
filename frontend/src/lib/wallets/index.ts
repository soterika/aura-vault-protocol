import { CoinbaseAdapter } from "./coinbaseAdapter";
import { FreighterAdapter } from "./freighterAdapter";
import { MetaMaskAdapter } from "./metamaskAdapter";
import type { WalletAdapter, WalletAdapterId } from "./types";

export type { SignTransactionOptions, WalletAdapter, WalletAdapterId, WalletConnectionResult } from "./types";
export { FreighterAdapter } from "./freighterAdapter";
export { MetaMaskAdapter } from "./metamaskAdapter";
export { CoinbaseAdapter } from "./coinbaseAdapter";

export const WALLET_ADAPTERS: Record<WalletAdapterId, WalletAdapter> = {
  freighter: new FreighterAdapter(),
  metamask: new MetaMaskAdapter(),
  coinbase: new CoinbaseAdapter(),
};

export function getWalletAdapter(id: WalletAdapterId): WalletAdapter {
  return WALLET_ADAPTERS[id];
}

export function getInstalledWallets(): WalletAdapter[] {
  return Object.values(WALLET_ADAPTERS).filter((adapter) => adapter.isInstalled());
}

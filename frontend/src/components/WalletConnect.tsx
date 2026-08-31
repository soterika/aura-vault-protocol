"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { useOnboarding } from "@/components/OnboardingChecklist";
import { ShareBalanceDisplay } from "@/components/ShareBalanceDisplay";

type WalletType = "freighter" | "metamask" | "xBull";

type WalletState = {
  type: WalletType;
  address: string;
};

type WalletConnectProps = {
  onConnected?: () => void;
  onDisconnected?: () => void;
};

function truncate(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getInstalledWallets(): WalletType[] {
  if (typeof window === "undefined") {
    return [];
  }

  const wallets: WalletType[] = [];

  const win = window as Window & {
    freighterApi?: unknown;
    ethereum?: unknown;
    xBullSDK?: unknown;
  };

  if (win.freighterApi) wallets.push("freighter");
  if (win.ethereum) wallets.push("metamask");
  if (win.xBullSDK) wallets.push("xBull");

  return wallets;
}

export default function WalletConnect({
  onConnected,
  onDisconnected,
}: WalletConnectProps) {
  const [wallets, setWallets] = useState<WalletType[]>([]);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [installedWallets, setInstalledWallets] = useState<WalletType[]>([]);

  const { markComplete } = useOnboarding();

  const detectWallets = useCallback(() => {
    setWallets(getInstalledWallets());
  }, []);

  useEffect(() => {
    detectWallets();
  }, [detectWallets]);

  async function connectWallet(type: WalletType) {
    setLoading(true);
    setError(null);

    try {
      if (type === "metamask") {
        const win = window as Window & {
          ethereum?: {
            request: (args: {
              method: string;
            }) => Promise<string[]>;
          };
        };

        if (!win.ethereum) {
          throw new Error("MetaMask is not installed.");
        }

        const accounts = await win.ethereum.request({
          method: "eth_requestAccounts",
        });

        if (!accounts.length) {
          throw new Error("No MetaMask account was returned.");
        }

        setWallet({
          type,
          address: accounts[0],
        });

        onConnected?.();
        return;
      }

      if (type === "freighter") {
        const win = window as Window & {
          freighterApi?: {
            requestAccess?: () => Promise<{
              address?: string;
            }>;
            getPublicKey?: () => Promise<string>;
          };
        };

        if (!win.freighterApi) {
          throw new Error("Freighter is not installed.");
        }

        let address: string | undefined;

        if (win.freighterApi.requestAccess) {
          const result = await win.freighterApi.requestAccess();
          address = result.address;
        }

        if (!address && win.freighterApi.getPublicKey) {
          address = await win.freighterApi.getPublicKey();
        }

        if (!address) {
          throw new Error("No Freighter address was returned.");
        }

        setWallet({
          type,
          address,
        });

        onConnected?.();
        return;
      }
      const address = (await api.getPublicKey()) as string;
      const network = (await api.getNetwork()) as string;
      const state: WalletState = {
        address,
        network: network.toUpperCase(),
        connected: true,
        walletType: "freighter",
      };

      setWallet(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(LAST_WALLET_KEY, "freighter");
      markComplete("connect_wallet");
      setShowDropdown(false);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to Freighter"
      );
    } finally {
      setLoading(false);
    }
  }

  function disconnectWallet() {
    setWallet(null);
    setError(null);
    onDisconnected?.();
  }

  const connectMetaMask = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const w = window as unknown as Record<string, unknown>;
      const ethereum = w.ethereum as
        | Record<string, (...args: unknown[]) => Promise<unknown>>
        | undefined;

      if (!ethereum) {
        setError("MetaMask not found. Please install the extension.");
        return;
      }

      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      const chainId = (await ethereum.request({
        method: "eth_chainId",
      })) as string;

      const networkName = chainId === "0x1" ? "ETHEREUM" : "TESTNET";

      const state: WalletState = {
        address: accounts[0],
        network: networkName,
        connected: true,
        walletType: "metamask",
      };

      setWallet(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(LAST_WALLET_KEY, "metamask");
      markComplete("connect_wallet");
      setShowDropdown(false);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to MetaMask"
      );
    } finally {
      setLoading(false);
    }
  }, [markComplete]);

  const connectCoinbase = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const { CoinbaseWalletSDK } = await import(
        "@coinbase/wallet-sdk"
      );

      const coinbaseWallet = new CoinbaseWalletSDK({
        appName: "Aura Vault Protocol",
        appLogoUrl: "/logo.png",
      });

      const provider = coinbaseWallet.makeWeb3Provider();

      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];

      const state: WalletState = {
        address: accounts[0],
        network: "ETHEREUM",
        connected: true,
        walletType: "coinbase",
      };

      setWallet(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(LAST_WALLET_KEY, "coinbase");
      markComplete("connect_wallet");
      setShowDropdown(false);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to Coinbase Wallet"
      );
    } finally {
      setLoading(false);
    }
  }, [markComplete]);

  if (wallet) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Connected Wallet</p>

          <p
            data-testid="wallet-address"
            className="text-sm text-gray-500"
          >
            {wallet.type}: {truncate(wallet.address)}
          </p>

          <p
            data-testid="network-badge"
            className="text-xs font-semibold text-emerald-600"
          >
            TESTNET
          </p>
        </div>

        <button
          data-testid="disconnect-wallet-btn"
          type="button"
          onClick={disconnectWallet}
          className="rounded-md border px-4 py-2 text-sm"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Connect Wallet</p>

        <p className="text-sm text-gray-500">
          Select an installed wallet.
        </p>
      </div>

      {wallets.length === 0 ? (
        <p className="text-sm text-gray-500">
          No supported wallet detected.
        </p>
      ) : (
        wallets.map((type) => (
          <button
            key={type}
            data-testid="connect-wallet-btn"
            type="button"
            onClick={() => connectWallet(type)}
            disabled={loading}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            {loading ? "Connecting..." : `Connect ${type}`}
          </button>
        ))
      )}

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PortfolioSection({ address }: { address: string }) {
  const [data, setData] = useState<{
    totalAssets: string;
    shareBalance: string;
    pricePerShare: string;
  } | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);

    try {
      const [assetsRes, balanceRes] = await Promise.all([
        fetch("/api/vault/total_assets"),
        fetch(
          `/api/vault/balance_of?address=${encodeURIComponent(address)}`
        ),
      ]);

      const assets = assetsRes.ok
        ? await assetsRes.json()
        : { total: "0" };

      const balance = balanceRes.ok
        ? await balanceRes.json()
        : { balance: "0" };

      const total = BigInt(assets.total ?? 0);
      const shares = BigInt(balance.balance ?? 0);

      const pps =
        total > 0n && shares > 0n
          ? ((total * 10000n) / shares).toString()
          : "10000";

      setData({
        totalAssets: assets.total ?? "0",
        shareBalance: balance.balance ?? "0",
        pricePerShare: pps,
      });
    } catch {
      setData({
        totalAssets: "—",
        shareBalance: "—",
        pricePerShare: "—",
      });
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      data-cy="portfolio-section"
      className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Portfolio
        </h2>

        <button
          data-cy="refresh-btn"
          onClick={load}
          disabled={refreshing}
          className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-4 text-center">
        <div>
          <dt className="mb-1 text-xs text-zinc-500">
            Total Vault Assets
          </dt>

          <dd
            data-cy="total-assets"
            className="font-mono text-sm font-semibold"
          >
            {data?.totalAssets ?? "—"}
          </dd>
        </div>

        <div>
          <dt className="mb-1 text-xs text-zinc-500">
            Your Shares
          </dt>

          <dd
            data-cy="share-balance"
            className="font-mono text-sm font-semibold"
          >
            {data?.shareBalance && data?.pricePerShare ? (
              <ShareBalanceDisplay
                shares={data.shareBalance}
                sharePrice={data.pricePerShare}
                variant="compact"
              />
            ) : (
              data?.shareBalance ?? "—"
            )}
          </dd>
        </div>

        <div>
          <dt className="mb-1 text-xs text-zinc-500">
            Price / Share
          </dt>

          <dd
            data-cy="price-per-share"
            className="font-mono text-sm font-semibold"
          >
            {data?.pricePerShare ?? "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

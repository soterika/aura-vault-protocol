"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw, Wallet as WalletIcon } from "lucide-react";
import { WalletSelectionModal, type SupportedWalletId, type WalletInfo } from "./WalletSelectionModal";
import { useWalletStore } from "@/lib/walletStore";

const STORAGE_KEY = "aura_wallet_state";
const LAST_WALLET_KEY = "aura_last_wallet_type";
type SavedWallet = { type: SupportedWalletId; address: string; network: string; connected: true };
export type WalletType = SupportedWalletId;
export type WalletState = SavedWallet;
type WalletExtension = {
  isConnected?: () => Promise<boolean | { isConnected?: boolean }>;
  getAddress?: () => Promise<string | { address?: string; error?: unknown }>;
  getPublicKey?: () => Promise<string>;
  requestAccess?: () => Promise<string | { address?: string; error?: unknown }>;
  connect?: () => Promise<string | { address?: string }>;
};

const walletCatalog: Omit<WalletInfo, "isInstalled">[] = [
  { id: "freighter", name: "Freighter", description: "Official Stellar browser wallet", installUrl: "https://www.freighter.app/", installInstructions: "Install Freighter, unlock your wallet, then try connecting again." },
  { id: "lobstr", name: "Lobstr", description: "Stellar wallet by LOBSTR", installUrl: "https://lobstr.co/", installInstructions: "Install the Lobstr Signer extension and unlock it before connecting." },
  { id: "xbull", name: "xBull", description: "Stellar and Soroban wallet", installUrl: "https://xbull.app/", installInstructions: "Install and unlock the xBull browser extension before connecting." },
];

export const SUPPORTED_WALLETS_METADATA = Object.fromEntries(walletCatalog.map(({ id, ...metadata }) => [id, metadata])) as Record<SupportedWalletId, Omit<WalletInfo, "id" | "isInstalled">>;

export function detectInstalledWallets(): Record<SupportedWalletId, boolean> {
  if (typeof window === "undefined") return { freighter: false, lobstr: false, xbull: false };
  const globals = window as unknown as Record<string, unknown>;
  return {
    freighter: Boolean(globals.freighterApi || globals.freighter),
    lobstr: Boolean(globals.lobstr || globals.lobstrSignerExtension),
    xbull: Boolean(globals.xBullSDK || globals.xbull),
  };
}

function readAddress(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "address" in value && typeof value.address === "string") return value.address;
  return null;
}

function getExtension(id: SupportedWalletId): WalletExtension | undefined {
  const globals = window as unknown as Record<string, WalletExtension | undefined>;
  if (id === "freighter") return globals.freighterApi ?? globals.freighter;
  if (id === "lobstr") return globals.lobstr ?? globals.lobstrSignerExtension;
  return globals.xBullSDK ?? globals.xbull;
}

export function truncateAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function truncate(address: string): string {
  return address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address || "";
}

export async function connectViaStellarWalletsKit(id: SupportedWalletId): Promise<{ address: string; network: string; usedFallback: true }> {
  if (typeof window === "undefined") throw new Error("Window object is not available.");
  const api = getExtension(id);
  if (!api) throw new Error(`${walletCatalog.find((wallet) => wallet.id === id)?.name ?? id} is not installed.`);
  const value = api.requestAccess ? await api.requestAccess() : api.getPublicKey ? await api.getPublicKey() : null;
  const address = readAddress(value);
  if (!address) throw new Error(`${walletCatalog.find((wallet) => wallet.id === id)?.name ?? id} connection returned no public key.`);
  return { address, network: "TESTNET", usedFallback: true };
}

export default function WalletConnect({ onConnected, onDisconnected }: { onConnected?: () => void; onDisconnected?: () => void } = {}) {
  const { address, network, connected, loading, error, setConnected, setDisconnected, setLoading, setError } = useWalletStore();
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [installed, setInstalled] = useState<Record<SupportedWalletId, boolean>>({ freighter: false, lobstr: false, xbull: false });

  useEffect(() => {
    setInstalled(detectInstalledWallets());
  }, []);

  // Restore only public wallet state. Freighter APIs used here are read-only;
  // requestAccess is intentionally reserved for an explicit user connection.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      setIsReconnecting(true);
      let parsed: SavedWallet | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const candidate = raw ? JSON.parse(raw) as Partial<SavedWallet> : null;
        if (candidate?.connected && candidate.address && candidate.type === "freighter") parsed = candidate as SavedWallet;
      } catch { /* ignore malformed or blocked storage */ }
      if (!parsed) {
        if (!cancelled) setIsReconnecting(false);
        return;
      }
      const api = getExtension("freighter");
      if (!api) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage is optional */ }
        if (!cancelled) { setDisconnected(); setIsReconnecting(false); }
        return;
      }
      try {
        let authorized = false;
        if (api.isConnected) {
          const result = await api.isConnected();
          authorized = typeof result === "boolean" ? result : result.isConnected === true;
        }
        let currentAddress: string | null = null;
        if (authorized && api.getAddress) currentAddress = readAddress(await api.getAddress());
        if (!currentAddress && authorized && api.getPublicKey) currentAddress = await api.getPublicKey();
        if (!authorized && !api.isConnected && api.getPublicKey) currentAddress = await api.getPublicKey();
        if (!currentAddress || currentAddress !== parsed.address) throw new Error("Freighter access is no longer available");
        if (cancelled) return;
        setWallet(parsed);
        setConnected(currentAddress, parsed.network || "TESTNET");
      } catch {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage is optional */ }
        if (!cancelled) { setWallet(null); setDisconnected(); }
      } finally {
        if (!cancelled) setIsReconnecting(false);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [setConnected, setDisconnected]);

  const wallets = useMemo(() => walletCatalog.map((wallet) => ({ ...wallet, isInstalled: installed[wallet.id] })), [installed]);

  const connectWallet = useCallback(async (id: SupportedWalletId) => {
    setLoading(true);
    setError(null);
    try {
      const api = getExtension(id);
      if (!api) throw new Error(`${walletCatalog.find((wallet) => wallet.id === id)?.name ?? id} is not installed.`);
      // All methods that can display a wallet permission prompt are reached
      // only after the user explicitly selects a wallet in the modal.
      const result = id === "freighter"
        ? (api.requestAccess ? await api.requestAccess() : api.getPublicKey ? await api.getPublicKey() : null)
        : id === "lobstr"
          ? (api.requestAccess ? await api.requestAccess() : api.getPublicKey ? await api.getPublicKey() : null)
          : (api.connect ? await api.connect() : api.getPublicKey ? await api.getPublicKey() : null);
      const walletAddress = readAddress(result);
      if (!walletAddress) throw new Error("The wallet did not return a public address or connection was declined.");
      const next: SavedWallet = { type: id, address: walletAddress, network: "TESTNET", connected: true };
      setWallet(next);
      setConnected(walletAddress, next.network);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        localStorage.setItem(LAST_WALLET_KEY, id);
      } catch { /* connecting remains usable when storage is blocked */ }
      setIsModalOpen(false);
      onConnected?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect wallet.");
    } finally {
      setLoading(false);
    }
  }, [onConnected, setConnected, setError, setLoading]);

  const disconnect = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch { /* store state is still cleared if storage is unavailable */ }
    setWallet(null);
    setDisconnected();
    setIsModalOpen(false);
    onDisconnected?.();
  }, [onDisconnected, setDisconnected]);

  if (isReconnecting || loading) {
    return <button type="button" disabled aria-live="polite" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RefreshCw size={15} className="animate-spin" aria-hidden="true" />Reconnecting…</button>;
  }

  if (connected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" title={`${network ?? "Stellar"} ${wallet?.type ?? "wallet"}`}><WalletIcon size={16} aria-hidden="true" />{truncateAddress(address)}</span>
        <button type="button" onClick={disconnect} className="rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">Disconnect</button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={() => setIsModalOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"><WalletIcon size={16} aria-hidden="true" />Connect Wallet<ChevronDown size={14} aria-hidden="true" /></button>
        {error && <span role="alert" className="max-w-xs text-right text-xs text-red-600">{error}</span>}
      </div>
      <WalletSelectionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} wallets={wallets} onSelectWallet={connectWallet} isConnecting={loading} connectingWalletId={null} errorMessage={error} />
    </>
  );
}

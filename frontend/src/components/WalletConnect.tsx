"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ChevronDown, Wallet, ExternalLink, RefreshCw } from "lucide-react";
import { useOnboarding } from "@/components/OnboardingChecklist";
import { WalletDisconnectControl } from "@/components/WalletDisconnectControl";
import {
  WalletSelectionModal,
  type SupportedWalletId,
  type WalletInfo,
} from "./WalletSelectionModal";
export type WalletType = SupportedWalletId;
export interface WalletState {
import { ShareBalanceDisplay } from "@/components/ShareBalanceDisplay";
type WalletType = "freighter" | "metamask" | "xBull" | "coinbase";
import { WalletIcon } from "./Icons";
type WalletType = "freighter" | "metamask" | "xBull";
type WalletState = {
  type: WalletType;
  address: string;
  network: string;
  connected: boolean;
}
export interface WalletConnectProps {
type WalletType = "freighter" | "metamask" | "xBull" | "coinbase" | "walletconnect";
const STORAGE_KEY = "aura_wallet_state";
const LAST_WALLET_KEY = "aura_last_wallet_type";
export type WalletState = {
  type?: WalletType;
  address?: string | null;
  network?: string | null;
  connected?: boolean;
  walletType?: WalletType | string | null;
};
type WalletConnectProps = {
  onConnected?: () => void;
  onDisconnected?: () => void;
const STORAGE_KEY = "aura_wallet_state";
const LAST_WALLET_KEY = "aura_last_wallet";
export function truncate(address: string): string {
  if (!address || address.length <= 10) return address || "";
};
function truncate(address: string) {
function truncate(address?: string | null) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
/**
 * Supported wallet definitions with metadata and install instructions
 */
export const SUPPORTED_WALLETS_METADATA: Record<
  SupportedWalletId,
  {
    name: string;
    description: string;
    installUrl: string;
    installInstructions: string;
  }
> = {
  freighter: {
    name: "Freighter",
    description: "Official Stellar browser extension wallet by SDF",
    installUrl: "https://www.freighter.app/",
    installInstructions:
      "Install the Freighter extension from freighter.app, create or import your account, then click connect.",
  },
  lobstr: {
    name: "Lobstr",
    description: "Leading mobile & web wallet for the Stellar network",
    installUrl: "https://lobstr.co/",
      "Install the Lobstr Signer extension or mobile app from lobstr.co, log in, then click connect.",
  xbull: {
    name: "xBull",
    description: "Privacy-focused powerful wallet for Stellar & Soroban",
    installUrl: "https://xbull.app/",
      "Install the xBull extension from xbull.app, unlock your wallet, then click connect.",
};
 * Detect which wallets are installed in the browser environment
export function detectInstalledWallets(): Record<SupportedWalletId, boolean> {
  if (typeof window === "undefined") {
    return { freighter: false, lobstr: false, xbull: false };
  const win = window as unknown as {
    freighterApi?: unknown;
    freighter?: unknown;
    lobstr?: unknown;
    lobstrSignerExtension?: unknown;
    xBullSDK?: unknown;
    xbull?: unknown;
  };
  return {
    freighter: Boolean(win.freighterApi || win.freighter),
    lobstr: Boolean(win.lobstr || win.lobstrSignerExtension),
    xbull: Boolean(win.xBullSDK || win.xbull),
 * Consistent wallet connection using Stellar Wallets Kit with graceful fallback
export async function connectViaStellarWalletsKit(
  walletId: SupportedWalletId
): Promise<{ address: string; network: string; usedFallback?: boolean }> {
  let kitModule: any = null;
  try {
    // Dynamic import to maintain safe SSR and kit availability resilience
    kitModule = await import("@creit-tech/stellar-wallets-kit");
  } catch {
    try {
      kitModule = await import("@creit.tech/stellar-wallets-kit");
    } catch {
      kitModule = null;
    }
  // If Stellar Wallets Kit is available, attempt to connect through it
  if (kitModule && kitModule.StellarWalletsKit) {
      const { StellarWalletsKit } = kitModule;
      // Kit wallet ID mapping
      const kitIdMap: Record<SupportedWalletId, string> = {
        freighter: "freighter",
        lobstr: "lobstr",
        xbull: "xbull",
      };
      if (typeof StellarWalletsKit.setWallet === "function") {
        StellarWalletsKit.setWallet(kitIdMap[walletId]);
      }
      if (typeof StellarWalletsKit.getAddress === "function") {
        const res = await StellarWalletsKit.getAddress();
        const address = typeof res === "string" ? res : res?.address;
        if (address) {
          return { address, network: "TESTNET", usedFallback: false };
        }
    } catch (kitErr) {
      console.warn("StellarWalletsKit error, falling back to direct extension:", kitErr);
  // Graceful fallback: Direct browser extension API connection
    throw new Error("Window object is not available.");
  const win = window as any;
  if (walletId === "freighter") {
    const api = win.freighterApi || win.freighter;
    if (!api) {
      throw new Error(
        "Freighter is not installed. Please install Freighter from https://www.freighter.app/"
      );
    let address: string | undefined;
    if (api.requestAccess) {
      const access = await api.requestAccess();
      address = typeof access === "string" ? access : access?.address;
    if (!address && api.getPublicKey) {
      address = await api.getPublicKey();
    if (!address) {
      throw new Error("Freighter connection was cancelled or returned no public key.");
    return { address, network: "TESTNET", usedFallback: true };
  if (walletId === "lobstr") {
    const lobstr = win.lobstr || win.lobstrSignerExtension;
    if (!lobstr) {
        "Lobstr is not installed. Please install Lobstr from https://lobstr.co/"
    if (lobstr.getPublicKey) {
      address = await lobstr.getPublicKey();
    } else if (lobstr.isConnected && lobstr.requestAccess) {
      const res = await lobstr.requestAccess();
      address = typeof res === "string" ? res : res?.address;
      throw new Error("Lobstr connection returned no public key.");
  if (walletId === "xbull") {
    const xbull = win.xBullSDK || win.xbull;
    if (!xbull) {
        "xBull is not installed. Please install xBull from https://xbull.app/"
    if (xbull.getPublicKey) {
      address = await xbull.getPublicKey();
    } else if (xbull.connect) {
      const res = await xbull.connect();
      throw new Error("xBull connection returned no public key.");
  throw new Error(`Unsupported wallet type: ${walletId}`);
export default function WalletConnect({
  onConnected,
  onDisconnected,
}: WalletConnectProps) {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [connectingId, setConnectingId] = useState<SupportedWalletId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [installedMap, setInstalledMap] = useState<Record<SupportedWalletId, boolean>>({
    freighter: false,
    lobstr: false,
    xbull: false,
  });
  const [isKitFallback, setIsKitFallback] = useState(false);
  const { markComplete } = useOnboarding();
  // Refresh installed wallets status
  const refreshInstalledWallets = useCallback(() => {
    setInstalledMap(detectInstalledWallets());
  }, []);
  // Hydration-safe initial load of wallet state and installed detection
  useEffect(() => {
    refreshInstalledWallets();
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.connected && parsed?.address) {
            setWallet(parsed);
          }
      } catch {
        // ignore corrupt local storage
  }, [refreshInstalledWallets]);
  // Handle wallet connection selection
  const handleSelectWallet = async (walletId: SupportedWalletId) => {
  // Hydration-safe: Detect wallets and restore persisted wallet state on client mount only
    detectWallets();
    if (typeof window === "undefined") return;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.address || parsed.connected)) {
          setWallet(parsed);
      // Ignore storage errors in restricted iframe/private mode
  }, [detectWallets]);
  async function connectWallet(type: WalletType) {
    setLoading(true);
    setConnectingId(walletId);
    setError(null);
      const { address, network, usedFallback } =
        await connectViaStellarWalletsKit(walletId);
      if (usedFallback) {
        setIsKitFallback(true);
      const nextState: WalletState = {
        type: walletId,
        address,
        network: network.toUpperCase(),
        connected: true,
      setWallet(nextState);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        localStorage.setItem(LAST_WALLET_KEY, walletId);
      markComplete?.("connect_wallet");
      setIsModalOpen(false);
      onConnected?.();
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
        const accounts = await win.ethereum.request({
          method: "eth_requestAccounts",
        });
        if (!accounts.length) {
          throw new Error("No MetaMask account was returned.");
        setWallet({
          type,
          address: accounts[0],
        onConnected?.();
        return;
      if (type === "freighter") {
          freighterApi?: {
            requestAccess?: () => Promise<{
              address?: string;
            }>;
            getPublicKey?: () => Promise<string>;
        if (!win.freighterApi) {
          throw new Error("Freighter is not installed.");
        let address: string | undefined;
        if (win.freighterApi.requestAccess) {
          const result = await win.freighterApi.requestAccess();
          address = result.address;
        if (!address && win.freighterApi.getPublicKey) {
          address = await win.freighterApi.getPublicKey();
        if (!address) {
          throw new Error("No Freighter address was returned.");
          address,
        const state: WalletState = {
          connected: true,
          walletType: type,
        setWallet(state);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            localStorage.setItem(LAST_WALLET_KEY, type);
          } catch {
            // Ignore storage errors
        markComplete("connect_wallet");
        setShowDropdown(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : `Failed to connect to ${SUPPORTED_WALLETS_METADATA[walletId].name}`;
import { useCallback, useEffect } from "react";
  isConnected,
  getAddress,
  requestAccess,
} from "@stellar/freighter-api";
import { useWalletStore } from "@/lib/walletStore";
 * Truncates a Stellar public key: first 4 chars + "..." + last 4 chars.
 * Example: GABC...WXYZ
export function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
    </svg>
  );
export default function WalletConnect() {
  const { address, network, connected, loading, error, setConnected, setDisconnected, setLoading, setError } =
    useWalletStore();
  // On mount: if the store says we were connected, verify Freighter still has access
    if (connected && address) {
      verifySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  async function verifySession() {
      const connResult = await isConnected();
      if (!connResult.isConnected) {
        setDisconnected();
          : "Failed to connect to Freighter"
    } finally {
      setLoading(false);
  function disconnectWallet() {
    setWallet(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LAST_WALLET_KEY);
        // ignore
    onDisconnected?.();
  const connectMetaMask = useCallback(async () => {
      const w = window as unknown as Record<string, unknown>;
      const ethereum = w.ethereum as
        | Record<string, (...args: unknown[]) => Promise<unknown>>
        | undefined;
      if (!ethereum) {
        setError("MetaMask not found. Please install the extension.");
        return;
      const addrResult = await getAddress();
      if (addrResult.error || !addrResult.address) {
      setDisconnected();
  const connect = useCallback(async () => {
      // 1. Check if Freighter extension is installed
        setError(
          "Freighter wallet not found. Please install the extension."
        );
      // 2. Request access (triggers the Freighter popup)
      const accessResult = await requestAccess();
      if (accessResult.error) {
        // Handle user declining gracefully
        if (
          typeof accessResult.error === "string" &&
          accessResult.error.includes("User declined")
        ) {
          setError("Connection declined. Please approve the request in Freighter.");
        } else {
          setError(
            typeof accessResult.error === "string"
              ? accessResult.error
              : "Failed to connect wallet"
          );
      // 3. Get the public key and network
        setError("Could not retrieve address from Freighter.");
      // @stellar/freighter-api v6 returns network from requestAccess
      const networkName =
        (accessResult as any).network?.toUpperCase() ??
        (accessResult as any).networkPassphrase?.includes("Test")
          ? "TESTNET"
          : "MAINNET";
      setConnected(addrResult.address, networkName ?? "TESTNET");
      const msg = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(msg);
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainId = (await ethereum.request({
        method: "eth_chainId",
      })) as string;
      const networkName = chainId === "0x1" ? "ETHEREUM" : "TESTNET";
      const state: WalletState = {
        type: "metamask",
        address: accounts[0],
      setWallet(state);
      markComplete("connect_wallet");
      setShowDropdown(false);
      setError(
          : "Failed to connect to MetaMask"
    } finally {
      setLoading(false);
      setConnectingId(null);
    }
  const disconnectWallet = () => {
    setWallet(null);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LAST_WALLET_KEY);
    onDisconnected?.();
  // Prepare wallet list for modal
  const walletList: WalletInfo[] = (["freighter", "lobstr", "xbull"] as SupportedWalletId[]).map(
    (id) => ({
      id,
      name: SUPPORTED_WALLETS_METADATA[id].name,
      description: SUPPORTED_WALLETS_METADATA[id].description,
      installUrl: SUPPORTED_WALLETS_METADATA[id].installUrl,
      installInstructions: SUPPORTED_WALLETS_METADATA[id].installInstructions,
      isInstalled: installedMap[id] ?? false,
    })
  // If connected, render connected state
  }, [markComplete]);
  const connectCoinbase = useCallback(async () => {
      const { CoinbaseWalletSDK } = await import(
        "@coinbase/wallet-sdk"
      const coinbaseWallet = new CoinbaseWalletSDK({
        appName: "Aura Vault Protocol",
        appLogoUrl: "/logo.png",
      });
      const provider = coinbaseWallet.makeWeb3Provider();
      const accounts = (await provider.request({
        type: "metamask", // Coinbase uses MetaMask-compatible provider
      localStorage.setItem(LAST_WALLET_KEY, "coinbase");
        type: "coinbase",
          : "Failed to connect to Coinbase Wallet"
  if (wallet) {
    const meta = SUPPORTED_WALLETS_METADATA[wallet.type];
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
              {meta ? meta.name.charAt(0) : "W"}
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Connected ({meta?.name || wallet.type})
              </p>
              <p
                data-testid="wallet-address"
                className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                {truncate(wallet.address)}
          </div>
          <span
            data-testid="network-badge"
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {wallet.network || "TESTNET"}
          </span>
        </div>
        <WalletDisconnectControl address={wallet.address} onConfirm={disconnectWallet} />
  }, [setConnected, setError, setLoading]);
  const disconnect = useCallback(() => {
    setDisconnected();
  }, [setDisconnected]);
  // ── Freighter not installed ──────────────────────────────────────────────
  if (error?.includes("not found")) {
      <div className="flex flex-col gap-3 w-full">
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          <p className="font-semibold mb-1">Freighter Wallet Not Detected</p>
          <p className="mb-2">
            Install the Freighter browser extension to connect your Stellar
            wallet.
          </p>
          <a
            href="https://www.freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80"
            aria-label="Install Freighter wallet extension (opens in new tab)"
            Install Freighter →
          </a>
          onClick={() => setError(null)}
          className="self-start text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          Try again
        </button>
      </div>
    );
  // ── Connected state ──────────────────────────────────────────────────────
  if (connected && address) {
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
            aria-label="Connected"
            className="inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-800"
          />
          {/* Network badge */}
            data-cy="network-badge"
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
            {network ?? "TESTNET"}
          {/* Truncated address */}
            data-cy="wallet-address"
            className="font-mono text-sm text-zinc-700 dark:text-zinc-300"
            title={address}
            {truncateAddress(address)}
          {/* Disconnect */}
          <button
            data-cy="disconnect-wallet-btn"
            onClick={disconnect}
            className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Disconnect wallet"
            Disconnect
          </button>
  // ── Disconnected state ───────────────────────────────────────────────────
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-3">
          data-cy="connect-wallet-btn"
          onClick={connect}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors"
          aria-label="Connect Freighter wallet"
          {loading && <Spinner />}
          {loading ? "Connecting…" : "Connect Wallet"}
      </div>
    );
  // ── Connected state ──────────────────────────────────────────────────────
  if (connected && address) {
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
            aria-label="Connected"
            className="inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-800"
          />
          {/* Network badge */}
            data-cy="network-badge"
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
            {network ?? "TESTNET"}
          {/* Truncated address */}
            data-cy="wallet-address"
            className="font-mono text-sm text-zinc-700 dark:text-zinc-300"
            title={address}
            {truncateAddress(address)}
          {/* Disconnect */}
          <button
            data-cy="disconnect-wallet-btn"
            onClick={disconnect}
            className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Disconnect wallet"
            Disconnect
          </button>
  // ── Disconnected state ───────────────────────────────────────────────────
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-3">
          data-cy="connect-wallet-btn"
          onClick={connect}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors"
          aria-label="Connect Freighter wallet"
          {loading && <Spinner />}
          {loading ? "Connecting…" : "Connect Wallet"}
      </div>
    );
  // ── Connected state ──────────────────────────────────────────────────────
  if (connected && address) {
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
            aria-label="Connected"
            className="inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-800"
          />
          {/* Network badge */}
            data-cy="network-badge"
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
            {network ?? "TESTNET"}
          {/* Truncated address */}
            data-cy="wallet-address"
            className="font-mono text-sm text-zinc-700 dark:text-zinc-300"
            title={address}
            {truncateAddress(address)}
          {/* Disconnect */}
          <button
            data-cy="disconnect-wallet-btn"
            onClick={disconnect}
            className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Disconnect wallet"
            Disconnect
          </button>
  // ── Disconnected state ───────────────────────────────────────────────────
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-3">
          data-cy="connect-wallet-btn"
          onClick={connect}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors"
          aria-label="Connect Freighter wallet"
          {loading && <Spinner />}
          {loading ? "Connecting…" : "Connect Wallet"}
      </div>
    );
  }

  // Disconnected state: trigger modal button
    <>
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Connect Wallet
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Connect with Freighter, Lobstr, or xBull via Stellar Wallets Kit.
          data-testid="connect-wallet-btn"
          onClick={() => {
            refreshInstalledWallets();
            setIsModalOpen(true);
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm"
          <Wallet size={16} />
          Connect Wallet
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
        )}
      <WalletSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        wallets={walletList}
        onSelectWallet={handleSelectWallet}
        isConnecting={loading}
        connectingWalletId={connectingId}
        errorMessage={error}
        kitFallbackActive={isKitFallback}
    </>
      {error && !error.includes("not found") && (
        <p
          className="text-sm text-red-600 dark:text-red-400"
          data-cy="wallet-error"
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Connect Wallet</p>
        <p className="text-sm text-gray-500">
          Select an installed wallet.
        </p>
      {wallets.length === 0 ? (
          No supported wallet detected.
      ) : (
        wallets.map((type) => (
            key={type}
            data-testid="connect-wallet-btn"
            type="button"
            onClick={() => connectWallet(type)}
            disabled={loading}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            <WalletIcon type={type} size={18} />
            <span>{loading ? "Connecting..." : `Connect ${type}`}</span>
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

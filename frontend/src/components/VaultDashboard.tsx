"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WalletConnect from "./WalletConnect";
import VaultActions from "./VaultActions";
import { FinancialValue } from "./FinancialValue";
import { EmptyState } from "./EmptyState";
import { AnimatedShareBalance } from "./AnimatedShareBalance";
import { useAnimatedNumber } from "@/lib/useAnimatedNumber";
import {
  useKeyboardShortcuts,
  type ShortcutAction,
} from "@/lib/useKeyboardShortcuts";
import { KeyboardShortcutHelp } from "./KeyboardShortcutHelp";
import type { DeepLinkAction } from "@/lib/useDeepLink";
import { ExplorerMenu } from "./ExplorerMenu";
import VaultPauseBanner from "./VaultPauseBanner";
import AdminPauseControls from "./AdminPauseControls";
import { useVaultPause } from "@/lib/useVaultPause";
import { PrintPortfolioButton } from "./PrintPortfolioButton";
import { VaultCapacityBar } from "./VaultCapacityBar";
interface VaultStats {
  tvl: string;
  apy: string;
  userBalance: string;
  userShares: string;
  pricePerShare: string;
  sharePriceUpdatedAt?: number;
}
interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "harvest";
  amount: string;
  timestamp: number;
  hash: string;
/** Modal type driven by keyboard shortcuts */
type ShortcutModal = "deposit" | "withdraw" | null;
function StatCard({
  label,
  value,
  rawValue,
  decimals,
  suffix,
  sub,
  testId,
}: {
  label: string;
  value: string;
  rawValue?: number;
  decimals?: number;
  suffix?: string;
  sub?: string;
  testId?: string;
}) {
  const animatedValue = useAnimatedNumber(rawValue ?? 0, { decimals });
  const displayValue =
    rawValue !== undefined ? `${animatedValue}${suffix ?? ""}` : value;
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {displayValue}
      {sub && <span className="text-xs text-zinc-400">{sub}</span>}
import useSWR from "swr";
import { RefreshCw, TrendingUp, Users, DollarSign, Percent, AlertCircle } from "lucide-react";
// ── Types ───────────────────────────────────────────────────────────────────
  totalAssets: string;       // raw integer string (stroops or token units)
  totalShares: string;       // raw integer string
  totalDepositors: number;
  apy7d: number;             // basis points, e.g. 850 = 8.50%
  sharePriceBps: number;     // price per share × 10000
// ── Fetcher ─────────────────────────────────────────────────────────────────
async function fetchVaultStats(): Promise<VaultStats> {
  const [assetsRes, statsRes] = await Promise.all([
    fetch("/api/vault/total_assets"),
    fetch("/api/vault/stats"),
  ]);
  const assets = assetsRes.ok ? await assetsRes.json() : {};
  const stats = statsRes.ok ? await statsRes.json() : {};
  const totalAssets = assets.total ?? stats.totalAssets ?? "0";
  const totalShares = stats.totalShares ?? "1";
  const totalDepositors = stats.totalDepositors ?? stats.depositors ?? 0;
  const apy7d = stats.apy7d ?? stats.apy ?? 0;
  // Share price = totalAssets / totalShares × 10000 (bps for display)
  let sharePriceBps = 10000;
  try {
    const a = BigInt(totalAssets);
    const s = BigInt(totalShares);
    if (s > 0n) sharePriceBps = Number((a * 10000n) / s);
  } catch {
    /* ignore BigInt parse failures */
  }
  return { totalAssets, totalShares, totalDepositors, apy7d, sharePriceBps };
// ── Skeleton ─────────────────────────────────────────────────────────────────
function StatCardSkeleton() {
      className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-3"
      aria-busy="true"
      aria-label="Loading stat"
      <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
      <div className="h-7 w-32 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
      <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const sentimentMap = {
    deposit: "positive" as const,
    withdraw: "negative" as const,
    harvest: "warning" as const,
  };
  const iconMap = {
    deposit: "↓",
    withdraw: "↑",
    harvest: "⚡",
    <div className="flex items-center justify-between border-b border-zinc-100 py-2.5 last:border-0 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <span aria-hidden="true">
          <FinancialValue
            value={iconMap[tx.type]}
            sentiment={sentimentMap[tx.type]}
            className="text-lg"
          />
        </span>
        <div>
          <p className="text-sm font-medium capitalize text-zinc-800 dark:text-zinc-200">
            {tx.type}
          </p>
          <p className="font-mono text-xs text-zinc-400">{tx.timestamp}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {tx.amount}
        </p>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label={`View transaction ${tx.hash} on explorer`}
        >
          {tx.hash.slice(0, 8)}…
        </a>
// ── Stat Card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  icon: React.ReactNode;
  tooltip?: string;
function StatCard({ label, value, icon, sub, tooltip }: StatCardProps) {
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {label}
        <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-50">
          {value}
        {tooltip && (
          <span className="group relative mb-0.5 cursor-default text-zinc-400 hover:text-zinc-600">
            <span aria-hidden="true" className="text-xs">ⓘ</span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-zinc-800 dark:bg-zinc-200 px-3 py-2 text-xs text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
            >
              {tooltip}
            </span>
          </span>
        )}
      {sub && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{sub}</p>
      )}
        <ExplorerMenu
          value={tx.hash}
          type="tx"
        />
    </div>
  );
}

const MOCK_TXS: Transaction[] = [
  {
    id: "1",
    type: "deposit",
    amount: "500 USDC",
    timestamp: 1787688610304,
    hash: "abc123def456",
  },
    id: "2",
    type: "harvest",
    amount: "12.5 USDC",
    timestamp: 1787685010304,
    hash: "fff999aaa111",
    id: "3",
    type: "withdraw",
    amount: "100 USDC",
    timestamp: 1787602210304,
    hash: "dead1234beef",
];
export default function VaultDashboard() {
export default function VaultDashboard({
  initialAction = null,
  initialAmount = null,
  onDeepLinkHandled,
  initialAction?: DeepLinkAction | null;
  initialAmount?: string | null;
  onDeepLinkHandled?: () => void;
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [txs] = useState<Transaction[]>(MOCK_TXS);
  const [loading, setLoading] = useState(true);
  const [liveMsg, setLiveMsg] = useState("");
  // ── Keyboard shortcut state ───────────────────────────────────────────────
  /** Which modal (if any) was opened via a keyboard shortcut */
  const [shortcutModal, setShortcutModal] = useState<ShortcutModal>(null);
  /** Controls the "?" shortcut help dialog */
  const [helpOpen, setHelpOpen] = useState(false);
  /** ref for the search input so "/" can focus it */
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { markComplete } = useOnboarding();
  // Mark "view_dashboard" milestone when dashboard is first viewed
  useEffect(() => {
    markComplete("view_dashboard");
  }, [markComplete]);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  // Vault pause state — single source of truth for the entire dashboard.
  const { isPaused, refresh: refreshPauseState } = useVaultPause();
  // Read connected wallet address from localStorage (set by WalletConnect).
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("walletState");
      if (raw) {
        const parsed = JSON.parse(raw) as { address?: string };
        if (parsed?.address) setConnectedAddress(parsed.address);
      }
    } catch {
      // ignore
    }
  }, []);
  const fetchStats = useCallback(async () => {
    try {
      const [assetsRes, apyRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/total_assets`),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/apy`),
      ]);
      const assets = assetsRes.ok ? await assetsRes.json() : { total: "0" };
      const apyData = apyRes.ok ? await apyRes.json() : { apy: "0" };
      setStats({
        tvl: assets.total ?? "0",
        apy: apyData.apy ?? "0",
        userBalance: assets.userBalance ?? "—",
        userShares: assets.userShares ?? "—",
        pricePerShare: assets.pricePerShare ?? "1.0000",
        sharePriceUpdatedAt: Date.now(),
      });
    } catch {
        tvl: "—",
        apy: "—",
        userBalance: "—",
        userShares: "—",
        pricePerShare: "—",
    } finally {
      setLoading(false);
    }
  }, []);
    fetchStats();
    void fetchStats();
  }, [fetchStats]);
    const wsUrl =
      typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_URL ??
            `ws://${window.location.host}/api/ws/vault`)
        : null;
    if (!wsUrl) return;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    function connect() {
      ws = new WebSocket(wsUrl!);
      wsRef.current = ws;
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          const msg = JSON.parse(evt.data as string) as {
            type: string;
            tvl?: string;
            apy?: string;
          };
          if (msg.type === "vault_update") {
            setStats((prev) =>
              prev
                ? {
                    ...prev,
                    tvl: msg.tvl ?? prev.tvl,
                    apy: msg.apy ?? prev.apy,
                  }
                : prev,
            );
            setLiveMsg("Balance updated");
            setTimeout(() => {
              setLiveMsg("");
            }, 3000);
            setTimeout(() => setLiveMsg(""), 3000);
          }
        } catch {
          // Ignore malformed WebSocket messages.
        }
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000);
    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  // ── Keyboard shortcut definitions ─────────────────────────────────────────
  const shortcuts = useMemo<ShortcutAction[]>(
    () => [
      {
        key: "d",
        label: "Open Deposit modal",
        handler: () => setShortcutModal("deposit"),
      },
        key: "w",
        label: "Open Withdraw modal",
        handler: () => setShortcutModal("withdraw"),
        key: "h",
        label: "Harvest yield",
        handler: () => {
          setLiveMsg("Harvest triggered via keyboard shortcut");
          setTimeout(() => setLiveMsg(""), 3000);
        },
        key: "/",
        label: "Focus search",
          searchInputRef.current?.focus();
        key: "?",
        label: "Show keyboard shortcuts",
        handler: () => setHelpOpen(true),
    ],
    [],
  // Disable all shortcuts while any modal (including the help dialog) is open
  // so keys don't fire behind the overlay.
  const shortcutsDisabled = helpOpen || shortcutModal !== null;
  useKeyboardShortcuts(shortcuts, { disabled: shortcutsDisabled });
  const fmtNumber = (value: string) => {
    const number = parseFloat(value);
    if (Number.isNaN(number)) {
      return value;
    return number.toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
    if (Number.isNaN(number)) return value;
    return number.toLocaleString(undefined, { maximumFractionDigits: 4 });
    <main className="relative z-0 mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      {/* ── Screen-reader live region ──────────────────────────────────────── */}
    <main
      className="relative z-0 mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8"
      data-print="portfolio-root"
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMsg}
      {/* ── Keyboard shortcut help dialog ──────────────────────────────────── */}
      <KeyboardShortcutHelp
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        shortcuts={shortcuts}
      />
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Vault Dashboard
          </h1>
          <p className="text-sm text-zinc-500">
            Real-time overview of your Aura vault positions.
        {/* "?" shortcut hint button — always visible in the header */}
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className={[
            "flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5",
            "text-xs font-medium text-zinc-500 transition-colors",
            "hover:border-zinc-300 hover:text-zinc-700",
            "dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
          ].join(" ")}
          aria-label="Show keyboard shortcuts (press ?)"
          title="Keyboard shortcuts (?)"
          <kbd className="font-mono text-xs">?</kbd>
          <span>Shortcuts</span>
        </button>
      {/* ── Portfolio ──────────────────────────────────────────────────────── */}
      {/* Vault pause banner — full-width at the top of the dashboard */}
      <VaultPauseBanner isPaused={isPaused} />
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Vault Dashboard
        </h1>
        <div className="flex items-center justify-between gap-4">
          {/* Print button — hidden automatically in @media print via data-print-trigger */}
          <PrintPortfolioButton />
        <p className="text-sm text-zinc-500">
          Real-time overview of your Aura vault positions.
      {/* Portfolio */}
      <section
        data-testid="portfolio-section"
        aria-label="Portfolio"
        className="relative z-0"
        {loading ? (
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-4"
            aria-busy="true"
            aria-label="Loading vault statistics"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-24 rounded-xl border border-zinc-200 bg-zinc-100 animate-pulse dark:border-zinc-700 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : (
            className="relative z-0 grid grid-cols-2 gap-4 sm:grid-cols-4"
            role="region"
            aria-label="Vault statistics"
            <StatCard
              data-cy="stat-tvl"
              label="TVL"
              value={fmtNumber(stats!.tvl)}
              rawValue={parseFloat(stats!.tvl)}
              decimals={4}
              sub="Total Value Locked"
            />
              testId="apy"
              data-cy="stat-apy"
              label="APY"
              value={`${fmtNumber(stats!.apy)}%`}
              rawValue={parseFloat(stats!.apy)}
              decimals={2}
              suffix="%"
              sub="Annualized yield"
              testId="share-balance"
              data-cy="stat-balance"
              label="Your Balance"
              value={fmtNumber(stats!.userBalance)}
              rawValue={parseFloat(stats!.userBalance)}
              sub="Underlying tokens"
              testId="price-per-share"
              label="Your Shares"
              value={fmtNumber(stats!.userShares)}
              sub={`@ ${stats!.pricePerShare} / share`}
            <div
              data-testid="price-per-share"
              className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Your Shares
              </span>
              <AnimatedShareBalance
                value={fmtNumber(stats!.userShares)}
                className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
              data-cy="stat-shares"
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Your Shares</span>
              <span className="text-xs text-zinc-400">
                <AnimatedShareBalance
                  value={stats!.pricePerShare}
                  className="font-mono"
                  priceMode
                />
                {" / share"}
            </div>
        {!loading && (
          <p className="mt-3 text-sm text-zinc-500">
            Price per share: {stats!.pricePerShare}
      </section>
      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="relative">
        <label htmlFor="vault-search" className="sr-only">
          Search transactions
        </label>
        <input
          id="vault-search"
          ref={searchInputRef}
          type="search"
          placeholder='Search transactions… (press "/" to focus)'
            "w-full rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm",
            "text-zinc-900 placeholder-zinc-400 outline-none",
            "focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
            "dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800",
      {/* ── Wallet and Actions ─────────────────────────────────────────────── */}
      <div className="relative z-0 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section aria-labelledby="wallet-heading" className="relative z-0">
          <h2
            id="wallet-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500"
      {/* Vault Capacity Bar — Issue #1005: only visible when tvl_cap is set */}
      <VaultCapacityBar />
      {/* Wallet + Actions row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section aria-labelledby="wallet-heading">
          <h2 id="wallet-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Wallet
          </h2>
          <WalletConnect />
        </section>
        <section aria-labelledby="actions-heading" className="relative z-0">
            id="actions-heading"
            Actions
            <span className="ml-2 font-normal normal-case text-zinc-400">
              (D = deposit, W = withdraw)
          {/*
           * externalModal / onExternalModalClose connect keyboard shortcuts
           * (managed here in VaultDashboard) to the modal inside VaultActions.
           */}
          <VaultActions
            externalModal={shortcutModal}
            onExternalModalClose={() => setShortcutModal(null)}
      {/* ── Transactions ───────────────────────────────────────────────────── */}
      <section aria-labelledby="tx-heading" className="relative z-50">
          <VaultActions />
            initialAction={initialAction}
            initialAmount={initialAmount}
            onDeepLinkHandled={onDeepLinkHandled}
      {/* Transactions */}
        aria-labelledby="tx-heading"
        className="relative z-50"
          {/* Pass pause state down so VaultActions doesn't poll separately */}
          <VaultActions isPaused={isPaused} />
      {/* Admin-only pause / unpause control */}
      <AdminPauseControls
        isPaused={isPaused}
        connectedAddress={connectedAddress}
        onToggle={refreshPauseState}
        <div className="relative z-0 mb-3 flex items-center justify-between">
            id="tx-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
            Recent Transactions
          <button
            data-testid="refresh-btn"
            type="button"
            onClick={() => void fetchStats()}
            className="relative z-20 touch-manipulation text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            ↻ Refresh
          </button>
        <div
          data-testid="tx-list"
          className="relative z-0 rounded-xl border border-zinc-200 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-900"
          role="list"
          aria-label="Recent transactions"
          {txs.length === 0 ? (
            <EmptyState variant="no-transactions" className="py-4" />
          ) : (
            txs.map((tx) => (
              <div key={tx.id} role="listitem">
                <TxRow tx={tx} />
              </div>
            ))
          )}
    </main>
// ── Format helpers ───────────────────────────────────────────────────────────
function formatAssets(raw: string): string {
    const n = BigInt(raw);
    // Assume 7 decimal places (Stellar native)
    const whole = n / 10_000_000n;
    const frac = n % 10_000_000n;
    if (whole >= 1_000_000n) {
      return `${(Number(whole) / 1_000_000).toFixed(2)}M`;
    if (whole >= 1_000n) {
      return `${(Number(whole) / 1_000).toFixed(2)}K`;
    const fracStr = frac.toString().padStart(7, "0").slice(0, 2);
    return `${whole}.${fracStr}`;
    return raw === "0" ? "0.00" : raw;
function formatApy(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
function formatSharePrice(bps: number): string {
  return (bps / 10000).toFixed(4);
// ── Main Component ───────────────────────────────────────────────────────────
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR<VaultStats>("vault-stats", fetchVaultStats, {
    refreshInterval: 30_000,  // auto-refresh every 30 seconds
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  });
  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
        aria-label="Vault Dashboard"
        className="w-full rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 flex flex-col items-center gap-4 text-center"
        data-cy="vault-dashboard-error"
        <AlertCircle className="text-red-500" size={32} aria-hidden="true" />
          <p className="font-semibold text-red-700 dark:text-red-400">
            Failed to load vault data
          <p className="text-sm text-red-600 dark:text-red-500 mt-1">
            {error?.message ?? "Unknown error"}
          onClick={() => mutate()}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          aria-label="Retry loading vault data"
          data-cy="retry-btn"
          <RefreshCw size={14} aria-hidden="true" />
          Retry
    );
  // ── Loading skeleton ───────────────────────────────────────────────────
  if (isLoading) {
        aria-label="Vault Dashboard loading"
        aria-busy="true"
        className="w-full"
        data-cy="vault-dashboard-skeleton"
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-36 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
          <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <StatCardSkeleton key={i} />
          ))}
  // ── Data ───────────────────────────────────────────────────────────────
  const stats = data!;
    <section
      aria-label="Vault Dashboard"
      className="w-full"
      data-cy="vault-dashboard"
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Vault Overview
        </h2>
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          aria-label="Refresh vault stats"
          data-cy="refresh-stats-btn"
          <RefreshCw size={12} aria-hidden="true" />
          Refresh
      {/* Stat cards — stacks vertically on mobile, 4-column on large screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Assets"
          value={formatAssets(stats.totalAssets)}
          icon={<DollarSign size={16} />}
          sub="Underlying tokens in vault"
          data-cy="stat-total-assets"
          label="Share Price"
          value={formatSharePrice(stats.sharePriceBps)}
          icon={<TrendingUp size={16} />}
          sub="Assets per share"
          data-cy="stat-share-price"
          label="7-Day APY"
          value={formatApy(stats.apy7d)}
          icon={<Percent size={16} />}
          sub="Annualised from last 7 days"
          tooltip="APY is estimated by comparing vault asset growth over the last 7 days, then annualising: ((assets_now / assets_7d_ago) ^ (365/7) − 1) × 100. Past performance is not a guarantee of future returns."
          data-cy="stat-apy"
          label="Total Depositors"
          value={stats.totalDepositors.toLocaleString()}
          icon={<Users size={16} />}
          sub="Unique depositor addresses"
          data-cy="stat-depositors"
      {/* Auto-refresh notice */}
      <p className="mt-3 text-right text-xs text-zinc-400 dark:text-zinc-600">
        Auto-refreshes every 30 s
      </p>
    </section>
  );
}

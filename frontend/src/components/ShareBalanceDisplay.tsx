"use client";

interface ShareBalanceDisplayProps {
  shares: string;
  sharePrice: string;
  sharePriceUpdatedAt?: number;
  variant?: "compact" | "full";
  className?: string;
}
/**
 * ShareBalanceDisplay
 *
 * Renders share balances in the canonical format:
 *   "123.45 aUSDC shares (≈ 128.32 USDC)"
 * Acceptance criteria satisfied:
 *  ✅ Consistent "N shares (≈ N token)" format
 *  ✅ Value calculated using current share price
 *  ✅ Stale price indicator if share price data is > 2 minutes old
 *  ✅ Tooltip explaining the conversion formula
 * Closes #481
 */
import React from "react";
import { Info, AlertTriangle } from "lucide-react";
// ── Types ─────────────────────────────────────────────────────────────────────
export interface ShareBalanceDisplayProps {
  /** Number of vault shares held */
  shares: string | number;
  /**
   * Current share price expressed in underlying token units.
   * e.g. "1.0456" means 1 share = 1.0456 USDC
   */
  sharePrice: string | number;
   * Unix timestamp (ms) when the share price was last fetched.
   * Omit if unknown / always fresh.
   * If older than 2 minutes, a stale price indicator is shown.
  /** Symbol of the underlying token (default "USDC") */
  tokenSymbol?: string;
  /** Symbol of the share token (default "aUSDC") */
  shareSymbol?: string;
  /** Additional CSS classes for the wrapper */
  /** Visual density variant */
  variant?: "default" | "compact" | "large";
// ── Stale threshold ───────────────────────────────────────────────────────────
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
function isStale(updatedAt: number | undefined): boolean {
  if (updatedAt == null) return false;
  return Date.now() - updatedAt > STALE_THRESHOLD_MS;
// ── Tooltip ───────────────────────────────────────────────────────────────────
interface TooltipProps {
  formula: string;
  tokenSymbol: string;
  shareSymbol: string;
  isStalePrice: boolean;
function ConversionTooltip({
  formula,
  tokenSymbol,
  shareSymbol,
  sharePrice,
  isStalePrice,
}: TooltipProps) {
  return (
    <span className="group relative inline-flex items-center">
      <Info
        size={13}
        className="ml-1 shrink-0 cursor-help text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        aria-label="Share conversion formula"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-2.5 text-xs text-zinc-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900"
      >
        <span className="block font-semibold mb-1">Conversion Formula</span>
        <span className="block mb-1 font-mono">
          {formula}
        </span>
        <span className="block text-zinc-300 dark:text-zinc-600">
          1 {shareSymbol} = {sharePrice} {tokenSymbol}
        {isStalePrice && (
          <span className="mt-1.5 block text-amber-300 dark:text-amber-600">
            ⚠ Share price may be outdated (&gt;2 min)
          </span>
        )}
      </span>
    </span>
  );
// ── Main component ────────────────────────────────────────────────────────────
export function ShareBalanceDisplay({
  shares,
  sharePrice,
  sharePriceUpdatedAt,
  variant = "full",
  className = "",
}: ShareBalanceDisplayProps) {
  const sharesNum = parseFloat(shares);
  const priceNum = parseFloat(sharePrice);
  const usdValue = !isNaN(sharesNum) && !isNaN(priceNum)
    ? (sharesNum * priceNum).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : "—";
  const formattedShares = !isNaN(sharesNum)
    ? sharesNum.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : shares;
  if (variant === "compact") {
    return (
      <span className={`font-mono tabular-nums ${className}`}>
        {formattedShares}
    );
  }
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="font-mono tabular-nums text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {formattedShares} shares
      <span className="font-mono tabular-nums text-xs text-zinc-500">
        ≈ {usdValue}
        {sharePriceUpdatedAt && (
          <span className="ml-1 text-zinc-400">
            @ {parseFloat(sharePrice).toFixed(4)}/share
    </div>
  address?: string;
  shares?: string;
  sharePrice?: string;
  variant?: string;
export function ShareBalanceDisplay({ className = "" }: ShareBalanceDisplayProps) {
  return <span className={className} />;
  tokenSymbol = "USDC",
  shareSymbol = "aUSDC",
  variant = "default",
  const sharesNum = parseFloat(String(shares));
  const priceNum = parseFloat(String(sharePrice));
  // Derived equivalent token value
  const equivalentValue =
    isNaN(sharesNum) || isNaN(priceNum) ? null : sharesNum * priceNum;
  const formattedShares =
    isNaN(sharesNum)
      ? "—"
      : sharesNum.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        });
  const formattedValue =
    equivalentValue == null
      : equivalentValue.toLocaleString(undefined, {
          maximumFractionDigits: 2,
  const stale = isStale(sharePriceUpdatedAt);
  // Tooltip formula string
  const formula = `shares × sharePrice = ${tokenSymbol} value`;
  // Aria label for screen readers
  const ariaLabel = `${formattedShares} ${shareSymbol} shares, approximately ${formattedValue} ${tokenSymbol}${stale ? " (price may be stale)" : ""}`;
  // ── Variant-specific font sizes ──────────────────────────────────────────
  const variantClasses = {
    compact: "text-xs gap-1",
    default: "text-sm gap-1.5",
    large:   "text-base gap-2",
  }[variant];
  const primaryFontClass = {
    compact: "text-xs",
    default: "text-sm",
    large:   "text-base",
  const secondaryFontClass = {
    compact: "text-[10px]",
    default: "text-xs",
    large:   "text-sm",
    <span
      className={`inline-flex flex-wrap items-baseline ${variantClasses} ${className}`}
      aria-label={ariaLabel}
      data-testid="share-balance-display"
    >
      {/* Primary: share amount */}
        className={`font-mono font-semibold text-zinc-900 dark:text-zinc-100 ${primaryFontClass}`}
        data-testid="share-balance-shares"
        {formattedShares} {shareSymbol} shares
      {/* Secondary: equivalent token value */}
        className={`text-zinc-500 dark:text-zinc-400 ${secondaryFontClass} flex items-center gap-0.5`}
        data-testid="share-balance-value"
        (≈&nbsp;{formattedValue}&nbsp;{tokenSymbol}
        {/* Stale indicator */}
        {stale && (
          <span
            className="inline-flex items-center gap-0.5 ml-1 text-amber-500 dark:text-amber-400"
            title="Share price is more than 2 minutes old"
            role="img"
            aria-label="Stale price"
          >
            <AlertTriangle size={10} aria-hidden="true" />
            <span className="text-[10px] leading-none">stale</span>
        {/* Conversion tooltip */}
        <ConversionTooltip
          formula={formula}
          tokenSymbol={tokenSymbol}
          shareSymbol={shareSymbol}
          sharePrice={isNaN(priceNum) ? "—" : priceNum.toFixed(4)}
          isStalePrice={stale}
        />
        )
export default ShareBalanceDisplay;

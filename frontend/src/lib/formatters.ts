/**
 * Locale-aware formatting utilities.
 *
 * Server usage:  import { createFormatters } from "@/lib/formatters";
 *                const fmt = createFormatters(locale);
 *
 * Client usage:  import { useFormatters } from "@/lib/formatters";
 *                const fmt = useFormatters();
 */

"use client";

import { useLocale } from "next-intl";

export interface Formatters {
  /** Format a decimal number with the locale's decimal/grouping separators. */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  /** Format a token amount (up to 7 significant decimal places). */
  formatTokenAmount(value: number): string;
  /** Format a percentage (e.g. APY). */
  formatPercent(value: number, fractionDigits?: number): string;
  /** Format a date using Intl.DateTimeFormat. */
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /** Format a compact relative time string (e.g. "2h ago"). */
  formatRelativeTime(timestamp: number): string;
}

/**
 * Build a Formatters object for any locale.
 * Safe to call on the server or client.
 */
export function createFormatters(locale: string): Formatters {
  return {
    formatNumber(value, options) {
      return new Intl.NumberFormat(locale, options).format(value);
    },

    formatTokenAmount(value) {
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 7,
      }).format(value);
    },

    formatPercent(value, fractionDigits = 2) {
      return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value / 100);
    },

    formatDate(value, options) {
      return new Intl.DateTimeFormat(locale, options).format(
        typeof value === "number" ? new Date(value) : value
      );
    },

    formatRelativeTime(timestamp) {
      const diffMs = timestamp - Date.now();
      const diffSec = Math.round(diffMs / 1000);
      const diffMin = Math.round(diffSec / 60);
      const diffHour = Math.round(diffMin / 60);
      const diffDay = Math.round(diffHour / 24);

      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

      if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
      if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
      if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
      return rtf.format(diffDay, "day");
    },
  };
}

/**
 * React hook — returns formatters bound to the current next-intl locale.
 * Must be called from a Client Component inside NextIntlClientProvider.
 */
export function useFormatters(): Formatters {
  const locale = useLocale();
  return createFormatters(locale);
}

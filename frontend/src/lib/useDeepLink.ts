"use client";

/**
 * useDeepLink — Issues #262 & #1465
 *
 * Reads `?action` and `?amount` query parameters from the current URL and
 * returns validated values the caller can use to pre-open the deposit or
 * withdraw modal. Also carries locale and arbitrary valid search parameters
 * through destination normalization so localized routes and deep links
 * survive intact.
 *
 * Validation rules (invalid values are silently ignored — no crash):
 *   - `action` must be exactly "deposit" or "withdraw"
 *   - `amount` must be a finite, positive number (parsed with parseFloat)
 *
 * Usage:
 *   const { action, amount, locale, preservedParams } = useDeepLink();
 */

import { useSearchParams, usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";

export type DeepLinkAction = "deposit" | "withdraw";

export interface DeepLinkParams {
  /** Validated action, or null if absent / unrecognised. */
  action: DeepLinkAction | null;
  /** Validated amount as a string, or null if absent / invalid. */
  amount: string | null;
  /** Extracted or configured locale prefix (e.g. 'es', 'fr', 'en'). */
  locale: string | null;
  /** Preserved search parameters excluding action and amount. */
  preservedParams: Record<string, string>;
}

const VALID_ACTIONS = new Set<string>(["deposit", "withdraw"]);
const SUPPORTED_LOCALES = new Set<string>(routing.locales);

/**
 * Extracts the locale segment from a pathname (e.g. "/es/tx/123" -> "es").
 */
export function extractLocaleFromPath(pathname: string): string | null {
  if (!pathname) return null;
  const pathOnly = pathname.split(/[?#]/)[0];
  const segments = pathOnly.split("/").filter(Boolean);
  if (segments.length > 0 && SUPPORTED_LOCALES.has(segments[0].toLowerCase())) {
    return segments[0].toLowerCase();
  }
  return null;
}

/**
 * Resolves a localized destination URL, ensuring the locale prefix and
 * valid query parameters (like referral codes or custom filters) are carried over.
 */
export function resolveLocalizedDestination(
  targetPath: string,
  searchParams?: URLSearchParams | string | Record<string, string>,
  targetLocale?: string | null
): string {
  const hashIndex = targetPath.indexOf("#");
  const hash = hashIndex >= 0 ? targetPath.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? targetPath.slice(0, hashIndex) : targetPath;

  const queryIndex = withoutHash.indexOf("?");
  const rawPath = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const inlineQuery = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";

  const cleanPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const existingLocale = extractLocaleFromPath(cleanPath);
  const normalizedTargetLocale =
    targetLocale && SUPPORTED_LOCALES.has(targetLocale.toLowerCase())
      ? targetLocale.toLowerCase()
      : null;

  // Build path with locale prefix if a valid targetLocale is given or already present
  let normalizedPath = cleanPath;
  if (normalizedTargetLocale) {
    if (existingLocale) {
      normalizedPath = cleanPath.replace(
        new RegExp(`^/${existingLocale}(?=/|$)`, "i"),
        `/${normalizedTargetLocale}`
      );
    } else {
      normalizedPath =
        cleanPath === "/" ? `/${normalizedTargetLocale}` : `/${normalizedTargetLocale}${cleanPath}`;
    }
  }

  // Merge inline query params with provided searchParams (searchParams take precedence)
  const params = new URLSearchParams(inlineQuery);
  if (searchParams) {
    const extra = new URLSearchParams(searchParams);
    extra.forEach((value, key) => {
      params.set(key, value);
    });
  }

  const queryString = params.toString();
  return `${normalizedPath}${queryString ? `?${queryString}` : ""}${hash}`;
}

export function useDeepLink(): DeepLinkParams {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Validate action
  const rawAction = searchParams.get("action") ?? "";
  const action: DeepLinkAction | null = VALID_ACTIONS.has(rawAction)
    ? (rawAction as DeepLinkAction)
    : null;

  // Validate amount — must be a finite positive number
  const rawAmount = searchParams.get("amount") ?? "";
  const parsedAmount = parseFloat(rawAmount);
  const amount: string | null =
    rawAmount !== "" && isFinite(parsedAmount) && parsedAmount > 0
      ? String(parsedAmount)
      : null;

  // Detect locale from path or query parameter
  const pathLocale = pathname ? extractLocaleFromPath(pathname) : null;
  const paramLocale = searchParams.get("locale");
  const locale = pathLocale ?? (paramLocale && SUPPORTED_LOCALES.has(paramLocale.toLowerCase()) ? paramLocale.toLowerCase() : null);

  // Preserve all other search parameters
  const preservedParams: Record<string, string> = {};
  searchParams.forEach((val, key) => {
    if (key !== "action" && key !== "amount") {
      preservedParams[key] = val;
    }
  });

  return { action, amount, locale, preservedParams };
}

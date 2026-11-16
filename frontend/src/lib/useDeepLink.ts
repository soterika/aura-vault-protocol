"use client";

/**
 * useDeepLink — Issue #262
 *
 * Reads `?action` and `?amount` query parameters from the current URL and
 * returns validated values the caller can use to pre-open the deposit or
 * withdraw modal.
 *
 * Validation rules (invalid values are silently ignored — no crash):
 *   - `action` must be exactly "deposit" or "withdraw"
 *   - `amount` must be a finite, positive number (parsed with parseFloat)
 *
 * Usage:
 *   const { action, amount } = useDeepLink();
 *   // action: "deposit" | "withdraw" | null
 *   // amount: string (e.g. "100") | null
 */

import { useSearchParams } from "next/navigation";

export type DeepLinkAction = "deposit" | "withdraw";

export interface DeepLinkParams {
  /** Validated action, or null if absent / unrecognised. */
  action: DeepLinkAction | null;
  /** Validated amount as a string, or null if absent / invalid. */
  amount: string | null;
}

const VALID_ACTIONS = new Set<string>(["deposit", "withdraw"]);

export function useDeepLink(): DeepLinkParams {
  const searchParams = useSearchParams();

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

  return { action, amount };
}

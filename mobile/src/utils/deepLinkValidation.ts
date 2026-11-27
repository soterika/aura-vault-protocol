export const SUPPORTED_TOKENS = ["USDC", "USDT", "XLM", "ETH", "SOL"] as const;
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number];
export const DEFAULT_TOKEN: SupportedToken = "USDC";

export interface AmountValidationResult {
  valid: boolean;
  amount: string;
  error?: string;
}

/**
 * Validates a deep-link deposit amount before populating the form.
 * Requires a finite positive number that does not exceed maxBalance.
 */
export function validateDeepLinkAmount(
  rawAmount: string | undefined,
  maxBalance: number
): AmountValidationResult {
  if (rawAmount === undefined || rawAmount.trim() === "") {
    return { valid: true, amount: "" };
  }

  const trimmed = rawAmount.trim();
  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      valid: false,
      amount: "",
      error: "Invalid deposit amount: must be a positive number.",
    };
  }

  if (parsed > maxBalance) {
    return {
      valid: false,
      amount: "",
      error: `Amount exceeds available balance of ${maxBalance}.`,
    };
  }

  return { valid: true, amount: trimmed };
}

/**
 * Normalizes and validates a deep-link token parameter.
 */
export function validateDeepLinkToken(rawToken: string | undefined): SupportedToken {
  if (!rawToken) {
    return DEFAULT_TOKEN;
  }
  const upper = rawToken.trim().toUpperCase();
  if ((SUPPORTED_TOKENS as readonly string[]).includes(upper)) {
    return upper as SupportedToken;
  }
  return DEFAULT_TOKEN;
}

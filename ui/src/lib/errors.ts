export type ErrorSeverity = "warning" | "error";

export interface UserError {
  message: string;
  action?: string;
  severity: ErrorSeverity;
  retryable: boolean;
  /** Original error preserved for logging only — never shown to the user */
  _raw?: unknown;
}

// Map Soroban VaultError codes to human language
const VAULT_ERROR_MAP: Record<number, Pick<UserError, "message" | "action" | "retryable">> = {
  1: { message: "The vault isn't set up yet.", action: "Contact the vault administrator.", retryable: false },
  2: { message: "The vault is already initialised.", action: "No action needed.", retryable: false },
  3: { message: "You don't have enough shares to withdraw that amount.", action: "Reduce the amount and try again.", retryable: false },
  4: { message: "The vault doesn't have enough tokens to cover this withdrawal.", action: "Try a smaller amount or come back later.", retryable: true },
  5: { message: "Amount must be greater than zero.", action: "Enter a positive number.", retryable: false },
  6: { message: "A calculation error occurred.", action: "Try a smaller amount.", retryable: false },
  7: { message: "One of the addresses is invalid.", action: "Check the address and try again.", retryable: false },
  8: { message: "There are no shares in the vault yet.", action: "Make a deposit first.", retryable: false },
  // Codes 9–12 added for Issue #65
  9: { message: "You don't have permission to perform this action.", action: "Connect the admin wallet and try again.", retryable: false },
  10: { message: "The vault cannot be upgraded right now due to a storage mismatch.", action: "Contact the vault administrator.", retryable: false },
  11: { message: "The vault is temporarily paused.", action: "Check the protocol status page and try again later.", retryable: true },
  12: { message: "Unexpected token balance detected. The transaction was blocked for your protection.", action: "Wait a moment and try again. If the problem persists, contact support.", retryable: true },
};

/**
 * Returns a short human-readable label for a vault error code, e.g. "VaultPaused (11)".
 * Returns null when the code is not recognised.
 */
export function errorCodeLabel(code: number): string | null {
  const LABEL: Record<number, string> = {
    1:  "NotInitialized",
    2:  "AlreadyInitialized",
    3:  "InsufficientShares",
    4:  "InsufficientUnderlying",
    5:  "ZeroAmount",
    6:  "MathOverflow",
    7:  "InvalidAddress",
    8:  "ZeroShares",
    9:  "UpgradeUnauthorized",
    10: "StorageLayoutMismatch",
    11: "VaultPaused",
    12: "BalanceMismatch",
  };
  const name = LABEL[code];
  return name ? `${name} (${code})` : null;
}

export function extractVaultCode(err: unknown): number | null {
  if (err && typeof err === "object") {
    // Soroban SDK typically surfaces the code as `.code` or in the message
    const code = (err as Record<string, unknown>).code;
    if (typeof code === "number") return code;
    const msg = String((err as Record<string, unknown>).message ?? "");
    const match = msg.match(/Error\(Contract,\s*#(\d+)\)/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

export function translateError(err: unknown): UserError {
  // 1. Known Soroban vault errors
  const code = extractVaultCode(err);
  if (code !== null && VAULT_ERROR_MAP[code]) {
    return { ...VAULT_ERROR_MAP[code], severity: "error", _raw: err };
  }

  // 2. Network / connectivity
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return {
      message: "Unable to reach the network.",
      action: "Check your connection and try again.",
      severity: "error",
      retryable: true,
      _raw: err,
    };
  }

  // 3. Timeout
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return {
      message: "The request timed out.",
      action: "Wait a moment, then try again.",
      severity: "warning",
      retryable: true,
      _raw: err,
    };
  }

  // 4. Rate limit (HTTP 429 or explicit signal)
  const status = (err as Record<string, unknown>)?.status;
  if (status === 429) {
    return {
      message: "Too many requests. Please slow down.",
      action: "Wait a few seconds before trying again.",
      severity: "warning",
      retryable: true,
      _raw: err,
    };
  }

  // 5. Generic connection errors by message keyword
  const msg = String((err as Record<string, unknown>)?.message ?? err ?? "").toLowerCase();
  if (msg.includes("network") || msg.includes("connection") || msg.includes("offline")) {
    return {
      message: "Connection lost.",
      action: "Check your internet connection and retry.",
      severity: "error",
      retryable: true,
      _raw: err,
    };
  }

  // 6. Transaction rejected / cancelled by the user in their wallet
  if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("cancelled")) {
    return {
      message: "Transaction cancelled.",
      action: "You rejected the transaction in your wallet. Try again when you're ready.",
      severity: "warning",
      retryable: true,
      _raw: err,
    };
  }

  // 7. Transaction simulation or submission failure
  if (msg.includes("transaction") && (msg.includes("fail") || msg.includes("revert") || msg.includes("error"))) {
    return {
      message: "The transaction could not be completed.",
      action: "Check your wallet balance and try again. If it keeps failing, contact support.",
      severity: "error",
      retryable: true,
      _raw: err,
    };
  }

  // 8. Fallback — never expose raw technical details
  return {
    message: "Something went wrong.",
    action: "Please try again. If the problem persists, contact support.",
    severity: "error",
    retryable: true,
    _raw: err,
  };
}

// ---------------------------------------------------------------------------
// Sentry integration stub
// ---------------------------------------------------------------------------

export interface SentryCaptureContext {
  /** Stellar/Soroban wallet public key — attached as tag for issue grouping */
  walletAddress?: string;
  /** Which panel threw (deposit | withdraw | harvest) */
  panelName?: string;
  /** Resolved vault error code, if any */
  errorCode?: number | null;
}

/**
 * Thin Sentry wrapper.
 *
 * In production, replace the body with a real `@sentry/browser` import:
 *
 *   import * as Sentry from "@sentry/browser";
 *   Sentry.captureException(error, { tags: { walletAddress, errorCode, panelName } });
 *
 * The stub is kept here so the rest of the UI can import and call it unconditionally
 * without pulling in the full Sentry SDK unless the team decides to add it.
 */
export const SentryClient = {
  captureContractError(error: unknown, ctx: SentryCaptureContext = {}): void {
    // Real implementation would call Sentry.captureException() here.
    // The stub is intentionally a no-op so it is safe to call in tests and
    // in environments where Sentry has not been initialised.
    if (typeof (globalThis as Record<string, unknown>).__SENTRY_CAPTURE__ === "function") {
      // Allow tests / host apps to inject a spy via globalThis.__SENTRY_CAPTURE__
      (globalThis as Record<string, unknown>).__SENTRY_CAPTURE__(error, ctx);
    }
  },
};

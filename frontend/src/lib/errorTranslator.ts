export type ErrorCode =
  | "INVALID_WALLET_ADDRESS"
  | "INSUFFICIENT_BALANCE"
  | "TRANSACTION_FAILED"
  | "NETWORK_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "REFRESH_TOKEN_EXPIRED"
  | "INVALID_TOKEN"
  | "UNKNOWN";

// ---------------------------------------------------------------------------
// VaultError codes — mirrors the on-chain VaultError discriminants (1–24).
// Keep in sync with aura-vault/src/errors.rs.
// ---------------------------------------------------------------------------

/** Numeric discriminants for every VaultError variant (1–24). */
export type VaultErrorCode =
  | 1   // NotInitialized
  | 2   // AlreadyInitialized
  | 3   // InsufficientShares
  | 4   // InsufficientUnderlying
  | 5   // ZeroAmount
  | 6   // MathOverflow
  | 7   // InvalidAddress
  | 8   // ZeroShares
  | 9   // UpgradeUnauthorized
  | 10  // StorageLayoutMismatch
  | 11  // VaultPaused
  | 12  // BalanceMismatch
  | 13  // TimelockNotExpired
  | 14  // NotApproved
  | 15  // AlreadyVoted
  | 16  // TvlCapExceeded
  | 17  // YieldTooSmall
  | 18  // DistributionAccuracyError
  | 19  // HarvestCooldown
  | 20  // WithdrawalQueued
  | 21  // QueueEntryNotFound
  | 22  // QueueUnbondingPending
  | 23  // InvalidWithdrawalFee
  | 24; // CircuitBreakerTripped

/**
 * Extract a VaultErrorCode from an unknown thrown value.
 *
 * Soroban SDK surfaces contract errors in several shapes depending on the
 * client used. This helper normalises all of them into a typed code, or
 * returns `null` if the error is not a recognisable VaultError.
 *
 * Supported shapes:
 * - `{ code: number }` — raw numeric code on a plain object
 * - `{ contractCode: number }` — Stellar SDK HostError
 * - Error message containing `"Error(Contract, #N)"` — XDR-decoded string
 * - Error message containing `"contract error N"` — friendly SDK message
 */
export function vaultErrorFromCode(error: unknown): VaultErrorCode | null {
  // 1. Plain object with a numeric `code` field (most common in tests/mocks)
  if (error !== null && typeof error === "object") {
    const obj = error as Record<string, unknown>;

    if (typeof obj.code === "number") {
      return toVaultErrorCode(obj.code);
    }
    // Stellar SDK HostError
    if (typeof obj.contractCode === "number") {
      return toVaultErrorCode(obj.contractCode);
    }
  }

  // 2. Parse from error message string
  const msg =
    typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : "";

  // "Error(Contract, #11)" — XDR-decoded Soroban error string
  const xdrMatch = msg.match(/Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/i);
  if (xdrMatch) {
    return toVaultErrorCode(parseInt(xdrMatch[1], 10));
  }

  // "contract error 11" — human-friendly SDK message
  const contractMatch = msg.match(/contract\s+error\s+(\d+)/i);
  if (contractMatch) {
    return toVaultErrorCode(parseInt(contractMatch[1], 10));
  }

  return null;
}

/** Narrow a raw number to VaultErrorCode or return null if out of range. */
function toVaultErrorCode(n: number): VaultErrorCode | null {
  if (Number.isInteger(n) && n >= 1 && n <= 24) {
    return n as VaultErrorCode;
  }
  return null;
}

/**
 * Return a structured, user-friendly recovery context for a VaultError code.
 *
 * Unlike {@link getErrorRecovery} (which classifies arbitrary thrown values),
 * this function works directly from a typed {@link VaultErrorCode} and always
 * returns a fully populated {@link VaultErrorContext} — including a localised
 * title and message sourced from the i18n `vault_errors` namespace when the
 * translation key is available.
 *
 * @param code  - The VaultError discriminant (1–24).
 * @param t     - Optional translation function. When supplied, titles and
 *                messages are pulled from the `vault_errors.<code>.*` i18n
 *                keys so the UI is automatically localised.
 * @param ctx   - Optional runtime context (entered amount, wallet balance, etc.)
 *                used to enrich the recovery message with concrete values.
 */
export function getVaultErrorRecovery(
  code: VaultErrorCode,
  t?: (key: string) => string,
  ctx?: ErrorRecoveryContext
): VaultErrorContext {
  // Helper: resolve a string either from i18n or from the static fallback map.
  const resolve = (field: "title" | "message"): string => {
    if (t) {
      const key = `vault_errors.${code}.${field}`;
      const translated = t(key);
      // translation functions may return the key itself when a translation is missing.
      if (translated !== key) return translated;
    }
    return VAULT_ERROR_STATIC[code]?.[field] ?? VAULT_ERROR_STATIC[5][field];
  };

  const title = resolve("title");
  const baseMessage = resolve("message");

  // Enrich the message with runtime context where relevant.
  const message = enrichMessage(code, baseMessage, ctx);

  const { icon, severity, actions } = VAULT_ERROR_UI[code] ?? VAULT_ERROR_UI[5];

  return { title, message, icon, severity, actions };
}

// ---------------------------------------------------------------------------
// Static fallback strings (English) — used when i18n is not available.
// Kept in sync with the vault_errors namespace in en.json.
// ---------------------------------------------------------------------------

const VAULT_ERROR_STATIC: Record<VaultErrorCode, { title: string; message: string }> = {
  1:  { title: "Vault Not Initialized",      message: "The vault has not been initialized yet. Contact the admin or verify the contract address." },
  2:  { title: "Already Initialized",        message: "The vault has already been initialized and cannot be set up again." },
  3:  { title: "Insufficient Shares",        message: "You do not have enough vault shares to complete this withdrawal. Check your share balance." },
  4:  { title: "Insufficient Underlying",    message: "The vault does not have enough underlying tokens to cover this redemption. Contact the admin." },
  5:  { title: "Zero Amount",                message: "Amount must be greater than zero. Increase the input amount and try again." },
  6:  { title: "Arithmetic Overflow",        message: "Arithmetic overflow: the transaction amount is too large. Try a smaller amount." },
  7:  { title: "Invalid Address",            message: "The address or token is not recognized. Ensure it has been whitelisted by the admin." },
  8:  { title: "No Shareholders",            message: "The vault has no shareholders yet. Yield cannot be distributed until someone deposits." },
  9:  { title: "Unauthorized",               message: "Only the vault admin can perform this action. Connect with the admin account and try again." },
  10: { title: "Storage Layout Mismatch",    message: "Contract upgrade failed: storage layout version mismatch. A migration is required first." },
  11: { title: "Vault Paused",               message: "The vault is currently paused. Please wait for the admin to resume operations." },
  12: { title: "Balance Mismatch",           message: "Security alert: the vault's token balance does not match its records. Contact the admin immediately." },
  13: { title: "Timelock Not Expired",       message: "This governance proposal cannot be executed yet. The timelock period has not elapsed." },
  14: { title: "Proposal Not Approved",      message: "This governance proposal has not received enough approvals to execute." },
  15: { title: "Already Voted",              message: "You have already voted on this proposal. Each signer may only vote once." },
  16: { title: "TVL Cap Exceeded",           message: "This deposit would exceed the vault's total-value-locked cap. Try a smaller amount or wait for capacity." },
  17: { title: "Yield Too Small",            message: "The yield amount is too small to distribute — it rounds to zero per share. Accumulate more yield first." },
  18: { title: "Distribution Accuracy Error","message": "Yield distribution precision check failed. Adjust the yield amount slightly and retry." },
  19: { title: "Harvest Cooldown",           message: "A harvest was performed too recently. Wait for the cooldown period to expire before harvesting again." },
  20: { title: "Withdrawal Queued",          message: "Your withdrawal has been queued. Claim it after the unbonding period expires using your queue entry ID." },
  21: { title: "Queue Entry Not Found",      message: "Withdrawal queue entry not found. It may not exist or may have already been claimed." },
  22: { title: "Unbonding Pending",          message: "Your withdrawal is still in the unbonding period. Please wait and retry after the unlock time." },
  23: { title: "Invalid Withdrawal Fee",     message: "Withdrawal fee exceeds the maximum allowed rate of 5%. Use a value between 0 and 500 basis points." },
  24: { title: "Circuit Breaker Tripped",    message: "Harvest rejected: the share price movement exceeded the safety limit. The vault has been auto-paused pending admin review." },
};

// ---------------------------------------------------------------------------
// UI metadata: icon, severity, and suggested recovery actions per code.
// ---------------------------------------------------------------------------

type UIMetadata = Pick<VaultErrorContext, "icon" | "severity" | "actions">;

const VAULT_ERROR_UI: Record<VaultErrorCode, UIMetadata> = {
  1:  { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Check Contract Address", action: "external" }] },
  2:  { icon: "AlertCircle",  severity: "info",    actions: [] },
  3:  { icon: "Wallet",       severity: "warning", actions: [{ label: "Reduce Amount", action: "reduce_amount" }] },
  4:  { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Try Again Later", action: "retry" }] },
  5:  { icon: "AlertCircle",  severity: "warning", actions: [{ label: "Increase Amount", action: "reduce_amount" }] },
  6:  { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Reduce Amount", action: "reduce_amount" }] },
  7:  { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Start Over", action: "start_over" }] },
  8:  { icon: "AlertCircle",  severity: "info",    actions: [{ label: "Try Again Later", action: "retry" }] },
  9:  { icon: "ShieldOff",    severity: "error",   actions: [{ label: "Start Over", action: "start_over" }] },
  10: { icon: "AlertCircle",  severity: "error",   actions: [] },
  11: { icon: "PauseCircle",  severity: "warning", actions: [{ label: "Follow @AuraVault", action: "external", href: "https://twitter.com/AuraVault" }] },
  12: { icon: "ShieldAlert",  severity: "error",   actions: [] },
  13: { icon: "Clock",        severity: "info",    actions: [{ label: "Try Again Later", action: "retry" }] },
  14: { icon: "ThumbsDown",   severity: "warning", actions: [{ label: "Try Again Later", action: "retry" }] },
  15: { icon: "CheckCircle",  severity: "info",    actions: [] },
  16: { icon: "AlertCircle",  severity: "warning", actions: [{ label: "Reduce Amount", action: "reduce_amount" }] },
  17: { icon: "AlertCircle",  severity: "warning", actions: [{ label: "Try Again Later", action: "retry" }] },
  18: { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Retry", action: "retry" }] },
  19: { icon: "Clock",        severity: "info",    actions: [{ label: "Try Again Later", action: "retry" }] },
  20: { icon: "Clock",        severity: "info",    actions: [] },
  21: { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Start Over", action: "start_over" }] },
  22: { icon: "Clock",        severity: "info",    actions: [{ label: "Try Again Later", action: "retry" }] },
  23: { icon: "AlertCircle",  severity: "error",   actions: [{ label: "Start Over", action: "start_over" }] },
  24: { icon: "ShieldAlert",  severity: "error",   actions: [{ label: "Follow @AuraVault", action: "external", href: "https://twitter.com/AuraVault" }] },
};

/** Optionally inject runtime values into the message for specific error codes. */
function enrichMessage(
  code: VaultErrorCode,
  base: string,
  ctx?: ErrorRecoveryContext
): string {
  if (!ctx) return base;
  const symbol = ctx.tokenSymbol ?? "tokens";
  switch (code) {
    case 3: // InsufficientShares
      return ctx.walletBalance
        ? `You only have ${ctx.walletBalance} shares but attempted to withdraw ${ctx.enteredAmount ?? "more"}. Reduce the amount.`
        : base;
    case 4: // InsufficientUnderlying
      return ctx.walletBalance
        ? `The vault holds ${ctx.walletBalance} ${symbol} but your redemption requires more. Contact the admin.`
        : base;
    case 16: // TvlCapExceeded
      return ctx.enteredAmount
        ? `Depositing ${ctx.enteredAmount} ${symbol} would exceed the vault cap. Try a smaller amount.`
        : base;
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Contextual error recovery types
// ---------------------------------------------------------------------------

export type RecoveryAction = {
  label: string;
  action: "retry" | "reduce_amount" | "start_over" | "external";
  href?: string;
};

export type VaultErrorContext = {
  title: string;
  message: string;
  /** lucide-react icon component name */
  icon: string;
  severity: "error" | "warning" | "info";
  actions: RecoveryAction[];
};

export interface ErrorRecoveryContext {
  enteredAmount?: string;
  walletBalance?: string;
  tokenSymbol?: string;
}

/**
 * Classify an unknown error thrown during vault transactions and return
 * structured, user-friendly recovery guidance.
 */
export function getErrorRecovery(
  error: unknown,
  context?: ErrorRecoveryContext
): VaultErrorContext {
  const msg = extractMessage(error).toLowerCase();
  const symbol = context?.tokenSymbol ?? "tokens";

  // -----------------------------------------------------------------------
  // 1. Insufficient balance
  // -----------------------------------------------------------------------
  if (
    isInsufficientBalance(error, msg)
  ) {
    const walletBal = context?.walletBalance ?? "unknown";
    const entered = context?.enteredAmount ?? "the entered amount";
    return {
      title: "Insufficient Balance",
      message: `Your wallet has ${walletBal} ${symbol} but you entered ${entered}. Reduce amount or top up wallet.`,
      icon: "Wallet",
      severity: "warning",
      actions: [
        { label: "Reduce Amount", action: "reduce_amount" },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 2. Vault paused (error code 11 / VaultPaused)
  // -----------------------------------------------------------------------
  if (isVaultPaused(error, msg)) {
    return {
      title: "Vault Is Paused",
      message: "The vault is paused. Check back later or follow @AuraVault for updates.",
      icon: "PauseCircle",
      severity: "warning",
      actions: [
        {
          label: "Follow @AuraVault",
          action: "external",
          href: "https://twitter.com/AuraVault",
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 3. Wrong network / network mismatch
  // -----------------------------------------------------------------------
  if (isWrongNetwork(msg)) {
    return {
      title: "Wrong Network",
      message: "Your wallet is connected to the wrong network. Switch to the correct network in Freighter and try again.",
      icon: "Globe",
      severity: "warning",
      actions: [
        {
          label: "Open Freighter",
          action: "external",
          href: "https://www.freighter.app/",
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 4. Network / connection error
  // -----------------------------------------------------------------------
  if (isNetworkError(error, msg)) {
    return {
      title: "Connection Issue",
      message: "Connection issue. Check your internet connection and try again.",
      icon: "WifiOff",
      severity: "error",
      actions: [
        { label: "Try Again", action: "retry" },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 5. Generic fallback
  // -----------------------------------------------------------------------
  const rawMessage = extractMessage(error) || "Transaction failed";
  return {
    title: "Transaction Failed",
    message: rawMessage,
    icon: "XCircle",
    severity: "error",
    actions: [
      { label: "Try Again", action: "retry" },
      { label: "Start Over", action: "start_over" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    return (error as Record<string, unknown>).message as string;
  }
  return "";
}

function isInsufficientBalance(error: unknown, lowerMsg: string): boolean {
  if (
    lowerMsg.includes("insufficient balance") ||
    lowerMsg.includes("insufficient funds") ||
    lowerMsg.includes("insufficientbalance") ||
    lowerMsg.includes("not enough balance")
  ) {
    return true;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as Record<string, unknown>).code === "INSUFFICIENT_BALANCE"
  ) {
    return true;
  }
  return false;
}

function isVaultPaused(error: unknown, lowerMsg: string): boolean {
  if (
    lowerMsg.includes("vaultpaused") ||
    lowerMsg.includes("vault paused") ||
    lowerMsg.includes("paused")
  ) {
    return true;
  }
  // Soroban contract error code 11
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as Record<string, unknown>).code === 11
  ) {
    return true;
  }
  return false;
}

function isWrongNetwork(lowerMsg: string): boolean {
  return (
    lowerMsg.includes("wrong network") ||
    lowerMsg.includes("network mismatch")
  );
}

function isNetworkError(error: unknown, lowerMsg: string): boolean {
  if (error instanceof TypeError && lowerMsg.includes("fetch")) {
    return true;
  }
  if (lowerMsg.includes("network") || lowerMsg.includes("connection")) {
    return true;
  }
  return false;
}

const errorMessages: Record<ErrorCode, { title: string; message: string }> = {
  INVALID_WALLET_ADDRESS: {
    title: "Invalid Wallet Address",
    message: "The wallet address provided is not valid. Please check and try again.",
  },
  INSUFFICIENT_BALANCE: {
    title: "Insufficient Balance",
    message: "Your account doesn't have enough balance for this transaction.",
  },
  TRANSACTION_FAILED: {
    title: "Transaction Failed",
    message: "The transaction couldn't be completed. Please try again.",
  },
  NETWORK_ERROR: {
    title: "Connection Error",
    message: "Network connection error. Please check your internet and try again.",
  },
  RATE_LIMIT_EXCEEDED: {
    title: "Too Many Requests",
    message: "You're making requests too quickly. Please wait a moment and try again.",
  },
  UNAUTHORIZED: {
    title: "Permission Denied",
    message: "You don't have permission to perform this action.",
  },
  NOT_FOUND: {
    title: "Not Found",
    message: "The requested resource was not found.",
  },
  INVALID_INPUT: {
    title: "Invalid Information",
    message: "The information you provided is not valid. Please check and try again.",
  },
  TIMEOUT: {
    title: "Request Timeout",
    message: "The request took too long. Please try again.",
  },
  SERVICE_UNAVAILABLE: {
    title: "Service Unavailable",
    message: "The service is temporarily unavailable. Please try again later.",
  },
  REFRESH_TOKEN_EXPIRED: {
    title: "Session Expired",
    message: "Your session has expired. Please log in again.",
  },
  INVALID_TOKEN: {
    title: "Invalid Session",
    message: "Invalid authentication token. Please log in again.",
  },
  UNKNOWN: {
    title: "Error",
    message: "An unexpected error occurred. Please try again.",
  },
};

export function translateError(error: unknown): { title: string; message: string } {
  if (error instanceof Response) {
    if (error.status === 401) {
      return errorMessages.INVALID_TOKEN;
    }
    if (error.status === 403) {
      return errorMessages.UNAUTHORIZED;
    }
    if (error.status === 404) {
      return errorMessages.NOT_FOUND;
    }
    if (error.status === 429) {
      return errorMessages.RATE_LIMIT_EXCEEDED;
    }
    if (error.status >= 500) {
      return errorMessages.SERVICE_UNAVAILABLE;
    }
    if (error.status >= 400) {
      return errorMessages.INVALID_INPUT;
    }
  }

  if (error instanceof TypeError) {
    if (error.message.includes("fetch")) {
      return errorMessages.NETWORK_ERROR;
    }
  }

  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string };
    const code = errorWithCode.code as ErrorCode | undefined;
    if (code && code in errorMessages) {
      return errorMessages[code];
    }
    return {
      title: "Error",
      message: error.message || "An unexpected error occurred.",
    };
  }

  return errorMessages.UNKNOWN;
}

export function createRetryableError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  if (error instanceof Response) {
    return error.status >= 500 || error.status === 429;
  }

  return false;
}

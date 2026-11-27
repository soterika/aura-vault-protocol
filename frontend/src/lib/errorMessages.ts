/**
 * Maps raw API, Stellar Horizon, and Soroban contract error codes
 * to human-readable user-facing messages.
 */

const ERROR_CODE_MAP: Record<string, string> = {
  // Stellar / Horizon transaction result codes
  tx_failed: "The transaction failed on the Stellar network. Please try again.",
  tx_too_early: "Transaction submitted too early. Please wait a moment and retry.",
  tx_too_late: "Transaction expired before confirmation. Please submit again.",
  tx_missing_operation: "Transaction is missing an operation.",
  tx_bad_seq: "Transaction sequence number mismatch. Please refresh and try again.",
  tx_bad_auth: "Transaction authorization failed. Please check your wallet signature.",
  tx_insufficient_balance: "Insufficient XLM balance to cover the transaction fee.",
  tx_no_source_account: "Source account not found on the Stellar network.",
  tx_insufficient_fee: "Transaction fee is too low. Please increase the fee and retry.",
  tx_bad_auth_extra: "Unexpected extra signatures on transaction.",
  tx_internal_error: "Stellar network encountered an internal error. Please try again.",

  // Stellar operation result codes
  op_underfunded: "Insufficient balance to complete this operation.",
  op_low_reserve: "Account balance would fall below the minimum Stellar reserve.",
  op_no_destination: "Destination account does not exist on the Stellar network.",
  op_no_trust: "Missing trustline for the selected asset.",
  op_not_authorized: "Your account is not authorized for this asset.",
  op_line_full: "Destination account cannot receive more of this asset.",

  // Vault / Soroban contract error codes
  ERR_INSUFFICIENT_BALANCE: "Insufficient balance for this transaction.",
  ERR_ZERO_SHARES: "Cannot perform this action when vault shares are zero.",
  ERR_PAUSED: "The vault is currently paused. Please try again later.",
  ERR_SLIPPAGE_EXCEEDED: "Price moved beyond your slippage tolerance. Please retry.",
  ERR_UNAUTHORIZED: "You are not authorized to perform this action.",
  ERR_INVALID_AMOUNT: "Please enter a valid amount greater than zero.",
  ZeroShares: "Vault has zero shares; harvest is unavailable.",
  VaultPaused: "The vault is currently paused.",
  InsufficientBalance: "Insufficient balance to complete this transaction.",

  // Wallet & network errors
  USER_REJECTED: "Transaction was cancelled in your wallet.",
  WALLET_NOT_CONNECTED: "Please connect your wallet before submitting.",
  NETWORK_ERROR: "Network connection error. Please check your internet and retry.",
  TIMEOUT: "Request timed out while waiting for confirmation.",
};

/**
 * Extracts a human-readable message from an unknown error or API error code.
 */
export function getHumanReadableError(
  error: unknown,
  fallback = "An unexpected error occurred. Please try again.",
): string {
  if (!error) return fallback;

  if (typeof error === "string") {
    return ERROR_CODE_MAP[error] ?? error;
  }

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    const code =
      (typeof errObj.code === "string" && errObj.code) ||
      (typeof errObj.errorCode === "string" && errObj.errorCode) ||
      (typeof errObj.result_code === "string" && errObj.result_code);

    if (code && ERROR_CODE_MAP[code]) {
      return ERROR_CODE_MAP[code];
    }

    if (typeof errObj.message === "string" && errObj.message.trim().length > 0) {
      // Check if the message itself is a known error code
      if (ERROR_CODE_MAP[errObj.message.trim()]) {
        return ERROR_CODE_MAP[errObj.message.trim()];
      }
      return errObj.message;
    }
  }

  return fallback;
}

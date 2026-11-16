/**
 * vaultService.ts — Stellar/Horizon transaction submission for vault operations.
 *
 * Parses signed XDR, validates the envelope is well-formed, submits to Horizon,
 * and maps tx_failed result codes to user-friendly messages.
 */

import { Horizon, xdr, TransactionBuilder } from "@stellar/stellar-sdk";

// ── Horizon network config ────────────────────────────────────────────────────

const HORIZON_URL =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(HORIZON_URL);
}

// ── XDR validation ────────────────────────────────────────────────────────────

/**
 * Parses a base64-encoded TransactionEnvelope XDR string.
 * Returns the parsed envelope or throws a descriptive error.
 */
export function parseSignedXdr(signedXdr: string): xdr.TransactionEnvelope {
  if (!signedXdr || typeof signedXdr !== "string") {
    throw new XdrValidationError("signedXdr must be a non-empty string");
  }

  // Basic base64 sanity check before attempting SDK parse
  if (!/^[A-Za-z0-9+/=]+$/.test(signedXdr.trim())) {
    throw new XdrValidationError("signedXdr contains invalid base64 characters");
  }

  try {
    return xdr.TransactionEnvelope.fromXDR(signedXdr, "base64");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new XdrValidationError(`Invalid XDR envelope: ${msg}`);
  }
}

/**
 * Reconstructs a Transaction from the envelope string and validates
 * that it has at least one signature and one operation.
 */
export function validateTransactionEnvelope(signedXdr: string): void {
  const envelope = parseSignedXdr(signedXdr);

  // Rebuild via TransactionBuilder to catch additional invariants
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new XdrValidationError(`Transaction failed structural validation: ${msg}`);
  }

  if (tx.signatures.length === 0) {
    throw new XdrValidationError("Transaction has no signatures");
  }

  if (tx.operations.length === 0) {
    throw new XdrValidationError("Transaction has no operations");
  }
}

// ── tx_failed result code mapping ─────────────────────────────────────────────

/**
 * Maps Horizon result codes to user-friendly messages.
 * Covers both transaction-level (tx*) and operation-level (op*) codes.
 */
export function mapResultCodesToMessage(resultCodes: HorizonResultCodes): string {
  const { transaction: txCode, operations: opCodes = [] } = resultCodes;

  const TX_MESSAGES: Record<string, string> = {
    tx_failed:            "One or more operations in the transaction failed.",
    tx_too_early:         "Transaction submitted before its minimum time bound.",
    tx_too_late:          "Transaction expired — please rebuild and re-sign with a fresh sequence number.",
    tx_missing_operation: "Transaction has no operations.",
    tx_bad_seq:           "Sequence number mismatch. Please refresh your account and try again.",
    tx_bad_auth:          "Transaction authentication failed. Ensure the correct key signed the transaction.",
    tx_insufficient_balance:
      "Insufficient balance to cover this transaction and the required XLM reserve.",
    tx_no_source_account: "Source account does not exist on the network.",
    tx_bad_auth_extra:    "Transaction has too many signatures.",
    tx_internal_error:    "An internal Horizon error occurred. Please try again later.",
    tx_not_supported:     "Transaction type is not supported by the current network.",
    tx_fee_bump_inner_failed: "Inner transaction of the fee bump failed.",
    tx_bad_sponsorship:   "Sponsorship configuration is invalid.",
    tx_bad_min_seq_age_or_gap:
      "Minimum sequence age or gap condition was not met.",
    tx_malformed:         "The transaction is malformed and cannot be processed.",
  };

  const OP_MESSAGES: Record<string, string> = {
    op_inner:                  "An inner operation failed.",
    op_bad_auth:               "Operation authentication failed.",
    op_no_source_account:      "Source account for an operation does not exist.",
    op_not_supported:          "Operation type is not supported.",
    op_too_many_subentries:    "Account has too many sub-entries (data entries, trustlines, etc.).",
    op_exceeded_work_limit:    "Operation exceeded the computational work limit.",
    op_too_many_sponsoring:    "Too many accounts are being sponsored.",
    // Payment / manage-offer ops
    op_malformed:              "Operation is malformed.",
    op_underfunded:            "Insufficient funds to complete the operation.",
    op_src_no_trust:           "Source account missing trustline for the asset.",
    op_src_not_authorized:     "Source account is not authorized to hold the asset.",
    op_no_destination:         "Destination account does not exist.",
    op_no_trust:               "Destination account missing trustline for the asset.",
    op_not_authorized:         "Destination account is not authorized to hold the asset.",
    op_line_full:              "Destination account's trustline is at capacity.",
    op_no_issuer:              "The asset issuer does not exist.",
    // Invoke host function (Soroban)
    op_soroban_resource_limit_exceeded:
      "The Soroban contract exceeded its resource limits. Try reducing complexity or increasing the fee.",
    op_soroban_invalid_host_function: "Invalid Soroban host function invocation.",
    op_low_reserve:            "The account does not have enough XLM to satisfy the minimum reserve requirement.",
  };

  // Collect operation-level messages
  const opMessages: string[] = opCodes.flatMap((code) => {
    const msg = OP_MESSAGES[code];
    return msg ? [msg] : [`Operation failed with code: ${code}`];
  });

  // Use transaction-level message as the primary description
  const primary =
    TX_MESSAGES[txCode ?? ""] ??
    (txCode ? `Transaction failed with code: ${txCode}` : "Transaction failed.");

  if (opMessages.length > 0) {
    return `${primary} Details: ${opMessages.join("; ")}`;
  }

  return primary;
}

// ── Submission ────────────────────────────────────────────────────────────────

export interface SubmitResult {
  hash: string;
  ledger: number;
  envelopeXdr: string;
  resultXdr: string;
}

/**
 * Submits a signed XDR transaction to Horizon and returns the result.
 * Throws structured errors for validation failures and tx_failed results.
 */
export async function submitTransaction(signedXdr: string): Promise<SubmitResult> {
  // Validate before hitting the network
  validateTransactionEnvelope(signedXdr);

  const server = getHorizonServer();

  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  let response: Horizon.HorizonApi.SubmitTransactionResponse;
  try {
    response = await server.submitTransaction(tx);
  } catch (err: unknown) {
    // Horizon SDK throws an instance of BadResponseError for non-2xx responses
    if (isHorizonError(err)) {
      const data = err.response?.data as HorizonErrorData | undefined;
      const resultCodes = data?.extras?.result_codes;

      if (resultCodes) {
        const userMessage = mapResultCodesToMessage(resultCodes);
        throw new TransactionFailedError(userMessage, resultCodes, data);
      }

      // Non-tx_failed Horizon error
      const status = err.response?.status ?? 0;
      if (status === 400) {
        throw new TransactionFailedError(
          "Transaction rejected by the network. Check the transaction parameters.",
          undefined,
          data
        );
      }
      if (status === 429) {
        throw new TransactionFailedError(
          "Horizon rate limit reached. Please wait and try again.",
          undefined,
          data
        );
      }
      if (status >= 500) {
        throw new TransactionFailedError(
          "Horizon is temporarily unavailable. Please try again later.",
          undefined,
          data
        );
      }

      throw new TransactionFailedError(
        `Network error submitting transaction (HTTP ${status}).`,
        undefined,
        data
      );
    }

    // Unknown error
    throw err;
  }

  return {
    hash:        response.hash,
    ledger:      response.ledger,
    envelopeXdr: response.envelope_xdr,
    resultXdr:   response.result_xdr,
  };
}

// ── Custom error types ────────────────────────────────────────────────────────

export class XdrValidationError extends Error {
  readonly code = "XDR_VALIDATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "XdrValidationError";
  }
}

export class TransactionFailedError extends Error {
  readonly code = "TRANSACTION_FAILED" as const;
  readonly resultCodes?: HorizonResultCodes;
  readonly horizonData?: HorizonErrorData;

  constructor(
    message: string,
    resultCodes?: HorizonResultCodes,
    horizonData?: HorizonErrorData
  ) {
    super(message);
    this.name = "TransactionFailedError";
    this.resultCodes = resultCodes;
    this.horizonData = horizonData;
  }
}

// ── Internal type helpers ─────────────────────────────────────────────────────

interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
}

interface HorizonErrorData {
  extras?: {
    result_codes?: HorizonResultCodes;
    result_xdr?: string;
  };
  title?: string;
  detail?: string;
}

interface HorizonErrorResponse {
  response?: {
    status?: number;
    data?: HorizonErrorData;
  };
}

function isHorizonError(err: unknown): err is Error & HorizonErrorResponse {
  return (
    err instanceof Error &&
    typeof (err as HorizonErrorResponse).response === "object"
  );
}

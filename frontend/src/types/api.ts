/**
 * API response type definitions for the Aura Vault Protocol frontend.
 * All types mirror the shapes returned by the backend REST API.
 */

// ── Vault ──────────────────────────────────────────────────────────────────

/** Response from GET /api/vault/total_assets */
export interface TotalAssetsResponse {
  total: string;
  /** Caller's underlying token balance (populated when address is known) */
  userBalance?: string;
  /** Caller's share balance */
  userShares?: string;
  /** Price per share (scaled by 10 000) */
  pricePerShare?: string;
}

/** Response from GET /api/vault/balance_of?address=... */
export interface BalanceOfResponse {
  balance: string;
}

/** Response from GET /api/vault/apy */
export interface ApyResponse {
  apy: string;
}

/** Response from GET /api/vault/balance */
export interface VaultBalanceResponse {
  usd: number;
  xlm: number;
}

/** Response from GET /api/vault/metrics */
export interface VaultMetricsResponse {
  apy: number;
  tvl: number;
  totalUsers: number;
  tvlChange24h: number;
}

/** A single transaction record from GET /api/vault/transactions */
export interface TransactionRecord {
  id: string;
  type: "deposit" | "withdraw" | "reward";
  amount: number;
  timestamp: number;
  status: "completed" | "pending" | "failed";
}

/** Response from GET /api/vault/transactions */
export type TransactionsResponse = TransactionRecord[];

/** Response from GET /api/wallet/info */
export interface WalletInfoResponse {
  address: string;
  connected: boolean;
  network: string;
}

// ── Performance ────────────────────────────────────────────────────────────

/** A single data point returned by GET /api/vault/performance */
export interface PerformanceDataPoint {
  timestamp: number;
  balance: number;
  apy: number;
  yieldEarned: number;
}

/** Response from GET /api/vault/performance?period=... */
export interface PerformanceResponse {
  balanceHistory: PerformanceDataPoint[];
  yieldBreakdown: Array<{ source: string; amount: number }>;
  totalYield: number;
  currentAPY: number;
}

// ── Gas ────────────────────────────────────────────────────────────────────

/** Response from POST /api/vault/estimate-gas */
export interface GasEstimateResponse {
  baseFee: string;
  priorityFee: string;
  totalGas: string;
}

// ── Transaction submission ─────────────────────────────────────────────────

/** Request body for POST /api/vault/transactions/submit */
export interface SubmitTransactionRequest {
  type: "deposit" | "withdraw";
  amount: string;
}

/** Response from POST /api/vault/transactions/submit */
export interface SubmitTransactionResponse {
  hash: string;
}

/** Error response shape returned by the API on non-2xx status */
export interface ApiErrorResponse {
  error: string;
  code?: string;
}

// ── Cache ──────────────────────────────────────────────────────────────────

/** Request body for POST /api/cache/invalidate */
export interface CacheInvalidateRequest {
  paths: string[];
}

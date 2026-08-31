/**
 * TypeScript Type Definitions for Aura Vault Protocol
 *
 * This file contains all TypeScript interfaces and types needed for integrating
 * with the Aura Vault smart contract. Import these types to ensure type safety
 * in your JavaScript/TypeScript applications.
 *
 * @module @aura-vault/types
 *
 * Usage:
 * ```typescript
 * import type { VaultErrorCode, DepositResult, VaultState } from '@aura-vault/types';
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Network and Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported Stellar networks.
 */
export type NetworkName = 'testnet' | 'mainnet';

/**
 * Network configuration including RPC and Horizon URLs.
 */
export interface NetworkConfig {
  name: NetworkName;
  rpcUrl: string;
  horizonUrl: string;
  passphrase: string;
}

/**
 * Deployment configuration for a specific network.
 */
export interface Deployment {
  contractId: string;
  tokenId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vault error codes matching the Soroban contract definition.
 *
 * @see https://github.com/soterika/aura-vault-protocol/docs/error-codes.json
 */
export enum VaultErrorCode {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  InsufficientShares = 3,
  InsufficientUnderlying = 4,
  ZeroAmount = 5,
  MathOverflow = 6,
  InvalidAddress = 7,
  ZeroShares = 8,
  UpgradeUnauthorized = 9,
  StorageLayoutMismatch = 10,
  VaultPaused = 11,
  BalanceMismatch = 12,
}

/**
 * Error information with code and message.
 */
export interface VaultError extends Error {
  code: VaultErrorCode;
  message: string;
}

/**
 * Result of vault error translation/analysis.
 */
export interface ErrorTranslation {
  code: VaultErrorCode | number;
  message: string;
  severity?: 'info' | 'warning' | 'error' | 'fatal';
  recoverable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Result Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base transaction result.
 */
export interface TransactionResult {
  hash: string;
  status: 'success' | 'failed';
  ledger: number;
  timestamp: number;
}

/**
 * Result of a deposit operation.
 */
export interface DepositResult extends TransactionResult {
  shares: bigint;
  totalShares: bigint;
  totalAssets: bigint;
}

/**
 * Result of a withdrawal operation.
 */
export interface WithdrawResult extends TransactionResult {
  amount: bigint;
  totalShares: bigint;
  totalAssets: bigint;
}

/**
 * Result of a harvest operation.
 */
export interface HarvestResult extends TransactionResult {
  yieldAmount: bigint;
  feeAmount: bigint;
  netYield: bigint;
}

/**
 * Generic transaction result for admin operations.
 */
export interface AdminTransactionResult extends TransactionResult {
  operationType: 'pause' | 'unpause' | 'setFees' | 'setTreasury' | 'upgrade';
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault State Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete vault state snapshot (read-only view).
 */
export interface VaultState {
  totalAssets: bigint;
  totalShares: bigint;
  sharePrice: bigint; // totalAssets * 10^7 / totalShares
  isPaused: boolean;
  lastUpdated: number; // Unix timestamp in milliseconds
}

/**
 * User position in the vault.
 */
export interface UserPosition {
  address: string;
  shareBalance: bigint;
  tokenValue: bigint; // shares * totalAssets / totalShares
  percentageOfVault: number; // 0-100
}

/**
 * Fee configuration (if exposed via contract).
 */
export interface FeeConfig {
  performanceFeeBasis: number; // e.g., 1000 = 10%
  treasury: string; // Treasury address
  totalCollected: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event emitted by the vault contract.
 */
export interface VaultEvent {
  type:
    | 'deposit'
    | 'withdraw'
    | 'harvest'
    | 'harvest_token'
    | 'pause'
    | 'unpause'
    | 'upgrade'
    | 'suspicious';
  txHash: string;
  ledger: number;
  timestamp: number;
}

/**
 * Deposit event details.
 */
export interface DepositEvent extends VaultEvent {
  type: 'deposit';
  caller: string;
  amount: bigint;
  shares: bigint;
  totalShares: bigint;
  totalAssets: bigint;
}

/**
 * Withdrawal event details.
 */
export interface WithdrawEvent extends VaultEvent {
  type: 'withdraw';
  caller: string;
  shares: bigint;
  redeemAmount: bigint;
  totalShares: bigint;
  totalAssets: bigint;
}

/**
 * Harvest event details.
 */
export interface HarvestEvent extends VaultEvent {
  type: 'harvest';
  caller: string;
  yieldAmount: bigint;
  feeAmount: bigint;
  netYield: bigint;
  totalAssets: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Governance proposal types.
 */
export type ProposalType =
  | 'update_admin'
  | 'update_token'
  | 'update_parameters'
  | 'pause'
  | 'upgrade';

/**
 * Governance proposal status.
 */
export type ProposalStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';

/**
 * Governance proposal details.
 */
export interface GovernanceProposal {
  id: string;
  proposalType: ProposalType;
  proposer: string;
  createdAt: number; // Unix timestamp
  deadline: number; // Unix timestamp
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  description: string;
}

/**
 * Vote record for a proposal.
 */
export interface Vote {
  proposalId: string;
  voter: string;
  voteType: 'for' | 'against' | 'abstain';
  votedAt: number; // Unix timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Options and Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for client initialization.
 */
export interface ClientOptions {
  network?: NetworkName;
  contractId?: string;
  tokenId?: string;
  rpcUrl?: string;
  horizonUrl?: string;
  timeout?: number; // milliseconds
}

/**
 * Options for transaction submission.
 */
export interface TransactionOptions {
  fee?: string; // in stroops
  timeout?: number; // in seconds
  memo?: string;
}

/**
 * Options for polling transactions.
 */
export interface PollOptions {
  maxAttempts?: number;
  interval?: number; // milliseconds
  timeout?: number; // milliseconds
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pagination parameters for listing operations.
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
  cursor?: string;
}

/**
 * Paginated result.
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Cache entry for vault state.
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number; // milliseconds
}

/**
 * Health check response.
 */
export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  rpcUrl: string;
  contractId: string;
  lastUpdated: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// React Hook Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of useVault hook.
 */
export interface UseVaultResult {
  state: VaultState | null;
  deposit: (keypair: any, amount: bigint) => Promise<DepositResult | null>;
  withdraw: (keypair: any, shares: bigint) => Promise<WithdrawResult | null>;
  harvest: (keypair: any, yieldAmount: bigint) => Promise<HarvestResult | null>;
  pause: (adminKeypair: any) => Promise<string>;
  unpause: (adminKeypair: any) => Promise<string>;
  isLoading: boolean;
  error: VaultError | null;
  refresh: () => Promise<void>;
  client: any; // AuraVaultClient
}

/**
 * Result of useUserPosition hook.
 */
export interface UseUserPositionResult {
  position: UserPosition | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Options for React hooks.
 */
export interface UseVaultOptions {
  network?: NetworkName;
  pollInterval?: number; // milliseconds
  onError?: (error: VaultError) => void;
  onSuccess?: (result: TransactionResult) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form/Input Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validated user input for deposit operation.
 */
export interface DepositInput {
  amount: string; // Display format (e.g., "1.5")
  amountStroops: bigint; // Stroops format
  isValid: boolean;
  errors: string[];
}

/**
 * Validated user input for withdrawal operation.
 */
export interface WithdrawInput {
  shares: string; // Display format
  sharesStroops: bigint; // Stroops format
  isValid: boolean;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constant Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Token decimal constants.
 */
export const TOKEN_DECIMALS = 7 as const;
export const TOKEN_SCALE = 10n ** BigInt(TOKEN_DECIMALS) as const;

/**
 * Basis point constants (for fee calculations).
 */
export const BASIS_POINTS = 10_000 as const; // 1 BP = 0.01%

/**
 * Common error messages.
 */
export const ERROR_MESSAGES: Record<VaultErrorCode, string> = {
  [VaultErrorCode.NotInitialized]:
    'Vault has not been initialized yet. Contact the protocol admin.',
  [VaultErrorCode.AlreadyInitialized]: 'This vault has already been initialized.',
  [VaultErrorCode.InsufficientShares]: 'Insufficient share balance for withdrawal.',
  [VaultErrorCode.InsufficientUnderlying]: 'Vault does not hold enough tokens.',
  [VaultErrorCode.ZeroAmount]: 'Amount must be greater than zero.',
  [VaultErrorCode.MathOverflow]: 'Amount is too large or would cause arithmetic overflow.',
  [VaultErrorCode.InvalidAddress]: 'Address is not authorized for this operation.',
  [VaultErrorCode.ZeroShares]: 'Cannot harvest when no shares are outstanding.',
  [VaultErrorCode.UpgradeUnauthorized]: 'Only the vault admin can perform this operation.',
  [VaultErrorCode.StorageLayoutMismatch]: 'Wasm version is incompatible with storage layout.',
  [VaultErrorCode.VaultPaused]: 'Vault is currently paused.',
  [VaultErrorCode.BalanceMismatch]:
    'Critical: balance mismatch detected. This indicates a potential issue.',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type guard to check if an error is a VaultError.
 */
export function isVaultError(error: unknown): error is VaultError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as any).code === 'number'
  );
}

/**
 * Type guard to check if a result is a successful transaction result.
 */
export function isSuccessfulTransaction<T extends TransactionResult>(
  result: T | null | undefined
): result is T {
  return result !== null && result !== undefined && result.status === 'success';
}

/**
 * Type guard to check if an error code is recoverable.
 */
export function isRecoverableError(code: VaultErrorCode): boolean {
  const nonRecoverable = [
    VaultErrorCode.NotInitialized,
    VaultErrorCode.BalanceMismatch,
    VaultErrorCode.InsufficientUnderlying,
    VaultErrorCode.StorageLayoutMismatch,
  ];
  return !nonRecoverable.includes(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Type Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make all properties of T readonly recursively.
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Extract the return type of a promise.
 */
export type Awaited<T> = T extends Promise<infer R> ? R : T;

/**
 * Make specific properties optional.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make specific properties required.
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from Stellar SDK (for convenience)
// ─────────────────────────────────────────────────────────────────────────────

export type { Keypair } from '@stellar/js-stellar-sdk';
export type { Account } from '@stellar/js-stellar-sdk';
export type { Transaction } from '@stellar/js-stellar-sdk';

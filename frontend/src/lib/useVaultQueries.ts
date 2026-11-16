"use client";

/**
 * useVaultQueries — Issue #1266
 *
 * Centralised React Query hooks for all Aura Vault API calls.
 * Replaces the raw-fetch useApiCall pattern with proper caching,
 * deduplication, and background refresh.
 *
 * Query keys are exported as constants so SSE invalidation and
 * tests can reference them without hard-coding strings.
 *
 * Hooks exported:
 *  - useVaultStats        — GET /api/v1/vault/stats
 *  - useVaultBalance      — GET /api/vault/balance_of?address=...
 *  - useVaultMetrics      — GET /api/vault/metrics
 *  - useTransactions      — GET /api/vault/transactions
 *  - useUserPreferences   — GET /api/v1/users/preferences  (auth-gated)
 *  - useGasEstimate       — GET /api/v1/gas/estimate
 *  - useDepositMutation   — POST /api/vault/transactions/submit  (deposit)
 *  - useWithdrawMutation  — POST /api/vault/transactions/submit  (withdraw)
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "")
    : "";

/** Centralised query key registry — import these in tests and SSE handlers. */
export const QUERY_KEYS = {
  vaultStats: ["vault", "stats"] as const,
  vaultBalance: (address: string) => ["vault", "balance", address] as const,
  vaultMetrics: ["vault", "metrics"] as const,
  transactions: (address?: string) =>
    address ? ["vault", "transactions", address] : (["vault", "transactions"] as const),
  userPreferences: ["user", "preferences"] as const,
  gasEstimate: ["gas", "estimate"] as const,
  governanceProposals: ["governance", "proposals"] as const,
} as const;

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function authHeaders(token?: string | null): HeadersInit {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultStats {
  totalAssets: string;
  totalShares: string;
  totalDepositors: number;
  apy7d: number;
  sharePrice: number;
  cached?: boolean;
  fetched_at?: string;
}

export interface VaultBalance {
  balance: string;
}

export interface VaultMetrics {
  apy: number;
  tvl: number;
  totalUsers: number;
  tvlChange24h: number;
}

export interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "reward";
  amount: number;
  timestamp: number;
  status: "completed" | "pending" | "failed";
}

export interface UserPreferences {
  theme?: string;
  currency?: string;
  notifications?: boolean;
  [key: string]: unknown;
}

export interface GasEstimate {
  baseFee: string;
  priorityFee: string;
  totalGas: string;
}

export interface SubmitTransactionPayload {
  type: "deposit" | "withdraw";
  amount: string;
  xdr?: string;
}

export interface SubmitTransactionResult {
  hash: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Vault-wide statistics (TVL, share price, APY).
 *
 * staleTime: 30 s (matches the backend Redis TTL)
 * refetchInterval: 60 s (background refresh every minute)
 */
export function useVaultStats(
  options?: Partial<UseQueryOptions<{ data: VaultStats }>>
) {
  return useQuery({
    queryKey: QUERY_KEYS.vaultStats,
    queryFn: () =>
      apiFetch<{ data: VaultStats }>(`${API_BASE}/api/v1/vault/stats`),
    staleTime: 30_000,
    refetchInterval: 60_000,
    ...options,
  });
}

/**
 * Share balance for a specific wallet address.
 *
 * Only runs when `address` is truthy. staleTime is longer (2 min) because
 * balance changes are rare outside of deposit/withdraw actions — and those
 * mutations invalidate this query immediately.
 */
export function useVaultBalance(address?: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.vaultBalance(address ?? ""),
    queryFn: () =>
      apiFetch<{ data: VaultBalance }>(
        `${API_BASE}/api/vault/balance_of?address=${encodeURIComponent(address!)}`
      ),
    enabled: Boolean(address),
    staleTime: 2 * 60_000,
    refetchInterval: 60_000,
  });
}

/**
 * Vault-level metrics (TVL USD, total users, APY).
 */
export function useVaultMetrics() {
  return useQuery({
    queryKey: QUERY_KEYS.vaultMetrics,
    queryFn: () => apiFetch<{ data: VaultMetrics }>(`${API_BASE}/api/vault/metrics`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Transaction history for a wallet.
 */
export function useTransactions(address?: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.transactions(address ?? undefined),
    queryFn: () =>
      apiFetch<Transaction[]>(
        address
          ? `${API_BASE}/api/vault/transactions?address=${encodeURIComponent(address)}`
          : `${API_BASE}/api/vault/transactions`
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * User preferences — requires a valid JWT.
 */
export function useUserPreferences(token?: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.userPreferences,
    queryFn: () =>
      apiFetch<{ data: UserPreferences }>(`${API_BASE}/api/v1/users/preferences`, {
        headers: authHeaders(token),
      }),
    enabled: Boolean(token),
    staleTime: 5 * 60_000, // preferences rarely change
  });
}

/**
 * Current gas / fee estimate.
 */
export function useGasEstimate() {
  return useQuery({
    queryKey: QUERY_KEYS.gasEstimate,
    queryFn: () =>
      apiFetch<{ data: GasEstimate }>(`${API_BASE}/api/v1/gas/estimate`),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Deposit mutation with optimistic update.
 *
 * Optimistic behaviour:
 *  1. Immediately adds `amount` to the cached userBalance.
 *  2. If the server call fails, rolls back to the previous cached value.
 *  3. On success or error, invalidates vault stats + balance so the server
 *     state is reflected after the next refetch.
 */
export function useDepositMutation(
  address?: string | null,
  token?: string | null
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: SubmitTransactionPayload) =>
      apiFetch<SubmitTransactionResult>(
        `${API_BASE}/api/vault/transactions/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(token),
          },
          body: JSON.stringify({ ...payload, type: "deposit" }),
        }
      ),

    // ── Optimistic update ──────────────────────────────────────────────────
    onMutate: async (payload) => {
      if (!address) return;

      const balanceKey = QUERY_KEYS.vaultBalance(address);

      // Cancel any in-flight refetch so it doesn't overwrite our optimistic value
      await qc.cancelQueries({ queryKey: balanceKey });

      // Snapshot the previous value for rollback
      const previousBalance = qc.getQueryData<{ data: VaultBalance }>(balanceKey);

      // Apply optimistic update
      qc.setQueryData<{ data: VaultBalance }>(balanceKey, (old) => {
        if (!old) return old;
        const prev = BigInt(old.data.balance);
        const delta = BigInt(
          Math.floor(parseFloat(payload.amount) * 1e7) // Stellar 7-decimal precision
        );
        return { ...old, data: { balance: String(prev + delta) } };
      });

      return { previousBalance };
    },

    onError: (_err, _vars, context) => {
      // Roll back on failure
      if (context?.previousBalance && address) {
        qc.setQueryData(QUERY_KEYS.vaultBalance(address), context.previousBalance);
      }
    },

    onSettled: () => {
      // Re-validate from server regardless of outcome
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.vaultStats });
      if (address) {
        void qc.invalidateQueries({
          queryKey: QUERY_KEYS.vaultBalance(address),
        });
      }
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.transactions(address ?? undefined) });
    },
  });
}

/**
 * Withdraw mutation with optimistic update.
 *
 * Optimistic behaviour mirrors deposit but subtracts `shares` from
 * the cached balance.
 */
export function useWithdrawMutation(
  address?: string | null,
  token?: string | null
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: SubmitTransactionPayload) =>
      apiFetch<SubmitTransactionResult>(
        `${API_BASE}/api/vault/transactions/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(token),
          },
          body: JSON.stringify({ ...payload, type: "withdraw" }),
        }
      ),

    onMutate: async (payload) => {
      if (!address) return;

      const balanceKey = QUERY_KEYS.vaultBalance(address);
      await qc.cancelQueries({ queryKey: balanceKey });

      const previousBalance = qc.getQueryData<{ data: VaultBalance }>(balanceKey);

      qc.setQueryData<{ data: VaultBalance }>(balanceKey, (old) => {
        if (!old) return old;
        const prev = BigInt(old.data.balance);
        const delta = BigInt(
          Math.floor(parseFloat(payload.amount) * 1e7)
        );
        const next = prev > delta ? prev - delta : 0n;
        return { ...old, data: { balance: String(next) } };
      });

      return { previousBalance };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousBalance && address) {
        qc.setQueryData(QUERY_KEYS.vaultBalance(address), context.previousBalance);
      }
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.vaultStats });
      if (address) {
        void qc.invalidateQueries({
          queryKey: QUERY_KEYS.vaultBalance(address),
        });
      }
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.transactions(address ?? undefined) });
    },
  });
}

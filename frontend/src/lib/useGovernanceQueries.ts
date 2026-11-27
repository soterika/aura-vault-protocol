"use client";

/**
 * useGovernanceQueries — Issue #1267
 *
 * React Query hooks for the Governance Dashboard.
 * Covers:
 *  - useGovernanceProposals  — GET /api/v1/governance/proposals
 *  - useGovernanceProposal   — GET /api/v1/governance/proposals/:id
 *  - useVoteMutation         — POST /api/v1/governance/proposals/:id/vote
 *  - useExecuteMutation      — POST /api/v1/governance/proposals/:id/execute
 *  - useGovernanceSSE        — subscribes to SSE stream for real-time updates
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { QUERY_KEYS } from "./useVaultQueries";

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "")
    : "";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProposalStatus =
  | "Pending"
  | "TimelockActive"
  | "Executable"
  | "Executed"
  | "Rejected";

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  status: ProposalStatus;
  proposer: string;
  createdAt: string;
  thresholdMet: boolean;
  timelockStartedAt: string | null;
  timelockExpiresAt: string | null;
  executableAt: string | null;
  votesFor: number;
  votesAgainst: number;
  requiredSignatures: number;
  signers: string[];
}

export interface ProposalListResponse {
  proposals: GovernanceProposal[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface GovernanceScope {
  chain?: string | null;
  contractId?: string | null;
}

export function governanceScopeKey(scope?: GovernanceScope) {
  return {
    chain: scope?.chain ?? "default",
    contractId: scope?.contractId ?? "default",
  } as const;
}

export function governanceListQueryKey(
  scope?: GovernanceScope,
  filters?: { status?: ProposalStatus; page?: number; pageSize?: number }
) {
  return [
    ...QUERY_KEYS.governanceProposals,
    governanceScopeKey(scope),
    filters ?? {},
  ] as const;
}

export function governanceDetailQueryKey(id: string, scope?: GovernanceScope) {
  return [
    ...QUERY_KEYS.governanceProposals,
    governanceScopeKey(scope),
    "detail",
    id,
  ] as const;
}

export interface UseGovernanceProposalsOptions extends GovernanceScope {
  status?: ProposalStatus;
  page?: number;
  pageSize?: number;
  token: string;
}

/**
 * Fetch all governance proposals.
 * Refetches every 30 s so status transitions (e.g. timelock expiry) appear promptly.
 */
export function useGovernanceProposals({
  status,
  page = 1,
  pageSize = 20,
  token,
  chain,
  contractId,
}: UseGovernanceProposalsOptions) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status) params.set("status", status);

  return useQuery({
    queryKey: governanceListQueryKey(
      { chain, contractId },
      { status, page, pageSize }
    ),
    queryFn: () =>
      apiFetch<{ success: boolean; data: ProposalListResponse }>(
        `${API_BASE}/api/v1/governance/proposals?${params}`,
        { headers: authHeaders(token) }
      ),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: Boolean(token),
  });
}

/**
 * Fetch a single proposal by ID.
 */
export function useGovernanceProposal(
  id: string,
  token: string,
  scope?: GovernanceScope
) {
  return useQuery({
    queryKey: governanceDetailQueryKey(id, scope),
    queryFn: () =>
      apiFetch<{ success: boolean; data: GovernanceProposal }>(
        `${API_BASE}/api/v1/governance/proposals/${id}`,
        { headers: authHeaders(token) }
      ),
    staleTime: 30_000,
    enabled: Boolean(id) && Boolean(token),
  });
}

// ── Vote mutation ─────────────────────────────────────────────────────────────

export interface VotePayload {
  proposalId: string;
  xdr: string;
  signer: string;
}

export function useVoteMutation(token: string, scope?: GovernanceScope) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ proposalId, xdr, signer }: VotePayload) =>
      apiFetch<{ success: boolean; data: unknown }>(
        `${API_BASE}/api/v1/governance/proposals/${proposalId}/vote`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(token),
          },
          body: JSON.stringify({ xdr, signer }),
        }
      ),

    onSuccess: () => {
      // Invalidate the scoped proposals list so the new vote count appears
      const queryKey = scope
        ? [...QUERY_KEYS.governanceProposals, governanceScopeKey(scope)]
        : QUERY_KEYS.governanceProposals;
      void qc.invalidateQueries({ queryKey });
    },
  });
}

// ── Execute mutation ──────────────────────────────────────────────────────────

export interface ExecutePayload {
  proposalId: string;
  xdr: string;
}

export function useExecuteMutation(token: string, scope?: GovernanceScope) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ proposalId, xdr }: ExecutePayload) =>
      apiFetch<{ success: boolean; data: unknown }>(
        `${API_BASE}/api/v1/governance/proposals/${proposalId}/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(token),
          },
          body: JSON.stringify({ xdr }),
        }
      ),

    onSuccess: () => {
      const queryKey = scope
        ? [...QUERY_KEYS.governanceProposals, governanceScopeKey(scope)]
        : QUERY_KEYS.governanceProposals;
      void qc.invalidateQueries({ queryKey });
    },
  });
}

// ── SSE hook for real-time proposal state changes ─────────────────────────────

/**
 * useGovernanceSSE
 *
 * Connects to the backend SSE stream at /api/v1/governance/proposals/stream
 * and invalidates the governance proposals cache when a proposal_updated event
 * is received.
 */
export function useGovernanceSSE(token: string, scope?: GovernanceScope) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = scope?.chain;
  const contractId = scope?.contractId;

  useEffect(() => {
    if (!token || typeof EventSource === "undefined") return;

    let isCancelled = false;

    function connect() {
      if (isCancelled) return;

      // SSE with auth — we append the token as a query param since
      // EventSource doesn't support custom headers.
      const url = `${API_BASE}/api/v1/governance/proposals/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("proposal_updated", () => {
        const queryKey =
          chain !== undefined || contractId !== undefined
            ? [
                ...QUERY_KEYS.governanceProposals,
                governanceScopeKey({ chain, contractId }),
              ]
            : QUERY_KEYS.governanceProposals;
        void qc.invalidateQueries({ queryKey });
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!isCancelled) {
          reconnectRef.current = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      isCancelled = true;
      esRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [token, qc, chain, contractId]);
}

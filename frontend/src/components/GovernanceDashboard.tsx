"use client";

/**
 * GovernanceDashboard — Issue #1267
 *
 * Displays active governance proposals with:
 *  - Status badges (Pending, TimelockActive, Executable, Executed, Rejected)
 *  - Proposal timeline (created → threshold met → timelock → executable)
 *  - Vote button (disabled if already voted or threshold already met)
 *  - Execute button (enabled only when status === "Executable")
 *  - Empty state when no proposals exist
 *  - Real-time updates via SSE (useGovernanceSSE)
 *
 * Auth guard: if wallet is not connected, shows a "connect wallet" prompt.
 */

import { useState, useCallback } from "react";
import {
  useGovernanceProposals,
  useGovernanceSSE,
  useVoteMutation,
  useExecuteMutation,
  type GovernanceProposal,
  type ProposalStatus,
} from "@/lib/useGovernanceQueries";
import { useWalletStore } from "@/lib/walletStore";
import { EmptyState } from "@/components/EmptyState";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ProposalStatus,
  { label: string; className: string }
> = {
  Pending: {
    label: "Pending",
    className:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  TimelockActive: {
    label: "Timelock Active",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  Executable: {
    label: "Executable",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  Executed: {
    label: "Executed",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  Rejected: {
    label: "Rejected",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.Pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
      aria-label={`Proposal status: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

interface TimelineStep {
  label: string;
  date: string | null;
  reached: boolean;
}

function buildTimeline(p: GovernanceProposal): TimelineStep[] {
  const thresholdDate = p.thresholdMet ? p.timelockStartedAt : null;

  return [
    { label: "Created", date: p.createdAt, reached: true },
    {
      label: "Threshold Met",
      date: thresholdDate,
      reached: p.thresholdMet,
    },
    {
      label: "Timelock Started",
      date: p.timelockStartedAt,
      reached: Boolean(p.timelockStartedAt),
    },
    {
      label: "Executable",
      date: p.executableAt,
      reached:
        p.status === "Executable" || p.status === "Executed",
    },
    {
      label: "Executed",
      date: p.status === "Executed" ? p.executableAt : null,
      reached: p.status === "Executed",
    },
  ];
}

function ProposalTimeline({ proposal }: { proposal: GovernanceProposal }) {
  const steps = buildTimeline(proposal);

  return (
    <div className="mt-4 flex items-center gap-0" role="list" aria-label="Proposal timeline">
      {steps.map((step, idx) => (
        <div key={step.label} className="flex items-center" role="listitem">
          {/* Step dot */}
          <div className="flex flex-col items-center">
            <div
              className={`h-3 w-3 rounded-full border-2 transition-colors ${
                step.reached
                  ? "border-indigo-500 bg-indigo-500"
                  : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
              }`}
              aria-hidden="true"
            />
            <div className="mt-1 text-center">
              <p
                className={`text-[10px] font-medium leading-tight ${
                  step.reached
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-400"
                }`}
              >
                {step.label}
              </p>
              {step.date && (
                <p className="text-[9px] text-zinc-400">
                  {new Date(step.date).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>
          {/* Connector line between steps */}
          {idx < steps.length - 1 && (
            <div
              className={`h-0.5 w-10 sm:w-16 transition-colors ${
                step.reached
                  ? "bg-indigo-500"
                  : "bg-zinc-200 dark:bg-zinc-700"
              }`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Proposal card ─────────────────────────────────────────────────────────────

interface ProposalCardProps {
  proposal: GovernanceProposal;
  walletAddress: string | null;
  token: string | null;
}

function ProposalCard({ proposal, walletAddress, token }: ProposalCardProps) {
  const [txError, setTxError] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);

  const voteMutation = useVoteMutation(token ?? "");
  const executeMutation = useExecuteMutation(token ?? "");

  const hasVoted = walletAddress
    ? proposal.signers.includes(walletAddress)
    : false;

  const canVote =
    !hasVoted &&
    proposal.status !== "Executed" &&
    proposal.status !== "Rejected" &&
    !proposal.thresholdMet;

  const canExecute = proposal.status === "Executable";

  // ── Simulate Freighter signing ──────────────────────────────────────────
  // In production, this would call:
  //   const { signedXDR } = await freighter.signTransaction(builtXdr, { network });
  // Here we produce a placeholder XDR for demonstration.
  const buildXdr = useCallback(() => {
    return btoa(
      JSON.stringify({
        type: "governance_vote",
        proposalId: proposal.id,
        signer: walletAddress,
        timestamp: Date.now(),
      })
    );
  }, [proposal.id, walletAddress]);

  const handleVote = async () => {
    if (!walletAddress || !token) return;
    setTxError(null);
    setTxSuccess(null);

    try {
      // In production: build + sign XDR via Freighter
      const xdr = buildXdr();
      await voteMutation.mutateAsync({
        proposalId: proposal.id,
        xdr,
        signer: walletAddress,
      });
      setTxSuccess("Vote submitted successfully!");
    } catch (err) {
      setTxError(
        err instanceof Error ? err.message : "Vote submission failed"
      );
    }
  };

  const handleExecute = async () => {
    if (!token) return;
    setTxError(null);
    setTxSuccess(null);

    try {
      const xdr = buildXdr();
      await executeMutation.mutateAsync({
        proposalId: proposal.id,
        xdr,
      });
      setTxSuccess("Proposal executed successfully!");
    } catch (err) {
      setTxError(
        err instanceof Error ? err.message : "Execution failed"
      );
    }
  };

  return (
    <article
      className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      aria-label={`Governance proposal: ${proposal.title}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusBadge status={proposal.status} />
            <span className="text-xs text-zinc-400 font-mono">
              #{proposal.id}
            </span>
          </div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
            {proposal.title}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {proposal.description}
      </p>

      {/* Signature progress */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Signatures</span>
            <span className="font-medium">
              {proposal.votesFor} / {proposal.requiredSignatures}
            </span>
          </div>
          <div
            className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
            role="progressbar"
            aria-valuenow={proposal.votesFor}
            aria-valuemin={0}
            aria-valuemax={proposal.requiredSignatures}
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-500"
              style={{
                width: `${Math.min(
                  100,
                  (proposal.votesFor / proposal.requiredSignatures) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-3 overflow-x-auto pb-1">
        <ProposalTimeline proposal={proposal} />
      </div>

      {/* Proposer + created date */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>
          Proposer:{" "}
          <span className="font-mono">
            {proposal.proposer.slice(0, 8)}…{proposal.proposer.slice(-4)}
          </span>
        </span>
        <span>
          Created:{" "}
          {new Date(proposal.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
        {proposal.executableAt && proposal.status !== "Executed" && (
          <span>
            {proposal.status === "TimelockActive"
              ? "Executable at: "
              : "Was executable: "}
            {new Date(proposal.executableAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Feedback messages */}
      {txError && (
        <p
          role="alert"
          className="mt-3 text-sm text-red-600 dark:text-red-400"
        >
          {txError}
        </p>
      )}
      {txSuccess && (
        <p
          role="status"
          className="mt-3 text-sm text-emerald-600 dark:text-emerald-400"
        >
          {txSuccess}
        </p>
      )}

      {/* Action buttons */}
      {proposal.status !== "Executed" && proposal.status !== "Rejected" && (
        <div className="mt-4 flex flex-wrap gap-3">
          {/* Vote button */}
          <button
            type="button"
            onClick={() => void handleVote()}
            disabled={
              !canVote ||
              voteMutation.isPending ||
              !walletAddress ||
              !token
            }
            aria-disabled={!canVote}
            title={
              hasVoted
                ? "You have already voted"
                : proposal.thresholdMet
                ? "Threshold already reached"
                : !walletAddress
                ? "Connect your wallet to vote"
                : undefined
            }
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {voteMutation.isPending ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Voting…
              </>
            ) : hasVoted ? (
              "✓ Voted"
            ) : (
              "Vote"
            )}
          </button>

          {/* Execute button */}
          <button
            type="button"
            onClick={() => void handleExecute()}
            disabled={
              !canExecute || executeMutation.isPending || !token
            }
            aria-disabled={!canExecute}
            title={
              !canExecute
                ? proposal.status === "TimelockActive"
                  ? `Timelock active until ${proposal.executableAt ? new Date(proposal.executableAt).toLocaleString() : "unknown"}`
                  : "Proposal cannot be executed yet"
                : undefined
            }
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {executeMutation.isPending ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Executing…
              </>
            ) : (
              "Execute"
            )}
          </button>
        </div>
      )}
    </article>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function ProposalSkeleton() {
  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900"
      aria-busy="true"
      aria-label="Loading proposal"
    >
      <div className="h-4 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="mt-2 h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="mt-1 h-4 w-5/6 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

interface GovernanceDashboardProps {
  /** JWT access token — obtained from useWalletStore or auth context */
  token: string | null;
}

export function GovernanceDashboard({ token }: GovernanceDashboardProps) {
  const { address: walletAddress } = useWalletStore();

  const [statusFilter, setStatusFilter] = useState<ProposalStatus | undefined>(
    undefined
  );

  const { data, isLoading, isError, error, refetch } = useGovernanceProposals({
    status: statusFilter,
    token: token ?? "",
  });

  // Real-time updates via SSE
  useGovernanceSSE(token ?? "");

  const proposals = data?.data?.proposals ?? [];
  const total = data?.data?.total ?? 0;

  // ── Not authenticated ───────────────────────────────────────────────────
  if (!token || !walletAddress) {
    return (
      <EmptyState
        variant="no-positions"
        title="Connect your wallet"
        description="You must connect your Freighter wallet to browse governance proposals and cast votes."
      />
    );
  }

  // ── Status filter bar ───────────────────────────────────────────────────
  const filters: Array<{ label: string; value: ProposalStatus | undefined }> = [
    { label: "All", value: undefined },
    { label: "Pending", value: "Pending" },
    { label: "Timelock Active", value: "TimelockActive" },
    { label: "Executable", value: "Executable" },
    { label: "Executed", value: "Executed" },
  ];

  return (
    <section aria-label="Governance Dashboard" className="w-full">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Governance
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Browse active proposals, cast votes, and monitor timelock status.
          </p>
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isLoading}
          aria-label="Refresh proposals"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
        >
          <svg
            className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Status filter */}
      <div
        className="mb-6 flex flex-wrap gap-2"
        role="group"
        aria-label="Filter proposals by status"
      >
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            aria-pressed={statusFilter === f.value}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              statusFilter === f.value
                ? "bg-indigo-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {isError && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
        >
          <strong>Failed to load proposals.</strong>{" "}
          {error instanceof Error ? error.message : "Please try again."}
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="space-y-4" aria-label="Loading proposals">
          <ProposalSkeleton />
          <ProposalSkeleton />
          <ProposalSkeleton />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && proposals.length === 0 && (
        <EmptyState
          variant="no-data"
          title="No active proposals"
          description={
            statusFilter
              ? `No proposals with status "${STATUS_CONFIG[statusFilter]?.label ?? statusFilter}".`
              : "There are no governance proposals at this time. Check back later."
          }
        />
      )}

      {/* Proposal list */}
      {!isLoading && proposals.length > 0 && (
        <>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            Showing {proposals.length} of {total} proposal
            {total !== 1 ? "s" : ""}
          </p>
          <div className="space-y-4" role="list" aria-label="Governance proposals">
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                walletAddress={walletAddress}
                token={token}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

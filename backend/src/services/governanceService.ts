/**
 * governanceService.ts — Issue #1268
 *
 * Business logic for governance proposals:
 *   - Listing non-expired proposals from governance_proposals table
 *   - Fetching a single proposal with its vote tally
 *   - Recording off-chain vote intents
 *   - Querying the on-chain contract for real-time proposal status
 */

import { getReadPool, getWritePool } from "../db.js";
import { horizonFetch } from "./horizonClient.js";
import { config } from "../config/index.js";
import { logger } from "../logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProposalStatus =
  | "active"
  | "approved"
  | "rejected"
  | "executed"
  | "expired"
  | "cancelled";

export type ActionType =
  | "upgrade"
  | "parameter_change"
  | "pause"
  | "unpause"
  | "emergency";

export interface GovernanceProposal {
  id: string;
  contract_proposal_id: number | null;
  proposer_address: string;
  title: string;
  description: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  status: ProposalStatus;
  votes_for: number;
  votes_against: number;
  threshold: number;
  executable_after: string | null;
  expires_at: string;
  executed_at: string | null;
  execution_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoteIntent {
  id: string;
  proposal_id: string;
  voter_address: string;
  support: boolean;
  comment: string | null;
  on_chain_tx_hash: string | null;
  created_at: string;
}

export interface ProposalWithVotes extends GovernanceProposal {
  votes: VoteIntent[];
  vote_count: number;
}

export interface ListProposalsOptions {
  page: number;
  pageSize: number;
  status?: ProposalStatus;
  includeExpired?: boolean;
}

export interface ListProposalsResult {
  proposals: GovernanceProposal[];
  total: number;
}

export interface VoteIntentInput {
  proposalId: string;
  voterAddress: string;
  support: boolean;
  comment?: string;
}

export interface OnChainProposalStatus {
  found: boolean;
  status?: string;
  votes_for?: number;
  votes_against?: number;
  executable_after?: string | null;
  executed?: boolean;
  source: "contract" | "unavailable";
  queried_at: string;
}

// ── List Proposals ────────────────────────────────────────────────────────────

/**
 * Returns paginated proposals from the database.
 * By default excludes expired proposals (matching issue #1268 spec: "non-expired").
 */
export async function listProposals(
  opts: ListProposalsOptions,
): Promise<ListProposalsResult> {
  const { page, pageSize, status, includeExpired = false } = opts;
  const offset = (page - 1) * pageSize;

  const pool = getReadPool();

  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (!includeExpired) {
    conditions.push(`(expires_at > NOW() OR status = 'executed')`);
  }

  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countQuery = `SELECT COUNT(*)::int AS total FROM governance_proposals ${where}`;
  const dataQuery = `
    SELECT
      id, contract_proposal_id, proposer_address, title, description,
      action_type, payload, status, votes_for, votes_against, threshold,
      executable_after, expires_at, executed_at, execution_tx_hash,
      created_at, updated_at
    FROM governance_proposals
    ${where}
    ORDER BY created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx}
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ total: number }>(countQuery, params),
    pool.query<GovernanceProposal>(dataQuery, [...params, pageSize, offset]),
  ]);

  return {
    proposals: dataResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

// ── Get Single Proposal ───────────────────────────────────────────────────────

/**
 * Fetches a single proposal with its vote intents.
 * Returns null when no proposal matches the given id.
 */
export async function getProposalById(
  id: string,
): Promise<ProposalWithVotes | null> {
  const pool = getReadPool();

  const [proposalResult, votesResult] = await Promise.all([
    pool.query<GovernanceProposal>(
      `SELECT
         id, contract_proposal_id, proposer_address, title, description,
         action_type, payload, status, votes_for, votes_against, threshold,
         executable_after, expires_at, executed_at, execution_tx_hash,
         created_at, updated_at
       FROM governance_proposals
       WHERE id = $1`,
      [id],
    ),
    pool.query<VoteIntent>(
      `SELECT id, proposal_id, voter_address, support, comment, on_chain_tx_hash, created_at
       FROM governance_vote_intents
       WHERE proposal_id = $1
       ORDER BY created_at ASC`,
      [id],
    ),
  ]);

  if (proposalResult.rowCount === 0) {
    return null;
  }

  const proposal = proposalResult.rows[0];
  return {
    ...proposal,
    votes: votesResult.rows,
    vote_count: votesResult.rowCount ?? 0,
  };
}

// ── Record Vote Intent ────────────────────────────────────────────────────────

/**
 * Records an off-chain vote intent for an authenticated user.
 *
 * Enforces the AlreadyVoted (error 15) guard from the on-chain contract:
 * each voter may only cast one intent per proposal.
 *
 * After inserting, updates the votes_for / votes_against tally on the parent
 * row so the dashboard can show live counts without recounting every time.
 */
export async function recordVoteIntent(
  input: VoteIntentInput,
): Promise<VoteIntent> {
  const { proposalId, voterAddress, support, comment } = input;
  const pool = getWritePool();

  // Verify the proposal exists and is still active/actionable
  const proposalCheck = await pool.query<{ status: ProposalStatus; expires_at: string }>(
    `SELECT status, expires_at FROM governance_proposals WHERE id = $1`,
    [proposalId],
  );

  if (proposalCheck.rowCount === 0) {
    const err = new Error("Proposal not found");
    (err as NodeJS.ErrnoException).code = "NOT_FOUND";
    throw err;
  }

  const proposal = proposalCheck.rows[0];

  if (proposal.status !== "active") {
    const err = new Error(`Proposal is not active (current status: ${proposal.status})`);
    (err as NodeJS.ErrnoException).code = "PROPOSAL_NOT_ACTIVE";
    throw err;
  }

  if (new Date(proposal.expires_at) < new Date()) {
    const err = new Error("Proposal has expired");
    (err as NodeJS.ErrnoException).code = "PROPOSAL_EXPIRED";
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert vote intent — the UNIQUE constraint on (proposal_id, voter_address)
    // will throw if the voter has already voted (mirrors AlreadyVoted error 15).
    const voteResult = await client.query<VoteIntent>(
      `INSERT INTO governance_vote_intents
         (proposal_id, voter_address, support, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, proposal_id, voter_address, support, comment, on_chain_tx_hash, created_at`,
      [proposalId, voterAddress, support, comment ?? null],
    );

    // Update tally in parent row
    if (support) {
      await client.query(
        `UPDATE governance_proposals SET votes_for = votes_for + 1 WHERE id = $1`,
        [proposalId],
      );
    } else {
      await client.query(
        `UPDATE governance_proposals SET votes_against = votes_against + 1 WHERE id = $1`,
        [proposalId],
      );
    }

    await client.query("COMMIT");

    logger.info(
      { proposalId, voterAddress, support },
      "[governance] vote intent recorded",
    );

    return voteResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");

    // Detect unique constraint violation → AlreadyVoted
    const pgErr = err as NodeJS.ErrnoException & { code?: string };
    if (pgErr.code === "23505") {
      const alreadyVoted = new Error("You have already cast a vote on this proposal");
      (alreadyVoted as NodeJS.ErrnoException).code = "ALREADY_VOTED";
      throw alreadyVoted;
    }

    throw err;
  } finally {
    client.release();
  }
}

// ── On-Chain Status ───────────────────────────────────────────────────────────

/**
 * Queries the Stellar/Soroban contract directly for a proposal's current
 * on-chain state. This is intentionally not cached — callers explicitly
 * request real-time accuracy.
 *
 * Falls back gracefully when the contract or Horizon is unavailable.
 */
export async function getOnChainProposalStatus(
  proposalId: string,
): Promise<OnChainProposalStatus> {
  const queriedAt = new Date().toISOString();

  // Resolve the contract_proposal_id from DB first
  const pool = getReadPool();
  const row = await pool.query<{ contract_proposal_id: number | null }>(
    `SELECT contract_proposal_id FROM governance_proposals WHERE id = $1`,
    [proposalId],
  );

  if (row.rowCount === 0) {
    const err = new Error("Proposal not found");
    (err as NodeJS.ErrnoException).code = "NOT_FOUND";
    throw err;
  }

  const contractProposalId = row.rows[0].contract_proposal_id;
  const { vaultContractId } = config.stellar;

  if (!contractProposalId || !vaultContractId) {
    logger.warn(
      { proposalId, contractProposalId, vaultContractId },
      "[governance] on-chain query skipped — contract not configured or proposal not yet on-chain",
    );
    return { found: false, source: "unavailable", queried_at: queriedAt };
  }

  // Query the Horizon/Soroban RPC for the governance proposal state.
  // The actual endpoint depends on the Soroban RPC method; here we use a
  // standard Horizon account data lookup pattern as a proxy.
  try {
    const path = `/contracts/${vaultContractId}/data?key=governance:proposal:${contractProposalId}`;
    const data = await horizonFetch<Record<string, unknown>>(
      path,
      `governance:proposal:${contractProposalId}`,
    );

    return {
      found: true,
      status: (data.status as string) ?? "unknown",
      votes_for: (data.votes_for as number) ?? 0,
      votes_against: (data.votes_against as number) ?? 0,
      executable_after: (data.executable_after as string) ?? null,
      executed: (data.executed as boolean) ?? false,
      source: "contract",
      queried_at: queriedAt,
    };
  } catch (err) {
    logger.warn(
      { err, proposalId, contractProposalId },
      "[governance] on-chain query failed — returning unavailable",
    );
    return { found: false, source: "unavailable", queried_at: queriedAt };
  }
}

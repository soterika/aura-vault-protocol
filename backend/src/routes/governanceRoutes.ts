/**
 * Governance Routes — Issue #1267
 *
 * GET  /api/v1/governance/proposals
 *   Returns the list of governance proposals with their current status.
 *   Auth-required: only authenticated users may browse proposals.
 *
 * GET  /api/v1/governance/proposals/:id
 *   Returns a single proposal by ID.
 *
 * POST /api/v1/governance/proposals/:id/vote
 *   Cast a vote on a proposal (calls the on-chain contract via a signed XDR).
 *   Body: { xdr: string, signer: string }
 *
 * POST /api/v1/governance/proposals/:id/execute
 *   Execute a proposal that has met threshold and passed the timelock.
 *   Body: { xdr: string }
 *
 * GET  /api/v1/governance/proposals/stream
 *   SSE stream that emits proposal state changes in real time.
 *
 * NOTE: Contract interaction (on-chain) is stubbed here — in production
 * the XDR would be submitted to the Horizon RPC. The in-memory store
 * simulates the contract state for integration testing.
 */

import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { successResponse, errorResponse } from "../dto/index.js";
import { logger } from "../logger.js";

export const governanceRouter = Router();

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
  /** True once the signature count reaches requiredSignatures. */
  thresholdMet: boolean;
  /** ISO timestamp when the timelock period started (null if not yet met threshold). */
  timelockStartedAt: string | null;
  /** ISO timestamp when timelock expires and execution is allowed (null until threshold met). */
  timelockExpiresAt: string | null;
  /** Same as timelockExpiresAt — alias for UI display. */
  executableAt: string | null;
  votesFor: number;
  votesAgainst: number;
  requiredSignatures: number;
  /** Addresses that have already voted. */
  signers: string[];
}

// ── In-memory store (simulates on-chain state) ────────────────────────────────
// In production this would be sourced from contract event indexer / DB.

const TIMELOCK_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours

const now = new Date();
const twoDaysAgo = new Date(now.getTime() - TIMELOCK_DURATION_MS - 3_600_000);
const inOneDayMs = now.getTime() + 24 * 60 * 60 * 1000;

const proposals = new Map<string, GovernanceProposal>([
  [
    "prop-1",
    {
      id: "prop-1",
      title: "Upgrade vault contract to v2",
      description:
        "This proposal upgrades the AuraVault Soroban contract from v1 to v2, enabling multi-asset deposits and dynamic fee tiers. Requires 3-of-5 multisig approval and a 48-hour timelock.",
      status: "Pending",
      proposer: "GADMIN1EXAMPLESTELLARADDRESS",
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      thresholdMet: false,
      timelockStartedAt: null,
      timelockExpiresAt: null,
      executableAt: null,
      votesFor: 1,
      votesAgainst: 0,
      requiredSignatures: 3,
      signers: ["GADMIN1EXAMPLESTELLARADDRESS"],
    },
  ],
  [
    "prop-2",
    {
      id: "prop-2",
      title: "Adjust harvest fee from 0.5% to 0.3%",
      description:
        "Reduces keeper harvest fee to attract more external keepers and improve yield compounding frequency.",
      status: "Executable",
      proposer: "GADMIN2EXAMPLESTELLARADDRESS",
      createdAt: twoDaysAgo.toISOString(),
      thresholdMet: true,
      timelockStartedAt: twoDaysAgo.toISOString(),
      timelockExpiresAt: new Date(twoDaysAgo.getTime() + TIMELOCK_DURATION_MS).toISOString(),
      executableAt: new Date(twoDaysAgo.getTime() + TIMELOCK_DURATION_MS).toISOString(),
      votesFor: 3,
      votesAgainst: 0,
      requiredSignatures: 3,
      signers: [
        "GADMIN2EXAMPLESTELLARADDRESS",
        "GADMIN3EXAMPLESTELLARADDRESS",
        "GADMIN4EXAMPLESTELLARADDRESS",
      ],
    },
  ],
  [
    "prop-3",
    {
      id: "prop-3",
      title: "Enable emergency pause for first 7 days after v2 deploy",
      description:
        "Grants a temporary guardian role that can pause deposits for a 7-day window immediately following the v2 upgrade.",
      status: "TimelockActive",
      proposer: "GADMIN3EXAMPLESTELLARADDRESS",
      createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      thresholdMet: true,
      timelockStartedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      timelockExpiresAt: new Date(inOneDayMs + 18 * 60 * 60 * 1000).toISOString(),
      executableAt: new Date(inOneDayMs + 18 * 60 * 60 * 1000).toISOString(),
      votesFor: 3,
      votesAgainst: 0,
      requiredSignatures: 3,
      signers: [
        "GADMIN3EXAMPLESTELLARADDRESS",
        "GADMIN4EXAMPLESTELLARADDRESS",
        "GADMIN5EXAMPLESTELLARADDRESS",
      ],
    },
  ],
]);

// ── SSE subscriber registry ───────────────────────────────────────────────────

type SseClient = Response;
const sseClients = new Set<SseClient>();

function broadcastProposalUpdate(proposal: GovernanceProposal) {
  const payload = JSON.stringify(proposal);
  for (const client of sseClients) {
    try {
      client.write(`event: proposal_updated\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function recomputeStatus(proposal: GovernanceProposal): ProposalStatus {
  if (proposal.status === "Executed" || proposal.status === "Rejected") {
    return proposal.status;
  }
  if (!proposal.thresholdMet) return "Pending";
  if (!proposal.timelockExpiresAt) return "TimelockActive";
  const now = Date.now();
  if (now < new Date(proposal.timelockExpiresAt).getTime()) return "TimelockActive";
  return "Executable";
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/governance/proposals/stream
 * SSE stream — must be registered before the :id routes to avoid param capture.
 */
governanceRouter.get("/proposals/stream", authenticate, (req: Request, res: Response): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);

  // Send a keepalive comment every 30 s
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(keepalive);
    }
  }, 30_000);

  req.on("close", () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

/**
 * GET /api/v1/governance/proposals
 * Returns all proposals, ordered newest first.
 * Optional query params: status, page, pageSize
 */
governanceRouter.get("/proposals", authenticate, (req: Request, res: Response): void => {
  try {
    const statusFilter = req.query.status as ProposalStatus | undefined;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10))
    );

    let list = Array.from(proposals.values()).map((p) => ({
      ...p,
      status: recomputeStatus(p),
    }));

    if (statusFilter) {
      list = list.filter((p) => p.status === statusFilter);
    }

    // Sort newest first
    list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = list.length;
    const slice = list.slice((page - 1) * pageSize, page * pageSize);

    res.json(
      successResponse({
        proposals: slice,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      })
    );
  } catch (err) {
    logger.error("[governance/proposals]", err);
    res
      .status(500)
      .json(errorResponse("INTERNAL_ERROR", "Failed to fetch proposals"));
  }
});

/**
 * GET /api/v1/governance/proposals/:id
 */
governanceRouter.get("/proposals/:id", authenticate, (req: Request, res: Response): void => {
  const proposal = proposals.get(req.params.id);
  if (!proposal) {
    res
      .status(404)
      .json(errorResponse("NOT_FOUND", `Proposal ${req.params.id} not found`));
    return;
  }
  res.json(
    successResponse({ ...proposal, status: recomputeStatus(proposal) })
  );
});

/**
 * POST /api/v1/governance/proposals/:id/vote
 * Body: { xdr: string, signer: string }
 *
 * Validates that the signer hasn't voted yet, records the vote,
 * and transitions the proposal to TimelockActive if threshold is met.
 */
governanceRouter.post(
  "/proposals/:id/vote",
  authenticate,
  (req: Request, res: Response): void => {
    const proposal = proposals.get(req.params.id);
    if (!proposal) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", `Proposal ${req.params.id} not found`)
        );
      return;
    }

    const { xdr, signer } = req.body as { xdr?: string; signer?: string };

    if (!signer || typeof signer !== "string" || signer.trim().length === 0) {
      res
        .status(400)
        .json(errorResponse("MISSING_SIGNER", "signer address is required"));
      return;
    }

    if (!xdr || typeof xdr !== "string") {
      res
        .status(400)
        .json(errorResponse("MISSING_XDR", "signed XDR is required"));
      return;
    }

    if (proposal.status === "Executed" || proposal.status === "Rejected") {
      res
        .status(409)
        .json(
          errorResponse(
            "PROPOSAL_CLOSED",
            "This proposal is no longer open for voting"
          )
        );
      return;
    }

    if (proposal.signers.includes(signer)) {
      res
        .status(409)
        .json(
          errorResponse(
            "ALREADY_VOTED",
            "This address has already voted on this proposal"
          )
        );
      return;
    }

    // Record the vote
    proposal.signers.push(signer);
    proposal.votesFor += 1;

    // Check threshold
    if (proposal.votesFor >= proposal.requiredSignatures) {
      proposal.thresholdMet = true;
      const nowTs = new Date().toISOString();
      const expiry = new Date(
        Date.now() + TIMELOCK_DURATION_MS
      ).toISOString();
      proposal.timelockStartedAt = nowTs;
      proposal.timelockExpiresAt = expiry;
      proposal.executableAt = expiry;
    }

    proposal.status = recomputeStatus(proposal);
    proposals.set(proposal.id, proposal);

    // Broadcast SSE update
    broadcastProposalUpdate(proposal);

    logger.info("[governance/vote]", {
      proposalId: proposal.id,
      signer,
      votesFor: proposal.votesFor,
      status: proposal.status,
    });

    res.json(
      successResponse({
        proposalId: proposal.id,
        status: proposal.status,
        votesFor: proposal.votesFor,
        thresholdMet: proposal.thresholdMet,
        timelockExpiresAt: proposal.timelockExpiresAt,
      })
    );
  }
);

/**
 * POST /api/v1/governance/proposals/:id/execute
 * Body: { xdr: string }
 *
 * Only allowed when status === "Executable" (timelock expired + threshold met).
 */
governanceRouter.post(
  "/proposals/:id/execute",
  authenticate,
  (req: Request, res: Response): void => {
    const proposal = proposals.get(req.params.id);
    if (!proposal) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", `Proposal ${req.params.id} not found`)
        );
      return;
    }

    const currentStatus = recomputeStatus(proposal);

    if (currentStatus !== "Executable") {
      const message =
        currentStatus === "TimelockActive"
          ? `Timelock has not expired yet. Executable at ${proposal.executableAt ?? "unknown"}.`
          : currentStatus === "Pending"
          ? "Proposal has not reached the required signature threshold yet."
          : `Proposal cannot be executed (status: ${currentStatus}).`;
      res
        .status(409)
        .json(errorResponse("NOT_EXECUTABLE", message));
      return;
    }

    const { xdr } = req.body as { xdr?: string };
    if (!xdr || typeof xdr !== "string") {
      res
        .status(400)
        .json(errorResponse("MISSING_XDR", "signed XDR is required to execute"));
      return;
    }

    // Mark as executed
    proposal.status = "Executed";
    proposals.set(proposal.id, proposal);

    broadcastProposalUpdate(proposal);

    logger.info("[governance/execute]", {
      proposalId: proposal.id,
      executedAt: new Date().toISOString(),
    });

    res.json(
      successResponse({
        proposalId: proposal.id,
        status: "Executed",
        executedAt: new Date().toISOString(),
      })
    );
  }
);

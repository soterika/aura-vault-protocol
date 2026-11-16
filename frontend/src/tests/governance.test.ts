/**
 * Tests for GovernanceDashboard logic — Issue #1267
 *
 * As with other frontend tests, we use vitest with environment: "node".
 * React rendering is not tested here; only the pure logic functions
 * (status computation, timeline building, vote eligibility) are covered.
 *
 * MSW mock-server tests for the governance API endpoint are in
 * useVaultQueries.test.ts (shared mock server).
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { GovernanceProposal, ProposalStatus } from "../lib/useGovernanceQueries";

// ── Pure helpers (inlined from GovernanceDashboard.tsx) ───────────────────────

const TIMELOCK_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours

function recomputeStatus(proposal: Pick<
  GovernanceProposal,
  "status" | "thresholdMet" | "timelockExpiresAt"
>): ProposalStatus {
  if (proposal.status === "Executed" || proposal.status === "Rejected") {
    return proposal.status;
  }
  if (!proposal.thresholdMet) return "Pending";
  if (!proposal.timelockExpiresAt) return "TimelockActive";
  const now = Date.now();
  if (now < new Date(proposal.timelockExpiresAt).getTime()) return "TimelockActive";
  return "Executable";
}

function canVote(
  proposal: Pick<GovernanceProposal, "status" | "thresholdMet" | "signers">,
  walletAddress: string | null
): boolean {
  if (!walletAddress) return false;
  if (proposal.status === "Executed" || proposal.status === "Rejected") return false;
  if (proposal.thresholdMet) return false;
  return !proposal.signers.includes(walletAddress);
}

function canExecute(status: ProposalStatus): boolean {
  return status === "Executable";
}

function buildTimeline(p: GovernanceProposal) {
  const thresholdDate = p.thresholdMet ? p.timelockStartedAt : null;
  return [
    { label: "Created",          date: p.createdAt,          reached: true },
    { label: "Threshold Met",    date: thresholdDate,        reached: p.thresholdMet },
    { label: "Timelock Started", date: p.timelockStartedAt,  reached: Boolean(p.timelockStartedAt) },
    { label: "Executable",       date: p.executableAt,       reached: p.status === "Executable" || p.status === "Executed" },
    { label: "Executed",         date: p.status === "Executed" ? p.executableAt : null, reached: p.status === "Executed" },
  ];
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<GovernanceProposal> = {}): GovernanceProposal {
  return {
    id: "prop-test",
    title: "Test proposal",
    description: "A test proposal",
    status: "Pending",
    proposer: "GPROPOSER",
    createdAt: new Date().toISOString(),
    thresholdMet: false,
    timelockStartedAt: null,
    timelockExpiresAt: null,
    executableAt: null,
    votesFor: 0,
    votesAgainst: 0,
    requiredSignatures: 3,
    signers: [],
    ...overrides,
  };
}

// ── Status computation ────────────────────────────────────────────────────────

describe("recomputeStatus", () => {
  it("returns Pending when threshold not met", () => {
    const p = makeProposal({ thresholdMet: false });
    expect(recomputeStatus(p)).toBe("Pending");
  });

  it("returns TimelockActive when threshold met but timelock not expired", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const p = makeProposal({
      thresholdMet: true,
      timelockExpiresAt: future,
    });
    expect(recomputeStatus(p)).toBe("TimelockActive");
  });

  it("returns Executable when timelock has expired", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const p = makeProposal({
      thresholdMet: true,
      timelockExpiresAt: past,
    });
    expect(recomputeStatus(p)).toBe("Executable");
  });

  it("preserves Executed status regardless of timelock", () => {
    const p = makeProposal({ status: "Executed", thresholdMet: true });
    expect(recomputeStatus(p)).toBe("Executed");
  });

  it("preserves Rejected status", () => {
    const p = makeProposal({ status: "Rejected" });
    expect(recomputeStatus(p)).toBe("Rejected");
  });

  it("returns TimelockActive when threshold met but no timelockExpiresAt", () => {
    const p = makeProposal({ thresholdMet: true, timelockExpiresAt: null });
    expect(recomputeStatus(p)).toBe("TimelockActive");
  });
});

// ── Vote eligibility ──────────────────────────────────────────────────────────

describe("canVote", () => {
  it("returns false when wallet not connected", () => {
    const p = makeProposal();
    expect(canVote(p, null)).toBe(false);
  });

  it("returns true for a new voter on a pending proposal", () => {
    const p = makeProposal({ thresholdMet: false, signers: [] });
    expect(canVote(p, "GNEWUSER")).toBe(true);
  });

  it("returns false if wallet has already voted", () => {
    const p = makeProposal({ signers: ["GALREADYVOTED"] });
    expect(canVote(p, "GALREADYVOTED")).toBe(false);
  });

  it("returns false once threshold is met", () => {
    const p = makeProposal({ thresholdMet: true, signers: [] });
    expect(canVote(p, "GNEW")).toBe(false);
  });

  it("returns false on Executed proposals", () => {
    const p = makeProposal({ status: "Executed", thresholdMet: false, signers: [] });
    expect(canVote(p, "GNEW")).toBe(false);
  });

  it("returns false on Rejected proposals", () => {
    const p = makeProposal({ status: "Rejected", thresholdMet: false, signers: [] });
    expect(canVote(p, "GNEW")).toBe(false);
  });
});

// ── Execute eligibility ───────────────────────────────────────────────────────

describe("canExecute", () => {
  it("returns true only for Executable status", () => {
    expect(canExecute("Executable")).toBe(true);
    expect(canExecute("Pending")).toBe(false);
    expect(canExecute("TimelockActive")).toBe(false);
    expect(canExecute("Executed")).toBe(false);
    expect(canExecute("Rejected")).toBe(false);
  });
});

// ── Timeline building ─────────────────────────────────────────────────────────

describe("buildTimeline", () => {
  it("always marks Created as reached", () => {
    const p = makeProposal();
    const timeline = buildTimeline(p);
    expect(timeline[0].label).toBe("Created");
    expect(timeline[0].reached).toBe(true);
  });

  it("marks Threshold Met unreached when threshold not met", () => {
    const p = makeProposal({ thresholdMet: false });
    const timeline = buildTimeline(p);
    const step = timeline.find((s) => s.label === "Threshold Met")!;
    expect(step.reached).toBe(false);
    expect(step.date).toBeNull();
  });

  it("marks Threshold Met reached when threshold is met", () => {
    const nowStr = new Date().toISOString();
    const p = makeProposal({
      thresholdMet: true,
      timelockStartedAt: nowStr,
    });
    const timeline = buildTimeline(p);
    const step = timeline.find((s) => s.label === "Threshold Met")!;
    expect(step.reached).toBe(true);
    expect(step.date).toBe(nowStr);
  });

  it("marks Executed step only when status is Executed", () => {
    const executed = makeProposal({
      status: "Executed",
      thresholdMet: true,
      executableAt: new Date().toISOString(),
    });
    const notExecuted = makeProposal({ status: "Executable", thresholdMet: true });

    const t1 = buildTimeline(executed);
    const t2 = buildTimeline(notExecuted);

    expect(t1.find((s) => s.label === "Executed")!.reached).toBe(true);
    expect(t2.find((s) => s.label === "Executed")!.reached).toBe(false);
  });

  it("returns exactly 5 steps", () => {
    expect(buildTimeline(makeProposal())).toHaveLength(5);
  });
});

// ── msw: governance API ───────────────────────────────────────────────────────

const server = setupServer(
  http.get("http://localhost/api/v1/governance/proposals", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    const allProposals: GovernanceProposal[] = [
      makeProposal({ id: "p1", status: "Pending" }),
      makeProposal({ id: "p2", status: "Executable", thresholdMet: true }),
      makeProposal({ id: "p3", status: "Executed", thresholdMet: true }),
    ];

    const filtered = status
      ? allProposals.filter((p) => p.status === status)
      : allProposals;

    return HttpResponse.json({
      success: true,
      data: {
        proposals: filtered,
        total: filtered.length,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      },
    });
  }),

  http.get("http://localhost/api/v1/governance/proposals/:id", ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: makeProposal({ id: params.id as string }),
    });
  }),

  http.post("http://localhost/api/v1/governance/proposals/:id/vote", async ({ request, params }) => {
    const body = await request.json() as { signer?: string };
    if (!body.signer) {
      return HttpResponse.json(
        { success: false, error: { code: "MISSING_SIGNER", message: "signer required" } },
        { status: 400 }
      );
    }
    return HttpResponse.json({
      success: true,
      data: { proposalId: params.id, status: "TimelockActive", votesFor: 1, thresholdMet: false },
    });
  }),

  http.post("http://localhost/api/v1/governance/proposals/:id/execute", async ({ request }) => {
    const body = await request.json() as { xdr?: string };
    if (!body.xdr) {
      return HttpResponse.json(
        { success: false, error: { code: "MISSING_XDR", message: "xdr required" } },
        { status: 400 }
      );
    }
    return HttpResponse.json({
      success: true,
      data: { proposalId: "p2", status: "Executed", executedAt: new Date().toISOString() },
    });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("msw: GET /api/v1/governance/proposals", () => {
  it("returns all proposals", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals", {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(res.ok).toBe(true);
    const json = await res.json() as { success: boolean; data: { proposals: GovernanceProposal[]; total: number } };
    expect(json.data.total).toBe(3);
  });

  it("filters by status", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals?status=Executable", {
      headers: { Authorization: "Bearer test-token" },
    });
    const json = await res.json() as { success: boolean; data: { proposals: GovernanceProposal[]; total: number } };
    expect(json.data.total).toBe(1);
    expect(json.data.proposals[0].status).toBe("Executable");
  });

  it("returns empty list when no proposals match filter", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals?status=Rejected", {
      headers: { Authorization: "Bearer test-token" },
    });
    const json = await res.json() as { success: boolean; data: { proposals: GovernanceProposal[]; total: number } };
    expect(json.data.total).toBe(0);
    expect(json.data.proposals).toHaveLength(0);
  });
});

describe("msw: POST /api/v1/governance/proposals/:id/vote", () => {
  it("submits a vote successfully", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals/p1/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ xdr: "dummyXDR", signer: "GVOTER" }),
    });
    expect(res.ok).toBe(true);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });

  it("returns 400 when signer is missing", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals/p1/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ xdr: "dummyXDR" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("msw: POST /api/v1/governance/proposals/:id/execute", () => {
  it("executes a proposal successfully", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals/p2/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ xdr: "dummyXDR" }),
    });
    expect(res.ok).toBe(true);
    const json = await res.json() as { success: boolean; data: { status: string } };
    expect(json.data.status).toBe("Executed");
  });

  it("returns 400 when xdr is missing", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals/p2/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

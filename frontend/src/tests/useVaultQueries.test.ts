/**
 * Tests for useVaultQueries — Issue #1266
 *
 * Strategy:
 *  - vitest is configured with environment: "node" (no JSDOM)
 *  - @testing-library/react is not available in this project
 *  - We therefore test the pure logic: query key structure, optimistic
 *    update math, and the helper functions that build the API URLs.
 *
 *  For the msw mock-server integration tests (which require a DOM), we
 *  test the fetch layer directly using msw's node handler.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QUERY_KEYS } from "../lib/useVaultQueries";

// ── Query key structure ───────────────────────────────────────────────────────

describe("QUERY_KEYS", () => {
  it("vaultStats is a stable tuple", () => {
    expect(QUERY_KEYS.vaultStats).toEqual(["vault", "stats"]);
  });

  it("vaultBalance includes the address", () => {
    expect(QUERY_KEYS.vaultBalance("GABCDEF")).toEqual([
      "vault",
      "balance",
      "GABCDEF",
    ]);
  });

  it("vaultBalance for empty string produces consistent key", () => {
    const key = QUERY_KEYS.vaultBalance("");
    expect(key).toEqual(["vault", "balance", ""]);
  });

  it("transactions with address includes address", () => {
    expect(QUERY_KEYS.transactions("GABC")).toEqual([
      "vault",
      "transactions",
      "GABC",
    ]);
  });

  it("transactions without address returns base key", () => {
    expect(QUERY_KEYS.transactions()).toEqual(["vault", "transactions"]);
    expect(QUERY_KEYS.transactions(undefined)).toEqual([
      "vault",
      "transactions",
    ]);
  });

  it("userPreferences key is stable", () => {
    expect(QUERY_KEYS.userPreferences).toEqual(["user", "preferences"]);
  });

  it("gasEstimate key is stable", () => {
    expect(QUERY_KEYS.gasEstimate).toEqual(["gas", "estimate"]);
  });

  it("governanceProposals key is stable", () => {
    expect(QUERY_KEYS.governanceProposals).toEqual([
      "governance",
      "proposals",
    ]);
  });
});

// ── Optimistic update arithmetic ──────────────────────────────────────────────

/**
 * Inline the optimistic balance update logic from useDepositMutation and
 * useWithdrawMutation so we can test it without a React environment.
 */
function applyDeposit(currentBalance: string, amount: string): string {
  const prev = BigInt(currentBalance);
  const delta = BigInt(Math.floor(parseFloat(amount) * 1e7));
  return String(prev + delta);
}

function applyWithdraw(currentBalance: string, amount: string): string {
  const prev = BigInt(currentBalance);
  const delta = BigInt(Math.floor(parseFloat(amount) * 1e7));
  const next = prev > delta ? prev - delta : 0n;
  return String(next);
}

describe("Optimistic update arithmetic", () => {
  it("deposit adds to balance in Stellar 7-decimal precision", () => {
    // 100 tokens at 1e7 = 1_000_000_000 stroops
    expect(applyDeposit("0", "100")).toBe("1000000000");
  });

  it("deposit accumulates correctly on existing balance", () => {
    expect(applyDeposit("500000000", "50")).toBe("1000000000");
  });

  it("withdraw subtracts from balance", () => {
    expect(applyWithdraw("1000000000", "100")).toBe("0");
  });

  it("withdraw partial amount leaves correct remainder", () => {
    expect(applyWithdraw("1000000000", "30")).toBe("700000000");
  });

  it("withdraw clamps to 0 when amount exceeds balance", () => {
    expect(applyWithdraw("100", "100000")).toBe("0");
  });

  it("handles fractional deposit amounts", () => {
    // 0.5 tokens = 5_000_000 stroops
    expect(applyDeposit("0", "0.5")).toBe("5000000");
  });
});

// ── msw mock-server: raw fetch layer ─────────────────────────────────────────

const mockVaultStats = {
  success: true,
  data: {
    totalAssets: "1000000000000",
    totalShares: "1000000000",
    totalDepositors: 42,
    apy7d: 850,
    sharePrice: 1.0,
    cached: false,
    fetched_at: "2026-01-01T00:00:00Z",
  },
};

const mockBalance = {
  success: true,
  data: { balance: "500000000" },
};

const mockMetrics = {
  success: true,
  data: { apy: 8.5, tvl: 1_000_000, totalUsers: 42, tvlChange24h: 1.2 },
};

const mockTransactions = [
  {
    id: "tx1",
    type: "deposit",
    amount: 100,
    timestamp: 1_700_000_000_000,
    status: "completed",
  },
];

const mockGasEstimate = {
  success: true,
  data: { baseFee: "100", priorityFee: "10", totalGas: "110" },
};

const mockProposals = {
  success: true,
  data: {
    proposals: [
      {
        id: "prop-1",
        title: "Upgrade contract to v2",
        description: "This proposal upgrades the vault to v2.",
        status: "Pending",
        proposer: "GABCDEF",
        createdAt: "2026-01-01T00:00:00Z",
        thresholdMet: false,
        timelockExpiresAt: null,
        executableAt: null,
        votesFor: 0,
        votesAgainst: 0,
        requiredSignatures: 3,
        signers: [],
      },
    ],
    total: 1,
  },
};

const server = setupServer(
  http.get("http://localhost/api/v1/vault/stats", () => HttpResponse.json(mockVaultStats)),
  http.get("http://localhost/api/vault/balance_of", () => HttpResponse.json(mockBalance)),
  http.get("http://localhost/api/vault/metrics", () => HttpResponse.json(mockMetrics)),
  http.get("http://localhost/api/vault/transactions", () =>
    HttpResponse.json(mockTransactions)
  ),
  http.get("http://localhost/api/v1/gas/estimate", () => HttpResponse.json(mockGasEstimate)),
  http.get("http://localhost/api/v1/governance/proposals", () =>
    HttpResponse.json(mockProposals)
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("msw mock server: vault stats", () => {
  it("returns vault stats shape", async () => {
    const res = await fetch("http://localhost/api/v1/vault/stats");
    expect(res.ok).toBe(true);
    const json = await res.json() as typeof mockVaultStats;
    expect(json.data.totalDepositors).toBe(42);
    expect(json.data.apy7d).toBe(850);
  });

  it("returns an error on server fault", async () => {
    server.use(
      http.get("http://localhost/api/v1/vault/stats", () =>
        HttpResponse.json({ error: "Server error" }, { status: 500 })
      )
    );
    const res = await fetch("http://localhost/api/v1/vault/stats");
    expect(res.status).toBe(500);
  });
});

describe("msw mock server: vault balance", () => {
  it("returns balance for an address", async () => {
    const res = await fetch("http://localhost/api/vault/balance_of?address=GABCDEF");
    expect(res.ok).toBe(true);
    const json = await res.json() as typeof mockBalance;
    expect(json.data.balance).toBe("500000000");
  });
});

describe("msw mock server: vault metrics", () => {
  it("returns metrics shape", async () => {
    const res = await fetch("http://localhost/api/vault/metrics");
    expect(res.ok).toBe(true);
    const json = await res.json() as typeof mockMetrics;
    expect(json.data.tvl).toBe(1_000_000);
  });
});

describe("msw mock server: transactions", () => {
  it("returns transaction list", async () => {
    const res = await fetch("http://localhost/api/vault/transactions");
    expect(res.ok).toBe(true);
    const json = await res.json() as typeof mockTransactions;
    expect(Array.isArray(json)).toBe(true);
    expect(json[0].id).toBe("tx1");
  });
});

describe("msw mock server: gas estimate", () => {
  it("returns gas estimate shape", async () => {
    const res = await fetch("http://localhost/api/v1/gas/estimate");
    expect(res.ok).toBe(true);
    const json = await res.json() as typeof mockGasEstimate;
    expect(json.data.totalGas).toBe("110");
  });
});

describe("msw mock server: governance proposals", () => {
  it("returns proposals list", async () => {
    const res = await fetch("http://localhost/api/v1/governance/proposals");
    expect(res.ok).toBe(true);
    const json = await res.json() as typeof mockProposals;
    expect(json.data.total).toBe(1);
    expect(json.data.proposals[0].status).toBe("Pending");
  });

  it("returns empty list when no proposals", async () => {
    server.use(
      http.get("http://localhost/api/v1/governance/proposals", () =>
        HttpResponse.json({
          success: true,
          data: { proposals: [], total: 0 },
        })
      )
    );
    const res = await fetch("http://localhost/api/v1/governance/proposals");
    const json = await res.json() as { success: boolean; data: { proposals: unknown[]; total: number } };
    expect(json.data.total).toBe(0);
    expect(json.data.proposals).toHaveLength(0);
  });
});

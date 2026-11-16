/**
 * Unit tests for src/lib/portfolioExport.ts
 *
 * Tests run in jsdom (no real browser File API needed for CSV/JSON building).
 * Download side-effects are skipped — we only test the data-building functions.
 */
import { describe, it, expect } from "vitest";
import { buildCsv, buildJsonExport } from "../lib/portfolioExport";
import type { ExportTransaction, PortfolioPosition } from "../lib/portfolioExport";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TX1: ExportTransaction = {
  date: "2024-03-15T10:22:00Z",
  type: "deposit",
  amount: "500.00",
  shares: "500.00",
  txHash: "abc123",
  priceAtTime: "1.0000",
};

const TX2: ExportTransaction = {
  date: "2024-04-01T08:00:00Z",
  type: "harvest",
  amount: "53.20",
  shares: "0.00",
  txHash: "cde345",
  priceAtTime: "1.0548",
};

const TX_WITH_COMMA: ExportTransaction = {
  date: "2024-05-01T00:00:00Z",
  type: "withdraw",
  amount: "100,500.00",   // comma inside value — must be escaped
  shares: "99.5",
  txHash: "fff111",
  priceAtTime: "1.01",
};

const POSITION: PortfolioPosition = {
  shares: "998.50",
  underlyingBalance: "1053.20",
  pricePerShare: "1.0548",
  apy: "8.5",
  yieldEarned: "53.20",
};

const ADDRESS = "GAURA1234567890EXAMPLEADDRESSXYZ";

// ── buildCsv ──────────────────────────────────────────────────────────────────

describe("buildCsv", () => {
  it("includes UTF-8 BOM as first character", () => {
    const csv = buildCsv([TX1]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it("has correct header row", () => {
    const csv = buildCsv([TX1]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("date,type,amount,shares,tx_hash,price_at_time");
  });

  it("outputs one data row per transaction", () => {
    const csv = buildCsv([TX1, TX2]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    // 1 header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it("row columns match transaction fields in order", () => {
    const csv = buildCsv([TX1]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    const row = lines[1];
    expect(row).toBe(
      `${TX1.date},${TX1.type},${TX1.amount},${TX1.shares},${TX1.txHash},${TX1.priceAtTime}`
    );
  });

  it("wraps fields containing commas in double-quotes", () => {
    const csv = buildCsv([TX_WITH_COMMA]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[1]).toContain('"100,500.00"');
  });

  it("returns header-only CSV for empty array (no data rows)", () => {
    const csv = buildCsv([]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^date,/);
  });
});

// ── buildJsonExport ───────────────────────────────────────────────────────────

describe("buildJsonExport", () => {
  it("sets schemaVersion to '1.0'", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      position: POSITION,
      transactions: [TX1],
    });
    expect(result.schemaVersion).toBe("1.0");
  });

  it("includes all provided transactions", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      position: POSITION,
      transactions: [TX1, TX2],
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].txHash).toBe("abc123");
  });

  it("sets walletAddress correctly", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      position: POSITION,
      transactions: [],
    });
    expect(result.walletAddress).toBe(ADDRESS);
  });

  it("defaults network to 'mainnet' when not provided", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      position: POSITION,
      transactions: [],
    });
    expect(result.network).toBe("mainnet");
  });

  it("uses provided network", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      network: "testnet",
      position: POSITION,
      transactions: [],
    });
    expect(result.network).toBe("testnet");
  });

  it("includes exportedAt as a valid ISO-8601 date", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      position: POSITION,
      transactions: [],
    });
    expect(() => new Date(result.exportedAt).toISOString()).not.toThrow();
  });

  it("preserves position snapshot fields", () => {
    const result = buildJsonExport({
      walletAddress: ADDRESS,
      position: POSITION,
      transactions: [],
    });
    expect(result.position.apy).toBe("8.5");
    expect(result.position.yieldEarned).toBe("53.20");
  });
});

/**
 * Unit tests for AuditRepository
 *
 * All PostgreSQL I/O is mocked — no running database required.
 * The test suite validates:
 *   - SQL query shapes and parameter binding for every method
 *   - Row-to-domain mapping (snake_case → camelCase, bigint ids)
 *   - Edge cases: empty results, zero-length id arrays, window-function totals
 *   - Pool routing (write vs. read replica)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the db module before importing the repository ────────────────────────

const mockWriteQuery = vi.fn();
const mockReadQuery = vi.fn();

vi.mock("../../db.js", () => ({
  getWritePool: () => ({ query: mockWriteQuery }),
  getReadPool: () => ({ query: mockReadQuery }),
}));

// Import after mock is in place
import { AuditRepository } from "./audit.repository.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a raw Postgres row as the driver returns it. */
function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "1",
    actor: "wallet-A",
    entity_type: "vault",
    entity_id: "vault-001",
    action: "deposit",
    metadata: { amount: "1000" },
    anchor_hash: null,
    created_at: "2024-01-15T10:00:00.000Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AuditRepository", () => {
  let repo: AuditRepository;

  beforeEach(() => {
    repo = new AuditRepository();
    vi.clearAllMocks();
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("inserts a row and returns a mapped AuditLog", async () => {
      const row = makeRow({ id: "42", anchor_hash: null });
      mockWriteQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await repo.create({
        actor: "wallet-A",
        entityType: "vault",
        entityId: "vault-001",
        action: "deposit",
        metadata: { amount: "1000" },
      });

      expect(result.id).toBe(42n);
      expect(result.actor).toBe("wallet-A");
      expect(result.entityType).toBe("vault");
      expect(result.entityId).toBe("vault-001");
      expect(result.action).toBe("deposit");
      expect(result.metadata).toEqual({ amount: "1000" });
      expect(result.anchorHash).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("uses the write pool", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [makeRow()] });
      await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d" });
      expect(mockWriteQuery).toHaveBeenCalledOnce();
      expect(mockReadQuery).not.toHaveBeenCalled();
    });

    it("serialises metadata to JSON in the INSERT", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [makeRow()] });
      const meta = { foo: "bar", count: 7 };
      await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d", metadata: meta });

      const [, params] = mockWriteQuery.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe(JSON.stringify(meta));
    });

    it("defaults metadata to {} when not provided", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [makeRow()] });
      await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d" });

      const [, params] = mockWriteQuery.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe("{}");
    });

    it("passes actor, entityType, entityId, action as positional params", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [makeRow()] });
      await repo.create({ actor: "myActor", entityType: "user", entityId: "uid-1", action: "login" });

      const [, params] = mockWriteQuery.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe("myActor");
      expect(params[1]).toBe("user");
      expect(params[2]).toBe("uid-1");
      expect(params[3]).toBe("login");
    });
  });

  // ── findUnanchored ──────────────────────────────────────────────────────────

  describe("findUnanchored()", () => {
    it("returns all unanchored logs ordered by created_at", async () => {
      const rows = [
        makeRow({ id: "1", action: "deposit" }),
        makeRow({ id: "2", action: "withdraw" }),
      ];
      mockWriteQuery.mockResolvedValueOnce({ rows });

      const result = await repo.findUnanchored();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1n);
      expect(result[1].id).toBe(2n);
    });

    it("returns empty array when no unanchored logs exist", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [] });
      const result = await repo.findUnanchored();
      expect(result).toEqual([]);
    });

    it("uses the write pool (scheduler must see fresh rows without replica lag)", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findUnanchored();
      expect(mockWriteQuery).toHaveBeenCalledOnce();
      expect(mockReadQuery).not.toHaveBeenCalled();
    });

    it("queries only rows WHERE anchor_hash IS NULL", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findUnanchored();

      const [sql] = mockWriteQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/WHERE\s+anchor_hash\s+IS\s+NULL/i);
    });

    it("orders results ASC by created_at", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findUnanchored();

      const [sql] = mockWriteQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/ORDER\s+BY\s+created_at\s+ASC/i);
    });
  });

  // ── findAllInRange ──────────────────────────────────────────────────────────

  describe("findAllInRange()", () => {
    const from = new Date("2024-01-01T00:00:00Z");
    const to = new Date("2024-01-31T23:59:59Z");

    it("returns logs within the given time range", async () => {
      const rows = [makeRow({ id: "10" }), makeRow({ id: "11" })];
      mockReadQuery.mockResolvedValueOnce({ rows });

      const result = await repo.findAllInRange(from, to);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(10n);
      expect(result[1].id).toBe(11n);
    });

    it("returns empty array for a range with no data", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      const result = await repo.findAllInRange(from, to);
      expect(result).toEqual([]);
    });

    it("uses the read (replica) pool", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findAllInRange(from, to);
      expect(mockReadQuery).toHaveBeenCalledOnce();
      expect(mockWriteQuery).not.toHaveBeenCalled();
    });

    it("passes from and to as positional parameters", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findAllInRange(from, to);

      const [, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe(from);
      expect(params[1]).toBe(to);
    });

    it("filters with >= and <= (inclusive bounds)", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findAllInRange(from, to);

      const [sql] = mockReadQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/created_at\s*>=\s*\$1/i);
      expect(sql).toMatch(/created_at\s*<=\s*\$2/i);
    });

    it("orders results ASC by created_at", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findAllInRange(from, to);

      const [sql] = mockReadQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/ORDER\s+BY\s+created_at\s+ASC/i);
    });
  });

  // ── query ───────────────────────────────────────────────────────────────────

  describe("query()", () => {
    it("returns logs and total from the window function", async () => {
      const rows = [
        { ...makeRow({ id: "1" }), total_count: "5" },
        { ...makeRow({ id: "2" }), total_count: "5" },
      ];
      mockReadQuery.mockResolvedValueOnce({ rows });

      const result = await repo.query({});

      expect(result.total).toBe(5);
      expect(result.logs).toHaveLength(2);
    });

    it("returns { logs: [], total: 0 } when no rows match", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      const result = await repo.query({ actor: "nobody" });
      expect(result.total).toBe(0);
      expect(result.logs).toEqual([]);
    });

    it("uses the read (replica) pool", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({});
      expect(mockReadQuery).toHaveBeenCalledOnce();
      expect(mockWriteQuery).not.toHaveBeenCalled();
    });

    it("applies actor filter as a positional parameter", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({ actor: "wallet-X" });

      const [sql, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/actor\s*=\s*\$1/i);
      expect(params[0]).toBe("wallet-X");
    });

    it("applies entityType filter", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({ entityType: "vault" });

      const [sql, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/entity_type\s*=\s*\$1/i);
      expect(params[0]).toBe("vault");
    });

    it("applies entityId filter", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({ entityId: "vault-42" });

      const [sql, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/entity_id\s*=\s*\$1/i);
      expect(params[0]).toBe("vault-42");
    });

    it("applies combined actor + entityType + entityId filters", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({ actor: "a", entityType: "vault", entityId: "v1" });

      const [sql, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/actor\s*=\s*\$1/i);
      expect(sql).toMatch(/entity_type\s*=\s*\$2/i);
      expect(sql).toMatch(/entity_id\s*=\s*\$3/i);
      expect(params[0]).toBe("a");
      expect(params[1]).toBe("vault");
      expect(params[2]).toBe("v1");
    });

    it("applies from/to time range filters", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      const from = new Date("2024-01-01T00:00:00Z");
      const to = new Date("2024-01-31T23:59:59Z");
      await repo.query({ from, to });

      const [sql, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/created_at\s*>=\s*\$1/i);
      expect(sql).toMatch(/created_at\s*<=\s*\$2/i);
      expect(params[0]).toBe(from);
      expect(params[1]).toBe(to);
    });

    it("passes limit and offset as the last two parameters", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({ limit: 25, offset: 50 });

      const [, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      // No filter conditions → limit=$1, offset=$2
      expect(params[0]).toBe(25);
      expect(params[1]).toBe(50);
    });

    it("defaults limit to 100 when not specified", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({});

      const [, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe(100);
    });

    it("defaults offset to 0 when not specified", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({});

      const [, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(params[1]).toBe(0);
    });

    it("caps limit at 1 000 rows", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({ limit: 99_999 });

      const [, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe(1_000);
    });

    it("includes COUNT(*) OVER () window function for total", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({});

      const [sql] = mockReadQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/COUNT\(\*\)\s+OVER\s*\(\s*\)/i);
    });

    it("orders results DESC by created_at", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.query({});

      const [sql] = mockReadQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/ORDER\s+BY\s+created_at\s+DESC/i);
    });
  });

  // ── setAnchorHash ────────────────────────────────────────────────────────────

  describe("setAnchorHash()", () => {
    it("returns 0 without querying when ids array is empty", async () => {
      const result = await repo.setAnchorHash([], "abc123");
      expect(result).toBe(0);
      expect(mockWriteQuery).not.toHaveBeenCalled();
    });

    it("updates rows and returns rowCount", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rowCount: 3 });
      const ids = [1n, 2n, 3n];
      const result = await repo.setAnchorHash(ids, "deadbeef");
      expect(result).toBe(3);
    });

    it("uses the write pool", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rowCount: 1 });
      await repo.setAnchorHash([1n], "hash");
      expect(mockWriteQuery).toHaveBeenCalledOnce();
      expect(mockReadQuery).not.toHaveBeenCalled();
    });

    it("passes anchor_hash as first parameter", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rowCount: 2 });
      await repo.setAnchorHash([10n, 11n], "myhash");

      const [, params] = mockWriteQuery.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe("myhash");
    });

    it("passes ids as string array in the ANY() clause", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rowCount: 2 });
      await repo.setAnchorHash([10n, 11n], "myhash");

      const [sql, params] = mockWriteQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/ANY\s*\(\$2::bigint\[\]\)/i);
      expect(params[1]).toEqual(["10", "11"]);
    });

    it("only updates rows that are still unanchored (anchor_hash IS NULL guard)", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rowCount: 0 });
      await repo.setAnchorHash([99n], "hash");

      const [sql] = mockWriteQuery.mock.calls[0] as [string];
      expect(sql).toMatch(/anchor_hash\s+IS\s+NULL/i);
    });

    it("handles null rowCount from the driver gracefully", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rowCount: null });
      const result = await repo.setAnchorHash([1n], "h");
      expect(result).toBe(0);
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────────

  describe("findById()", () => {
    it("returns the log when found", async () => {
      const row = makeRow({ id: "77", action: "harvest" });
      mockReadQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await repo.findById(77n);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(77n);
      expect(result!.action).toBe("harvest");
    });

    it("returns null when not found", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      const result = await repo.findById(9999n);
      expect(result).toBeNull();
    });

    it("uses the read pool", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findById(1n);
      expect(mockReadQuery).toHaveBeenCalledOnce();
      expect(mockWriteQuery).not.toHaveBeenCalled();
    });

    it("passes id as a string parameter (BigInt serialisation)", async () => {
      mockReadQuery.mockResolvedValueOnce({ rows: [] });
      await repo.findById(42n);

      const [, params] = mockReadQuery.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe("42");
    });
  });

  // ── Row mapping ───────────────────────────────────────────────────────────────

  describe("row → AuditLog mapping", () => {
    it("maps anchor_hash correctly when set", async () => {
      const row = makeRow({ anchor_hash: "0xdeadbeef" });
      mockWriteQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d" });
      expect(result.anchorHash).toBe("0xdeadbeef");
    });

    it("maps anchor_hash to null when not set", async () => {
      const row = makeRow({ anchor_hash: null });
      mockWriteQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d" });
      expect(result.anchorHash).toBeNull();
    });

    it("converts id to bigint", async () => {
      const row = makeRow({ id: "9007199254740993" }); // > Number.MAX_SAFE_INTEGER
      mockWriteQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d" });
      expect(result.id).toBe(9007199254740993n);
    });

    it("converts created_at string to a Date object", async () => {
      mockWriteQuery.mockResolvedValueOnce({ rows: [makeRow()] });
      const result = await repo.create({ actor: "a", entityType: "b", entityId: "c", action: "d" });
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  // ── Singleton export ──────────────────────────────────────────────────────────

  describe("auditRepository singleton", () => {
    it("exports a pre-constructed AuditRepository instance", async () => {
      const { auditRepository } = await import("./audit.repository.js");
      expect(auditRepository).toBeInstanceOf(AuditRepository);
    });
  });
});

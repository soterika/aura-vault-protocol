import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../db.js", () => ({ db: { query } }));

import { searchEvents } from "./eventSearchService.js";

describe("searchEvents", () => {
  beforeEach(() => query.mockReset());

  it("uses PostgreSQL full-text search, filters, ordering and pagination", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ total: "21" }] })
      .mockResolvedValueOnce({ rows: [{ id: "event-1", event_type: "deposit" }] });

    const response = await searchEvents({
      q: "large deposit",
      type: "deposit",
      from: "2025-01-01T00:00:00Z",
      to: "2025-02-01T00:00:00Z",
      page: 2,
      pageSize: 10,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("search_vector @@ websearch_to_tsquery('simple', $1)");
    expect(query.mock.calls[0][0]).toContain("event_type = $2");
    expect(query.mock.calls[0][0]).toContain("created_at >= $3::timestamptz");
    expect(query.mock.calls[0][0]).toContain("created_at <= $4::timestamptz");
    expect(query.mock.calls[1][0]).toContain("LIMIT $5 OFFSET $6");
    expect(query.mock.calls[1][1]).toEqual([
      "large deposit", "deposit", "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", 10, 10,
    ]);
    expect(response).toEqual({
      data: [{ id: "event-1", event_type: "deposit" }],
      pagination: { page: 2, pageSize: 10, total: 21, totalPages: 3 },
    });
  });

  it("supports search without optional filters", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await searchEvents({ q: "deposit", page: 1, pageSize: 20 });
    expect(query.mock.calls[0][1]).toEqual(["deposit"]);
    expect(response.pagination.totalPages).toBe(0);
  });
});

describe("contract event migrations", () => {
  const createSchema = readFileSync(new URL("../../migrations/005_create_contract_events.sql", import.meta.url), "utf8");
  const searchMigration = readFileSync(new URL("../../migrations/006_contract_event_full_text_search.sql", import.meta.url), "utf8");

  it("creates the event columns written by the backfill path", () => {
    for (const column of ["ledger_sequence", "transaction_hash", "event_index", "contract_id", "event_type", "topic", "value", "created_at"]) {
      expect(createSchema).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(createSchema).toContain("UNIQUE (transaction_hash, event_index)");
  });

  it("adds, backfills, maintains, and indexes the full-text vector", () => {
    expect(searchMigration).toMatch(/ADD COLUMN IF NOT EXISTS search_vector TSVECTOR/i);
    expect(searchMigration).toMatch(/UPDATE contract_events[\s\S]*WHERE search_vector IS NULL/i);
    expect(searchMigration).toMatch(/BEFORE INSERT OR UPDATE OF event_type, contract_id, transaction_hash, topic, value/i);
    expect(searchMigration).toMatch(/USING GIN \(search_vector\)/i);
    for (const sourceColumn of ["event_type", "contract_id", "transaction_hash", "topic", "value"]) {
      expect(searchMigration).toContain(`NEW.${sourceColumn}`);
    }
    const backfill = searchMigration.split("UPDATE contract_events")[1]?.split("WHERE search_vector IS NULL")[0] ?? "";
    for (const sourceColumn of ["event_type", "contract_id", "transaction_hash", "topic", "value"]) {
      expect(backfill).toContain(sourceColumn);
    }
  });
});

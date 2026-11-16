import { describe, it, expect, vi } from "vitest";
import {
  parseMigrationSql,
  MigrationLockError,
} from "../runner.js";

describe("Database Migration System (Issue #293)", () => {
  it("correctly parses SQL files with up and down sections", () => {
    const rawSql = `
      BEGIN;
      CREATE TABLE test_table (id INT PRIMARY KEY);
      COMMIT;

      -- Down Migration
      BEGIN;
      DROP TABLE test_table CASCADE;
      COMMIT;
    `;

    const parsed = parseMigrationSql(rawSql, "001_test_table.sql");
    expect(parsed.name).toBe("001_test_table");
    expect(parsed.filename).toBe("001_test_table.sql");
    expect(parsed.upSql).toContain("CREATE TABLE test_table");
    expect(parsed.downSql).toContain("DROP TABLE test_table");
  });

  it("handles SQL files without explicit down marker gracefully", () => {
    const rawSql = `
      CREATE TABLE only_up (id INT);
    `;

    const parsed = parseMigrationSql(rawSql, "002_only_up.sql");
    expect(parsed.name).toBe("002_only_up");
    expect(parsed.upSql).toContain("CREATE TABLE only_up");
    expect(parsed.downSql).toContain("No explicit down migration defined");
  });

  it("defines MigrationLockError with clear messaging", () => {
    const err = new MigrationLockError();
    expect(err.name).toBe("MigrationLockError");
    expect(err.message).toContain("Migration lock is currently held");
  });
});

/**
 * logger.redaction.test.ts — issue #1269
 *
 * Verifies that the Pino logger correctly redacts sensitive field patterns so
 * secrets never appear in log output, and that the safe startup log shape
 * contains only the expected non-sensitive fields.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import pino from "pino";
import { Writable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Patterns that must NEVER appear in log output. */
const SENSITIVE_PATTERNS = [
  /password/i,
  /jwt[-_]?secret/i,
  /api[-_]?key/i,
  /database_url/i,
  /redis_url/i,
  // Literal secret/token values should be replaced with [REDACTED]
];

/**
 * Build a Pino logger that writes JSON lines to an in-memory array so tests
 * can inspect the raw serialised output without touching stdout.
 */
function buildTestLogger(redactPaths: string[]) {
  const lines: string[] = [];

  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });

  const logger = pino(
    {
      level: "trace",
      redact: { paths: redactPaths, censor: "[REDACTED]" },
    },
    dest,
  );

  return { logger, lines };
}

// The same REDACTED_PATHS as defined in logger.ts
const REDACTED_PATHS: string[] = [
  "password",
  "*.password",
  "req.body.password",
  "req.body.token",
  "req.body.accessToken",
  "req.body.refreshToken",
  "res.body.accessToken",
  "res.body.refreshToken",
  "token",
  "accessToken",
  "refreshToken",
  "jwtSecret",
  "secret",
  "*.secret",
  "*.jwtSecret",
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "privateKey",
  "*.privateKey",
  "mnemonic",
  "*.mnemonic",
  "seed",
  "*.seed",
  "secretKey",
  "*.secretKey",
  // Issue #1269 additions
  "*.token",
  "*.key",
  "*.apiKey",
  "*.api_key",
  "*.url",
  "*.password",
  "*.secret",
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Pino logger redaction (#1269)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts top-level 'password' field", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ password: "super-secret-123" }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.password).toBe("[REDACTED]");
    expect(JSON.stringify(log)).not.toContain("super-secret-123");
  });

  it("redacts top-level 'token' field", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ token: "eyJhbGciOiJIUzI1NiJ9.payload.sig" }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.token).toBe("[REDACTED]");
  });

  it("redacts top-level 'secret' field", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ secret: "my-jwt-secret-value" }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.secret).toBe("[REDACTED]");
    expect(JSON.stringify(log)).not.toContain("my-jwt-secret-value");
  });

  it("redacts top-level 'jwtSecret' field", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ jwtSecret: "hs256-secret" }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.jwtSecret).toBe("[REDACTED]");
  });

  it("redacts nested '*.password' — e.g. config.database.password", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ db: { password: "db-pass" } }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.db.password).toBe("[REDACTED]");
  });

  it("redacts nested '*.secret'", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ config: { secret: "config-secret" } }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.config.secret).toBe("[REDACTED]");
  });

  it("redacts nested '*.url' — covers database/redis URL leaks", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ db: { url: "postgres://user:pass@host:5432/db" } }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.db.url).toBe("[REDACTED]");
    expect(JSON.stringify(log)).not.toContain("postgres://user:pass@host:5432/db");
  });

  it("redacts nested '*.key' — covers API keys", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ email: { key: "SG.some-sendgrid-api-key" } }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.email.key).toBe("[REDACTED]");
  });

  it("redacts nested '*.token'", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info({ auth: { token: "bearer-xyz" } }, "test");

    const log = JSON.parse(lines[0]!);
    expect(log.auth.token).toBe("[REDACTED]");
  });

  it("does NOT redact safe startup fields: port, nodeEnv, redisHost, dbHost", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info(
      { port: 3001, nodeEnv: "production", redisHost: "redis.internal", dbHost: "pg.internal" },
      "Aura Vault backend running on port 3001",
    );

    const log = JSON.parse(lines[0]!);
    expect(log.port).toBe(3001);
    expect(log.nodeEnv).toBe("production");
    expect(log.redisHost).toBe("redis.internal");
    expect(log.dbHost).toBe("pg.internal");
  });

  it("does not include any sensitive patterns in the safe startup log", () => {
    const { logger, lines } = buildTestLogger(REDACTED_PATHS);
    logger.info(
      { port: 3001, nodeEnv: "production", redisHost: "localhost", dbHost: "localhost" },
      "Aura Vault backend running on port 3001",
    );

    const raw = lines[0]!;
    for (const pattern of SENSITIVE_PATTERNS) {
      expect(raw).not.toMatch(pattern);
    }
  });
});

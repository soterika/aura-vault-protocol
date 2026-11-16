/**
 * Pact Consumer Test — Issue #983
 *
 * Defines the consumer contract for GET /api/v1/vault/stats.
 * Covers: success case, vault paused case, no data (empty) case.
 *
 * Run: vitest run src/tests/vault-stats.consumer.pact.test.ts
 * The generated pact file is written to ../../pacts/ (repo root /pacts/).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import path from "path";
import { fileURLToPath } from "url";

const { like, string, boolean, eachLike, integer, fromProviderState } =
  MatchersV3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

const provider = new PactV3({
  consumer: "AuraVaultFrontend",
  provider: "AuraVaultBackend",
  dir: path.resolve(__dirname, "../../../../pacts"),
  port: 4567,
  logLevel: "warn",
});

// ---------------------------------------------------------------------------
// Helpers — typed fetch against the mock provider
// ---------------------------------------------------------------------------

async function fetchVaultStats(
  baseUrl: string,
  query?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${baseUrl}/api/v1/vault/stats`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pact consumer — GET /api/v1/vault/stats", () => {
  // ── 1. Success case ────────────────────────────────────────────────────────
  it("returns vault stats when the worker is running and has data", async () => {
    await provider
      .given("yield worker is running with recent run data")
      .uponReceiving("a request for vault stats (success)")
      .withRequest({
        method: "GET",
        path: "/api/v1/vault/stats",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          workerRunning: boolean(),
          lastRun: like({
            lastRunAt: string(),
            processed: integer(),
            failed: integer(),
            durationMs: integer(),
            errors: [],
          }),
        }),
      })
      .executeTest(async (mockServer) => {
        const res = await fetchVaultStats(mockServer.url);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          workerRunning: boolean;
          lastRun: { processed: number } | null;
        };
        expect(typeof body.workerRunning).toBe("boolean");
        expect(body.lastRun).not.toBeNull();
      });
  });

  // ── 2. Vault paused case ───────────────────────────────────────────────────
  it("returns vault stats indicating paused state", async () => {
    await provider
      .given("vault is paused")
      .uponReceiving("a request for vault stats when vault is paused")
      .withRequest({
        method: "GET",
        path: "/api/v1/vault/stats",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          workerRunning: boolean(),
          vaultPaused: boolean(),
          lastRun: like({
            lastRunAt: string(),
            processed: integer(),
            failed: integer(),
            durationMs: integer(),
            errors: [],
          }),
        }),
      })
      .executeTest(async (mockServer) => {
        const res = await fetchVaultStats(mockServer.url);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { vaultPaused?: boolean };
        // vaultPaused field should be present and boolean when vault is paused
        expect(typeof body.vaultPaused).toBe("boolean");
      });
  });

  // ── 3. No data case (worker never run / no last run) ──────────────────────
  it("returns null lastRun when no data exists yet", async () => {
    await provider
      .given("yield worker has never run")
      .uponReceiving("a request for vault stats with no run data")
      .withRequest({
        method: "GET",
        path: "/api/v1/vault/stats",
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          workerRunning: boolean(),
          lastRun: null,
        }),
      })
      .executeTest(async (mockServer) => {
        const res = await fetchVaultStats(mockServer.url);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          workerRunning: boolean;
          lastRun: null;
        };
        expect(body.lastRun).toBeNull();
      });
  });

  // ── 4. With history query param ────────────────────────────────────────────
  it("returns history array when history query param is provided", async () => {
    await provider
      .given("yield worker has run multiple times")
      .uponReceiving("a request for vault stats with history")
      .withRequest({
        method: "GET",
        path: "/api/v1/vault/stats",
        query: { history: "5" },
        headers: { Accept: "application/json" },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          workerRunning: boolean(),
          lastRun: like({
            lastRunAt: string(),
            processed: integer(),
            failed: integer(),
            durationMs: integer(),
            errors: [],
          }),
          history: eachLike({
            lastRunAt: string(),
            processed: integer(),
            failed: integer(),
            durationMs: integer(),
            errors: [],
          }),
        }),
      })
      .executeTest(async (mockServer) => {
        const res = await fetchVaultStats(mockServer.url, { history: "5" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { history?: unknown[] };
        expect(Array.isArray(body.history)).toBe(true);
      });
  });
});

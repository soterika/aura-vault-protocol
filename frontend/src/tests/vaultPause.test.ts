/**
 * Unit tests for pure helpers in useVaultPause.ts
 *
 * The test environment is "node" (no JSDOM, no React renderer), so we
 * re-declare the pure functions inline — exactly the same pattern used in
 * dashboard.test.ts and vaultUtils.test.ts.  React hook behaviour is covered
 * by integration / Playwright tests.
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Inline copies of the pure helpers from useVaultPause.ts
// (Importing the module would pull in React, which requires a JSX transform.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @see useVaultPause.ts — parsePauseResponse
 */
function parsePauseResponse(body: unknown): boolean | undefined {
  if (body === null || typeof body !== "object") return undefined;

  const obj = body as Record<string, unknown>;

  // Standard ApiResponse envelope: { success: true, data: { paused: ... } }
  if (obj.data !== null && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.paused === "boolean") return data.paused;
    if (typeof data.is_paused === "boolean") return data.is_paused;
  }

  // Flat response: { paused: ... } or { is_paused: ... }
  if (typeof obj.paused === "boolean") return obj.paused;
  if (typeof obj.is_paused === "boolean") return obj.is_paused;

  return undefined;
}

/**
 * @see useVaultPause.ts — pauseStateFromWsEvent
 */
function pauseStateFromWsEvent(type: string): boolean | undefined {
  if (type === "vault_paused") return true;
  if (type === "vault_unpaused") return false;
  return undefined;
}

/**
 * @see AdminPauseControls.tsx — isAdminAddress
 */
function isAdminAddress(
  connected: string | null | undefined,
  adminEnv: string | null | undefined,
): boolean {
  if (!connected || !adminEnv) return false;
  return connected.trim().toLowerCase() === adminEnv.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// parsePauseResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePauseResponse", () => {
  // ── Flat `paused` key ────────────────────────────────────────────────────
  it("returns true for { paused: true }", () => {
    expect(parsePauseResponse({ paused: true })).toBe(true);
  });

  it("returns false for { paused: false }", () => {
    expect(parsePauseResponse({ paused: false })).toBe(false);
  });

  // ── Flat `is_paused` key ─────────────────────────────────────────────────
  it("returns true for { is_paused: true }", () => {
    expect(parsePauseResponse({ is_paused: true })).toBe(true);
  });

  it("returns false for { is_paused: false }", () => {
    expect(parsePauseResponse({ is_paused: false })).toBe(false);
  });

  // ── ApiResponse envelope with `paused` ───────────────────────────────────
  it("returns true for { success: true, data: { paused: true } }", () => {
    expect(parsePauseResponse({ success: true, data: { paused: true } })).toBe(
      true,
    );
  });

  it("returns false for { success: true, data: { paused: false } }", () => {
    expect(parsePauseResponse({ success: true, data: { paused: false } })).toBe(
      false,
    );
  });

  // ── ApiResponse envelope with `is_paused` ───────────────────────────────
  it("returns true for { data: { is_paused: true } }", () => {
    expect(parsePauseResponse({ data: { is_paused: true } })).toBe(true);
  });

  it("returns false for { data: { is_paused: false } }", () => {
    expect(parsePauseResponse({ data: { is_paused: false } })).toBe(false);
  });

  // ── Unknown / invalid shapes ─────────────────────────────────────────────
  it("returns undefined for null input", () => {
    expect(parsePauseResponse(null)).toBeUndefined();
  });

  it("returns undefined for a string input", () => {
    expect(parsePauseResponse("paused")).toBeUndefined();
  });

  it("returns undefined for a number input", () => {
    expect(parsePauseResponse(42)).toBeUndefined();
  });

  it("returns undefined when object has no recognised key", () => {
    expect(parsePauseResponse({ status: "paused" })).toBeUndefined();
  });

  it("returns undefined when paused key has non-boolean value", () => {
    expect(parsePauseResponse({ paused: "yes" })).toBeUndefined();
  });

  it("returns undefined for an empty object", () => {
    expect(parsePauseResponse({})).toBeUndefined();
  });

  it("returns undefined when data envelope exists but has no pause key", () => {
    expect(parsePauseResponse({ data: { tvl: "1000" } })).toBeUndefined();
  });

  // ── data key takes priority over flat key ────────────────────────────────
  it("prefers data.paused over flat paused when both present", () => {
    // data.paused = false, flat paused = true → should return false (data wins)
    expect(
      parsePauseResponse({ paused: true, data: { paused: false } }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pauseStateFromWsEvent
// ─────────────────────────────────────────────────────────────────────────────

describe("pauseStateFromWsEvent", () => {
  it('returns true for "vault_paused"', () => {
    expect(pauseStateFromWsEvent("vault_paused")).toBe(true);
  });

  it('returns false for "vault_unpaused"', () => {
    expect(pauseStateFromWsEvent("vault_unpaused")).toBe(false);
  });

  it('returns undefined for "vault_update" (unrelated event)', () => {
    expect(pauseStateFromWsEvent("vault_update")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(pauseStateFromWsEvent("")).toBeUndefined();
  });

  it("returns undefined for an arbitrary unknown type", () => {
    expect(pauseStateFromWsEvent("deposit")).toBeUndefined();
  });

  it("is case-sensitive — VAULT_PAUSED does not match", () => {
    expect(pauseStateFromWsEvent("VAULT_PAUSED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isAdminAddress (from AdminPauseControls)
// ─────────────────────────────────────────────────────────────────────────────

describe("isAdminAddress", () => {
  const ADMIN = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

  it("returns true when addresses match exactly", () => {
    expect(isAdminAddress(ADMIN, ADMIN)).toBe(true);
  });

  it("is case-insensitive — lowercase match is accepted", () => {
    expect(isAdminAddress(ADMIN.toLowerCase(), ADMIN)).toBe(true);
    expect(isAdminAddress(ADMIN, ADMIN.toLowerCase())).toBe(true);
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(isAdminAddress(`  ${ADMIN}  `, ADMIN)).toBe(true);
    expect(isAdminAddress(ADMIN, `  ${ADMIN}  `)).toBe(true);
  });

  it("returns false when addresses differ", () => {
    expect(isAdminAddress("GABCDEF", ADMIN)).toBe(false);
  });

  it("returns false when connected address is null", () => {
    expect(isAdminAddress(null, ADMIN)).toBe(false);
  });

  it("returns false when connected address is undefined", () => {
    expect(isAdminAddress(undefined, ADMIN)).toBe(false);
  });

  it("returns false when connected address is an empty string", () => {
    expect(isAdminAddress("", ADMIN)).toBe(false);
  });

  it("returns false when admin env var is null (not configured)", () => {
    expect(isAdminAddress(ADMIN, null)).toBe(false);
  });

  it("returns false when admin env var is undefined (not configured)", () => {
    expect(isAdminAddress(ADMIN, undefined)).toBe(false);
  });

  it("returns false when admin env var is an empty string", () => {
    expect(isAdminAddress(ADMIN, "")).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(isAdminAddress(null, null)).toBe(false);
  });
});

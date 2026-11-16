import { describe, it, expect } from "vitest";
import { translateError } from "../lib/errors";

describe("translateError", () => {
  it("maps VaultError code 3 (InsufficientShares)", () => {
    const err = { code: 3 };
    const result = translateError(err);
    expect(result.message).toContain("enough shares");
    expect(result.retryable).toBe(false);
    expect(result.severity).toBe("error");
  });

  it("maps VaultError code from Soroban message string", () => {
    const err = new Error("Error(Contract, #5)");
    const result = translateError(err);
    expect(result.message).toContain("greater than zero");
  });

  it("maps network fetch error", () => {
    const err = new TypeError("Failed to fetch");
    const result = translateError(err);
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("network");
  });

  it("maps rate limit (status 429)", () => {
    const result = translateError({ status: 429 });
    expect(result.message).toContain("Too many requests");
    expect(result.retryable).toBe(true);
  });

  it("returns generic fallback for unknown errors", () => {
    const result = translateError(new Error("some internal exception XYZ"));
    expect(result.message).toBe("Something went wrong.");
    expect(result._raw).toBeDefined();
    // Raw technical details must never leak into the user-facing message
    expect(result.message).not.toContain("exception");
    expect(result.message).not.toContain("XYZ");
  });

  it("never exposes raw error in message for vault code 6", () => {
    const result = translateError({ code: 6 });
    expect(result.message).not.toMatch(/overflow|MathOverflow/i);
  });
});

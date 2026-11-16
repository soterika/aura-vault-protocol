import { describe, it, expect } from "vitest";
import { translateError } from "../lib/errors";

// ---------------------------------------------------------------------------
// All VaultError codes (1–8)
// ---------------------------------------------------------------------------
describe("translateError — vault error codes", () => {
  it("code 1: NotInitialized — not retryable", () => {
    const r = translateError({ code: 1 });
    expect(r.retryable).toBe(false);
    expect(r.severity).toBe("error");
    expect(r.message).toBeTruthy();
  });

  it("code 2: AlreadyInitialized — not retryable", () => {
    const r = translateError({ code: 2 });
    expect(r.retryable).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it("code 3: InsufficientShares — message contains 'shares'", () => {
    const r = translateError({ code: 3 });
    expect(r.message).toMatch(/shares/i);
    expect(r.retryable).toBe(false);
  });

  it("code 4: InsufficientUnderlying — retryable", () => {
    const r = translateError({ code: 4 });
    expect(r.retryable).toBe(true);
  });

  it("code 5: ZeroAmount — message contains 'zero' or 'greater'", () => {
    const r = translateError({ code: 5 });
    expect(r.message).toMatch(/zero|greater/i);
  });

  it("code 6: MathOverflow — never exposes raw term", () => {
    const r = translateError({ code: 6 });
    expect(r.message).not.toMatch(/overflow|math/i);
    expect(r.retryable).toBe(false);
  });

  it("code 7: InvalidAddress — message contains 'address'", () => {
    const r = translateError({ code: 7 });
    expect(r.message).toMatch(/address/i);
  });

  it("code 8: ZeroShares — message mentions deposit or shares", () => {
    const r = translateError({ code: 8 });
    expect(r.message).toMatch(/shares|deposit/i);
  });

  it("all known codes return severity=error", () => {
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((code) => {
      expect(translateError({ code }).severity).toBe("error");
    });
  });

  it("all known codes include _raw with original error", () => {
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((code) => {
      const err = { code };
      expect(translateError(err)._raw).toBe(err);
    });
  });
});

// ---------------------------------------------------------------------------
// Soroban message string parsing
// ---------------------------------------------------------------------------
describe("translateError — Soroban message string", () => {
  it("parses Error(Contract, #1) string", () => {
    const r = translateError(new Error("Error(Contract, #1)"));
    expect(r.retryable).toBe(false);
  });

  it("parses Error(Contract, #3) string", () => {
    const r = translateError(new Error("Error(Contract, #3)"));
    expect(r.message).toMatch(/shares/i);
  });

  it("parses Error(Contract, #5) string", () => {
    const r = translateError(new Error("Error(Contract, #5)"));
    expect(r.message).toMatch(/zero|greater/i);
  });

  it("parses Error(Contract, #8) string", () => {
    const r = translateError(new Error("Error(Contract, #8)"));
    expect(r.message).toMatch(/shares|deposit/i);
  });

  it("unknown contract code falls through to fallback", () => {
    const r = translateError(new Error("Error(Contract, #99)"));
    expect(r.message).toBe("Something went wrong.");
  });
});

// ---------------------------------------------------------------------------
// Network / connectivity errors
// ---------------------------------------------------------------------------
describe("translateError — network errors", () => {
  it("TypeError 'Failed to fetch' → retryable", () => {
    const r = translateError(new TypeError("Failed to fetch"));
    expect(r.retryable).toBe(true);
  });

  it("TypeError 'fetch' → message contains 'network'", () => {
    const r = translateError(new TypeError("Failed to fetch"));
    expect(r.message).toMatch(/network/i);
  });

  it("message containing 'network' → retryable", () => {
    const r = translateError(new Error("network error occurred"));
    expect(r.retryable).toBe(true);
  });

  it("message containing 'connection' → retryable", () => {
    const r = translateError(new Error("connection refused"));
    expect(r.retryable).toBe(true);
  });

  it("message containing 'offline' → retryable", () => {
    const r = translateError(new Error("user is offline"));
    expect(r.retryable).toBe(true);
  });

  it("DOMException TimeoutError → warning severity", () => {
    const err = new DOMException("timed out", "TimeoutError");
    const r = translateError(err);
    expect(r.severity).toBe("warning");
    expect(r.retryable).toBe(true);
  });

  it("DOMException TimeoutError → message contains 'timed out'", () => {
    const err = new DOMException("timed out", "TimeoutError");
    const r = translateError(err);
    expect(r.message).toMatch(/timed out/i);
  });

  it("status 429 → too many requests message", () => {
    const r = translateError({ status: 429 });
    expect(r.message).toMatch(/too many requests/i);
    expect(r.retryable).toBe(true);
    expect(r.severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// Fallback / unknown errors
// ---------------------------------------------------------------------------
describe("translateError — fallback", () => {
  it("unknown Error → generic message", () => {
    const r = translateError(new Error("some totally unknown thing QQQ"));
    expect(r.message).toBe("Something went wrong.");
  });

  it("unknown Error → does not expose raw message", () => {
    const r = translateError(new Error("internal exception ABC"));
    expect(r.message).not.toMatch(/exception|ABC/);
  });

  it("null input → fallback", () => {
    const r = translateError(null);
    expect(r.message).toBe("Something went wrong.");
  });

  it("undefined input → fallback", () => {
    const r = translateError(undefined);
    expect(r.message).toBe("Something went wrong.");
  });

  it("plain string → fallback", () => {
    const r = translateError("something broke");
    expect(r.message).toBe("Something went wrong.");
  });

  it("empty object → fallback", () => {
    const r = translateError({});
    expect(r.message).toBe("Something went wrong.");
  });

  it("fallback _raw is preserved", () => {
    const err = new Error("mystery");
    const r = translateError(err);
    expect(r._raw).toBe(err);
  });

  it("fallback is retryable", () => {
    const r = translateError(new Error("????"));
    expect(r.retryable).toBe(true);
  });

  it("fallback severity is error", () => {
    const r = translateError(new Error("????"));
    expect(r.severity).toBe("error");
  });

  it("number input → fallback", () => {
    const r = translateError(42);
    expect(r.message).toBe("Something went wrong.");
  });
});

// ---------------------------------------------------------------------------
// Action field presence
// ---------------------------------------------------------------------------
describe("translateError — action field", () => {
  it("code 1 has action text", () => {
    expect(translateError({ code: 1 }).action).toBeTruthy();
  });

  it("code 3 has action text", () => {
    expect(translateError({ code: 3 }).action).toBeTruthy();
  });

  it("network error has action text", () => {
    expect(translateError(new TypeError("Failed to fetch")).action).toBeTruthy();
  });

  it("fallback has action text", () => {
    expect(translateError(new Error("??")).action).toBeTruthy();
  });
});

/**
 * Fuzz Tests for Backend Zod Input Validation — Issue #984
 *
 * Uses fast-check to generate 10,000 random inputs per schema and verifies:
 *   - No crashes (unhandled exceptions) for any input
 *   - No valid Stellar addresses are incorrectly rejected
 *
 * Schemas fuzzed:
 *   1. Wallet address (Stellar public key format)
 *   2. Token amount (i128 range)
 *   3. JWT token format
 *   4. Pagination params (page, pageSize)
 *   5. Date range (from / to)
 *
 * Run: vitest run src/validation.fuzz.test.ts
 * Target: < 30 seconds total
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import fc from "fast-check";

// ---------------------------------------------------------------------------
// Schema definitions
// (These mirror what the backend routes validate in real usage.)
// ---------------------------------------------------------------------------

/**
 * Stellar public key: G + 55 base-32 [A-Z2-7] characters = 56 chars total.
 * StrKey encoding means valid keys start with 'G' and contain only
 * uppercase alphanumeric characters from the base-32 alphabet.
 */
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

const walletAddressSchema = z
  .string()
  .regex(STELLAR_ADDRESS_REGEX, "Invalid Stellar public key");

/**
 * Token amount: signed 128-bit integer range.
 * i128 spans -170141183460469231731687303715884105728 to
 *            +170141183460469231731687303715884105727
 * We represent amounts as strings to avoid JS number precision loss, then
 * parse them as BigInt for range validation.
 */
const I128_MIN = BigInt("-170141183460469231731687303715884105728");
const I128_MAX = BigInt("170141183460469231731687303715884105727");

const tokenAmountSchema = z
  .string()
  .regex(/^-?\d+$/, "Amount must be an integer string")
  .refine(
    (v) => {
      try {
        const n = BigInt(v);
        return n >= I128_MIN && n <= I128_MAX;
      } catch {
        return false;
      }
    },
    { message: "Amount out of i128 range" }
  );

/**
 * JWT token: three base64url segments separated by dots.
 * We do not verify the signature here — just structural validation.
 */
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

const jwtTokenSchema = z
  .string()
  .refine(
    (v) => {
      const parts = v.split(".");
      if (parts.length !== 3) return false;
      return parts.every((p) => p.length > 0 && BASE64URL_SEGMENT.test(p));
    },
    { message: "Invalid JWT format" }
  );

/**
 * Pagination params.
 */
const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int("page must be an integer")
    .min(1, "page must be >= 1"),
  pageSize: z.coerce
    .number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be >= 1")
    .max(200, "pageSize must be <= 200"),
});

/**
 * Date range (ISO 8601 strings).
 */
const dateRangeSchema = z
  .object({
    from: z.string().datetime({ message: "from must be ISO 8601" }),
    to: z.string().datetime({ message: "to must be ISO 8601" }),
  })
  .refine((d) => new Date(d.from) <= new Date(d.to), {
    message: "from must not be after to",
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUM_RUNS = 10_000;

/**
 * Asserts that schema.safeParse() never throws for any input.
 * Returns the parse result — never throws.
 */
function safeParseNoThrow<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): z.SafeParseReturnType<unknown, T> {
  try {
    return schema.safeParse(input);
  } catch (err) {
    // If safeParse itself threw, that is the crash we are catching
    throw new Error(
      `Schema threw unexpectedly for input ${JSON.stringify(input)}: ${err}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Wallet address schema
// ---------------------------------------------------------------------------

describe("walletAddressSchema — fuzz", () => {
  it("never crashes on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => safeParseNoThrow(walletAddressSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("never crashes on arbitrary values of any type", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => safeParseNoThrow(walletAddressSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("always accepts valid Stellar public keys", () => {
    /**
     * A real Stellar public key:
     *   - First char: 'G'
     *   - Remaining 55 chars: uppercase letters and digits 2–7
     *
     * We generate keys that satisfy this structural requirement.
     * Cryptographic validity is not required here — the schema only
     * checks the structural format.
     */
    const stellarCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const validAddressArb = fc
      .array(fc.constantFrom(...stellarCharset.split("")), {
        minLength: 55,
        maxLength: 55,
      })
      .map((chars) => "G" + chars.join(""));

    fc.assert(
      fc.property(validAddressArb, (address) => {
        const result = safeParseNoThrow(walletAddressSchema, address);
        expect(result.success).toBe(true);
      }),
      { numRuns: 1_000, verbose: false }
    );
  });

  it("rejects strings that are clearly not Stellar addresses", () => {
    const invalid = ["", "not-an-address", "AAAA", "g" + "A".repeat(55)];
    for (const v of invalid) {
      const result = safeParseNoThrow(walletAddressSchema, v);
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Token amount schema
// ---------------------------------------------------------------------------

describe("tokenAmountSchema — fuzz", () => {
  it("never crashes on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => safeParseNoThrow(tokenAmountSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("never crashes on arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => safeParseNoThrow(tokenAmountSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("accepts all integers representable as JS safe integers", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: I128_MIN, max: I128_MAX }), (n) => {
        const result = safeParseNoThrow(tokenAmountSchema, n.toString());
        expect(result.success).toBe(true);
      }),
      { numRuns: 1_000, verbose: false }
    );
  });

  it("rejects non-integer strings", () => {
    const invalid = ["1.5", "1e10", "abc", "", " ", "NaN", "Infinity", "--1"];
    for (const v of invalid) {
      const result = safeParseNoThrow(tokenAmountSchema, v);
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. JWT token schema
// ---------------------------------------------------------------------------

describe("jwtTokenSchema — fuzz", () => {
  it("never crashes on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => safeParseNoThrow(jwtTokenSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("never crashes on arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => safeParseNoThrow(jwtTokenSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("accepts structurally valid JWT tokens", () => {
    const base64UrlSegment = fc
      .array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("")), {
        minLength: 1,
        maxLength: 200,
      })
      .map((chars) => chars.join(""));

    const validJwtArb = fc
      .tuple(base64UrlSegment, base64UrlSegment, base64UrlSegment)
      .map(([h, p, s]) => `${h}.${p}.${s}`);

    fc.assert(
      fc.property(validJwtArb, (token) => {
        const result = safeParseNoThrow(jwtTokenSchema, token);
        expect(result.success).toBe(true);
      }),
      { numRuns: 1_000, verbose: false }
    );
  });

  it("rejects tokens with wrong segment count", () => {
    const invalid = ["", "a.b", "a.b.c.d", "...", "header.payload."];
    for (const v of invalid) {
      const result = safeParseNoThrow(jwtTokenSchema, v);
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Pagination schema
// ---------------------------------------------------------------------------

describe("paginationSchema — fuzz", () => {
  it("never crashes on arbitrary objects", () => {
    fc.assert(
      fc.property(fc.record({ page: fc.anything(), pageSize: fc.anything() }), (input) => {
        expect(() => safeParseNoThrow(paginationSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("never crashes on arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => safeParseNoThrow(paginationSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("accepts valid page and pageSize combinations", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 200 }),
        (page, pageSize) => {
          const result = safeParseNoThrow(paginationSchema, { page, pageSize });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 1_000, verbose: false }
    );
  });

  it("rejects page < 1 or pageSize > 200", () => {
    expect(safeParseNoThrow(paginationSchema, { page: 0, pageSize: 10 }).success).toBe(false);
    expect(safeParseNoThrow(paginationSchema, { page: -1, pageSize: 10 }).success).toBe(false);
    expect(safeParseNoThrow(paginationSchema, { page: 1, pageSize: 201 }).success).toBe(false);
    expect(safeParseNoThrow(paginationSchema, { page: 1, pageSize: 0 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Date range schema
// ---------------------------------------------------------------------------

describe("dateRangeSchema — fuzz", () => {
  it("never crashes on arbitrary objects", () => {
    fc.assert(
      fc.property(fc.record({ from: fc.anything(), to: fc.anything() }), (input) => {
        expect(() => safeParseNoThrow(dateRangeSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("never crashes on arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => safeParseNoThrow(dateRangeSchema, input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS, verbose: false }
    );
  });

  it("accepts valid ISO date ranges where from <= to", () => {
    // Generate two dates and always put the earlier one as `from`
    fc.assert(
      fc.property(fc.date(), fc.date(), (d1, d2) => {
        const [from, to] = d1 <= d2 ? [d1, d2] : [d2, d1];
        const result = safeParseNoThrow(dateRangeSchema, {
          from: from.toISOString(),
          to: to.toISOString(),
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 1_000, verbose: false }
    );
  });

  it("rejects ranges where from is after to", () => {
    const result = safeParseNoThrow(dateRangeSchema, {
      from: "2026-12-31T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-ISO strings", () => {
    const invalid = [
      { from: "not-a-date", to: "2026-01-01T00:00:00.000Z" },
      { from: "2026-01-01T00:00:00.000Z", to: "yesterday" },
      { from: "", to: "" },
      { from: "2026/01/01", to: "2026/12/31" },
    ];
    for (const v of invalid) {
      const result = safeParseNoThrow(dateRangeSchema, v);
      expect(result.success).toBe(false);
    }
  });
});

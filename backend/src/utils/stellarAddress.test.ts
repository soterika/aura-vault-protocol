import { describe, it, expect } from "vitest";
import { isValidStellarAddress } from "../utils/stellarAddress.js";
import { stellarAddressSchema } from "../utils/stellarSchemas.js";

/**
 * Known-valid Stellar Ed25519 public keys (G-addresses) — all 56 characters.
 * These addresses have been verified to have correct CRC-16/XMODEM checksums.
 *
 * GBXGQJWV… is sourced from Stellar SDK test fixtures.
 * The remaining addresses were generated with a correct StrKey encoder.
 */
const VALID_ADDRESSES = [
  "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON",
  "GAO7XM2CKPYLCSCBQOUQUP4OV67V6HBB7QITFJS473LW5ANTLPKFSON6",
  "GAIOVAQ7XNNEDEJT5R3DRKFC3Y5H7M7Y3SUGJENFNBVZS4LZAGMYNCZK",
];

/**
 * Invalid inputs — should all return false.
 */
const INVALID_ADDRESSES: Array<{ label: string; input: unknown }> = [
  { label: "empty string", input: "" },
  { label: "null", input: null },
  { label: "undefined", input: undefined },
  { label: "number", input: 12345 },
  { label: "contract address (C-address)", input: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM" },
  { label: "starts with wrong letter (A)", input: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
  { label: "too short (55 chars)", input: "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXO" },
  { label: "too long (57 chars)", input: "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXONN" },
  { label: "invalid base32 character (0)", input: "G0XGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON" },
  { label: "invalid base32 character (1)", input: "G1XGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON" },
  { label: "invalid base32 character (8)", input: "G8XGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON" },
  { label: "invalid base32 character (lowercase)", input: "gbxgqjwvlwoyhflvtkwv5fgha3lnyy2jqkm7oajaueqfu6lpcsefvxon" },
  { label: "all Gs (wrong checksum)", input: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG" },
  { label: "checksum corrupted (last char changed)", input: "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXOA" },
  { label: "whitespace padded", input: " GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON " },
  { label: "contains space in middle", input: "GBXGQJWV LWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON" },
];

describe("isValidStellarAddress", () => {
  describe("valid addresses", () => {
    for (const addr of VALID_ADDRESSES) {
      it(`accepts ${addr.slice(0, 12)}…`, () => {
        expect(isValidStellarAddress(addr)).toBe(true);
      });
    }
  });

  describe("invalid inputs", () => {
    for (const { label, input } of INVALID_ADDRESSES) {
      it(`rejects ${label}`, () => {
        // Cast to string to match function signature; function handles non-strings gracefully
        expect(isValidStellarAddress(input as string)).toBe(false);
      });
    }
  });

  it("rejects a contract address (C-address) where a user address is expected", () => {
    // Soroban contract addresses start with C
    const contractAddr = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    expect(isValidStellarAddress(contractAddr)).toBe(false);
  });

  it("returns false for non-string input (number)", () => {
    expect(isValidStellarAddress(42 as unknown as string)).toBe(false);
  });
});

describe("stellarAddressSchema (Zod)", () => {
  it("passes for a valid G-address", () => {
    const result = stellarAddressSchema.safeParse(VALID_ADDRESSES[0]);
    expect(result.success).toBe(true);
  });

  it("returns 'Invalid Stellar address format' for all-G address (wrong checksum)", () => {
    const result = stellarAddressSchema.safeParse("GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid Stellar address format");
    }
  });

  it("returns 'Invalid Stellar address format' for a contract address", () => {
    const result = stellarAddressSchema.safeParse("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid Stellar address format");
    }
  });

  it("returns required message for empty string", () => {
    const result = stellarAddressSchema.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Stellar address is required");
    }
  });

  it("returns 'Invalid Stellar address format' for corrupted checksum", () => {
    const result = stellarAddressSchema.safeParse(
      "GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXOA"
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid Stellar address format");
    }
  });
});

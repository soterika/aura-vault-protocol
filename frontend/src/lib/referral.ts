/**
 * Referral utility helpers
 *
 * - addressToReferralCode: encodes a Stellar G-address to a base58 slug
 * - referralCodeToAddress: decodes a base58 slug back to a Stellar address
 * - getReferralLink:       builds the full /ref/{code} URL
 * - storeReferralCode:     persists the code to localStorage
 * - getStoredReferralCode: reads the persisted code from localStorage
 * - clearReferralCode:     removes the persisted code from localStorage
 */

// ---------------------------------------------------------------------------
// Base58 encoding — compact, URL-safe, no ambiguous chars (0/O/l/I removed)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encodes a Uint8Array to a base58 string.
 * Leading zero bytes become leading '1' characters.
 */
function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Leading zeros
  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += "1";
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]!];
  }

  return result;
}

/**
 * Decodes a base58 string to a Uint8Array.
 * Returns null if the input contains a character outside the alphabet.
 */
function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = [0];

  for (const char of input) {
    const charIdx = BASE58_ALPHABET.indexOf(char);
    if (charIdx === -1) return null;

    let carry = charIdx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading '1's become leading zero bytes
  let leadingZeros = 0;
  for (const char of input) {
    if (char !== "1") break;
    leadingZeros++;
  }

  const result = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[leadingZeros + i] = bytes[bytes.length - 1 - i]!;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Stellar G-address ↔ referral code
// ---------------------------------------------------------------------------

/**
 * Converts a Stellar G-address into a compact base58 referral code.
 *
 * Stellar addresses are base32-encoded StrKey strings. We decode the raw
 * bytes and re-encode them as base58, which is more compact and avoids
 * ambiguous characters.
 *
 * The input is treated as UTF-8 bytes directly (ASCII subset), since
 * Stellar addresses only use chars A-Z2-7 and start with G.
 */
export function addressToReferralCode(address: string): string {
  if (!address || !address.startsWith("G") || address.length !== 56) {
    throw new Error("Invalid Stellar address");
  }

  const bytes = new TextEncoder().encode(address);
  return base58Encode(bytes);
}

/**
 * Decodes a base58 referral code back to a Stellar G-address.
 * Returns null if the code is invalid.
 */
export function referralCodeToAddress(code: string): string | null {
  if (!code) return null;

  const bytes = base58Decode(code);
  if (!bytes) return null;

  try {
    const address = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (address.startsWith("G") && address.length === 56) {
      return address;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Link generation
// ---------------------------------------------------------------------------

/**
 * Builds the full referral link for a given Stellar address.
 * e.g.  https://app.example.com/ref/4RYgKmFxQECPvMdT...
 */
export function getReferralLink(address: string): string {
  const code = addressToReferralCode(address);
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/ref/${code}`;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const REFERRAL_CODE_KEY = "aura_referral_code";

/**
 * Persists a referral code to localStorage.
 * Safe to call during SSR (no-op when window is undefined).
 */
export function storeReferralCode(code: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REFERRAL_CODE_KEY, code);
  } catch {
    // localStorage might be unavailable (private browsing, full storage)
  }
}

/**
 * Reads the stored referral code from localStorage.
 * Returns null when unavailable.
 */
export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(REFERRAL_CODE_KEY);
  } catch {
    return null;
  }
}

/**
 * Clears the stored referral code from localStorage
 * (call after the referral has been registered server-side).
 */
export function clearReferralCode(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(REFERRAL_CODE_KEY);
  } catch {
    // ignore
  }
}

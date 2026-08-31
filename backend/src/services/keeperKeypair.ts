/**
 * Keeper Keypair — Issue #315
 *
 * Loads the keeper's Stellar secret key from AWS Secrets Manager and exposes
 * it as a typed interface.  Caches the result for `SECRETS_CACHE_TTL_MS`
 * milliseconds (default 5 min) to avoid hammering Secrets Manager on every
 * scheduled tick.
 *
 * Expected Secrets Manager payload (JSON string):
 *   {
 *     "secretKey": "S...",           // Stellar secret key (required)
 *     "publicKey": "G..."            // Stellar public key (optional, for logging)
 *   }
 */

import { getSecret } from "../secrets.js";
import { logger } from "../logger.js";

export interface KeeperKeypair {
  /** Stellar secret key (starts with "S"). */
  secretKey: string;
  /** Stellar public key (starts with "G"), if present in the secret. */
  publicKey?: string;
}

// ---------------------------------------------------------------------------
// In-process cache (separate from secrets.ts which caches the raw map)
// ---------------------------------------------------------------------------

interface CachedKeypair {
  keypair: KeeperKeypair;
  expiresAt: number;
}

let _cached: CachedKeypair | null = null;

const CACHE_TTL_MS = Number(process.env.SECRETS_CACHE_TTL_MS ?? 5 * 60 * 1_000);

/**
 * Fetch the keeper keypair from AWS Secrets Manager (or env in development).
 * Caches the parsed result for the configured TTL.
 *
 * @param secretId  The Secrets Manager secret name / ARN.
 */
export async function getKeeperKeypair(secretId: string): Promise<KeeperKeypair> {
  if (_cached && _cached.expiresAt > Date.now()) {
    return _cached.keypair;
  }

  // `getSecret` reads from Secrets Manager (prod) or process.env (dev)
  const rawSecretKey = await getSecret(`${secretId}:secretKey`);
  const rawPublicKey = await getSecret(`${secretId}:publicKey`);

  // Fallback: try reading the whole secret as a structured JSON via known
  // env-var names for local dev convenience.
  const secretKey =
    rawSecretKey ??
    process.env.KEEPER_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      `[KeeperKeypair] Secret key not found in secret "${secretId}". ` +
        `Ensure the Secrets Manager entry contains the "secretKey" field, ` +
        `or set KEEPER_SECRET_KEY in the local environment.`
    );
  }

  // Basic Stellar secret key sanity check (starts with "S", length 56)
  if (!secretKey.startsWith("S") || secretKey.length !== 56) {
    throw new Error(
      `[KeeperKeypair] Secret key loaded from "${secretId}" does not look like ` +
        `a valid Stellar secret key (expected "S..." with length 56).`
    );
  }

  const publicKey = rawPublicKey ?? process.env.KEEPER_PUBLIC_KEY;

  const keypair: KeeperKeypair = { secretKey, ...(publicKey ? { publicKey } : {}) };

  _cached = { keypair, expiresAt: Date.now() + CACHE_TTL_MS };

  logger.info("[KeeperKeypair] Keeper keypair loaded", {
    secretId,
    publicKey: publicKey ?? "(not set)",
  });

  return keypair;
}

/** Invalidate the in-process cache (useful for rotation / tests). */
export function invalidateKeeperKeypairCache(): void {
  _cached = null;
}

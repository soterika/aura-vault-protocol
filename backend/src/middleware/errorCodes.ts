/**
 * Machine-readable error code constants for the Aura Vault API.
 *
 * These codes are returned in the `error.code` field of every error envelope:
 *   { success: false, error: { code, message, details }, meta: { ... } }
 *
 * Use these constants everywhere res.failure() is called so that error codes
 * remain consistent across all routes and are easy to refactor.
 */

// ── Generic ───────────────────────────────────────────────────────────────────

/** A required parameter or field was missing or had an invalid value. */
export const INVALID_INPUT = 'INVALID_INPUT';

/** An unexpected server-side error occurred. */
export const INTERNAL_ERROR = 'INTERNAL_ERROR';

// ── Address / Identity ────────────────────────────────────────────────────────

/** The supplied address did not pass format validation. */
export const INVALID_ADDRESS = 'INVALID_ADDRESS';

// ── Vault state ───────────────────────────────────────────────────────────────

/** The vault is currently paused; no mutating operations are allowed. */
export const VAULT_PAUSED = 'VAULT_PAUSED';

/** The vault has not been initialised yet. */
export const NOT_INITIALIZED = 'NOT_INITIALIZED';

/** The vault has already been initialised and cannot be re-initialised. */
export const ALREADY_INITIALIZED = 'ALREADY_INITIALIZED';

// ── Arithmetic / amounts ──────────────────────────────────────────────────────

/** A zero or negative amount was supplied where a positive value is required. */
export const ZERO_AMOUNT = 'ZERO_AMOUNT';

/** An arithmetic operation overflowed. */
export const MATH_OVERFLOW = 'MATH_OVERFLOW';

// ── Share / asset accounting ──────────────────────────────────────────────────

/** The caller does not hold enough vault shares to satisfy the withdrawal. */
export const INSUFFICIENT_SHARES = 'INSUFFICIENT_SHARES';

/** The vault does not hold enough underlying tokens to cover the redemption. */
export const INSUFFICIENT_UNDERLYING = 'INSUFFICIENT_UNDERLYING';

/** The vault's actual on-chain balance does not match the tracked state (flash loan guard). */
export const BALANCE_MISMATCH = 'BALANCE_MISMATCH';

// ── Caps & fees ───────────────────────────────────────────────────────────────

/** The deposit would push the vault above its total-value-locked cap. */
export const TVL_CAP_EXCEEDED = 'TVL_CAP_EXCEEDED';

/** The withdrawal fee supplied is not within the accepted range. */
export const INVALID_WITHDRAWAL_FEE = 'INVALID_WITHDRAWAL_FEE';

/** The requested fee exceeds the protocol maximum. */
export const FEE_EXCEEDS_MAXIMUM = 'FEE_EXCEEDS_MAXIMUM';

// ── Harvest / yield ───────────────────────────────────────────────────────────

/** Harvest was attempted before the required cooldown period has elapsed. */
export const HARVEST_COOLDOWN = 'HARVEST_COOLDOWN';

// ── Circuit breaker ───────────────────────────────────────────────────────────

/** The circuit breaker has tripped; the operation is temporarily disabled. */
export const CIRCUIT_BREAKER_TRIPPED = 'CIRCUIT_BREAKER_TRIPPED';

// ── Multi-asset / portfolio ───────────────────────────────────────────────────

/** The requested asset was not found in the vault or registry. */
export const ASSET_NOT_FOUND = 'ASSET_NOT_FOUND';

/** The supplied asset weights do not sum to 100 %. */
export const WEIGHT_MISMATCH = 'WEIGHT_MISMATCH';

/** The same asset appears more than once in the supplied list. */
export const DUPLICATE_ASSET = 'DUPLICATE_ASSET';

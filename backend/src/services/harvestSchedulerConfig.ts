/**
 * Harvest Scheduler Configuration — Issue #315
 *
 * Centralises all configuration values for the harvest scheduler.
 * Values are loaded from environment variables with safe defaults.
 *
 * Required env vars (production):
 *   HARVEST_KEEPER_SECRET_ID   — AWS Secrets Manager secret name for the
 *                                keeper keypair (must contain `secretKey` field)
 *   VAULT_CONTRACT_ID          — Stellar contract address of the vault
 *
 * Optional env vars:
 *   HARVEST_THRESHOLD_AMOUNT   — Minimum accumulated yield before harvesting
 *                                (default: 1000 stroops equivalent)
 *   HARVEST_INTERVAL_MS        — Poll cadence in milliseconds (default: 300_000 = 5 min)
 *   HARVEST_MIN_HARVEST_GAP_MS — Minimum time between harvests in ms
 *                                (default: 240_000 = 4 min) — prevents duplicate harvests
 *   HARVEST_MAX_ATTEMPTS       — Job retry attempts before DLQ (default: 3)
 *   HARVEST_COOLDOWN_MS        — Back-off after a failed harvest attempt
 *                                (default: 60_000 = 1 min)
 */

export interface HarvestSchedulerConfig {
  /** Minimum accumulated yield (in the vault's token unit) before harvesting. */
  thresholdAmount: number;

  /** How often to poll yield accumulation, in milliseconds. Default: 5 min */
  intervalMs: number;

  /**
   * Minimum gap between two completed harvests, in milliseconds.
   * Prevents triggering a second harvest that would be a no-op or cause a
   * "harvest too soon" contract error.  Default: 4 min.
   */
  minHarvestGapMs: number;

  /** Maximum job retry attempts before moving to DLQ.  Default: 3. */
  maxAttempts: number;

  /** Delay after a failed harvest attempt before the next retry (ms). */
  cooldownMs: number;

  /**
   * AWS Secrets Manager secret name that holds the keeper keypair JSON.
   * The secret must include at least: `{ "secretKey": "<Stellar secret key>" }`.
   */
  keeperSecretId: string;

  /** Stellar contract ID of the vault being harvested. */
  vaultContractId: string;
}

/**
 * Load and validate the harvest scheduler configuration from the process
 * environment.  Throws if any required production-only value is absent.
 */
export function loadHarvestConfig(env: NodeJS.ProcessEnv = process.env): HarvestSchedulerConfig {
  const isProduction = (env.NODE_ENV ?? "development") === "production";

  // Required in all environments but defaulted for local dev
  const keeperSecretId = env.HARVEST_KEEPER_SECRET_ID ?? "aura-vault/keeper-keypair";
  const vaultContractId = env.VAULT_CONTRACT_ID ?? "";

  if (isProduction && !env.HARVEST_KEEPER_SECRET_ID) {
    throw new Error("[HarvestConfig] HARVEST_KEEPER_SECRET_ID is required in production");
  }
  if (isProduction && !vaultContractId) {
    throw new Error("[HarvestConfig] VAULT_CONTRACT_ID is required in production");
  }

  const thresholdAmount = parsePositiveInt(env.HARVEST_THRESHOLD_AMOUNT, 1_000, "HARVEST_THRESHOLD_AMOUNT");
  const intervalMs = parsePositiveInt(env.HARVEST_INTERVAL_MS, 300_000, "HARVEST_INTERVAL_MS");
  const minHarvestGapMs = parsePositiveInt(env.HARVEST_MIN_HARVEST_GAP_MS, 240_000, "HARVEST_MIN_HARVEST_GAP_MS");
  const maxAttempts = parsePositiveInt(env.HARVEST_MAX_ATTEMPTS, 3, "HARVEST_MAX_ATTEMPTS");
  const cooldownMs = parsePositiveInt(env.HARVEST_COOLDOWN_MS, 60_000, "HARVEST_COOLDOWN_MS");

  return {
    thresholdAmount,
    intervalMs,
    minHarvestGapMs,
    maxAttempts,
    cooldownMs,
    keeperSecretId,
    vaultContractId,
  };
}

function parsePositiveInt(raw: string | undefined, defaultVal: number, name: string): number {
  if (raw === undefined || raw === "") return defaultVal;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[HarvestConfig] ${name} must be a positive integer, got: ${JSON.stringify(raw)}`);
  }
  return n;
}

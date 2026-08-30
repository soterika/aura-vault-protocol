/**
 * Centralized configuration module — issue #856
 *
 * All environment variables are validated via Zod at process startup.
 * A missing or invalid required variable throws immediately with a clear
 * message so misconfigured deployments fail fast rather than failing
 * silently at runtime.
 *
 * USAGE
 *   import { config } from './config/index.js';
 *   const { port } = config.server;
 *
 * Individual domain sections are also exported for convenience:
 *   import { serverConfig, redisConfig, databaseConfig } from './config/index.js';
 *
 * SENSITIVE VALUES
 *   Secret fields (JWT_SECRET, API keys, passwords) are stored in the
 *   config object at runtime but are never logged here.  Do not pass the
 *   full `config` object to any logger.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce a string env var to a positive integer with a fallback default. */
const positiveInt = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v: string | undefined) =>
      v !== undefined && v !== "" ? parseInt(v, 10) : defaultValue
    )
    .pipe(z.number().int().positive());

/** Coerce a string env var to a boolean ("true" → true, anything else → false). */
const booleanStr = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v: string | undefined): boolean => {
      if (v === undefined || v === "") return defaultValue;
      return v.toLowerCase() === "true";
    })
    .pipe(z.boolean());

/** Optional string — empty string is normalised to undefined. */
const optionalStr = z
  .string()
  .optional()
  .transform((v: string | undefined) => (v === "" ? undefined : v));

// ─────────────────────────────────────────────────────────────────────────────
// Environment schema
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ── Server ─────────────────────────────────────────────────────────────────
  PORT: positiveInt(3001),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .optional()
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional()
    .default("info"),
  CORS_ORIGIN: optionalStr,

  // ── AWS / Secrets ──────────────────────────────────────────────────────────
  AWS_REGION: z.string().optional().default("us-east-1"),
  SECRETS_PROVIDER: z.enum(["env", "aws"]).optional().default("env"),
  APP_SECRETS_ID: optionalStr,
  SECRETS_CACHE_TTL_MS: positiveInt(300_000),
  JWT_SECRET: optionalStr,
  UNSUBSCRIBE_SECRET: optionalStr,

  // ── Email ──────────────────────────────────────────────────────────────────
  SENDGRID_API_KEY: optionalStr,
  MAILGUN_DOMAIN: optionalStr,
  MAILGUN_API_KEY: optionalStr,

  // ── Redis ──────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().optional().default("redis://localhost:6379"),
  REDIS_PASSWORD: optionalStr,
  REDIS_TLS: booleanStr(false),
  /** Comma-separated list of cluster nodes, e.g. "host1:6379,host2:6379" */
  REDIS_CLUSTER: optionalStr,

  // ── Cache TTLs (seconds) ───────────────────────────────────────────────────
  CACHE_API_TTL: positiveInt(60),
  CACHE_DEFI_PRICE_TTL: positiveInt(30),
  CACHE_DEFI_POOL_TTL: positiveInt(60),

  // ── Gas / EVM ──────────────────────────────────────────────────────────────
  GAS_RPC_URL: z.string().url().optional().default("https://cloudflare-eth.com"),
  EVM_CHAIN_ID: positiveInt(1),
  GAS_CACHE_TTL_MS: positiveInt(60_000),
  GAS_HISTORY_LIMIT: positiveInt(20),
  GAS_DEFAULT_LIMIT: positiveInt(21_000),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_REPLICA_URL: optionalStr,

  // ── Stellar ────────────────────────────────────────────────────────────────
  HORIZON_URL: z
    .string()
    .url()
    .optional()
    .default("https://horizon-testnet.stellar.org"),
  VAULT_CONTRACT_ID: optionalStr,
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-field validation rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates variables that are only required in certain environments or that
 * have inter-field dependencies.  Throws a descriptive Error on violation.
 */
function validateCrossFieldConstraints(
  env: z.infer<typeof envSchema>
): void {
  const errors: string[] = [];

  // JWT_SECRET is required outside the test environment to prevent the
  // dev default "aura-vault-dev-secret" from reaching production.
  if (env.NODE_ENV !== "test" && !env.JWT_SECRET) {
    errors.push(
      "JWT_SECRET is required in non-test environments. " +
      "Set a strong random secret of at least 32 characters."
    );
  }

  // When using AWS Secrets Manager the destination secret ID must be provided.
  if (env.SECRETS_PROVIDER === "aws" && !env.APP_SECRETS_ID) {
    errors.push(
      "APP_SECRETS_ID is required when SECRETS_PROVIDER=aws."
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `[config] Environment validation failed:\n` +
      errors.map((e) => `  • ${e}`).join("\n")
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse and validate
// ─────────────────────────────────────────────────────────────────────────────

function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i: z.ZodIssue) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[config] Environment validation failed:\n${issues}\n\n` +
      `Copy .env.example to .env and fill in the required values.`
    );
  }

  validateCrossFieldConstraints(result.data);

  return result.data;
}

const env = parseEnv();

// ─────────────────────────────────────────────────────────────────────────────
// Typed config sections
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HTTP server settings.
 *
 * @property port       - TCP port the Express server listens on (default 3001)
 * @property nodeEnv    - Runtime environment: "development" | "test" | "production"
 * @property logLevel   - Winston log level
 * @property corsOrigin - Comma-separated list of allowed CORS origins; empty
 *                        string means localhost-only in dev, deny-all in prod
 */
export const serverConfig = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  corsOrigin: env.CORS_ORIGIN,
} as const;

export type ServerConfig = typeof serverConfig;

/**
 * Secrets management settings.
 *
 * NOTE: jwtSecret and unsubscribeSecret are sensitive — do NOT log them.
 *
 * @property provider          - "env" reads from process.env; "aws" uses AWS Secrets Manager
 * @property appSecretsId      - AWS Secrets Manager secret name (required when provider=aws)
 * @property secretsCacheTtlMs - How long (ms) AWS secret values are cached locally
 * @property jwtSecret         - HMAC-SHA256 signing key for JWTs (required outside test)
 * @property unsubscribeSecret - HMAC signing key for email unsubscribe tokens
 */
export const secretsConfig = {
  provider: env.SECRETS_PROVIDER,
  appSecretsId: env.APP_SECRETS_ID,
  secretsCacheTtlMs: env.SECRETS_CACHE_TTL_MS,
  jwtSecret: env.JWT_SECRET,
  unsubscribeSecret: env.UNSUBSCRIBE_SECRET,
} as const;

export type SecretsConfig = typeof secretsConfig;

/**
 * Redis / ioredis connection settings.
 *
 * @property url          - Redis connection URL (single-node or sentinel)
 * @property password     - AUTH password (sensitive — do NOT log)
 * @property tls          - Enable TLS for the Redis connection
 * @property clusterNodes - Comma-separated "host:port" pairs for Cluster mode;
 *                          when set, url is ignored
 */
export const redisConfig = {
  url: env.REDIS_URL,
  password: env.REDIS_PASSWORD,
  tls: env.REDIS_TLS,
  clusterNodes: env.REDIS_CLUSTER,
} as const;

export type RedisConfig = typeof redisConfig;

/**
 * In-process / Redis cache TTL values (in seconds).
 *
 * @property apiTtl        - General API response cache lifetime
 * @property defiPriceTtl  - DeFi token price cache lifetime
 * @property defiPoolTtl   - DeFi liquidity pool data cache lifetime
 */
export const cacheConfig = {
  apiTtl: env.CACHE_API_TTL,
  defiPriceTtl: env.CACHE_DEFI_PRICE_TTL,
  defiPoolTtl: env.CACHE_DEFI_POOL_TTL,
} as const;

export type CacheConfig = typeof cacheConfig;

/**
 * EVM / gas estimation settings.
 *
 * @property rpcUrl       - JSON-RPC endpoint used for eth_feeHistory / eth_gasPrice
 * @property chainId      - EVM chain ID (1 = Ethereum mainnet)
 * @property cacheTtlMs   - How long (ms) a gas estimate is cached before re-fetching
 * @property historyLimit - Number of recent blocks to include in fee history
 * @property defaultLimit - Default gas unit limit used in fee estimation
 */
export const gasConfig = {
  rpcUrl: env.GAS_RPC_URL,
  chainId: env.EVM_CHAIN_ID,
  cacheTtlMs: env.GAS_CACHE_TTL_MS,
  historyLimit: env.GAS_HISTORY_LIMIT,
  defaultLimit: env.GAS_DEFAULT_LIMIT,
} as const;

export type GasConfig = typeof gasConfig;

/**
 * PostgreSQL database connection settings.
 *
 * NOTE: url and replicaUrl contain credentials — do NOT log them.
 *
 * @property url        - Primary (write) database connection string
 * @property replicaUrl - Read-replica connection string; falls back to url when unset
 */
export const databaseConfig = {
  url: env.DATABASE_URL,
  replicaUrl: env.DATABASE_REPLICA_URL,
} as const;

export type DatabaseConfig = typeof databaseConfig;

/**
 * Stellar / Horizon settings.
 *
 * @property horizonUrl      - Horizon REST API base URL
 * @property vaultContractId - On-chain Soroban contract address for the Aura Vault
 */
export const stellarConfig = {
  horizonUrl: env.HORIZON_URL,
  vaultContractId: env.VAULT_CONTRACT_ID,
} as const;

export type StellarConfig = typeof stellarConfig;

/**
 * Email delivery settings.
 *
 * NOTE: sendgridApiKey and mailgunApiKey are sensitive — do NOT log them.
 *
 * @property sendgridApiKey - SendGrid API key (used when provider is SendGrid)
 * @property mailgunDomain  - Mailgun sending domain
 * @property mailgunApiKey  - Mailgun API key (sensitive)
 */
export const emailConfig = {
  sendgridApiKey: env.SENDGRID_API_KEY,
  mailgunDomain: env.MAILGUN_DOMAIN,
  mailgunApiKey: env.MAILGUN_API_KEY,
} as const;

export type EmailConfig = typeof emailConfig;

// ─────────────────────────────────────────────────────────────────────────────
// Aggregated config object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single import point for all application configuration.
 *
 * Grouped by domain so call-sites only import what they need:
 *   import { config } from './config/index.js';
 *   const { rpcUrl } = config.gas;
 *
 * Sensitive fields (secrets, passwords, API keys) are present at runtime
 * but MUST NOT be serialised into log output.  Log `config.server` or
 * `config.gas` freely; never log `config.secrets`, `config.database`,
 * `config.redis.password`, or `config.email`.
 */
export const config = {
  server: serverConfig,
  secrets: secretsConfig,
  redis: redisConfig,
  cache: cacheConfig,
  gas: gasConfig,
  database: databaseConfig,
  stellar: stellarConfig,
  email: emailConfig,
} as const;

export type AppConfig = typeof config;

export default config;

/**
 * AWS Secrets Manager Integration — Issue #855
 *
 * Features:
 * - loadSecretsAtStartup(): prefetches all secrets at boot so first request is never slow
 * - startSecretsRefresh(): background interval re-fetches secrets for zero-downtime rotation
 * - Fallback to process.env for local development (SECRETS_PROVIDER=env)
 * - Never logs secret values — only key names and error codes
 * - stopSecretsRefresh(): call during graceful shutdown
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';
import { logger } from './logger.js';

// ── Config ─────────────────────────────────────────────────────────────────

const SECRETS_PROVIDER = process.env.SECRETS_PROVIDER ?? 'env';
const AWS_REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const APP_SECRETS_ID = process.env.APP_SECRETS_ID;

// Cache TTL: how long a fetched secret is considered fresh (default 5 min)
const CACHE_TTL_MS = Number(process.env.SECRETS_CACHE_TTL_MS ?? 5 * 60 * 1000);

// Refresh interval: background re-fetch frequency to support secret rotation (default 5 min)
const REFRESH_INTERVAL_MS = Number(process.env.SECRETS_REFRESH_INTERVAL_MS ?? 5 * 60 * 1000);

// ── Types ───────────────────────────────────────────────────────────────────

type SecretMap = Record<string, string>;

interface CacheEntry {
  value: SecretMap;
  expiresAt: number;
}

// ── State ───────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
let smClient: SecretsManagerClient | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// ── AWS Client ──────────────────────────────────────────────────────────────

function getClient(): SecretsManagerClient {
  smClient ??= new SecretsManagerClient({ region: AWS_REGION });
  return smClient;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the secret JSON payload. Throws if payload is not a JSON object.
 * NEVER logs the parsed values — only safe metadata.
 */
function parseSecretPayload(payload: string | undefined): SecretMap {
  if (!payload) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Secret payload is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Secret payload must be a JSON object');
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

// ── AWS Fetch ───────────────────────────────────────────────────────────────

async function fetchFromAws(secretId: string): Promise<SecretMap> {
  try {
    const response = await getClient().send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    const value = parseSecretPayload(response.SecretString);

    // Store in cache
    cache.set(secretId, { value, expiresAt: Date.now() + CACHE_TTL_MS });

    // Log safe metadata only — never log the values themselves
    logger.info('[secrets] fetched from AWS Secrets Manager', {
      secretId,
      keyCount: Object.keys(value).length,
      keys: Object.keys(value),
    });

    return value;
  } catch (err) {
    if (err instanceof SecretsManagerServiceException) {
      // Sanitise: log only the error code — never any secret payload
      const smErr = err as { name: string };
      logger.error('[secrets] AWS Secrets Manager error', {
        errorCode: smErr.name,
        secretId,
        // Do not include err.message — it may contain partial secret data
      });
    } else {
      logger.error('[secrets] unexpected error fetching secret', {
        secretId,
        // Omit err details for safety
      });
    }
    throw err as Error;
  }
}

// ── Internal secret map ─────────────────────────────────────────────────────

async function getSecretMap(): Promise<SecretMap> {
  if (SECRETS_PROVIDER !== 'aws') {
    if (process.env.NODE_ENV === 'production') {
      // Hard-fail: production must never use env vars as the secret store
      throw new Error(
        '[secrets] SECRETS_PROVIDER must be "aws" in production. ' +
          'Do not use env-var secrets in production.'
      );
    }
    // Local development fallback: read from process.env
    // (never log these values)
    return process.env as SecretMap;
  }

  if (!APP_SECRETS_ID) {
    throw new Error('[secrets] APP_SECRETS_ID is required when SECRETS_PROVIDER=aws');
  }

  // Return cached value if still fresh
  const cached = cache.get(APP_SECRETS_ID);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  return fetchFromAws(APP_SECRETS_ID);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up a single secret by key name.
 * Returns undefined if the key is not found.
 * Never exposes the secret value in error responses or logs.
 */
export async function getSecret(name: string): Promise<string | undefined> {
  const secrets = await getSecretMap();
  return secrets[name];
}

/**
 * Prefetch all secrets at startup so the first request is never slow.
 * In env mode (local dev), this is a no-op.
 *
 * Safe to call before app.listen — does not block startup on failure.
 */
export async function loadSecretsAtStartup(): Promise<void> {
  if (SECRETS_PROVIDER !== 'aws') {
    logger.info('[secrets] provider=env — skipping AWS startup load (local dev)');
    return;
  }
  if (!APP_SECRETS_ID) {
    logger.warn('[secrets] APP_SECRETS_ID not set — cannot preload secrets');
    return;
  }
  try {
    await fetchFromAws(APP_SECRETS_ID);
    logger.info('[secrets] startup load complete', { secretId: APP_SECRETS_ID });
  } catch {
    // Do not rethrow — let the app start so health probes pass.
    // The app will fail on the first request that needs the secret.
    logger.error('[secrets] startup load failed — check IAM permissions and APP_SECRETS_ID', {
      secretId: APP_SECRETS_ID,
    });
  }
}

/**
 * Start a background refresh loop to support zero-downtime secret rotation.
 * Re-fetches from AWS at SECRETS_REFRESH_INTERVAL_MS intervals.
 * Call stopSecretsRefresh() during graceful shutdown to clear the timer.
 */
export function startSecretsRefresh(): void {
  if (SECRETS_PROVIDER !== 'aws' || !APP_SECRETS_ID) return;
  if (refreshTimer !== null) return; // Already running

  refreshTimer = setInterval(() => {
    if (!APP_SECRETS_ID) return;
    void fetchFromAws(APP_SECRETS_ID).catch(() => {
      // Error already logged inside fetchFromAws
    });
  }, REFRESH_INTERVAL_MS);

  logger.info('[secrets] background refresh started', {
    intervalMs: REFRESH_INTERVAL_MS,
    secretId: APP_SECRETS_ID,
  });
}

/**
 * Stop the background refresh loop. Call during graceful shutdown.
 */
export function stopSecretsRefresh(): void {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    logger.info('[secrets] background refresh stopped');
  }
}

/**
 * Clears the in-memory cache. Used in tests.
 */
export function clearSecretsCache(): void {
  cache.clear();
}

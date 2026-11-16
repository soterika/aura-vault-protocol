/**
 * Horizon API Client — Issue #312
 *
 * Thin HTTP client for the Stellar Horizon REST API.
 * All calls are routed through the circuit breaker so degraded Horizon
 * service does not cascade into the backend.
 *
 * Usage:
 *   import { horizonFetch } from './horizonClient.js';
 *   const data = await horizonFetch('/accounts/G...', 'account:G...');
 */

import { withHorizonCircuitBreaker } from "./horizonCircuitBreakerService.js";
import { cacheSet } from "../cache.js";

const HORIZON_BASE_URL =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

const FALLBACK_CACHE_NS = "horizon:fallback";
const FALLBACK_CACHE_TTL_SECS = 300; // Cache successful responses for 5 min as fallback

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

async function rawHorizonFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${HORIZON_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(9_000), // 9s — under circuit breaker's 10s timeout
    ...init,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Horizon HTTP ${res.status}: ${text}`);
    (err as NodeJS.ErrnoException).code = String(res.status);
    throw err;
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Public circuit-breaker-wrapped fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a Horizon REST endpoint through the circuit breaker.
 *
 * On success, the response is cached under the fallback key so it can be
 * served while the circuit is open.
 *
 * @param path        Horizon path, e.g. "/accounts/G..."
 * @param fallbackKey Optional Redis key for fallback caching (defaults to path)
 * @param init        Fetch options (method, headers, body)
 */
export async function horizonFetch<T = unknown>(
  path: string,
  fallbackKey?: string,
  init?: RequestInit
): Promise<T> {
  const key = fallbackKey ?? `path:${path}`;

  const result = await withHorizonCircuitBreaker<T>(
    () => rawHorizonFetch(path, init) as Promise<T>,
    key
  );

  // Cache successful response as fallback for future open-circuit requests
  try {
    await cacheSet(FALLBACK_CACHE_NS, key, result, FALLBACK_CACHE_TTL_SECS);
  } catch {
    // Redis unavailable — skip caching, don't fail the request
  }

  return result;
}

/**
 * Fetch account details from Horizon.
 */
export async function fetchHorizonAccount(address: string): Promise<unknown> {
  return horizonFetch(`/accounts/${address}`, `account:${address}`);
}

/**
 * Fetch recent operations for an account from Horizon.
 */
export async function fetchHorizonAccountOperations(
  address: string,
  limit = 10
): Promise<unknown> {
  return horizonFetch(
    `/accounts/${address}/operations?limit=${limit}&order=desc`,
    `account:${address}:ops:${limit}`
  );
}

/**
 * Fetch ledger by sequence from Horizon.
 */
export async function fetchHorizonLedger(sequence: number): Promise<unknown> {
  return horizonFetch(`/ledgers/${sequence}`, `ledger:${sequence}`);
}

/**
 * Submit a signed transaction XDR to Horizon through the circuit breaker.
 */
export async function submitHorizonTransaction(xdr: string): Promise<unknown> {
  return horizonFetch(
    "/transactions",
    undefined,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `tx=${encodeURIComponent(xdr)}`,
    }
  );
}

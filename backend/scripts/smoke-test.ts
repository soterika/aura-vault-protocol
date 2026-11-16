#!/usr/bin/env tsx
/**
 * smoke-test.ts
 *
 * Post-deployment smoke test suite for the Aura Vault backend.
 * Verifies that critical endpoints are responding correctly after a blue-green
 * deployment switch. The script exits 0 on full success and non-zero on the
 * first failure so the CI/CD pipeline can trigger an automatic rollback.
 *
 * Invoked by scripts/smoke-test.sh (and directly by the blue-green-deploy.yml
 * workflow via: npx tsx backend/scripts/smoke-test.ts)
 *
 * Environment variables:
 *   BASE_URL          Base URL to test against (default: http://localhost:3001)
 *   SMOKE_TIMEOUT_MS  Per-request timeout in ms (default: 5000)
 *   TEST_WALLET       Stellar wallet address used for the auth smoke test
 *   MAX_STATS_AGE_MS  Maximum acceptable age for cached vault stats in ms
 *                     (used to verify the Horizon listener is connected)
 *
 * Total wall-clock limit: 55 seconds (enforced by the caller via timeout(1)).
 *
 * Closes #947
 */

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT_MS ?? '5000', 10);
const TEST_WALLET = process.env.TEST_WALLET ?? 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3NVARIUOY';
const MAX_STATS_AGE_MS = parseInt(process.env.MAX_STATS_AGE_MS ?? '120000', 10); // 2-minute freshness window
let smokeAccessToken = '';

// ─── Lightweight HTTP client ──────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: <T = unknown>() => T;
  headers: Record<string, string | string[] | undefined>;
}

function request(
  urlStr: string,
  options: http.RequestOptions & { body?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            json: <T>() => JSON.parse(data) as T,
            headers: res.headers as Record<string, string | string[] | undefined>,
          });
        });
      },
    );

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Request to ${urlStr} timed out after ${TIMEOUT_MS}ms`));
    });

    req.on('error', reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Test runner ─────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

async function runTest(
  name: string,
  fn: () => Promise<void>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    console.log(`  ✓  ${name} (${durationMs}ms)`);
    return { name, passed: true, durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  ✗  ${name} (${durationMs}ms)`);
    console.error(`     ${error}`);
    return { name, passed: false, durationMs, error };
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ─── Individual smoke tests ───────────────────────────────────────────────────

/**
 * TC-01  GET /api/health → 200
 * Verifies the process is alive and Express is handling requests.
 */
async function testHealthEndpoint(): Promise<void> {
  const res = await request(`${BASE_URL}/api/health`);
  assert(res.status === 200, `Expected HTTP 200, got ${res.status}`);

  const body = res.json<{ status?: string; redis?: boolean }>();
  assert(
    typeof body === 'object' && body !== null,
    `Expected JSON response body, got: ${res.body.slice(0, 200)}`,
  );
}

/**
 * TC-02  GET /api/v1/vault/stats → 200 with valid shape
 * Verifies the vault stats endpoint returns a properly shaped response.
 */
async function testVaultStats(): Promise<void> {
  const res = await request(`${BASE_URL}/api/v1/vault/stats`);
  assert(res.status === 200, `Expected HTTP 200, got ${res.status}`);

  const body = res.json<{ success?: boolean; data?: Record<string, unknown> }>();
  assert(body?.success === true, `Response success flag is not true: ${res.body.slice(0, 200)}`);
  assert(
    typeof body.data === 'object' && body.data !== null,
    `Expected data object in response`,
  );
  const stats = body.data as Record<string, unknown>;
  const totalAssets = Number(stats.total_assets ?? stats.totalAssets);
  const apy = Number(stats.apy7d ?? stats.apy);
  assert(Number.isFinite(totalAssets) && totalAssets > 0, `Expected non-zero total assets, got ${stats.total_assets ?? stats.totalAssets}`);
  assert(Number.isFinite(apy) && apy > 0 && apy < 1000, `Expected APY between 0 and 1000%, got ${stats.apy7d ?? stats.apy}`);
}

/**
 * TC-03  POST /api/auth/login with test wallet → JWT tokens
 * Verifies the authentication flow produces valid JWT tokens.
 */
async function testAuthLogin(): Promise<void> {
  const payload = JSON.stringify({
    walletAddress: TEST_WALLET,
    tier: 'free',
  });

  const res = await request(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: payload,
  });

  // Accept 200 or 201; reject anything ≥ 400
  assert(
    res.status < 400,
    `Auth login returned HTTP ${res.status}: ${res.body.slice(0, 300)}`,
  );

  const body = res.json<{ accessToken?: string; refreshToken?: string }>();
  assert(
    typeof body.accessToken === 'string' && body.accessToken.length > 0,
    `Expected accessToken string in auth response`,
  );
  assert(
    typeof body.refreshToken === 'string' && body.refreshToken.length > 0,
    `Expected refreshToken string in auth response`,
  );
  smokeAccessToken = body.accessToken;
}

async function testLeaderboard(): Promise<void> {
  const res = await request(`${BASE_URL}/api/vault/leaderboard`);
  assert(res.status === 200, `Leaderboard returned HTTP ${res.status}`);
  const body = res.json<{ leaderboard?: unknown[] }>();
  assert(Array.isArray(body.leaderboard) && body.leaderboard.length > 0, 'Leaderboard must contain at least one depositor');
}

async function testAuthenticatedRateLimit(): Promise<void> {
  if (!smokeAccessToken) throw new Error('Auth smoke test did not provide an access token');
  const responses: number[] = [];
  for (let i = 0; i < 61; i += 1) {
    const res = await request(`${BASE_URL}/api/auth/sessions`, {
      headers: { Authorization: `Bearer ${smokeAccessToken}` },
    });
    responses.push(res.status);
    if (res.status >= 500) throw new Error(`Authenticated request ${i + 1} failed with HTTP ${res.status}`);
  }
  assert(responses[60] === 429, `Expected request 61 to be rate limited (429), got ${responses[60]}`);
  assert(responses.slice(0, 60).every((status) => status < 400), 'One of the first 60 authenticated reads was unexpectedly rejected');
}

/**
 * TC-04  Redis cache warm — vault stats served from cache
 * Calls /api/v1/vault/stats twice; the second call must have cached: true.
 */
async function testRedisCacheWarm(): Promise<void> {
  // First call may be a cache miss — trigger caching
  await request(`${BASE_URL}/api/v1/vault/stats`);

  // Second call should be a cache hit
  const res = await request(`${BASE_URL}/api/v1/vault/stats`);
  assert(res.status === 200, `Expected HTTP 200 on cached request, got ${res.status}`);
  assert(String(res.headers['x-cache'] ?? '').toUpperCase() === 'HIT', `Expected X-Cache: HIT, got ${res.headers['x-cache'] ?? '(missing)'}`);

  const body = res.json<{ success?: boolean; data?: { cached?: boolean } }>();
  assert(body?.success === true, 'Cached vault stats response was not successful');
  assert(
    body.data?.cached === true,
    `Expected cached: true on second vault/stats call; got cached: ${body.data?.cached}`,
  );
}

async function testSseHeartbeat(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const url = new URL(`${BASE_URL}/api/v1/events/stream`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { headers: { Accept: 'text/event-stream' } });
    let data = '';
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('SSE status/heartbeat was not received within 30 seconds')), 30_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      req.destroy();
      if (error) reject(error);
      else resolve();
    };
    req.on('response', (res) => {
      if (res.statusCode !== 200 || !String(res.headers['content-type']).includes('text/event-stream')) {
        finish(new Error(`Expected SSE HTTP 200, got ${res.statusCode} (${res.headers['content-type']})`));
        return;
      }
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes('event: status') && data.includes(': keepalive')) finish();
      });
      res.on('error', (error) => finish(error));
    });
    req.on('error', (error) => {
      if (!settled) finish(error);
    });
    req.end();
  });
}

/**
 * TC-05  Database reachable — verified via health endpoint
 * The /api/health endpoint reports database connectivity status. We treat a
 * 200 with no explicit db: false as a pass (the field may not be present in
 * all configurations).
 */
async function testDatabaseReachable(): Promise<void> {
  const res = await request(`${BASE_URL}/api/health`);
  assert(res.status === 200, `Health check returned HTTP ${res.status}`);

  const body = res.json<Record<string, unknown>>();
  // If the health endpoint explicitly signals db is down, fail the smoke test
  if ('database' in body) {
    assert(
      body.database !== false && body.database !== 'down',
      `Health endpoint reports database is down: ${JSON.stringify(body.database)}`,
    );
  }
  if ('db' in body) {
    assert(
      body.db !== false && body.db !== 'down',
      `Health endpoint reports db is down: ${JSON.stringify(body.db)}`,
    );
  }
}

/**
 * TC-06  Horizon listener connected — verified via stats freshness
 * The vault stats fetched_at timestamp must be within MAX_STATS_AGE_MS of now.
 * A stale timestamp indicates the Horizon event listener has stopped updating.
 */
async function testHorizonListenerFreshness(): Promise<void> {
  const res = await request(`${BASE_URL}/api/v1/vault/stats`);
  assert(res.status === 200, `vault/stats returned HTTP ${res.status}`);

  const body = res.json<{
    success?: boolean;
    data?: { fetched_at?: string; last_updated?: string };
  }>();

  assert(body?.success === true, 'vault/stats response was not successful');

  // Try fetched_at first, then last_updated
  const rawTs = body.data?.fetched_at ?? body.data?.last_updated;

  if (!rawTs) {
    // Field not present in this build — skip freshness check gracefully
    console.log('     (skipped — fetched_at/last_updated not present in vault stats)');
    return;
  }

  const ageMs = Date.now() - new Date(rawTs).getTime();
  assert(
    ageMs <= MAX_STATS_AGE_MS,
    `Vault stats are stale: last updated ${Math.round(ageMs / 1000)}s ago ` +
    `(max allowed: ${MAX_STATS_AGE_MS / 1000}s). Horizon listener may be disconnected.`,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log('');
  console.log(`╔══════════════════════════════════════════════════════╗`);
  console.log(`║         Aura Vault — Post-Deploy Smoke Tests         ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`  Target : ${BASE_URL}`);
  console.log(`  Timeout: ${TIMEOUT_MS}ms per request`);
  console.log('');

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'TC-01  GET /api/health returns 200',                testHealthEndpoint },
    { name: 'TC-02  GET /api/v1/vault/stats returns valid shape', testVaultStats },
    { name: 'TC-03  POST /api/auth/login returns JWT tokens',    testAuthLogin },
    { name: 'TC-04  Redis cache is warm (stats cached)',         testRedisCacheWarm },
    { name: 'TC-05  Database is reachable (via health)',         testDatabaseReachable },
    { name: 'TC-06  Horizon listener connected (stats fresh)',   testHorizonListenerFreshness },
    { name: 'TC-07  Leaderboard contains a depositor',            testLeaderboard },
    { name: 'TC-08  Authenticated rate limit rejects request 61', testAuthenticatedRateLimit },
    { name: 'TC-09  SSE stream sends status and heartbeat',        testSseHeartbeat },
  ];

  const results: TestResult[] = [];

  for (const { name, fn } of tests) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runTest(name, fn));
  }

  const totalMs = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('');
  console.log('──────────────────────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed  (${totalMs}ms total)`);
  console.log('──────────────────────────────────────────────────────');

  if (failed > 0) {
    console.log('');
    console.log('  Failed tests:');
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`    ✗  ${r.name}`);
      console.log(`       ${r.error ?? '(no detail)'}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('');
  console.log('  ✅  All smoke tests passed — deployment is healthy.');
  console.log('');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('');
  console.error('  Fatal error in smoke test runner:');
  console.error(' ', err instanceof Error ? err.message : String(err));
  console.error('');
  process.exit(1);
});

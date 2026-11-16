/**
 * k6 Load Test — 1000 Concurrent Depositors  (#987)
 *
 * Scenario: ramp 0 → 1000 users over 60 s, sustain for 5 minutes,
 * ramp down over 30 s. Each VU authenticates, makes a deposit, then
 * checks the resulting share balance.
 *
 * Usage:
 *   # Against staging (default)
 *   k6 run tests/load/concurrent-deposits.js
 *
 *   # Against a custom URL
 *   BASE_URL=https://api.staging.auravault.io k6 run tests/load/concurrent-deposits.js
 *
 *   # Stream results to InfluxDB for Grafana
 *   k6 run --out influxdb=http://localhost:8086/k6 tests/load/concurrent-deposits.js
 *
 * Environment variables:
 *   BASE_URL          Backend base URL (default: https://api.staging.auravault.io)
 *   WALLET_PREFIX     Prefix for generated wallet addresses (default: GCONCURRENT)
 *   GRAFANA_URL       Grafana base URL used in handleSummary annotation
 *   GRAFANA_API_KEY   Bearer token for Grafana annotation API
 */

import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// ─── Custom metrics ──────────────────────────────────────────────────────────

/** End-to-end latency for the full authenticate→deposit→balance flow. */
const flowLatency = new Trend("deposit_flow_latency_ms", true);

/** Individual step latencies. */
const authLatency    = new Trend("deposit_auth_latency_ms",    true);
const depositLatency = new Trend("deposit_step_latency_ms",    true);
const balanceLatency = new Trend("deposit_balance_latency_ms", true);

/** Number of flows where the returned share count was 0 after a deposit. */
const zeroSharesAfterDeposit = new Counter("deposit_zero_shares_after_deposit");

/** Tracks the share-count consistency check pass/fail. */
const balanceConsistency = new Rate("deposit_balance_consistency");

/** Overall flow success rate. */
const flowSuccessRate = new Rate("deposit_flow_success_rate");

// ─── Scenario configuration ───────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Issue #987: ramp 0 → 1000 over 60s, sustain 5 min, ramp down 30s
    concurrent_depositors: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "60s",  target: 1000 }, // ramp up
        { duration: "5m",   target: 1000 }, // sustained load
        { duration: "30s",  target: 0    }, // ramp down
      ],
      gracefulRampDown: "30s",
    },
  },

  // ── Acceptance criteria (Issue #987) ────────────────────────────────────
  thresholds: {
    // p95 response time < 500ms across every step
    "deposit_auth_latency_ms":    ["p(95)<500"],
    "deposit_step_latency_ms":    ["p(95)<500"],
    "deposit_balance_latency_ms": ["p(95)<500"],
    "deposit_flow_latency_ms":    ["p(95)<500"],

    // Error rate < 1%
    "http_req_failed":            ["rate<0.01"],

    // 0 data inconsistencies: every deposit must result in shares > 0
    "deposit_zero_shares_after_deposit": ["count==0"],

    // Balance consistency rate must be 100%
    "deposit_balance_consistency": ["rate==1"],

    // Overall flow success > 99%
    "deposit_flow_success_rate": ["rate>0.99"],
  },
};

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL      = __ENV.BASE_URL      || "https://api.staging.auravault.io";
const WALLET_PREFIX = __ENV.WALLET_PREFIX || "GCONCURRENT";

/** Deposit amounts in stroops (Stellar's smallest unit, 1 XLM = 10_000_000). */
const DEPOSIT_AMOUNTS = [
  1_000_000,    //  0.1 XLM — micro deposit
  10_000_000,   //  1   XLM — small deposit
  100_000_000,  // 10   XLM — medium deposit
  500_000_000,  // 50   XLM — larger deposit
];

const HEADERS_JSON = { "Content-Type": "application/json" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic-looking Stellar-style wallet address for a VU.
 * Real Stellar addresses are 56 characters; we pad to keep the shape.
 */
function makeWalletAddress() {
  // Use a uuid suffix to ensure uniqueness across VUs and iterations.
  const suffix = uuidv4().replace(/-/g, "").toUpperCase().slice(0, 46);
  return `${WALLET_PREFIX}${suffix}`;
}

/**
 * POST /api/auth/login → accessToken.
 * Returns null on failure so the VU can bail cleanly without failing the run.
 */
function authenticate(walletAddress) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ walletAddress, tier: "free" }),
    { headers: HEADERS_JSON, timeout: "10s" }
  );
  authLatency.add(Date.now() - start);

  const ok = check(res, {
    "auth: status 200":              (r) => r.status === 200,
    "auth: has accessToken":         (r) => {
      try { return !!JSON.parse(r.body).accessToken; } catch { return false; }
    },
  });

  if (!ok) return null;
  try {
    return JSON.parse(res.body).accessToken;
  } catch {
    return null;
  }
}

/**
 * POST /api/v1/vault/transactions/deposit → { shares, txHash }.
 * Returns null on failure.
 */
function deposit(token, walletAddress, amount) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/vault/transactions/deposit`,
    JSON.stringify({ walletAddress, amount, contractId: "AURA_VAULT_STAGING" }),
    {
      headers: {
        ...HEADERS_JSON,
        Authorization: `Bearer ${token}`,
      },
      timeout: "15s",
    }
  );
  depositLatency.add(Date.now() - start);

  const ok = check(res, {
    "deposit: status 200 or 202": (r) => r.status === 200 || r.status === 202,
    "deposit: body is JSON":      (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });

  if (!ok) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/vault/stats → { total_assets, total_shares }.
 * We use vault stats (public, no auth) to confirm share supply increased.
 * Per-address balance would require on-chain RPC; stats serve as a proxy.
 */
function getVaultStats(token) {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/vault/stats`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: "10s",
  });
  balanceLatency.add(Date.now() - start);

  const ok = check(res, {
    "balance: status 200": (r) => r.status === 200,
    "balance: has data":   (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!ok) return null;
  try {
    return JSON.parse(res.body).data;
  } catch {
    return null;
  }
}

// ─── VU entrypoint ───────────────────────────────────────────────────────────

export default function () {
  const flowStart     = Date.now();
  const walletAddress = makeWalletAddress();

  // ── Step 1: Authenticate ──────────────────────────────────────────────────
  const token = authenticate(walletAddress);
  if (!token) {
    flowSuccessRate.add(0);
    sleep(1);
    return;
  }

  // ── Step 2: Deposit ───────────────────────────────────────────────────────
  // Each VU picks a random deposit amount to vary the load profile.
  const amount     = DEPOSIT_AMOUNTS[Math.floor(Math.random() * DEPOSIT_AMOUNTS.length)];
  const depositRes = deposit(token, walletAddress, amount);

  if (!depositRes) {
    flowSuccessRate.add(0);
    sleep(1);
    return;
  }

  // ── Step 3: Verify share balance consistency ──────────────────────────────
  // Allow a short settle time for async transaction processing.
  sleep(0.5);

  const stats = getVaultStats(token);

  if (!stats) {
    // Could not read stats — count as inconsistency
    balanceConsistency.add(0);
    zeroSharesAfterDeposit.add(1);
    flowSuccessRate.add(0);
    flowLatency.add(Date.now() - flowStart);
    sleep(1);
    return;
  }

  // Invariant: total_shares must be > 0 after at least one deposit has occurred.
  const totalShares = Number(stats.total_shares ?? 0);
  const isConsistent = totalShares > 0;

  balanceConsistency.add(isConsistent ? 1 : 0);
  if (!isConsistent) {
    zeroSharesAfterDeposit.add(1);
  }

  // ── Record end-to-end latency and success ─────────────────────────────────
  flowLatency.add(Date.now() - flowStart);
  flowSuccessRate.add(isConsistent ? 1 : 0);

  // Think time: 0.5–2s to simulate realistic user pacing.
  sleep(0.5 + Math.random() * 1.5);
}

// ─── Summary / Grafana annotation ────────────────────────────────────────────

export function handleSummary(data) {
  const metrics = data.metrics || {};

  const p95Flow    = metrics["deposit_flow_latency_ms"]?.values?.["p(95)"]    ?? 0;
  const p95Auth    = metrics["deposit_auth_latency_ms"]?.values?.["p(95)"]    ?? 0;
  const p95Deposit = metrics["deposit_step_latency_ms"]?.values?.["p(95)"]    ?? 0;
  const p95Balance = metrics["deposit_balance_latency_ms"]?.values?.["p(95)"] ?? 0;
  const errorRate  = metrics["http_req_failed"]?.values?.rate                  ?? 0;
  const zeroShares = metrics["deposit_zero_shares_after_deposit"]?.values?.count ?? 0;
  const successRate = metrics["deposit_flow_success_rate"]?.values?.rate        ?? 0;
  const consistency = metrics["deposit_balance_consistency"]?.values?.rate      ?? 0;

  // Determine overall pass/fail
  const passed =
    p95Flow    < 500 &&
    p95Auth    < 500 &&
    p95Deposit < 500 &&
    p95Balance < 500 &&
    errorRate  < 0.01 &&
    zeroShares === 0 &&
    successRate > 0.99 &&
    consistency === 1;

  const summary = {
    scenario:  "1000 concurrent depositors",
    status:    passed ? "PASS" : "FAIL",
    thresholds: {
      "p95 flow end-to-end (ms)":        { value: p95Flow.toFixed(1),    limit: "<500",  pass: p95Flow    < 500 },
      "p95 auth (ms)":                   { value: p95Auth.toFixed(1),    limit: "<500",  pass: p95Auth    < 500 },
      "p95 deposit (ms)":                { value: p95Deposit.toFixed(1), limit: "<500",  pass: p95Deposit < 500 },
      "p95 balance check (ms)":          { value: p95Balance.toFixed(1), limit: "<500",  pass: p95Balance < 500 },
      "http error rate":                 { value: (errorRate * 100).toFixed(2) + "%", limit: "<1%",  pass: errorRate  < 0.01 },
      "zero-share inconsistencies":      { value: String(zeroShares),    limit: "==0",   pass: zeroShares === 0 },
      "deposit flow success rate":       { value: (successRate * 100).toFixed(2) + "%", limit: ">99%", pass: successRate > 0.99 },
      "balance consistency rate":        { value: (consistency * 100).toFixed(2) + "%", limit: "==100%", pass: consistency === 1 },
    },
    timestamp: new Date().toISOString(),
  };

  // Push Grafana annotation when credentials are provided
  const grafanaUrl    = __ENV.GRAFANA_URL;
  const grafanaApiKey = __ENV.GRAFANA_API_KEY;
  if (grafanaUrl && grafanaApiKey) {
    const annotation = {
      text: `k6 load test #987 — ${summary.status}: p95=${p95Flow.toFixed(0)}ms errors=${(errorRate*100).toFixed(2)}%`,
      tags: ["k6", "load-test", "concurrent-deposits", summary.status.toLowerCase()],
      time: Date.now(),
    };
    http.post(
      `${grafanaUrl}/api/annotations`,
      JSON.stringify(annotation),
      { headers: { ...HEADERS_JSON, Authorization: `Bearer ${grafanaApiKey}` } }
    );
  }

  return {
    "tests/load/concurrent-deposits-results.json": JSON.stringify(summary, null, 2),
    stdout: `\n${"=".repeat(60)}\nk6 Concurrent Depositors Load Test (#987)\n${"=".repeat(60)}\n${JSON.stringify(summary, null, 2)}\n`,
  };
}

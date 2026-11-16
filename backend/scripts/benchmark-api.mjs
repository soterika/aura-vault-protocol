import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:4100";
const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 120);
const baselinePath = new URL("../api-latency-baselines.json", import.meta.url);
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const routes = [
  ["GET /api/v1/vault/stats", "/api/v1/vault/stats", "GET"],
  ["GET /api/vault/leaderboard", "/api/vault/leaderboard", "GET"],
  ["GET /api/v1/yield/apy-history", "/api/v1/yield/apy-history", "GET"],
  ["POST /api/auth/login", "/api/auth/login", "POST"],
  ["GET /api/health", "/api/health", "GET"],
];

function percentile(values, fraction) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

let failed = false;
for (const [name, path, method] of routes) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ email: "benchmark@example.invalid", password: "invalid" }) } : {}),
    });
    await response.arrayBuffer();
    samples.push(performance.now() - start);
    if (response.status >= 500) throw new Error(`${name} returned HTTP ${response.status}`);
  }
  samples.sort((a, b) => a - b);
  const p95Ms = percentile(samples, 0.95);
  const limit = baseline.endpoints[name].p95Ms * (1 + baseline.regressionThresholdPercent / 100);
  console.log(`${name}\tp95=${p95Ms.toFixed(1)}ms\tlimit=${limit.toFixed(1)}ms`);
  if (p95Ms > limit) failed = true;
}
if (failed) process.exitCode = 1;

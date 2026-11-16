# Performance Benchmarking Guide

This guide explains how to run all performance benchmarks in the Aura Vault Protocol repository, interpret results, and prevent regressions. All benchmarks are automated in CI; this guide covers how to run them locally.

---

## Table of Contents

1. [Performance Budget Summary](#performance-budget-summary)
2. [Contract Instruction Benchmarks](#contract-instruction-benchmarks)
3. [API Load Tests](#api-load-tests)
4. [Frontend Bundle Size Profiling](#frontend-bundle-size-profiling)
5. [Interpreting Grafana Dashboards](#interpreting-grafana-dashboards)
6. [CI Integration](#ci-integration)
7. [Updating Baselines](#updating-baselines)

---

## Performance Budget Summary

The following table shows all current budgets and baselines. These are the values CI enforces. A PR that exceeds any limit will fail.

### Contract Gas Baselines (`gas-baselines.json`)

Threshold for regression: **+10%** above baseline. Measurements are CPU instruction counts from the Soroban SDK native test harness.

| Function | Baseline (instructions) | Baseline (memory bytes) |
|---|---|---|
| `initialize` | 3,500,000 | 1,200,000 |
| `deposit` | 5,500,000 | 1,800,000 |
| `withdraw` | 5,800,000 | 1,900,000 |
| `harvest` | 5,200,000 | 1,700,000 |
| `harvest_token` | 6,500,000 | 2,100,000 |
| `register_yield_token` | 2,800,000 | 1,000,000 |
| `pause` | 2,600,000 | 950,000 |
| `unpause` | 2,600,000 | 950,000 |
| `is_paused` | 1,800,000 | 700,000 |
| `set_fees` | 2,700,000 | 980,000 |
| `set_treasury` | 2,700,000 | 980,000 |
| `withdraw_fees` | 5,000,000 | 1,650,000 |
| `total_fees_collected` | 1,600,000 | 650,000 |
| `total_assets` | 1,600,000 | 650,000 |
| `balance_of` | 1,700,000 | 680,000 |

> Native test harness values are ~30–50% lower than actual on-chain WASM execution but are internally consistent and sufficient for regression detection.

### Frontend Bundle Size Budgets (`frontend/.size-limit.json` and `frontend/budget.json`)

| Bundle | Warning Limit | Hard Limit (CI fails) |
|---|---|---|
| Main JS bundle | 180 kB gzip | 200 kB gzip |
| Framework chunk (React + Next.js) | 45 kB gzip | 50 kB gzip |
| Per-route chunk (any page) | 40 kB gzip | 50 kB gzip |
| CSS bundle | 15 kB gzip | 20 kB gzip |

### API Load Test SLAs

| Metric | Target |
|---|---|
| p95 latency at 1,000 concurrent users | < 500 ms |
| Error rate (unhandled) | 0 |
| Heap growth over 500 cycles | < 20 MB |

---

## Contract Instruction Benchmarks

### Prerequisites

- Rust toolchain with `wasm32-unknown-unknown` target
- `cargo` in PATH
- `jq` in PATH
- `python3` in PATH

### Running Gas Benchmarks

```bash
# From the repo root
./scripts/check-gas.sh
```

This script:
1. Runs all tests in `aura-vault/src/` matching the `gas_` prefix
2. Parses `GAS_MEASUREMENT: <function> <instructions>` lines from test output
3. Compares each measurement against `gas-baselines.json` with a 10% tolerance
4. Writes a detailed JSON report to `gas-report.json`
5. Exits non-zero if any function exceeds the threshold

**Sample output**

```
[gas-check] Running gas measurement tests in ./aura-vault …
[gas-check]   Measured: deposit = 5412000 instructions
[gas-check]   Measured: withdraw = 5763000 instructions
[gas-check]   Measured: harvest = 5180000 instructions

Function             Baseline       Current    Delta%     Status
───────────────────────────────────────────────────────────────────────────
balance_of             1,700,000   1,682,000    -1.06%  improved
deposit                5,500,000   5,412,000    -1.60%  improved
harvest                5,200,000   5,180,000    -0.38%  improved
harvest_token          6,500,000   6,488,000    -0.18%  improved
initialize             3,500,000   3,498,000    -0.06%  improved
pause                  2,600,000   2,595,000    -0.19%  improved
withdraw               5,800,000   5,763,000    -0.64%  improved
───────────────────────────────────────────────────────────────────────────
Summary: 15 passed, 0 failed, 0 skipped
```

### Running Gas Tests Directly

To run just the gas tests without the comparison script:

```bash
cd aura-vault
cargo test gas_ -- --nocapture 2>&1 | grep GAS_MEASUREMENT
```

### How Gas Tests Work

Gas tests in `aura-vault/src/gas_test.rs` call each contract function inside `env.budget().cpu_instruction_count()` wrappers and print results in the `GAS_MEASUREMENT:` format. Each test follows this pattern:

```rust
#[test]
fn gas_deposit() {
    let env = Env::default();
    // ... setup ...
    env.budget().reset_default();
    client.deposit(&caller, &1_000_000);
    let cpu = env.budget().cpu_instruction_count();
    println!("GAS_MEASUREMENT: deposit {}", cpu);
}
```

### Interpreting Gas Results

- **improved** (green): Current measurement is lower than baseline — a good sign after optimizations.
- **PASS↑** (yellow): Measurement is higher than baseline but within the 10% threshold. Acceptable but worth investigating if the change was not intentional.
- **FAIL** (red): Measurement exceeds baseline by more than 10%. The PR will be blocked. Investigate which code change caused the increase.

A `FAIL` means one of:
- A new storage read/write was added (each ledger access is expensive)
- An arithmetic operation was made more complex
- A new event was emitted
- A loop was introduced

To diagnose, diff the failing function against its previous version and count ledger operations.

---

## API Load Tests

### Prerequisites

- Node.js 20+
- `npm install` in the repo root (installs `vitest` and `ts-node`)

### Running API Load Tests Locally

The primary API load test suite runs entirely in-process using mocked async calls. It simulates up to 1,000 concurrent users.

```bash
# From the repo root
npx vitest run scripts/stress-test.ts
```

Or run the full stress test script (which also generates a JSON report):

```bash
npx ts-node scripts/stress-test.ts
# Report written to test-report/stress-test-report.json
```

### Running the k6 Load Test (HTTP-Level)

For realistic HTTP-level load testing against a live backend:

```bash
# Install k6: https://k6.io/docs/getting-started/installation/
k6 run ui/src/tests/load.k6.ts \
  -e BASE_URL=http://localhost:3001 \
  --vus 100 \
  --duration 60s
```

Key scenarios in `load.k6.ts`:
- `deposit_pipeline`: simulates user depositing tokens
- `withdraw_pipeline`: simulates user withdrawing shares
- `harvest_pipeline`: simulates keeper calling harvest
- `error_translation`: measures error translation throughput

### Configuring the Stress Test

The stress test in `scripts/stress-test.ts` accepts environment variables:

| Variable | Default | Description |
|---|---|---|
| `STRESS_USERS` | `1000` | Number of concurrent simulated users |
| `STRESS_BASE_LATENCY_MS` | `5` | Simulated API base latency in ms |
| `STRESS_ERROR_RATE` | `0.05` | Fraction of requests to inject errors (0–1) |
| `STRESS_CYCLES` | `500` | Memory stability test cycles |

Example with custom parameters:

```bash
STRESS_USERS=500 STRESS_BASE_LATENCY_MS=50 npx ts-node scripts/stress-test.ts
```

### Interpreting Load Test Results

The report at `test-report/stress-test-report.json` contains per-scenario metrics:

```json
{
  "scenario": "deposit_pipeline",
  "users": 1000,
  "p50_ms": 5.1,
  "p95_ms": 8.3,
  "p99_ms": 10.2,
  "error_rate": 0,
  "unhandled_rejections": 0
}
```

**Pass/fail thresholds**:
- `p95_ms < 500` — required
- `unhandled_rejections == 0` — required
- `heap_delta_mb < 20` (memory stability test) — required

A p95 above 500 ms almost certainly means the `setTimeout(1200)` stub in form components is still active. See `docs/load-test-report.md` for known bottlenecks.

### Profiling with clinic.js

For CPU flame graphs during a load run:

```bash
npm install -g clinic
clinic flame -- node -r ts-node/register scripts/stress-test.ts
```

The flame graph will open in your browser. Look for wide orange bars, which indicate hot paths spending more CPU time than expected.

---

## Frontend Bundle Size Profiling

### Prerequisites

- Node.js 20+
- `npm install` in `frontend/`

### Checking Bundle Size Locally

```bash
cd frontend

# Build production bundle
npm run build

# Run size-limit check against .size-limit.json budgets
npx size-limit
```

Output example:

```
  Main JS bundle   148 kB / 200 kB  ✓
  Framework chunk   43 kB /  50 kB  ✓
  Per-route chunks  31 kB /  50 kB  ✓
  CSS bundle        12 kB /  20 kB  ✓
```

### Analyzing Bundle Composition

When a bundle approaches its limit, use the Next.js bundle analyzer to find large dependencies:

```bash
cd frontend
ANALYZE=true npm run build
```

This opens an interactive treemap in your browser. Look for:
- Duplicate packages (e.g., two versions of React)
- Large dependencies that could be lazy-loaded
- Development-only code accidentally included in production builds

### Common Size Fixes

| Problem | Fix |
|---|---|
| A library included in the main bundle | Move to `dynamic(() => import(...), { ssr: false })` |
| Icons imported as a full icon set | Use tree-shaking imports: `import { SomeIcon } from 'package/SomeIcon'` |
| Large locale files | Use `next-intl` or similar with dynamic locale loading |
| Duplicate packages | Run `npx npm-dedupe` and check `package-lock.json` |

### Running the Performance Budget Workflow Locally

The full CI budget check is defined in `.github/workflows/perf-budget.yml`. To simulate it locally:

```bash
cd frontend
npm run build
npx size-limit --json > /tmp/size-report.json
cat /tmp/size-report.json
```

---

## Interpreting Grafana Dashboards

Grafana is available at `http://localhost:3000` when running the monitoring stack via `docker-compose.monitoring.yml`.

### Available Dashboards

| Dashboard | File | Purpose |
|---|---|---|
| Vault Operations | `monitoring/grafana/dashboards/vault-operations.json` | Contract event rates, deposit/withdraw/harvest volume |
| System Health | `monitoring/grafana/dashboards/system-health.json` | CPU, memory, request rate, error rate |
| Log Aggregation | `monitoring/grafana/dashboards/log-aggregation.json` | Structured logs from backend and infrastructure |

### Vault Operations Dashboard

Key panels and how to read them:

| Panel | Good | Investigate |
|---|---|---|
| **Event Rate** (events/min) | Steady or growing | Sudden drop to zero (contract or indexer issue) |
| **Deposit Volume** (tokens/hr) | Proportional to user activity | Sudden spike (bot activity) or sustained zero |
| **Harvest Frequency** (harvests/hr) | At least one per hour in production | Zero for >4 hours (keeper offline) |
| **Error Rate** | < 0.1% | > 1% (investigate contract error codes) |
| **p95 Latency** (backend API) | < 200 ms | > 500 ms (scale up or investigate N+1 queries) |

### System Health Dashboard

| Panel | Normal Range | Alert Threshold |
|---|---|---|
| **CPU Utilization** | < 60% | > 80% for 5 min |
| **Memory Usage** | < 70% | > 85% |
| **Request Queue Depth** (Redis) | < 100 | > 1,000 |
| **RDS Connections** | < 80 | > 90 of max connections |
| **Error Rate (5xx)** | < 0.1% | > 1% |

### Prometheus Alerts

Prometheus alerting rules are defined in `monitoring/prometheus/alert.rules.yml`. Key alerts:

| Alert | Condition | Severity |
|---|---|---|
| `VaultHarvestStalled` | No harvest event in 4 hours | Warning |
| `BackendHighErrorRate` | 5xx rate > 1% for 5 min | Critical |
| `HighAPILatency` | p95 > 500 ms for 5 min | Warning |
| `LowDiskSpace` | Disk > 85% | Warning |
| `DatabaseConnectionsHigh` | RDS connections > 90% of max | Critical |

To view firing alerts:

```bash
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {alertname: .labels.alertname, state: .state}'
```

### Starting the Monitoring Stack Locally

```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

Services started:
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (default credentials: admin/admin)
- Alertmanager: `http://localhost:9093`

---

## CI Integration

### Automated Checks on Every PR

| Check | Workflow file | Trigger |
|---|---|---|
| Contract gas regression | `.github/workflows/gas-regression.yml` | PR to main |
| Gas tracking (baseline update) | `.github/workflows/gas-tracking.yml` | Push to main |
| Frontend bundle budget | `.github/workflows/perf-budget.yml` | PR to main |
| API stress test | `.github/workflows/stress-test.yml` | PR to main |
| Load test (full) | `.github/workflows/load-test.yml` | Scheduled weekly |

### What Fails a PR

A PR will be blocked if:
1. Any contract function's CPU instruction count exceeds its baseline by more than 10%
2. Any frontend bundle exceeds its hard size limit
3. The stress test reports any `unhandled_rejections > 0` or `p95_ms > 500`

---

## Updating Baselines

### Updating Gas Baselines

After an intentional optimization or after adding a new function, update the baselines:

```bash
./scripts/update-gas-baselines.sh
```

This re-runs the gas tests and overwrites `gas-baselines.json` with new measurements. Commit the updated file with a clear message explaining why baselines changed:

```
git add gas-baselines.json
git commit -m "perf: update gas baselines after TTL optimization"
```

> Do not update baselines to hide a regression. Only update after a deliberate, reviewed optimization.

### Updating Frontend Bundle Budgets

If bundle sizes have legitimately grown (e.g., after adding a major feature), update `frontend/.size-limit.json` and `frontend/budget.json` together. Include a brief justification in the PR description explaining what was added and why the new size is acceptable.

### Updating API Load Test Thresholds

Load test thresholds are hardcoded in `scripts/stress-test.ts`. Changes require a PR and a comment explaining the new target.

# Aura Vault Protocol — CI/CD Pipeline Reference

This document is the single source of truth for every GitHub Actions workflow in this repository. It covers the full pipeline topology, per-workflow documentation, required secrets and environment variables, deployment gate criteria, local execution with `act`, and branch protection configuration.

---

## Table of Contents

1. [Pipeline Architecture](#1-pipeline-architecture)
2. [Workflow Reference](#2-workflow-reference)
   - [ci.yml — Unified CI](#ciyml--unified-ci)
   - [pipeline.yml — Comprehensive CI/CD Pipeline](#pipelineyml--comprehensive-cicd-pipeline)
   - [pr.yml — PR Checks](#pryml--pr-checks)
   - [deploy.yml — Deploy](#deployyml--deploy)
   - [frontend-deploy.yml — Frontend Deploy + CDN Invalidation](#frontend-deployyml--frontend-deploy--cdn-invalidation)
   - [ci.backend-frontend.yml — Backend & Frontend CI](#cibackend-frontendyml--backend--frontend-ci)
   - [security-scan.yml — Security Scanning (Rust)](#security-scanyml--security-scanning-rust)
   - [security-scanning.yml — Security Scanning (Full Stack)](#security-scanningyml--security-scanning-full-stack)
   - [trivy-scanning.yml — Trivy Container Scanning](#trivy-scanningyml--trivy-container-scanning)
   - [codeql.yml — CodeQL Analysis](#codeqlyml--codeql-analysis)
   - [gas-tracking.yml — Gas Tracking](#gas-trackingyml--gas-tracking)
   - [gas-regression.yml — Gas Regression Check](#gas-regressionyml--gas-regression-check)
   - [lighthouse.yml — Lighthouse CI / Core Web Vitals](#lighthouseyml--lighthouse-ci--core-web-vitals)
   - [terraform.yml — Terraform Plan / Apply](#terraformyml--terraform-plan--apply)
   - [terraform-drift.yml — Infrastructure Drift Detection](#terraform-driftyml--infrastructure-drift-detection)
   - [load-test.yml — Load Testing](#load-testyml--load-testing)
   - [dr-test.yml — Monthly DR Test](#dr-testyml--monthly-dr-test)
   - [dr-failover-test.yml — Quarterly DR Failover Test](#dr-failover-testyml--quarterly-dr-failover-test)
   - [mutation-testing.yml — Mutation Testing](#mutation-testingyml--mutation-testing)
   - [fuzz-test.yml — Fuzz Testing](#fuzz-testyml--fuzz-testing)
   - [fuzzing-properties.yml — Property-Based Fuzz Testing](#fuzzing-propertiesyml--property-based-fuzz-testing)
   - [docker-build.yml — Docker Build & Push](#docker-buildyml--docker-build--push)
   - [cypress.yml — Cypress E2E](#cypressyml--cypress-e2e)
   - [perf-budget.yml — Frontend Performance Budget](#perf-budgetyml--frontend-performance-budget)
   - [rustdoc.yml — Rustdoc](#rustdocyml--rustdoc)
   - [dependabot-auto-merge.yml — Dependabot Auto-merge](#dependabot-auto-mergeyml--dependabot-auto-merge)
3. [Required GitHub Secrets](#3-required-github-secrets)
4. [Required Environment Variables](#4-required-environment-variables)
5. [Deployment Gate Criteria](#5-deployment-gate-criteria)
6. [Running Jobs Locally with `act`](#6-running-jobs-locally-with-act)
7. [Branch Protection Rules](#7-branch-protection-rules)

---

## 1. Pipeline Architecture

The diagram below shows the full pipeline DAG from an open PR through staging and into a production deployment. Nodes represent jobs or logical stages; edges represent `needs` dependencies or manual approval gates.

```mermaid
flowchart TD
    subgraph PR["Pull Request Phase"]
        direction TB
        PR_OPEN(["Open PR"])
        PR_LINT["pr.yml: lint\n(rustfmt + clippy)"]
        PR_TEST["pr.yml: test\n(cargo test)"]
        PR_SECURITY["pr.yml: security audit\n(cargo-audit)"]
        PR_BUILD_WASM["pr.yml: build-wasm\n(size ≤ 64 KiB)"]
        PR_MOBILE["pr.yml: mobile-tests\n(Playwright 375/390/414)"]
        GAS_CHECK["gas-regression.yml\n(gas regression ≤ 5%)"]
        LIGHTHOUSE_PR["lighthouse.yml\n(Perf ≥ 85, LCP < 2.5s)"]
        PERF_BUDGET["perf-budget.yml\n(bundle size limits)"]
        SECURITY_SCAN_PR["security-scanning.yml\n(npm/cargo audit, Trivy,\nSemgrep, TruffleHog)"]
        CODEQL_PR["codeql.yml\n(JavaScript/TypeScript)"]
        CI_PR["ci.yml\n(lint, unit, build,\nintegration, e2e)"]
        CI_BF_PR["ci.backend-frontend.yml\n(lint, test, build)"]
        PR_GATE(["All PR checks pass\n(branch protection)"])
    end

    subgraph MERGE["Merge to main"]
        MERGE_MAIN(["Merge to main"])
    end

    subgraph STAGING["Staging Deployment"]
        direction TB
        PIPELINE_LINT["pipeline.yml: lint\n(rustfmt + clippy -D warnings)"]
        PIPELINE_TEST["pipeline.yml: test-contract\n(cargo test)"]
        PIPELINE_FE_TEST["pipeline.yml: test-frontend\n(UI + frontend)"]
        PIPELINE_SAST_RUST["pipeline.yml: sast-rust\n(cargo-audit + cargo-deny)"]
        PIPELINE_SAST_CODEQL["pipeline.yml: sast-codeql\n(CodeQL JS/TS)"]
        PIPELINE_SAST_CONTAINER["pipeline.yml: sast-container\n(Trivy)"]
        PIPELINE_BUILD_WASM["pipeline.yml: build-wasm\n(size gate + SHA-256)"]
        PIPELINE_BUILD_IMAGE["pipeline.yml: build-image\n(GHCR push)"]
        DOCKER_BUILD["docker-build.yml\n(build backend + frontend,\nTrivy scan before push)"]
        FRONTEND_DEPLOY_STG["frontend-deploy.yml\n(S3 sync + CloudFront\ninvalidation — staging)"]
        TERRAFORM_STG["terraform.yml: apply-staging\n(auto on merge)"]
        DEPLOY_STG["pipeline.yml / deploy.yml:\ndeploy-staging\n(Stellar testnet Wasm)"]
        RUSTDOC_STG["rustdoc.yml\n(cargo doc -D warnings\n+ GitHub Pages)"]
        GAS_TRACK_STG["gas-tracking.yml\n(measure + compare\nvs. baselines)"]
        LIGHTHOUSE_MERGE["lighthouse.yml\n(update baseline on main)"]
        CI_GATE["pipeline.yml: ci-gate\n(all checks ✅)"]
        STAGING_SMOKE(["Staging smoke tests pass"])
    end

    subgraph PROD["Production Deployment (manual)"]
        direction TB
        PROD_APPROVAL(["Manual approval\n(GitHub Environment: production)"])
        DEPLOY_PROD_WASM["deploy.yml / pipeline.yml:\ndeploy-production\n(Stellar mainnet Wasm)"]
        DEPLOY_PROD_FE["frontend-deploy.yml:\ndeploy-production\n(S3 + CloudFront prod)"]
        TERRAFORM_PROD["terraform.yml: apply-production\n(manual workflow_dispatch)"]
        PROD_LIVE(["Production live ✅"])
    end

    subgraph SCHEDULED["Scheduled / Background"]
        direction TB
        LOAD_TEST["load-test.yml\n(nightly, 1000 users)"]
        DR_MONTHLY["dr-test.yml\n(monthly restore test)"]
        DR_QUARTERLY["dr-failover-test.yml\n(quarterly failover drill)"]
        MUTATION["mutation-testing.yml\n(quarterly cargo-mutants)"]
        FUZZ["fuzz-test.yml\n(daily property + invariant tests)"]
        DRIFT["terraform-drift.yml\n(daily drift detection)"]
        DEPENDABOT["dependabot-auto-merge.yml\n(patch/minor auto-merge)"]
    end

    PR_OPEN --> PR_LINT & PR_TEST & PR_SECURITY & PR_MOBILE & GAS_CHECK & LIGHTHOUSE_PR & PERF_BUDGET & SECURITY_SCAN_PR & CODEQL_PR & CI_PR & CI_BF_PR
    PR_LINT & PR_TEST --> PR_BUILD_WASM
    PR_BUILD_WASM & PR_SECURITY & PR_MOBILE & GAS_CHECK & LIGHTHOUSE_PR & PERF_BUDGET & SECURITY_SCAN_PR & CODEQL_PR & CI_PR & CI_BF_PR --> PR_GATE
    PR_GATE --> MERGE_MAIN

    MERGE_MAIN --> PIPELINE_LINT & PIPELINE_TEST & PIPELINE_FE_TEST & PIPELINE_SAST_RUST & PIPELINE_SAST_CODEQL & PIPELINE_SAST_CONTAINER
    PIPELINE_LINT & PIPELINE_TEST & PIPELINE_SAST_RUST --> PIPELINE_BUILD_WASM
    PIPELINE_FE_TEST & PIPELINE_SAST_CONTAINER --> PIPELINE_BUILD_IMAGE
    PIPELINE_BUILD_WASM & PIPELINE_BUILD_IMAGE --> CI_GATE
    CI_GATE --> DEPLOY_STG
    MERGE_MAIN --> DOCKER_BUILD & FRONTEND_DEPLOY_STG & TERRAFORM_STG & RUSTDOC_STG & GAS_TRACK_STG & LIGHTHOUSE_MERGE
    DEPLOY_STG --> STAGING_SMOKE

    STAGING_SMOKE --> PROD_APPROVAL
    PROD_APPROVAL --> DEPLOY_PROD_WASM & DEPLOY_PROD_FE & TERRAFORM_PROD
    DEPLOY_PROD_WASM & DEPLOY_PROD_FE & TERRAFORM_PROD --> PROD_LIVE

    MERGE_MAIN -.-> LOAD_TEST & FUZZ & DRIFT & DEPENDABOT
    SCHEDULED -.-> DR_MONTHLY & DR_QUARTERLY & MUTATION & LOAD_TEST & FUZZ & DRIFT
```

### Key pipeline properties

- **PR checks are non-blocking incremental**: all PR jobs run in parallel where possible; the branch protection rule requires the `ci-gate` and `pr.yml: build` status checks to pass before merge.
- **Staging is automatic**: every merge to `main` triggers a staging deployment. No manual step is needed.
- **Production is gated**: production deployments require a `workflow_dispatch` event with `environment: production` AND GitHub Environment approval on the `production` environment.
- **Rollback**: `pipeline.yml` includes an automatic `rollback-staging` job that triggers when `deploy-staging` fails.
- **Wasm size enforcement**: the build pipeline hard-fails if the compiled `aura_vault.wasm` exceeds 64 KiB (Soroban's on-chain limit).

---

## 2. Workflow Reference

### `ci.yml` — Unified CI

**File:** `.github/workflows/ci.yml`

**Triggers:**
- `push` on any branch
- `pull_request` on any branch

**Concurrency:** One run per workflow + ref; in-progress runs cancelled on new push.

**Job DAG:**

```
lint (frontend, backend, ui) ──────────────────────────────────┐
unit-tests (rust, backend, ui) ──► migration-tests ──►         │
                                   integration-tests            ├──► summary
build (frontend, backend, rust-wasm) ──► e2e-tests ─────────────┤
security-scan ──────────────────────────────────────────────────┘
```

| Job | What it does |
|-----|--------------|
| `lint` | Runs `npm run lint` (frontend) or `tsc --noEmit` (backend, ui) across three workspaces in parallel via matrix. |
| `unit-tests` | Runs `cargo test` (Rust) and `npm test` (backend, ui) with result artifacts uploaded. Rust matrix entry also builds Wasm first for upgrade tests. |
| `build` | Builds Next.js (frontend), TypeScript (backend), and Wasm (rust-wasm) in a matrix. Artifacts uploaded. |
| `security-scan` | `npm audit --audit-level=high` for all three Node workspaces, `cargo audit` for `aura-vault`. |
| `migration-tests` | Spins up a Postgres 16 service container, runs `vitest run src/tests/migration.test.ts`. Depends on `unit-tests`. |
| `integration-tests` | Scaffold job; add real integration tests under `backend/test/integration/`. Depends on `migration-tests`. |
| `e2e-tests` | Starts Next.js dev server, runs Cypress E2E via `cypress-io/github-action@v6`. Depends on `build`. Screenshots/videos uploaded on failure. |
| `summary` | Downloads all artifacts, prints a status table, and fails the overall run if any required job failed. |

---

### `pipeline.yml` — Comprehensive CI/CD Pipeline

**File:** `.github/workflows/pipeline.yml`

**Triggers:**
- `push` on `main`, `develop`
- `pull_request` on `main`, `develop`
- `workflow_dispatch` with `environment` input (`staging` | `production`)

**Concurrency:** One run per workflow + ref; in-progress runs cancelled.

**Job DAG:**

```
lint ──────────────────────┐
test-contract ─────────────┤
test-frontend ─────────────┤──► build-image ──────────────────────► deploy-staging ──► deploy-production
sast-rust ─────────────────┤
sast-codeql ───────────────┤
sast-container ─────────────┤──► build-wasm ──────────────────────┘
                            └──► ci-gate
```

| Job | What it does |
|-----|--------------|
| `lint` | `cargo fmt --check` + `cargo clippy --all-targets -D warnings` with Cargo cache. |
| `test-contract` | Builds Wasm (required by upgrade tests), then runs `cargo test --test-threads=4`. Uploads `contract-test-results` artifact. |
| `test-frontend` | `npm ci && npm test` for both `ui` and `frontend` workspaces. |
| `sast-rust` | `cargo-audit` (CVE scan) + `cargo-deny` (license + advisories check). |
| `sast-codeql` | GitHub CodeQL analysis on `javascript-typescript` with `security-extended` queries. |
| `sast-container` | Builds Docker image, runs Trivy (`CRITICAL,HIGH`), uploads SARIF. Blocks pipeline on CRITICAL findings. |
| `build-wasm` | Compiles `wasm32-unknown-unknown --release`, enforces 64 KiB Soroban size limit, computes SHA-256 (exposed as output `wasm-sha256`). Artifacts retained 30 days. |
| `build-image` | Logs into GHCR, tags image with `sha-*`, `latest`, `staging`; pushes on `push` / `workflow_dispatch` events only. |
| `deploy-staging` | Downloads Wasm artifact, deploys to Stellar **testnet** using `STAGING_DEPLOY_KEYPAIR`. Runs post-deploy smoke tests. Requires `staging` GitHub Environment. |
| `rollback-staging` | Auto-triggered on `deploy-staging` failure; identifies the previous stable commit and re-deploys it. |
| `deploy-production` | Deploys to Stellar **mainnet** using `PROD_DEPLOY_KEYPAIR`. Requires `workflow_dispatch` with `environment: production` AND manual approval on `production` GitHub Environment. |
| `ci-gate` | Fan-in job: fails if any of `lint`, `test-contract`, `test-frontend`, `sast-rust`, `sast-codeql`, `build-wasm` did not succeed. This is the required status check for branch protection. |

---

### `pr.yml` — PR Checks

**File:** `.github/workflows/pr.yml`

**Triggers:**
- `pull_request` targeting `main` or `develop`

**Jobs:**

| Job | What it does |
|-----|--------------|
| `lint` | `cargo fmt --check` + `cargo clippy -D warnings` on the Rust contract. |
| `test` | `cargo test` — full Rust test suite. |
| `security` | `cargo install cargo-audit --locked && cargo audit`. |
| `build` | Depends on `lint` + `test`. Compiles Wasm, checks size ≤ 64 KiB, uploads `aura-vault-wasm-pr-<number>` artifact (retained 7 days). |
| `mobile-tests` | Builds Next.js, starts production server, runs Playwright against three mobile viewports (`mobile-375`, `mobile-390`, `mobile-414`). Uploads HTML report and screenshots on failure (retained 14 days). |

> **Note:** `mobile-tests` runs in parallel with `lint/test/security/build` since it has no `needs` dependency.

---

### `deploy.yml` — Deploy

**File:** `.github/workflows/deploy.yml`

**Triggers:**
- `push` on `main`
- `workflow_dispatch` with `environment` input (`staging` | `production`)

**Jobs:**

| Job | What it does |
|-----|--------------|
| `test` | `cargo test` — sanity gate before any deployment. |
| `build-wasm` | Builds Wasm, computes SHA-256 (output: `wasm-sha256`), uploads artifact (30-day retention). |
| `build-image` | Builds and pushes Docker image to GHCR with `sha-*`, `latest`, `staging` tags. |
| `deploy-staging` | Deploys Wasm to Stellar **testnet**. Requires `staging` GitHub Environment. Logs commit + hash to step summary. |
| `deploy-production` | Deploys Wasm to Stellar **mainnet**. Requires `workflow_dispatch` with `environment: production` AND `production` GitHub Environment approval. |

---

### `frontend-deploy.yml` — Frontend Deploy + CDN Invalidation

**File:** `.github/workflows/frontend-deploy.yml`

**Triggers:**
- `push` on `main` when `frontend/**` or this workflow file changes
- `workflow_dispatch` with `environment` input and optional `full_invalidation` flag

**Concurrency:** One run per ref; in-progress runs cancelled (avoids partial S3 syncs).

**Jobs:**

| Job | What it does |
|-----|--------------|
| `build` | `npm ci && npm run build` in `frontend/`, uploads `frontend-build-<sha>` artifact (1-day retention). Counts changed files for incremental invalidation decision. |
| `deploy-staging` | AWS OIDC credential assumption (`AWS_STAGING_DEPLOY_ROLE_ARN`). S3 sync with two passes: hashed JS/CSS with 1-year immutable cache-control, HTML with `must-revalidate`. Computes incremental CloudFront invalidation paths (up to `INCREMENTAL_THRESHOLD=50` files; falls back to `/*` beyond that). Waits for invalidation completion. Warns if monthly invalidation count approaches 1000 (CloudFront free tier). |
| `deploy-production` | Same as staging but targeting `PROD_S3_BUCKET` and `PROD_CLOUDFRONT_DISTRIBUTION_ID`. Requires `production` GitHub Environment approval. |

---

### `ci.backend-frontend.yml` — Backend & Frontend CI

**File:** `.github/workflows/ci.backend-frontend.yml`

**Triggers:**
- `push` / `pull_request` on `main`, `develop` when `backend/**`, `frontend/**`, or `package*.json` changes

**Jobs:**

| Job | What it does |
|-----|--------------|
| `lint-backend` | `npm run lint --workspace=backend` (continue-on-error: soft failure). |
| `lint-frontend` | `npm run lint --workspace=frontend` (continue-on-error: soft failure). |
| `test-backend` | Spins up Redis 7 service container, runs `npm run test --workspace=backend` with `REDIS_URL`. |
| `build-backend` | Depends on `lint-backend` + `test-backend`. Runs `npm run build --workspace=backend`. |
| `build-frontend` | Depends on `lint-frontend`. Runs `npm run build --workspace=frontend`. |
| `security-scan` | `npm audit --audit-level=moderate` (continue-on-error). |
| `analyze` | Fan-in gate: fails if any non-security job failed. |

---

### `security-scan.yml` — Security Scanning (Rust)

**File:** `.github/workflows/security-scan.yml`

**Triggers:**
- `push` / `pull_request` on any branch when `aura-vault/**` changes
- Weekly schedule: Monday 02:00 UTC

**Jobs:**

| Job | What it does |
|-----|--------------|
| `security-tests` | Builds Wasm, runs `cargo test security_tests::` with `--test-threads=4`. Fails loudly if any security test fails (grep for `test result: ok`). Also runs the full test suite. |
| `cargo-audit` | Installs `cargo-audit`, produces JSON report, fails on any HIGH or CRITICAL CVE (Python post-processing). |
| `clippy-security` | Clippy with an extended deny list: `unwrap_used`, `expect_used`, `panic`, `integer_arithmetic`, `as_conversions`, `cast_possible_truncation`, `cast_sign_loss`, `indexing_slicing`. |
| `security-gate` | Fan-in: downloads all artifacts, prints summaries, fails if any of the three jobs failed. |

---

### `security-scanning.yml` — Security Scanning (Full Stack)

**File:** `.github/workflows/security-scanning.yml`

**Triggers:**
- `push` / `pull_request` on any branch

**Jobs:**

| Job | What it does |
|-----|--------------|
| `npm-audit` | Matrix across `frontend`, `backend`, `ui`: `npm ci --ignore-scripts && npm audit --audit-level=critical`. Fails on critical findings; uploads JSON reports (14-day retention). |
| `cargo-audit` | Pinned `cargo-audit 0.21.0`; fails on any vulnerability via `--deny warnings`. |
| `trivy-scan` | Matrix across `frontend` and `aura-vault` contexts: builds Docker images, runs Trivy with SARIF output, uploads to GitHub Security tab. Fails on CRITICAL (unfixed included). |
| `semgrep` | Runs Semgrep with rulesets `p/typescript`, `p/javascript`, `p/docker`, `p/secrets`, `p/owasp-top-ten`, `p/nodejs`. Fails on ERROR-level findings. |
| `secret-scanning` | TruffleHog: scans PR diff (`--only-verified --json`) on PRs, full history on pushes. |
| `pr-security-summary` | Runs on PRs after all scan jobs. Posts or updates a sticky comment with a summary table (✅/❌ per tool). Also links to the Security tab and Actions run. |

---

### `trivy-scanning.yml` — Trivy Container Scanning

**File:** `.github/workflows/trivy-scanning.yml`

**Triggers:**
- `push` / `pull_request` on `main`, `develop` when Dockerfiles, `backend/**`, `frontend/**`, or `aura-vault/**` changes
- Weekly schedule: Sunday 02:00 UTC
- `workflow_dispatch`

**Jobs:**

| Job | What it does |
|-----|--------------|
| `trivy-scan` | Builds three images (`aura-backend`, `aura-frontend`, `aura-contract`). Each image is scanned three times: table output (human-readable), JSON output, and SARIF output. SARIF blocks on CRITICAL. All SARIFs uploaded to GitHub Security tab. Results aggregated to step summary. |
| `create-issues-for-high-cves` | Parses Trivy JSON output; creates GitHub issues labelled `security`, `high-cve`, `automated` for each HIGH CVE not already tracked. Deduplicates by issue title. |

---

### `codeql.yml` — CodeQL Analysis

**File:** `.github/workflows/codeql.yml`

**Triggers:**
- `push` / `pull_request` on `main`, `develop`
- Weekly schedule: Sunday 03:00 UTC

**Jobs:**

| Job | What it does |
|-----|--------------|
| `analyze` | Matrix on `javascript-typescript`. Initializes CodeQL with `security-extended,security-and-quality` query suites, excludes `note`/`recommendation`-level findings. Autobuild, then analyze. Results uploaded to GitHub Security tab and as an artifact (14-day retention). |

---

### `gas-tracking.yml` — Gas Tracking

**File:** `.github/workflows/gas-tracking.yml`

**Triggers:**
- `push` on `main`, `develop` when `aura-vault/src/**`, `Cargo.toml/lock`, or baseline/script files change
- `pull_request` on the same paths
- `workflow_dispatch` with optional `update_baselines` boolean

**Jobs:**

| Job | What it does |
|-----|--------------|
| `gas-measure` | Runs `cargo test gas_` with `--test-threads=1` for deterministic measurements. Filters `GAS_MEASURE:` lines from stdout into `gas-measurements.json`. Fails if the file is not produced. Uploads artifact (30-day retention). |
| `gas-compare` | Runs `scripts/compare_gas.py` against `gas-baselines.json`. Produces `gas-report.md`. Exposes `passed` output. |
| `gas-comment` | On PRs: finds existing bot comment (via `peter-evans/find-comment`) and creates or updates it with the gas Markdown report. |
| `update-baselines` | Only on `workflow_dispatch` with `update_baselines: true`: runs `scripts/update_baselines.py`, commits updated `gas-baselines.json` with `[skip ci]` message. |

---

### `gas-regression.yml` — Gas Regression Check

**File:** `.github/workflows/gas-regression.yml`

**Triggers:**
- `push` / `pull_request` on any branch when `aura-vault/src/**`, `Cargo.toml/lock`, or `gas-baselines.json` changes

**Jobs:**

| Job | What it does |
|-----|--------------|
| `gas-check` | Runs `cargo test gas_`, then calls `scripts/check-gas.sh` to compare against baselines. Builds a Markdown PR comment (Python inline script) showing per-function baseline/current/delta table. Posts/updates sticky comment via `marocchino/sticky-pull-request-comment`. Fails if any function exceeds the regression threshold (default: **5%**). |

---

### `lighthouse.yml` — Lighthouse CI / Core Web Vitals

**File:** `.github/workflows/lighthouse.yml`

**Triggers:**
- `push` on `main`, `develop`
- `pull_request` on any branch

**Thresholds enforced:**

| Metric | Threshold |
|--------|-----------|
| Performance score | ≥ 85 |
| LCP | < 2.5 s |
| CLS | < 0.1 |
| FID (max-potential) | < 100 ms |

**Jobs:**

| Job | What it does |
|-----|--------------|
| `build-frontend` | `npm install && npm run build` with `NEXT_TELEMETRY_DISABLED=1`. Uploads `nextjs-build` artifact (1-day retention). |
| `lighthouse` | Restores build artifact, installs `@lhci/cli@0.14.x`, starts Next.js server, runs `lhci autorun` against `/` and `/dashboard` (3 runs). Asserts thresholds from `lighthouserc.json`. Posts sticky PR comment with score table (🟢 ≥ 90, 🟡 ≥ 50, 🔴 < 50). Uploads full LHCI report artifact (30-day retention). |
| `lighthouse-baseline` | On `push` to `main` only: re-runs Lighthouse and uploads to `temporary-public-storage` for baseline comparison. Uploads baseline artifact (90-day retention). |

---

### `terraform.yml` — Terraform Plan / Apply

**File:** `.github/workflows/terraform.yml`

**Triggers:**
- `push` on `main` when `terraform/**` changes
- `pull_request` on `main` when `terraform/**` changes
- `workflow_dispatch` with `environment` input (`staging` | `production`)

**Authentication:** OIDC (`TF_CI_ROLE_ARN`) — no long-lived AWS keys. Backend uses S3 (`TF_STATE_BUCKET`) + DynamoDB locking.

**Jobs:**

| Job | What it does |
|-----|--------------|
| `validate` | Matrix across `remote-state`, `staging`, `production` modules. `terraform fmt -check`, `init -backend=false`, `validate`. |
| `plan` | Depends on `validate`. OIDC credential assumption. `terraform init` with S3 backend config, `terraform plan -out=tfplan`. Posts plan output as PR comment (truncated to 60 KB). Uploads plan artifact (7-day retention). |
| `apply-staging` | Depends on `plan`, runs on `push` to `main`. Downloads plan artifact, applies staging. Requires `staging` GitHub Environment. |
| `apply-production` | Depends on `plan`, runs only on `workflow_dispatch` with `environment: production`. Requires `production` GitHub Environment (manual approval). |

---

### `terraform-drift.yml` — Infrastructure Drift Detection

**File:** `.github/workflows/terraform-drift.yml`

**Triggers:**
- Daily schedule: 06:00 UTC
- `workflow_dispatch` with `auto_remediate` boolean

**Jobs:**

| Job | What it does |
|-----|--------------|
| `drift-check` | AWS credentials via long-lived keys (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). Runs `terraform plan -detailed-exitcode`. Exit code 0 = no drift, 1 = error, 2 = drift detected. Generates `drift_report.txt` with changed resources and attributes. Sends Slack alert on drift (`SLACK_WEBHOOK_URL`). Auto-remediates tag-only drift when `auto_remediate=true`. Creates GitHub issue for non-tag drift requiring manual review. Uploads artifact (30-day retention). |

---

### `load-test.yml` — Load Testing

**File:** `.github/workflows/load-test.yml`

**Triggers:**
- `push` / `pull_request` on `main` when load test source files change
- `workflow_dispatch`
- Nightly schedule: 02:00 UTC

**Acceptance criteria:** API p95 latency < 500 ms at 1000 concurrent users, zero unhandled rejections, error translation p95 < 1 ms.

**Jobs:**

| Job | What it does |
|-----|--------------|
| `load-test-vitest` | `npm run test:load -- --reporter=verbose` in `ui/`. Verifies no `FAIL` or `AssertionError` lines. Uploads results artifact. |
| `load-test-k6-lint` | Installs k6 via APT, validates the k6 script compiles (`k6 run --vus 1 --duration 2s`) without live endpoints. |
| `report` | Fan-in summary: posts job status table to step summary; fails run if vitest load tests failed. |

---

### `dr-test.yml` — Monthly DR Test

**File:** `.github/workflows/dr-test.yml`

**Triggers:**
- Monthly schedule: 1st of month at 04:00 UTC
- `workflow_dispatch`

**Jobs:**

| Job | What it does |
|-----|--------------|
| `dr-test` | Invokes `aura-vault-restore-test-prod` Lambda with log tail. Reads `success` field from response JSON. Fails run if `success != true`. Requires `production` GitHub Environment. |

---

### `dr-failover-test.yml` — Quarterly DR Failover Test

**File:** `.github/workflows/dr-failover-test.yml`

**Triggers:**
- Quarterly schedule: 1st of January, April, July, October at 06:00 UTC
- `workflow_dispatch` with `promote` boolean and `environment` choice

**RPO target:** ≤ 300 seconds (5 minutes)  
**RTO target:** ≤ 30 minutes

**Jobs:**

| Job | What it does |
|-----|--------------|
| `dr-test` | Reads DR config from AWS SSM (`/aura-vault/prod/dr/config`). Checks RDS read replica status in `eu-west-1`. Measures replication lag via CloudWatch (`AWS/RDS ReplicaLag`). Checks Route 53 health check status. Optionally promotes replica to standalone when `promote: true` (measures actual RTO). Publishes results to SNS failover-alerts topic. Uploads `dr_test_results.json` (90-day retention). Posts results table to step summary. Creates GitHub issue on DEGRADED status. |

---

### `mutation-testing.yml` — Mutation Testing

**File:** `.github/workflows/mutation-testing.yml`

**Triggers:**
- `workflow_dispatch`
- Quarterly schedule: 1st of January, April, July, October at 02:00 UTC
- `push` when `aura-vault/src/lib.rs`, `storage.rs`, `fee.rs`, or `errors.rs` changes

**Mutation score threshold:** ≥ 80%

**Jobs:**

| Job | What it does |
|-----|--------------|
| `mutation-testing` | Installs `cargo-mutants --locked`, runs `cargo mutants --output mutants.out --timeout 120`. Counts caught/missed mutants, computes score. Fails if score < 80%. Uploads report + `mutants.out/` directory (30-day retention). |

---

### `fuzz-test.yml` — Fuzz Testing

**File:** `.github/workflows/fuzz-test.yml`

**Triggers:**
- `push` / `pull_request` on `main`, `develop`
- Daily schedule: 02:00 UTC

**Jobs:**

| Job | What it does |
|-----|--------------|
| `fuzz` | Runs `cargo test --lib fuzz` with `PROPTEST_CASES=1000` and `PROPTEST_MAX_SHRINK_ITERS=100000` (property tests). Runs `cargo test --lib invariants` (invariant checks). Runs full `cargo test --lib`. Installs `cargo-tarpaulin` and generates HTML coverage report (continue-on-error). Uploads `coverage-report` artifact. |

---

### `fuzzing-properties.yml` — Property-Based Fuzz Testing

**File:** `.github/workflows/fuzzing-properties.yml`

This workflow is a duplicate of `fuzz-test.yml` with identical configuration. It runs the same property test suite on the same schedule.

---

### `docker-build.yml` — Docker Build & Push

**File:** `.github/workflows/docker-build.yml`

**Triggers:**
- `push` on `main`, `develop` when `backend/**`, `frontend/**`, `Dockerfile.*`, or `docker-compose*.yml` changes
- `pull_request` (opened, synchronize, reopened) on same paths

**Scan-before-push policy:** CRITICAL CVEs from Trivy block the image push.

**Jobs:**

| Job | What it does |
|-----|--------------|
| `build-backend` | Builds `Dockerfile.backend` (loaded locally), scans with Trivy (CRITICAL = `exit-code: 1`), uploads SARIF to Security tab. Pushes to GHCR with branch/semver/sha/latest tags on non-PR events only. |
| `build-frontend` | Same flow as `build-backend` but for `Dockerfile.frontend`. |

**Image tags produced:**
- `<branch>-<sha>` — every push
- `latest` — on default branch
- `x.y.z` / `x.y` — on semver tags

---

### `cypress.yml` — Cypress E2E

**File:** `.github/workflows/cypress.yml`

**Triggers:**
- `push` on `main`, `feature/**`
- `pull_request` on any branch

**Jobs:**

| Job | What it does |
|-----|--------------|
| `cypress` | Matrix across `chrome`, `firefox`, `edge`. Builds Next.js, starts prod server, runs Cypress via `cypress-io/github-action@v6` with `wait-on`. Uploads failure screenshots to `cypress-screenshots-<browser>` artifact. |

---

### `perf-budget.yml` — Frontend Performance Budget

**File:** `.github/workflows/perf-budget.yml`

**Triggers:**
- `push` / `pull_request` on `main`, `develop` when `frontend/**` changes

**Budget thresholds:**

| Bundle | Gzip limit |
|--------|-----------|
| Main JS bundle | 200 kB |
| Per-route chunks | 50 kB each |
| CSS bundle | 20 kB |

**Jobs:**

| Job | What it does |
|-----|--------------|
| `check-bundle-size` | Builds Next.js with `NODE_ENV=production`, runs `npx size-limit --json`. Fails if any limit is exceeded. Posts or updates sticky PR comment with per-bundle size table, limit, and status. Uploads `size-report.json` + `size-report-table.txt` artifact (30-day retention). |

---

### `rustdoc.yml` — Rustdoc

**File:** `.github/workflows/rustdoc.yml`

**Triggers:**
- `push` on `main`, `develop` when `aura-vault/src/**`, `Cargo.toml`, or this workflow file changes
- `pull_request` on `main`, `develop` when `aura-vault/src/**` or `Cargo.toml` changes

**Jobs:**

| Job | What it does |
|-----|--------------|
| `build-docs` | Runs `cargo doc --no-deps` with `RUSTDOCFLAGS=-D warnings` (warnings become errors). Uploads `rustdoc-html-<sha>` artifact (7-day retention). |
| `publish-docs` | On `push` to `main` only. Re-builds docs, adds root redirect to `aura_vault/index.html`, configures GitHub Pages, uploads Pages artifact, deploys to `github-pages` environment. |

---

### `dependabot-auto-merge.yml` — Dependabot Auto-merge

**File:** `.github/workflows/dependabot-auto-merge.yml`

**Triggers:**
- `pull_request` (opened, synchronize, reopened) — only runs when `github.actor == 'dependabot[bot]'`

**Jobs:**

| Job | What it does |
|-----|--------------|
| `auto-merge-patch-minor` | Fetches Dependabot metadata. Enables `gh pr merge --auto --squash` for `semver-patch` and `semver-minor` updates. Merge executes automatically once all CI checks pass. |
| `auto-merge-security` | Fetches metadata; immediately runs `gh pr merge --merge` (not squash, not auto) when the PR is a security advisory (`ghsa-id != ''`, `alert-state == OPEN`, or title contains `[security]`). |

---

## 3. Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions** at the repository level. Environment-scoped secrets (staging, production) should additionally be set in the corresponding GitHub Environment.

| Secret | Used by | Description |
|--------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | `terraform-drift.yml`, `dr-test.yml`, `dr-failover-test.yml` | AWS IAM access key (long-lived; used only where OIDC is not supported). |
| `AWS_SECRET_ACCESS_KEY` | Same as above | AWS IAM secret access key. |
| `AWS_REGION` | All AWS workflows | Default region (typically `us-east-1`). |
| `AWS_STAGING_DEPLOY_ROLE_ARN` | `frontend-deploy.yml` | IAM role ARN assumed via OIDC for staging S3/CloudFront deploys. |
| `AWS_PROD_DEPLOY_ROLE_ARN` | `frontend-deploy.yml` | IAM role ARN assumed via OIDC for production S3/CloudFront deploys. |
| `TF_CI_ROLE_ARN` | `terraform.yml` | IAM role ARN assumed via OIDC for Terraform plan/apply. |
| `TF_STATE_BUCKET` | `terraform.yml` | S3 bucket name for Terraform remote state. |
| `TF_VAR_DB_USERNAME` | `terraform-drift.yml` | Terraform variable: database username. |
| `TF_VAR_SSH_PUBLIC_KEY` | `terraform-drift.yml` | Terraform variable: EC2 SSH public key. |
| `STELLAR_MAINNET_SECRET` | `pipeline.yml`, `deploy.yml` (via `PROD_DEPLOY_KEYPAIR`) | Stellar secret key for mainnet contract deployments. **High sensitivity — store in `production` environment only.** |
| `STELLAR_TESTNET_SECRET` | `pipeline.yml`, `deploy.yml` (via `STAGING_DEPLOY_KEYPAIR`) | Stellar secret key for testnet deployments. Store in `staging` environment. |
| `STAGING_DEPLOY_KEYPAIR` | `pipeline.yml`, `deploy.yml` | Alias/reference for `STELLAR_TESTNET_SECRET`. |
| `PROD_DEPLOY_KEYPAIR` | `pipeline.yml`, `deploy.yml` | Alias/reference for `STELLAR_MAINNET_SECRET`. |
| `CONTRACT_ID_MAINNET` | Application runtime, deploy scripts | On-chain contract address on Stellar mainnet. |
| `CONTRACT_ID_TESTNET` | Application runtime, deploy scripts | On-chain contract address on Stellar testnet. |
| `STAGING_S3_BUCKET` | `frontend-deploy.yml` | S3 bucket name for staging frontend assets. |
| `PROD_S3_BUCKET` | `frontend-deploy.yml` | S3 bucket name for production frontend assets. |
| `STAGING_CLOUDFRONT_DISTRIBUTION_ID` | `frontend-deploy.yml` | CloudFront distribution ID for staging CDN. |
| `PROD_CLOUDFRONT_DISTRIBUTION_ID` | `frontend-deploy.yml` | CloudFront distribution ID for production CDN. |
| `SNYK_TOKEN` | Security scanning (if Snyk is added) | Snyk API token. Not currently used by existing workflows but reserved for future integration. |
| `CODECOV_TOKEN` | Coverage reporting (if Codecov is added) | Codecov upload token. Reserved for future integration. |
| `DOCKERHUB_USERNAME` | Docker Hub push (if used) | Docker Hub username. GHCR (`GITHUB_TOKEN`) is used by current workflows. Reserved. |
| `DOCKERHUB_TOKEN` | Docker Hub push (if used) | Docker Hub access token. Reserved. |
| `SLACK_WEBHOOK_URL` | `terraform-drift.yml` | Incoming webhook URL for Slack drift alerts. |
| `PAGERDUTY_INTEGRATION_KEY` | Incident alerting (reserved) | PagerDuty Events API v2 integration key. |
| `TF_API_TOKEN` | Terraform Cloud (if used) | Terraform Cloud API token. Current workflows use S3 backend directly. Reserved. |
| `LHCI_GITHUB_APP_TOKEN` | `lighthouse.yml` | Lighthouse CI GitHub App token for status check integration. |
| `SEMGREP_APP_TOKEN` | `security-scanning.yml` | Semgrep App token for CI-linked scans (optional; workflows continue without it). |

### Secret rotation recommendations

- Rotate `STELLAR_MAINNET_SECRET` / `PROD_DEPLOY_KEYPAIR` immediately if a production deployment fails unexpectedly or a team member with access departs.
- Rotate AWS IAM keys every 90 days. Prefer OIDC (no long-lived keys) wherever possible — `terraform.yml` and `frontend-deploy.yml` already use OIDC.
- Treat `SLACK_WEBHOOK_URL` and `PAGERDUTY_INTEGRATION_KEY` as sensitive; rotation is low-urgency but should follow security incidents.

---

## 4. Required Environment Variables

These variables must be set in the deployment environment (Vercel, ECS task definition, `.env.production`, or equivalent). They are **not** GitHub Secrets but runtime configuration.

| Variable | Example value | Description |
|----------|---------------|-------------|
| `NODE_ENV` | `production` | Node.js environment. Controls Next.js build optimisations and runtime behaviour. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `mainnet` or `testnet` | Stellar network the frontend connects to. Embedded at build time (`NEXT_PUBLIC_*` is client-side). |
| `NEXT_PUBLIC_CONTRACT_ID` | `CDXXX...` | Deployed Aura Vault contract address. Embedded at build time. |
| `DATABASE_URL` | `postgres://user:pass@host:5432/aura` | PostgreSQL connection string for the backend. Must include credentials; treat as secret in practice. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL used by the backend and load tests. |

### How to set them

**Locally:**
```bash
cp .env.example .env.local
# Edit .env.local with real values
```

**In GitHub Actions** (for workflows that need runtime vars):
```yaml
env:
  NODE_ENV: production
  NEXT_PUBLIC_STELLAR_NETWORK: testnet
  NEXT_PUBLIC_CONTRACT_ID: ${{ secrets.CONTRACT_ID_TESTNET }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  REDIS_URL: ${{ secrets.REDIS_URL }}
```

**In AWS ECS / Fargate:** store `DATABASE_URL` and `REDIS_URL` in AWS Secrets Manager and inject via `secretsFrom` in the task definition.

---

## 5. Deployment Gate Criteria

A commit is blocked from reaching production unless **all** of the following conditions are satisfied.

### Gate 1 — CI Gate (pipeline.yml: `ci-gate`)

All of the following jobs must report `success`:

- `lint` — `rustfmt` and `clippy -D warnings` pass
- `test-contract` — all Rust unit and integration tests pass
- `test-frontend` — all UI and frontend Jest/Vitest tests pass
- `sast-rust` — `cargo-audit` reports zero HIGH/CRITICAL CVEs; `cargo-deny` advisories check passes
- `sast-codeql` — CodeQL finds no new security findings
- `build-wasm` — Wasm compiles and is ≤ 64 KiB

### Gate 2 — Code Coverage ≥ 80%

Mutation testing (`mutation-testing.yml`) requires a mutation score of **≥ 80%** on the core Rust source files (`lib.rs`, `storage.rs`, `errors.rs`). A score below 80% fails the job.

> Coverage from `cargo-tarpaulin` (run inside `fuzz-test.yml`) is uploaded as an artifact. While not currently enforced as a blocking gate in CI, the target line coverage is **≥ 80%** per the project's quality bar.

### Gate 3 — No HIGH or CRITICAL Vulnerabilities

Multiple workflows enforce this:

| Workflow | Enforcement |
|----------|-------------|
| `security-scan.yml` | `cargo-audit` Python check fails on HIGH/CRITICAL CVEs |
| `security-scanning.yml` | `npm audit --audit-level=critical` fails; `cargo audit --deny warnings` fails; Trivy SARIF with `exit-code: 1` on CRITICAL |
| `trivy-scanning.yml` | Trivy SARIF `exit-code: 1` on CRITICAL (unfixed included) |
| `docker-build.yml` | Trivy scan must pass before image is pushed |
| `pipeline.yml: sast-container` | Trivy `exit-code: 1` on CRITICAL/HIGH |

### Gate 4 — Gas Regression ≤ 5%

`gas-regression.yml` measures per-function instruction counts and compares them against `gas-baselines.json`. The `enforce gas threshold` step fails the job if any function regresses by more than the configured threshold (default **5%**). This job runs on every push and PR touching `aura-vault/src/**`.

To update baselines after an intentional gas change:

```bash
# Trigger the update-baselines job
gh workflow run gas-tracking.yml -f update_baselines=true
```

Or manually:

```bash
./scripts/update-gas-baselines.sh
git add gas-baselines.json
git commit -m "chore: update gas baselines"
```

### Gate 5 — Lighthouse Performance Score ≥ 90

`lighthouse.yml` runs Lighthouse CI with thresholds defined in `lighthouserc.json`. The workflow asserts:

| Metric | Minimum |
|--------|---------|
| Performance score | **≥ 85** (workflow threshold) / **≥ 90** (project target) |
| LCP | < 2.5 s |
| CLS | < 0.1 |
| FID (max-potential) | < 100 ms |

> The workflow enforces ≥ 85; the project quality bar is ≥ 90. Update `lighthouserc.json` to raise the assertion to 90 when the frontend consistently meets that threshold.

### Gate 6 — Staging Smoke Tests

`pipeline.yml: deploy-staging` includes a smoke test step after deployment. The pipeline does not proceed toward production promotion until the staging deployment and smoke tests both succeed.

### Summary table

| Gate | Enforced by | Blocking? |
|------|-------------|-----------|
| All CI checks pass | `pipeline.yml: ci-gate` | ✅ Yes — branch protection |
| Coverage ≥ 80% | `mutation-testing.yml` | ✅ Yes — job fails |
| No HIGH/CRITICAL CVEs | Multiple security workflows | ✅ Yes — job fails |
| Gas regression ≤ 5% | `gas-regression.yml` | ✅ Yes — job fails |
| Lighthouse score ≥ 85 (target 90) | `lighthouse.yml` | ✅ Yes — lhci assertion |
| Staging smoke tests pass | `pipeline.yml: deploy-staging` | ✅ Yes — production gate |
| Manual approval | GitHub Environment: production | ✅ Yes — required reviewer |

---

## 6. Running Jobs Locally with `act`

[`act`](https://github.com/nektos/act) allows you to run GitHub Actions workflows locally using Docker. This is useful for iterating on workflow changes without committing to the repository.

### Installation

**macOS (Homebrew):**
```bash
brew install act
```

**Linux:**
```bash
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
# Binary is installed to /usr/local/bin/act
```

**Windows (scoop):**
```powershell
scoop install act
```

**Verify installation:**
```bash
act --version
```

### First-time setup

`act` requires a Docker image. On first run it will prompt you to choose a size:

```bash
act
# Choose "Medium" (nektos/act-environments-ubuntu:20.04) for most workflows
# or "Large" for full parity with GitHub-hosted runners
```

Create a `.secrets` file (git-ignored) for secrets:

```bash
cat > .secrets << 'EOF'
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
STELLAR_TESTNET_SECRET=S...
GITHUB_TOKEN=ghp_...
EOF
```

> Never commit `.secrets`. It is already in `.gitignore`.

### Common `act` commands

**List all available jobs:**
```bash
act --list
```

**Dry-run (show what would execute):**
```bash
act --dryrun
```

**Run the full CI workflow (push event):**
```bash
act push --secret-file .secrets
```

**Run only the Rust lint job from `pipeline.yml`:**
```bash
act push --secret-file .secrets -j lint -W .github/workflows/pipeline.yml
```

**Run PR checks (simulates a pull_request event):**
```bash
act pull_request --secret-file .secrets -W .github/workflows/pr.yml
```

**Run security scanning:**
```bash
act push --secret-file .secrets -W .github/workflows/security-scanning.yml
```

**Run gas regression check:**
```bash
act push --secret-file .secrets -W .github/workflows/gas-regression.yml
```

**Run Lighthouse CI (requires frontend to build):**
```bash
act pull_request --secret-file .secrets -W .github/workflows/lighthouse.yml
```

**Run a workflow_dispatch job with inputs:**
```bash
act workflow_dispatch \
  --secret-file .secrets \
  -W .github/workflows/pipeline.yml \
  --input environment=staging
```

**Run with a specific Docker platform (useful on Apple Silicon):**
```bash
act push --secret-file .secrets --container-architecture linux/amd64
```

**Use the large runner image for full parity:**
```bash
act push --secret-file .secrets \
  -P ubuntu-latest=catthehacker/ubuntu:full-latest \
  -W .github/workflows/ci.yml
```

### Limitations of `act`

- OIDC credential flows (`aws-actions/configure-aws-credentials` with `role-to-assume`) do not work locally. Use static credentials in `.secrets` instead.
- GitHub Pages deployment steps will fail. Skip them: `act push -j build-docs` (skip `publish-docs`).
- `workflow_dispatch` manual approval (GitHub Environments) is not enforced locally — `act` will execute the job directly.
- Some Docker-in-Docker steps (Trivy image scanning) may require `--privileged` or a Docker socket mount.

---

## 7. Branch Protection Rules

Apply the following settings in **Settings → Branches → Branch protection rules** for the `main` branch.

### Required settings for `main`

| Setting | Value | Reason |
|---------|-------|--------|
| **Require a pull request before merging** | ✅ Enabled | No direct pushes to `main`. |
| Required approvals | **1** (minimum; 2 recommended for production paths) | Ensures peer review. |
| Dismiss stale pull request approvals | ✅ Enabled | Re-approval required after new commits. |
| Require review from Code Owners | ✅ Enabled (if `CODEOWNERS` exists) | Ensures domain experts approve relevant changes. |
| **Require status checks to pass before merging** | ✅ Enabled | CI gate enforcement. |
| Status checks — required | See table below | All listed checks must be green. |
| **Require branches to be up to date before merging** | ✅ Enabled | Prevents stale-branch merges. |
| **Require conversation resolution before merging** | ✅ Enabled | No unresolved review comments. |
| **Require signed commits** | ✅ Enabled (recommended) | Cryptographic commit attribution. |
| **Include administrators** | ✅ Enabled | Rules apply to everyone, including admins. |
| **Allow force pushes** | ❌ Disabled | Preserves git history. |
| **Allow deletions** | ❌ Disabled | Prevents accidental branch deletion. |

### Required status checks

These are the exact check names that must be added in GitHub's required status checks UI:

| Status check name | Provided by |
|-------------------|-------------|
| `CI Gate (all checks passed)` | `pipeline.yml: ci-gate` |
| `Lint & Format` | `pr.yml: lint` |
| `Test` | `pr.yml: test` |
| `Security Audit` | `pr.yml: security` |
| `Build Wasm` | `pr.yml: build` |
| `Gas Regression Check` | `gas-regression.yml: gas-check` |
| `Lighthouse CI — Core Web Vitals` | `lighthouse.yml: lighthouse` |
| `Security Gate` | `security-scan.yml: security-gate` |
| `CodeQL Analysis` | `codeql.yml: analyze` |

> Add the `Mobile Viewport Tests (Playwright)` check from `pr.yml: mobile-tests` once Playwright infrastructure is stable.

### Required settings for `develop`

Apply the same rules as `main` with the following adjustments:

- Required approvals: **1**
- Required status checks: same list as `main`
- Allow force pushes: ❌ Disabled
- Include administrators: ✅ Enabled

### GitHub Environments configuration

| Environment | Protection rules |
|-------------|-----------------|
| `staging` | No required reviewers; auto-deploys on merge to `main`. |
| `production` | **Required reviewers** (minimum 1); deployment only via `workflow_dispatch`. Consider adding a wait timer (e.g., 10 minutes) to allow cancellation. |
| `plan` | Used by Terraform plan jobs; no required reviewers. |
| `github-pages` | Used by `rustdoc.yml`; no required reviewers. |

---

*Last updated: 2026-08-24. To propose changes to this document, open a PR modifying `.github/PIPELINE.md`.*

# Dependency Audit Remediation Runbook (Issue #1378)

## Overview

The nightly dependency security audit workflow ([`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml)) reported high or critical vulnerabilities in both `npm-audit` and `cargo-audit`:

- **Issue**: [#1378](https://github.com/soterika/aura-vault-protocol/issues/1378)
- **Workflow Run**: [40477202398](https://github.com/soterika/aura-vault-protocol/actions/runs/40477202398)
- **Status**: `npm: failure`, `cargo: failure`

## Audited Targets

### 1. npm Packages (`npm audit --audit-level=high --json`)
- `backend/` (`npm-audit-backend`)
- `frontend/` (`npm-audit-frontend`)
- `mobile/` (`npm-audit-mobile`)
- `contracts/` (`npm-audit-contracts`)

### 2. Cargo Crates (`cargo audit --json`)
- `aura-vault/` (`cargo-audit-aura-vault`)
- `aura-migration/` (`cargo-audit-aura-migration`)

## Remediation Steps

### Step 1: Retrieve Scanner Artifacts
Download the workflow artifacts from run `40477202398`:
```bash
gh run download 40477202398
```
Inspect the generated JSON reports (`*-npm-audit.json` and `*-cargo-audit.json`) to identify the specific advisories and affected transitive dependencies.

### Step 2: Remediate npm Vulnerabilities
For each affected package directory (`backend`, `frontend`, `mobile`, `contracts`):
```bash
cd <package>
npm audit --audit-level=high
npm audit fix
# If breaking changes are required, review and update major versions explicitly:
# npm audit fix --force
```

### Step 3: Remediate Cargo Vulnerabilities
For each affected crate directory (`aura-vault`, `aura-migration`):
```bash
cd <crate>
cargo audit
cargo update
```
If an advisory has no upstream fix yet and is verified as non-exploitable in this context, document the justification and add a temporary ignore entry in `.cargo/audit.toml` with an expiration/review date.

### Step 4: Verify Clean Audit
Re-run the audit commands locally before pushing:
```bash
for pkg in backend frontend mobile contracts; do
  (cd "$pkg" && npm audit --audit-level=high)
done

for crate in aura-vault aura-migration; do
  (cd "$crate" && cargo audit)
done
```

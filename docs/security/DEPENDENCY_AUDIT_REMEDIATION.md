# Dependency Audit Remediation Runbook

This runbook documents the triage and remediation process for failures reported by `.github/workflows/security-audit.yml` (such as issue #1358).

## Scoped Targets

- **npm packages** (`npm audit --audit-level=high`):
  - `backend/`
  - `frontend/`
  - `mobile/`
  - `contracts/`
- **Cargo crates** (`cargo audit`):
  - `aura-vault/`
  - `aura-migration/`

## Triage Steps

1. **Download scanner artifacts** from the failing GitHub Actions run (`npm-audit-<package>` and `cargo-audit-<crate>`).
2. **Reproduce locally**:
   ```bash
   # npm
   for pkg in backend frontend mobile contracts; do
     (cd "$pkg" && npm audit --audit-level=high)
   done

   # cargo
   for crate in aura-vault aura-migration; do
     (cd "$crate" && cargo audit)
   done
   ```
3. **Remediate**:
   - For npm: run `npm audit fix` (or `npm audit fix --force` only after verifying breaking changes) and commit the updated `package-lock.json` / `package.json`.
   - For Cargo: run `cargo update -p <vulnerable-crate>` (or bump the minimum version in `Cargo.toml`) and commit the updated `Cargo.lock`.
   - If a transitive vulnerability has no upstream fix, document the risk assessment and temporary mitigation in `SECURITY.md` or `.trivyignore` with an expiration date.
4. **Verify**:
   - Re-run `npm audit --audit-level=high` and `cargo audit` locally to confirm zero high/critical findings.
   - Trigger `.github/workflows/security-audit.yml` via `workflow_dispatch` on the PR branch.

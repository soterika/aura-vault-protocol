# Dependency Audit Triage & Remediation

This guide covers triaging and resolving findings from the `.github/workflows/security-audit.yml` workflow (`npm audit` and `cargo audit`).

## Audited Targets

- **npm (`--audit-level=high`)**: `backend`, `frontend`, `mobile`, `contracts`
- **cargo (`cargo audit`)**: `aura-vault`, `aura-migration`

## Downloading Workflow Artifacts

1. Open the failing GitHub Actions run.
2. Download the uploaded JSON reports:
   - `npm-audit-<package>` (`<package>-npm-audit.json`)
   - `cargo-audit-<crate>` (`<crate>-cargo-audit.json`)

## Remediating npm Vulnerabilities

Run inside the affected package directory (`backend`, `frontend`, `mobile`, or `contracts`):

```bash
npm audit --audit-level=high
npm audit fix
```

If a transitive dependency cannot be updated automatically without a breaking major bump:
- Add a targeted `overrides` entry in that package's `package.json` after verifying compatibility.
- Regenerate `package-lock.json` and re-run `npm audit --audit-level=high`.

## Remediating Cargo Vulnerabilities

Run inside the affected crate directory (`aura-vault` or `aura-migration`):

```bash
cargo audit
cargo update -p <vulnerable-crate>
```

If an advisory has no upstream fix or is a false positive for the target platform:
- Document the justification and add an `audit.toml` in the crate directory with `[advisories]` `ignore = ["RUSTSEC-XXXX-XXXX"]`.

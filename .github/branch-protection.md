# Branch Protection Configuration

Apply these settings to the `main` branch in GitHub → Settings → Branches.

## Required status checks (must pass before merge)

- `Lint & Format` (from `pr.yml`)
- `Test` (from `pr.yml`)
- `Security Audit` (from `pr.yml`)
- `Build Wasm` (from `pr.yml`)

## Additional rules

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approving reviews | 1 |
| Dismiss stale reviews on new commits | ✅ |
| Require branches to be up to date before merging | ✅ |
| Do not allow bypassing the above settings | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

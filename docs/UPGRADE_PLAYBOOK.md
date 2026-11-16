# Aura Vault — Contract Upgrade Playbook

> **Issue**: #411  
> **Version**: 0.2.0  
> **Last Updated**: 2026-08-28  
> **Audience**: Vault administrators and protocol engineers

---

## Table of Contents

1. [Overview](#overview)
2. [Pre-Upgrade Checklist](#pre-upgrade-checklist)
3. [Upgrade Commands with Expected Outputs](#upgrade-commands-with-expected-outputs)
4. [State Migration Verification](#state-migration-verification)
5. [Unpause and Smoke Test](#unpause-and-smoke-test)
6. [Rollback Procedure](#rollback-procedure)
7. [Communication Template](#communication-template)
8. [Upgrade Decision Matrix](#upgrade-decision-matrix)

---

## Overview

Aura Vault supports live WASM upgrades via the Soroban `upgrade` mechanism. The admin calls `upgrade(new_wasm_hash)` to replace the contract's executable code while preserving all on-chain state (balances, shares, configuration).

**What is preserved across an upgrade:**
- `total_assets` / `total_deposited`
- `total_shares`
- All user share balances (`balance_of`)
- Admin address
- Token address
- Fee configuration (`perf_fee_bps`, `mgmt_fee_bps`, treasury)
- Version counter (incremented by upgrade)
- Pause state

**What changes:**
- Contract bytecode (WASM)
- `layout_version` (if the new WASM bumps `CURRENT_LAYOUT_VERSION`)

**Authorization**: Only the admin address (set at `initialize()`) can call `upgrade()`. Any other caller receives `VaultError::UpgradeUnauthorized` (error code 9).

**Storage layout guard**: If the new WASM's `CURRENT_LAYOUT_VERSION` does not match the on-chain `layout_version`, the contract returns `VaultError::StorageLayoutMismatch` (error code 10) and the upgrade is aborted.

---

## Pre-Upgrade Checklist

Work through every item before executing any upgrade command on mainnet. Each checkbox must be confirmed by the admin executing the upgrade.

### 1. Code & Build

- [ ] New contract code is merged to `main` and tagged (e.g., `v0.3.0`).
- [ ] All tests pass: `cd aura-vault && cargo test` — confirm **all tests pass** with zero warnings.
- [ ] Release WASM built from the tagged commit: `cargo build --target wasm32-unknown-unknown --release`.
- [ ] WASM binary SHA-256 hash recorded: `sha256sum target/wasm32-unknown-unknown/release/aura_vault.wasm`.
- [ ] Binary is byte-for-byte identical to the testnet-validated binary (compare hashes).

### 2. Testnet Validation

- [ ] Upgrade performed on testnet at least **72 hours** before mainnet.
- [ ] Testnet post-upgrade smoke tests passed (see [Unpause and Smoke Test](#unpause-and-smoke-test)).
- [ ] No unexpected state changes observed on testnet after upgrade.
- [ ] Layout version compatibility confirmed (or migration script executed and verified).

### 3. Security Review

- [ ] Diff between old and new WASM source reviewed by at least one engineer who did not author the change.
- [ ] Any new storage keys added are documented and backward-compatible.
- [ ] No new `unwrap()` or `expect()` calls introduced outside `#[cfg(test)]`.
- [ ] Overflow-check profile still set to `true` in `Cargo.toml`.

### 4. User Notification

- [ ] Upgrade announcement posted in community channels (Discord, Telegram, X/Twitter) — minimum **48 hours** before upgrade.
- [ ] Upgrade announcement posted to GitHub Discussions.
- [ ] Expected downtime window published (default: vault will be paused for ≤ 30 minutes).
- [ ] Support team briefed and on standby.

### 5. Pause Vault

Pause the vault **before** uploading the new WASM. This prevents any deposits, withdrawals, or harvests from executing during the upgrade window.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- pause
```

**Expected output**: Transaction success (no error code).

**Verify pause is active**:
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- is_paused
# Expected: true
```

- [ ] Vault is paused — `is_paused()` returns `true`.
- [ ] Pause TX hash recorded: _______________

### 6. State Backup

Record the pre-upgrade state. This data is used to verify nothing was lost after the upgrade.

```bash
# Record total assets
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- total_assets
# Save output: _______________

# Record current version
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- version
# Save output: _______________

# Record current fee settings
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- get_fees
# Save output: _______________
```

- [ ] `total_assets` recorded: _______________
- [ ] `version` recorded: _______________
- [ ] `get_fees` recorded: _______________

---

## Upgrade Commands with Expected Outputs

Execute these steps in order. Do not skip ahead.

### Step 1: Build the Release WASM

```bash
cd aura-vault
cargo build --target wasm32-unknown-unknown --release
```

**Expected output**:
```
Compiling aura-vault v0.3.0 ...
Finished release [optimized] target(s) in Xs
```

No `warning: unused ...` lines should appear in production code.

```bash
# Verify binary size (should be under 1 MB)
ls -lh target/wasm32-unknown-unknown/release/aura_vault.wasm

# Record SHA-256 hash
sha256sum target/wasm32-unknown-unknown/release/aura_vault.wasm
```

**Expected**: Binary exists, size < 1 MB, hash matches the value from testnet run.

### Step 2: Upload New WASM to Mainnet

```bash
WASM_PATH="./target/wasm32-unknown-unknown/release/aura_vault.wasm"
ADMIN_KEY="S..."   # Mainnet admin keypair

NEW_WASM_HASH=$(stellar contract upload \
  --wasm "$WASM_PATH" \
  --source "$ADMIN_KEY" \
  --network mainnet \
  --output json | jq -r '.wasm_id')

echo "New WASM Hash: $NEW_WASM_HASH"
```

**Expected output**: A 64-character hex string.

```
New WASM Hash: a3f4c8e2...  (64 hex chars)
```

- [ ] WASM hash recorded: _______________
- [ ] WASM hash matches testnet upload hash.

### Step 3: Execute Upgrade

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash "$NEW_WASM_HASH"
```

**Expected output**: Transaction success. No error code in result.

**What happens internally**:
1. Contract verifies caller is admin.
2. Contract checks `CURRENT_LAYOUT_VERSION` in new WASM matches stored `layout_version`.
3. Soroban replaces contract WASM.
4. Version counter is incremented by 1.
5. An `upgrade` event is emitted with the new WASM hash.

- [ ] Upgrade TX hash recorded: _______________
- [ ] No error returned.

### Step 4: Verify Version Increment

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- version
```

**Expected output**: Previous version + 1.

```
# If version was 2 before upgrade:
3
```

- [ ] Version incremented as expected.

---

## State Migration Verification

After the upgrade executes, verify that all critical state is intact and nothing was corrupted.

### Automated Verification Script

```bash
#!/bin/bash
set -e

CONTRACT_ID="<CONTRACT_ID>"
NETWORK="mainnet"

# Pre-upgrade values (fill in from checklist Step 6)
EXPECTED_ASSETS=<RECORDED_TOTAL_ASSETS>
EXPECTED_VERSION_PRE=<RECORDED_VERSION>

echo "=== Post-Upgrade State Verification ==="

# 1. Total assets unchanged
ASSETS=$(stellar contract invoke \
  --id "$CONTRACT_ID" --network "$NETWORK" -- total_assets)
echo "total_assets: $ASSETS (expected: $EXPECTED_ASSETS)"
if [ "$ASSETS" != "$EXPECTED_ASSETS" ]; then
  echo "ERROR: total_assets mismatch!"
  exit 1
fi

# 2. Version incremented by 1
VERSION=$(stellar contract invoke \
  --id "$CONTRACT_ID" --network "$NETWORK" -- version)
EXPECTED_VERSION=$((EXPECTED_VERSION_PRE + 1))
echo "version: $VERSION (expected: $EXPECTED_VERSION)"
if [ "$VERSION" != "$EXPECTED_VERSION" ]; then
  echo "ERROR: version mismatch!"
  exit 1
fi

# 3. Vault is still paused (we haven't unpaused yet)
PAUSED=$(stellar contract invoke \
  --id "$CONTRACT_ID" --network "$NETWORK" -- is_paused)
echo "is_paused: $PAUSED (expected: true)"
if [ "$PAUSED" != "true" ]; then
  echo "WARNING: vault is not paused — was it unpaused prematurely?"
fi

# 4. Fees unchanged
FEES=$(stellar contract invoke \
  --id "$CONTRACT_ID" --network "$NETWORK" -- get_fees)
echo "get_fees: $FEES"

echo "=== Verification PASSED ==="
```

### Manual Verification Checklist

- [ ] `total_assets` matches pre-upgrade recorded value.
- [ ] `version` is exactly `pre_upgrade_version + 1`.
- [ ] `get_fees` returns the same `(perf_fee_bps, mgmt_fee_bps)` as before.
- [ ] `is_paused()` returns `true` (vault still paused from pre-upgrade step).
- [ ] Sample user balance check: run `balance_of` for one known depositor address and confirm it matches the expected value.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- balance_of \
  --address <KNOWN_DEPOSITOR_ADDRESS>
# Should match the value recorded before upgrade
```

- [ ] Sample balance for known depositor confirmed.

---

## Unpause and Smoke Test

Only proceed here after the state migration verification has passed completely.

### Unpause the Vault

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- unpause
```

**Expected output**: Transaction success.

```bash
# Verify
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- is_paused
# Expected: false
```

- [ ] `is_paused()` returns `false`.
- [ ] Unpause TX hash recorded: _______________

### Smoke Tests

Run the following in order against the live mainnet contract to confirm core functionality is working.

#### Test 1: Read total assets (zero-cost, non-mutating)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- total_assets
# Expected: <same as pre-upgrade value>
```

- [ ] Passes ✓

#### Test 2: Test deposit with a small amount

Use the test keypair (not an admin keypair). Deposit a small amount to confirm the contract accepts deposits.

```bash
SMOKE_USER="S..."        # Test user secret key
SMOKE_ADDRESS="G..."     # Test user public key
SMOKE_AMOUNT=1000        # Small token amount

stellar contract invoke \
  --id <CONTRACT_ID> \
  --source "$SMOKE_USER" \
  --network mainnet \
  -- deposit \
  --caller "$SMOKE_ADDRESS" \
  --amount $SMOKE_AMOUNT
```

**Expected output**: Transaction success. No error code.

```bash
# Verify shares were minted
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- balance_of \
  --address "$SMOKE_ADDRESS"
# Expected: > 0
```

- [ ] Deposit succeeds.
- [ ] Share balance > 0 for smoke test user.

#### Test 3: Test withdrawal

```bash
SHARES=$(stellar contract invoke \
  --id <CONTRACT_ID> --network mainnet \
  -- balance_of --address "$SMOKE_ADDRESS")

stellar contract invoke \
  --id <CONTRACT_ID> \
  --source "$SMOKE_USER" \
  --network mainnet \
  -- withdraw \
  --caller "$SMOKE_ADDRESS" \
  --shares $SHARES
```

**Expected output**: Transaction success. Smoke test user's share balance returns to 0.

- [ ] Withdrawal succeeds.
- [ ] Smoke test user share balance is 0 after withdrawal.

#### Test 4: Confirm events emitted

Check the Stellar block explorer for the contract address. Verify:
- `upgrade` event present with the new WASM hash.
- `deposit` event present from the smoke test deposit.
- `withdraw` event present from the smoke test withdrawal.

- [ ] Events visible on block explorer.

### Upgrade Complete

- [ ] All smoke tests passed.
- [ ] Post-upgrade announcement sent to community channels (see [Communication Template](#communication-template)).

---

## Rollback Procedure

If any step fails — state mismatch, unexpected error, smoke test failure — follow this procedure.

### Decision: When to Roll Back

Roll back immediately if any of the following are true:
- `total_assets` does not match the pre-upgrade value.
- `version` is not `pre_upgrade_version + 1`.
- `deposit()` or `withdraw()` returns an unexpected error after unpausing.
- Any user reports loss of funds.

Do **not** roll back for minor UI issues or non-critical cosmetic bugs. Rolling back has its own risks.

### Rollback Steps

#### Step 1: Re-pause the vault (if already unpaused)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- pause
```

This stops any further state changes while you investigate.

#### Step 2: Confirm the issue

Document exactly what failed:
- Which verification check failed?
- What was the actual vs. expected value?
- Is this a logic bug, a data corruption, or an environment issue?

#### Step 3: Upload the previous WASM

You must have the previous WASM binary available. Retrieve it from the tagged release in the repository.

```bash
git checkout <PREVIOUS_TAG>    # e.g., v0.2.0
cd aura-vault
cargo build --target wasm32-unknown-unknown --release

PREV_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  --output json | jq -r '.wasm_id')

echo "Previous WASM Hash: $PREV_WASM_HASH"
```

> **Note**: If the previous WASM was already uploaded to mainnet (which it was for the initial deployment), the upload command will return the existing WASM hash immediately without consuming resources.

#### Step 4: Execute the rollback upgrade

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash "$PREV_WASM_HASH"
```

**Expected output**: Transaction success.

#### Step 5: Verify rollback

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- version
# Expected: pre-failed-upgrade version + 2
# (each upgrade call, including the rollback, increments version)
```

Confirm `total_assets` and user balances are correct.

#### Step 6: Unpause (only if rollback verified)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- unpause
```

#### Step 7: Post-incident report

Within 24 hours of a rollback, post a public incident report covering:
- What failed and why.
- Which users were affected (if any).
- What state changes (if any) occurred before rollback.
- Remediation plan for the next upgrade attempt.

---

## Communication Template

### Pre-Upgrade Announcement (Post ≥ 48 hours before)

> **[MAINTENANCE] Aura Vault upgrade scheduled — [DATE] [TIME] UTC**
>
> We will be upgrading the Aura Vault contract to version [NEW_VERSION] on [DATE] at approximately [TIME] UTC.
>
> **What to expect:**
> - The vault will be **paused** during the upgrade window (estimated 15–30 minutes).
> - Deposits, withdrawals, and harvests will be temporarily unavailable.
> - All balances and shares are fully preserved. No action is required from depositors.
>
> **What is changing:**
> [Brief bullet list of changes in the new version]
>
> **Contract**: `<CONTRACT_ID>`  
> **New WASM**: The new WASM hash will be published in this thread after deployment.
>
> Questions? Join #support on Discord or open a GitHub Discussion.

---

### Post-Upgrade Confirmation (Post immediately after smoke tests pass)

> **[COMPLETE] Aura Vault upgraded to v[NEW_VERSION]**
>
> The upgrade has completed successfully.
>
> **Summary:**
> - Vault is unpaused and accepting deposits/withdrawals.
> - All balances preserved — no user action required.
> - New WASM hash: `<NEW_WASM_HASH>`
> - Upgrade TX: `<UPGRADE_TX_HASH>`
>
> **What changed:**
> [Same bullet list as pre-announcement]
>
> Full changelog: [link to CHANGELOG.md]  
> Report issues: #support on Discord or GitHub Issues.

---

### Rollback Announcement (Post immediately if rollback occurs)

> **[INCIDENT] Aura Vault upgrade rolled back — investigating**
>
> We encountered an issue during today's upgrade to v[NEW_VERSION] and have rolled back to v[PREV_VERSION].
>
> **Current status:** Vault is paused while we investigate. All funds are safe.
>
> **What happened:** [Brief, factual description of the failure]
>
> We will post a full incident report within 24 hours and reschedule the upgrade after the issue is resolved.
>
> We apologise for the extended downtime.

---

## Upgrade Decision Matrix

Use this matrix to determine the appropriate upgrade path.

| Scenario | Action | Timelock | Announcement |
|---|---|---|---|
| Critical security bug (funds at risk) | Emergency upgrade; pause first | None | Immediate after pause |
| High-severity bug (no fund risk) | Expedited upgrade; 24h notice | None | 24h pre + post |
| New feature / non-breaking change | Standard upgrade | 48h | 48h pre + post |
| Storage layout change (migration needed) | Extended process; test migration first | 7 days | 7 days pre + post |
| Contract version bump only | Standard upgrade | 48h | 48h pre + post |

---

*See [/docs/DEPLOYMENT.md](DEPLOYMENT.md) for initial deployment procedures. See [/GOVERNANCE.md](../GOVERNANCE.md) for governance approval requirements before upgrades.*

# Network Upgrade Coordination Guide

**Aura Vault Protocol — Issue #421**
Last updated: 2026-08-24

---

## Overview

Stellar protocol upgrades — including Soroban VM changes, ledger parameter adjustments, and SDF validator votes — can affect the Aura Vault contract's behavior, gas costs, and storage TTLs. This guide documents how to monitor, test, communicate, verify, and if necessary roll back through a network upgrade event.

---

## 1. Monitoring SDF Announcements

### Primary Sources

| Source | URL | Check Frequency |
|---|---|---|
| SDF Blog | `https://stellar.org/blog` | Daily during upgrade windows |
| SDF GitHub — stellar-core | `https://github.com/stellar/stellar-core/releases` | Subscribe to release notifications |
| Soroban Changelog | `https://github.com/stellar/rs-soroban-env/blob/main/CHANGELOG.md` | Subscribe to repo notifications |
| Stellar Developers Discord | `#protocol-updates` channel | Real-time |
| SDF Twitter / X | `@StellarOrg`, `@StellarDevs` | Real-time |
| Stellar Stack Exchange | `https://stellar.stackexchange.com` | Weekly |

### What to Watch For

These categories of change require action before a mainnet upgrade:

- **Soroban VM host function changes** — any added, removed, or semantically changed host functions used by the vault (token transfers, auth, storage)
- **Ledger parameter changes** — max entry TTL, min TTL, base fee adjustments, max instructions per transaction
- **SEP changes** — particularly SEP-41 (token interface) which the vault depends on
- **Wasm size / instruction limits** — if tightened, the vault Wasm may need optimization
- **Storage schema changes** — DataKey layout compatibility, entry expiration behavior
- **Auth / account model changes** — impacts `require_auth()` calls in deposit/withdraw/harvest

### Tracking Sheet

Maintain a living table in the team's project tracker:

| Upgrade | Target Date | Affects Vault? | Action Required | Owner | Status |
|---|---|---|---|---|---|
| Protocol vXX | YYYY-MM-DD | Yes / No / TBD | Description | @name | Pending |

---

## 2. Pre-Upgrade Testing on Futurenet

Futurenet runs the next protocol version before it reaches Testnet or Mainnet, making it the primary environment for pre-upgrade validation.

### 2.1 Environment Setup

```bash
# Add Futurenet network config to Stellar CLI
stellar network add futurenet \
  --rpc-url https://rpc-futurenet.stellar.org \
  --network-passphrase "Test SDF Future Network ; October 2022"

# Verify connectivity
stellar network ls
```

### 2.2 Pre-Upgrade Test Checklist

Run these steps on Futurenet against a freshly deployed vault instance before every protocol upgrade that may affect the vault:

**Build**
- [ ] `cargo test` passes — all 22 unit and integration tests green
- [ ] `cargo build --target wasm32-unknown-unknown --release` succeeds with zero warnings
- [ ] Wasm binary size is within the network's max Wasm size limit

**Deploy to Futurenet**
```bash
# Upload Wasm to Futurenet
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source <test-keypair> \
  --network futurenet

# Deploy instance
stellar contract deploy \
  --wasm-hash <hash> \
  --source <test-keypair> \
  --network futurenet

# Initialize
stellar contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network futurenet \
  -- initialize \
  --admin <admin-address> \
  --underlying_token <token-id>
```

**Functional Smoke Tests**
- [ ] `initialize` — deploys cleanly; double-init returns `AlreadyInitialized`
- [ ] `deposit` — mints correct shares; first depositor gets 1:1 ratio
- [ ] `withdraw` — burns shares, returns correct underlying amount
- [ ] `harvest` — injects yield, increases exchange rate, emits event
- [ ] `pause` / `unpause` — admin can pause; operations reject with `VaultPaused`; unpause restores
- [ ] `balance_of` / `total_assets` — return correct values after state changes
- [ ] Flash loan guard — balance mismatch scenario triggers `suspicious` event and `BalanceMismatch`
- [ ] TTL extension — storage entries have TTL > threshold after each mutating call

**Gas / Fee Validation**
- [ ] Transaction fees are within acceptable bounds (budget 2× current mainnet fees as buffer)
- [ ] Instruction counts have not regressed significantly from baseline

**Edge Cases**
- [ ] Zero-amount deposit returns `ZeroAmount`
- [ ] Withdraw more than balance returns `InsufficientShares`
- [ ] Harvest with zero total shares returns `ZeroShares`
- [ ] Math overflow scenarios handled correctly

### 2.3 Regression Baseline

Before each upgrade cycle, record the current mainnet metrics as baseline:

```bash
# Record baseline values
stellar contract invoke --id <mainnet-contract-id> --network mainnet -- total_assets
stellar contract invoke --id <mainnet-contract-id> --network mainnet -- is_paused
```

Compare Futurenet test results against this baseline.

---

## 3. User Communication — 48-Hour Minimum Notice

All network upgrades that may affect vault operations require user notification at least **48 hours** before the upgrade window.

### Communication Channels (in order of priority)

1. **In-app banner** — Engineering deploys a prominent notice on the vault UI
2. **Discord `#announcements`** — pinned message with full details
3. **Twitter / X** — concise summary with link to full notice
4. **Email list** — for users who opted into upgrade notifications
5. **Docs site** — create or update a `network-status` entry

### Notice Template

```
🔔 Upcoming Stellar Network Upgrade — Action May Be Required

The Stellar network will upgrade to Protocol vXX on [DATE] at approximately [TIME] UTC.

**What is changing:**
[1-3 bullet points describing relevant changes]

**Impact on Aura Vault:**
[Low / Medium / High] — [one sentence explanation]

**What you should do:**
- [Action if required, e.g., "No action needed — the vault will continue operating normally."]
- [Or: "We recommend completing any pending withdrawals before [TIME] UTC."]

**Expected downtime:**
[None / Approximately X minutes while ledger upgrades]

**We will post a follow-up once the upgrade is confirmed complete.**

Questions? Ask in #support or open a GitHub issue.
```

### Timing

| T-minus | Action |
|---|---|
| T-7 days | Internal team aware; Futurenet testing begins |
| T-48 hours | Public notice posted on all channels |
| T-24 hours | Reminder posted on Discord |
| T-4 hours | Final reminder; on-call engineer confirmed available |
| T-0 | Upgrade window begins; monitoring heightened |
| T+1 hour | Post-upgrade verification begins (see Section 4) |
| T+2 hours | Status update posted regardless of outcome |

---

## 4. Post-Upgrade Verification Checklist

Execute these checks within 1 hour of the upgrade completing. Use a dedicated Testnet or Futurenet instance as a sanity check before declaring Mainnet healthy.

### 4.1 On-Chain State Integrity

- [ ] `total_assets()` returns the same value as before the upgrade
- [ ] Spot-check 3–5 user `balance_of` values match pre-upgrade records
- [ ] `is_paused()` returns `false` (vault was not accidentally paused by upgrade)
- [ ] Storage entries are not expired (TTL still valid)

### 4.2 Functional Smoke Test (Testnet)

Run a quick end-to-end flow on Testnet post-upgrade:

```bash
# Deposit
stellar contract invoke --id <testnet-id> --network testnet \
  -- deposit --caller <test-address> --amount 1000000

# Check balance
stellar contract invoke --id <testnet-id> --network testnet \
  -- balance_of --id <test-address>

# Withdraw
stellar contract invoke --id <testnet-id> --network testnet \
  -- withdraw --caller <test-address> --shares <share-amount>

# Harvest
stellar contract invoke --id <testnet-id> --network testnet \
  -- harvest --caller <test-address> --yield_amount 100000
```

- [ ] Deposit succeeded and emitted `deposit` event
- [ ] Withdraw succeeded and returned correct underlying amount
- [ ] Harvest succeeded and emitted `harvest` event
- [ ] No unexpected error codes

### 4.3 Backend / UI Checks

- [ ] API returns correct `total_assets` and share balances
- [ ] APY calculation is consistent with pre-upgrade baseline
- [ ] Transaction history displays correctly for recent transactions
- [ ] No elevated error rates in API logs

### 4.4 Fee / Performance Checks

- [ ] Transaction fees on Mainnet are within expected range
- [ ] No instruction count limit errors in recent transactions

### 4.5 Sign-Off

Post in `#announcements` and `#engineering`:

```
✅ Post-upgrade verification complete — Protocol vXX

All checks passed. The vault is operating normally.
Verified by: @engineer
Time: [UTC timestamp]
```

---

## 5. Rollback Plan

The vault Wasm is upgradeable via the `upgrade` contract function (admin-only). A rollback means redeploying the previous Wasm hash.

### 5.1 Pre-Upgrade Preparation

Before every upgrade, record and store:

```bash
# Store the current Wasm hash (get from deployment records or Stellar Expert)
PREVIOUS_WASM_HASH="<hash-of-current-deployed-wasm>"

# Verify the previous Wasm is still uploaded on-chain
stellar contract info --id <contract-id> --network mainnet
```

Keep the compiled `.wasm` artifact for the current production version in a tagged GitHub release so it can be re-uploaded if needed.

### 5.2 Rollback Trigger Criteria

Initiate rollback if any of the following occur after an upgrade:

- Any core function (`deposit`, `withdraw`, `harvest`) fails with an unexpected error on Mainnet
- `BalanceMismatch` events fire without a known cause (possible state corruption)
- User funds appear inaccessible with no clear path to recovery
- Backend cannot decode contract events after upgrade
- Post-upgrade verification checklist has any unresolved failures after 30 minutes

### 5.3 Rollback Procedure

```bash
# Step 1: Pause the vault immediately to stop further state changes
stellar contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network mainnet \
  -- pause

# Step 2: (If needed) Re-upload the previous Wasm to the network
stellar contract upload \
  --wasm <path-to-previous-release.wasm> \
  --source <admin-keypair> \
  --network mainnet
# Record the returned hash as ROLLBACK_WASM_HASH

# Step 3: Invoke the upgrade function with the previous Wasm hash
stellar contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash <ROLLBACK_WASM_HASH>

# Step 4: Run the post-upgrade verification checklist

# Step 5: If verification passes, unpause
stellar contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network mainnet \
  -- unpause
```

### 5.4 Post-Rollback Communication

```
⚠️ Aura Vault — Upgrade Rolled Back

We encountered [brief description of issue] following the Protocol vXX upgrade and have reverted 
to the previous contract version as a precaution.

**Your funds are safe.** The vault is [paused / operational].

We are investigating and will post a full update within [2 / 4] hours.

We apologize for the disruption.
```

### 5.5 Post-Incident Review

After any rollback event, hold a post-mortem within 5 business days:

1. Root cause analysis
2. Why Futurenet testing did not catch the issue
3. Updated test cases to cover the failure mode
4. Updated rollback runbook if the procedure revealed gaps

---

## 6. Contact and Ownership

| Role | Responsibility | Contact |
|---|---|---|
| Protocol Upgrade Owner | Coordinates the full upgrade process | @protocol-lead |
| On-Call Engineer | Available during upgrade window and for 2 hours after | Rotation schedule in team calendar |
| Community Lead | Drafts and posts user communications | @community-lead |
| Security Lead | Reviews upgrade for security implications | @security-lead |

Upgrade windows should always have at least **two engineers available** — one executing, one monitoring.

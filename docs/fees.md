# Aura Vault — Fee Structure & Revenue Model

> **Issue**: #408  
> **Version**: 0.2.0  
> **Last Updated**: 2026-08-28

---

## Table of Contents

1. [Overview](#overview)
2. [Fee Types](#fee-types)
3. [Fee Calculation Examples](#fee-calculation-examples)
4. [Fee Recipient](#fee-recipient)
5. [Governance Process for Fee Changes](#governance-process-for-fee-changes)
6. [Historical Fee Rate Table](#historical-fee-rate-table)
7. [Comparison with Competing Protocols](#comparison-with-competing-protocols)
8. [Gas Fees](#gas-fees)
9. [Future Fee Features](#future-fee-features)
10. [Technical Reference](#technical-reference)

---

## Overview

Aura Vault uses a **dual-fee model** designed to align incentives between protocol sustainability and user value. Fees are transparent, on-chain, and configurable by governance within fixed bounds.

| Fee Type | Rate Range | Applied On |
|---|---|---|
| Performance Fee | 10% – 20% | Yield injected via `harvest()` |
| Management Fee | 0% – 1% per year | Total assets (daily accrual) |

There are **no deposit fees** and **no withdrawal fees**. Users only pay fees on the yield they earn.

All fee parameters are stored in contract instance storage and queryable by anyone at zero cost via `get_fees()`.

---

## Fee Types

### Performance Fee (10–20%)

Collected each time a keeper calls `harvest()` to inject yield into the vault.

**How it works:**
1. A keeper submits a yield amount to the vault.
2. The contract deducts the performance fee from the yield before crediting the vault's total assets.
3. The net yield increases `total_assets`, raising the share price for all holders.
4. The fee accrues in the `TotalFeeCollected` storage slot.

**Formula:**
```
perf_fee      = yield_amount × perf_fee_bps / 10,000
yield_to_vault = yield_amount − perf_fee
new_total_assets = old_total_assets + yield_to_vault
```

**Bounds enforced by contract:**
- Minimum: 1000 bps (10%)
- Maximum: 2000 bps (20%)

The contract rejects any `set_fees()` call outside these bounds.

---

### Management Fee (0–1% per year)

A time-based annual fee accrued daily as a fraction of total assets under management.

**How it works:**
1. Each day, a small fee is calculated against the vault's current `total_assets`.
2. The fee accrues in the `TotalFeeCollected` storage slot.
3. The `LastMgmtFeeTime` timestamp is updated on each accrual.

**Formula:**
```
daily_fee = total_assets × mgmt_fee_bps / 10,000 / 365
```

**Bounds enforced by contract:**
- Minimum: 0 bps (0%)
- Maximum: 100 bps (1%)

At the current default rate of **0% management fee**, no management fee is charged.

---

### No Deposit or Withdrawal Fee

Deposit and withdraw operations do not charge any protocol fee. Users receive or redeem shares at the exact share formula output:

- **Deposit**: `shares = floor(amount × total_shares / total_assets)` (or 1:1 for the first depositor)
- **Withdraw**: `amount = floor(shares × total_assets / total_shares)`

The only value reduction on withdrawal is rounding down to the nearest integer (a Soroban arithmetic property, not a fee).

---

## Fee Calculation Examples

### Example 1: 15% Performance Fee on a Single Harvest

```
State before:
  total_assets    = 10,000 tokens
  total_fee       = 0 tokens
  perf_fee_bps    = 1500 (15%)

Keeper calls harvest(yield_amount = 2,000):
  perf_fee        = 2,000 × 1500 / 10,000 = 300 tokens
  yield_to_vault  = 2,000 − 300 = 1,700 tokens
  total_assets    = 10,000 + 1,700 = 11,700 tokens
  total_fee       = 0 + 300 = 300 tokens

User with 500 shares (out of 10,000 total):
  redeemable      = 500 × 11,700 / 10,000 = 585 tokens  (was 500 before harvest)
  yield earned    = 585 − 500 = 85 tokens
```

### Example 2: 20% Performance Fee Over Multiple Harvests

```
Day 1: harvest(1,000) at 20% fee
  fee = 200, vault += 800 → total_assets = 10,800

Day 2: harvest(500) at 20% fee
  fee = 100, vault += 400 → total_assets = 11,200
  cumulative fees = 300

Day 3: Admin withdraws accumulated fees
  transfer(vault → treasury, 300)
  total_fee_collected resets to 0
```

### Example 3: 0.5% Annual Management Fee

```
total_assets = 1,000,000 tokens
mgmt_fee_bps = 50 (0.5%)

Annual fee  = 1,000,000 × 50 / 10,000 = 5,000 tokens
Daily fee   = 5,000 / 365 ≈ 13.7 tokens per day
Monthly fee ≈ 410 tokens
```

### Basis Points Quick Reference

| Percentage | Basis Points |
|---|---|
| 0.01% | 1 |
| 0.1% | 10 |
| 0.5% | 50 |
| 1% | 100 |
| 10% | 1,000 |
| 15% | 1,500 |
| 20% | 2,000 |

---

## Fee Recipient

Collected fees are transferred to the **treasury address** configured by the admin via `set_treasury()`.

The treasury address is public and readable on-chain:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- get_fees
```

**Current treasury address**: To be published at mainnet deployment.  
**Fee withdrawal**: Only the admin can call `withdraw_fees()`, which transfers the entire `TotalFeeCollected` balance to the treasury in a single atomic transaction.

### Transparency Commitments

- The treasury address is stored in contract instance storage and visible to anyone.
- The cumulative fees collected since genesis are readable via `total_fees_collected()` at zero cost.
- Fee withdrawals emit on-chain events and are visible in any Stellar block explorer.
- The protocol commits to publishing quarterly treasury reports on GitHub.

---

## Governance Process for Fee Changes

Fee parameters can only be changed by the vault admin. In the current version (0.2.0), this is a multisig admin address. Once on-chain governance is live, changes will require a community proposal.

### Current Process (v0.2.0)

1. **Proposal**: A change is proposed publicly in the GitHub Discussions forum or a community call.
2. **Comment period**: Minimum 7 days of public comment.
3. **Admin execution**: If consensus is reached, the admin calls `set_fees(new_perf_bps, new_mgmt_bps)` on-chain.
4. **Announcement**: The change is announced in community channels with the TX hash.

### Contract-Enforced Limits

The contract enforces hard limits that **cannot be bypassed** regardless of who the admin is:

| Parameter | Minimum | Maximum |
|---|---|---|
| `perf_fee_bps` | 1000 (10%) | 2000 (20%) |
| `mgmt_fee_bps` | 0 (0%) | 100 (1%) |

A call to `set_fees()` with values outside these ranges will return `VaultError::InvalidAddress` and revert.

### Future On-Chain Governance

See [/GOVERNANCE.md](../GOVERNANCE.md) for the planned governance system including proposal mechanics, voting power, quorum, and timelock.

---

## Historical Fee Rate Table

| Date | Performance Fee | Management Fee | Changed By | TX Hash |
|---|---|---|---|---|
| 2026-06-04 (v0.1.0) | 15% (1500 bps) | 0% (0 bps) | Genesis | — |
| 2026-08-28 (v0.2.0) | 15% (1500 bps) | 0% (0 bps) | No change | — |

*This table will be updated on every fee change. All changes are verifiable on the Stellar block explorer.*

---

## Comparison with Competing Protocols

The following comparison reflects publicly documented rates as of 2026-08. All figures are approximate.

| Protocol | Chain | Performance Fee | Management Fee | Withdrawal Fee | Notes |
|---|---|---|---|---|---|
| **Aura Vault** | Stellar/Soroban | 10–20% | 0–1% | None | Bounded by contract |
| Yearn Finance (v3) | Ethereum | 10–20% | 0–2% | None | Strategy-variable |
| Beefy Finance | Multi-chain | 4.5–9.5% | None | 0.1% | Betoken buyback |
| Convex Finance | Ethereum | 16% | 0% | None | Curve-focused |
| Sommelier | Cosmos | 0–20% | 0–2% | 0–5% | Strategist-set |
| Idle Finance | Ethereum | 10–15% | 0–1.5% | None | Per-strategy |

**Key differentiators for Aura Vault:**
- **No withdrawal fee** — users always redeem at the full share value.
- **Bounded fees** — the contract makes it impossible to set performance fees above 20% or management fees above 1%, even for the admin. This is a hard security property, not a policy.
- **Gas efficiency** — fee accounting is embedded in the harvest operation; no separate accrual transaction is needed.

---

## Gas Fees

Gas fees on Stellar/Soroban are paid in XLM (Stellar's native token) per operation, not per contract function call. They are set by the Stellar network and not controlled by Aura Vault.

**Typical gas costs** (Stellar Testnet, approximate):
- `deposit()`: ~0.0001 XLM
- `withdraw()`: ~0.0001 XLM
- `harvest()`: ~0.0002 XLM (includes fee accounting)
- `get_fees()`, `total_assets()`, `balance_of()`: free (read-only)

Gas costs on mainnet vary with network congestion. The protocol does not profit from gas fees.

---

## Future Fee Features

The following fee-related features are on the protocol roadmap:

| Feature | Description | Status |
|---|---|---|
| Strategy fee split | Performance fees split between protocol treasury and individual strategy operators | Planned |
| Fee discount tiers | Reduced fees for large depositors or governance token holders | Under consideration |
| Referral fee share | A portion of fees directed to referring integrators | Planned |
| Streaming management fee | Continuous (per-block) management fee accrual instead of daily | Planned |

Community feedback on these features is welcome in GitHub Discussions.

---

## Technical Reference

### Contract Functions

| Function | Description | Auth |
|---|---|---|
| `set_fees(perf_fee_bps, mgmt_fee_bps)` | Update fee parameters | Admin only |
| `set_treasury(address)` | Update fee recipient | Admin only |
| `withdraw_fees()` | Transfer collected fees to treasury | Admin only |
| `get_fees()` | Read current `(perf_bps, mgmt_bps)` | Public |
| `total_fees_collected()` | Read cumulative fees | Public |

### Storage Keys

| Key | Type | Description |
|---|---|---|
| `Treasury` | Address | Fee recipient address |
| `PerfFeeBps` | u32 | Performance fee in bps |
| `MgmtFeeBps` | u32 | Management fee in bps |
| `TotalFeeCollected` | i128 | Cumulative fees since genesis |
| `LastMgmtFeeTime` | u64 | Timestamp of last mgmt fee accrual |

### Querying Fees On-Chain

```bash
# Get current fee rates
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- get_fees
# Returns: (perf_fee_bps: u32, mgmt_fee_bps: u32)

# Get total fees collected
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- total_fees_collected
# Returns: i128

# Set fees (admin only)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- set_fees \
  --perf_fee_bps 1500 \
  --mgmt_fee_bps 0
```

### Running Fee Tests

```bash
cd aura-vault
cargo test fee
cargo test --lib   # all tests
```

---

*For integration examples see [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md). For governance of fee parameters see [/GOVERNANCE.md](../GOVERNANCE.md).*

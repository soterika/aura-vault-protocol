# Vault Share Math

This document explains the share pricing model used by Aura Vault: how shares are minted on deposit, burned on withdrawal, how yield increases the exchange rate, and how the design defends against inflation attacks.

---

## Table of Contents

1. [Core Concept](#1-core-concept)
2. [State Variables](#2-state-variables)
3. [First Deposit — Seed Ratio](#3-first-deposit--seed-ratio)
4. [Deposit Formula](#4-deposit-formula)
5. [Withdraw Formula](#5-withdraw-formula)
6. [Rounding Direction and Why Floor Protects the Vault](#6-rounding-direction-and-why-floor-protects-the-vault)
7. [Performance Fee](#7-performance-fee)
8. [Worked Example: 3 Depositors, 2 Harvests, Multiple Withdrawals](#8-worked-example-3-depositors-2-harvests-multiple-withdrawals)
9. [Inflation Attack — Scenario and Prevention](#9-inflation-attack--scenario-and-prevention)
10. [Summary of Invariants](#10-summary-of-invariants)

---

## 1. Core Concept

Aura Vault is a **share-based vault**. Instead of tracking each depositor's token balance directly, the vault tracks:

- `total_assets` — the total number of underlying tokens currently held by the vault (including accrued yield).
- `total_shares` — the total number of shares issued across all depositors.

A depositor's claim on the vault is:

```
user_tokens = floor(user_shares × total_assets / total_shares)
```

When yield is harvested, `total_assets` increases but `total_shares` does not. This means each existing share is now worth more tokens — all depositors benefit proportionally without any on-chain loop.

---

## 2. State Variables

| Variable | Storage | Type | Description |
|---|---|---|---|
| `total_assets` (a.k.a. `total_deposited`) | Instance | `i128` | Sum of all deposited tokens plus net harvested yield |
| `total_shares` | Instance | `i128` | Sum of all outstanding vault shares |
| `balance(addr)` | Persistent per address | `i128` | Share balance of a specific depositor |
| `perf_fee_bps` | Instance | `u32` | Performance fee in basis points (default: 1000 = 10%) |
| `decimals` | Instance (`DataKey::Decimals`) | `u32` | Number of decimal places used by vault shares (set at initialization, immutable; default: 7) |

All values are in **stroops** (1 token = 10^decimals base units, e.g. 10,000,000 stroops for a 7-decimal token like XLM or USDC on Stellar). The share precision is configured at initialization via `DataKey::Decimals` and exposed publicly via `decimals() -> u32`. The formulas operate on raw integer units scaled to `10^decimals`.

---

## 3. First Deposit — Seed Ratio

When the vault has no shares (`total_shares == 0`) or no assets (`total_assets == 0`), the first depositor receives shares **equal to their deposit amount**:

```
new_shares = amount          (when total_shares == 0 OR total_assets == 0)
```

This 1:1 seed ratio sets the initial exchange rate. For example, depositing 1,000,000 stroops (0.1 USDC) gives exactly 1,000,000 shares.

**Why 1:1?**  
Any other seed ratio is arbitrary. 1:1 is the natural choice: the exchange rate starts at exactly 1 token per share, making the initial state easy to reason about.

---

## 4. Deposit Formula

For all subsequent deposits (when `total_shares > 0` and `total_assets > 0`):

```
new_shares = floor(amount × total_shares / total_assets)
```

**Where:**
- `amount` — tokens being deposited (in stroops)
- `total_shares` — shares outstanding *before* this deposit
- `total_assets` — tokens in vault *before* this deposit

**Implementation (from `lib.rs`):**

```rust
let numerator = amount
    .checked_mul(total_shares)
    .ok_or(VaultError::MathOverflow)?;
let new_shares = numerator
    .checked_div(total_deposited)
    .ok_or(VaultError::MathOverflow)?;
```

The `floor` is implicit in integer division (Rust's `/` operator truncates toward zero for positive integers).

**Zero-share guard:**  
If `new_shares == 0` after the calculation (possible when `amount` is very small relative to `total_assets`), the deposit is rejected with `VaultError::ZeroAmount`. This prevents dust deposits that would gift value to existing shareholders.

---

## 5. Withdraw Formula

Burning `shares` redeems:

```
redeem_amount = floor(shares × total_assets / total_shares)
```

**Where:**
- `shares` — number of shares being burned
- `total_assets` — tokens in vault *before* this withdrawal
- `total_shares` — shares outstanding *before* this withdrawal

**Implementation (from `lib.rs`):**

```rust
let numerator = shares
    .checked_mul(total_deposited)
    .ok_or(VaultError::MathOverflow)?;
let redeem_amount = numerator
    .checked_div(total_shares)
    .ok_or(VaultError::MathOverflow)?;
```

After computing `redeem_amount`, the contract:
1. Subtracts `shares` from `user_balance` and `total_shares`.
2. Subtracts `redeem_amount` from `total_assets`.
3. Transfers `redeem_amount` tokens to the caller.

---

## 6. Rounding Direction and Why Floor Protects the Vault

Both formulas use **floor (truncation toward zero)**. This is intentional and critical.

### Deposit — floor on `new_shares`

When rounding down the shares minted, the depositor receives slightly *fewer* shares than their exact proportional contribution. The tiny remainder stays in the vault, slightly benefiting existing shareholders. This is acceptable and standard.

If instead we rounded **up** on deposit, the depositor could receive shares representing slightly *more* than they deposited, draining fractional value from the vault over many deposits.

### Withdraw — floor on `redeem_amount`

When rounding down the tokens redeemed, the caller receives slightly *fewer* tokens than the exact value of their shares. The tiny remainder stays in the vault.

If instead we rounded **up** on withdrawal, repeated micro-withdrawals could slowly drain more than the depositor is owed.

### The invariant

Floor rounding on both sides ensures:

```
total_assets ≥ sum of all individual redemption values
```

The vault can always satisfy all outstanding withdrawal claims. The small fractional dust accumulates as a rounding buffer that further protects solvency.

---

## 7. Performance Fee

When yield is harvested, a performance fee is deducted before crediting `total_assets`:

```
fee_amount     = floor(yield_amount × perf_fee_bps / 10000)
yield_net      = yield_amount - fee_amount
total_assets   += yield_net          (not += yield_amount)
fees_collected += fee_amount
```

The default `perf_fee_bps` is **1000** (10%). The fee accrues in a separate counter (`total_fees_collected`) and does not affect the share/asset ratio until the admin calls `withdraw_fees`, which transfers the accumulated fees to the treasury.

**Effect on exchange rate:**  
Only `yield_net` enters `total_assets`, so the 10% performance fee reduces the yield-driven appreciation of shares. With a 10% fee, a 100-token yield event increases `total_assets` by 90 tokens (and puts 10 tokens aside for the treasury).

---

## 8. Worked Example: 3 Depositors, 2 Harvests, Multiple Withdrawals

This example uses whole tokens (not stroops) for readability. All arithmetic is integer arithmetic with floor division. The performance fee is 10% (1000 bps).

### Initial state

```
total_assets = 0
total_shares = 0
```

---

### Event 1 — Alice deposits 1,000 tokens

Condition: `total_shares == 0` → seed ratio applies.

```
new_shares = 1,000

Alice's shares  = 1,000
total_shares    = 1,000
total_assets    = 1,000
exchange rate   = 1,000 / 1,000 = 1.000 token/share
```

---

### Event 2 — Bob deposits 500 tokens

```
new_shares = floor(500 × 1,000 / 1,000) = floor(500.000) = 500

Bob's shares    = 500
total_shares    = 1,500
total_assets    = 1,500
exchange rate   = 1,500 / 1,500 = 1.000 token/share
```

At equal exchange rate, Bob gets exactly proportional shares — expected.

---

### Event 3 — Harvest 1: keeper injects 150 tokens of yield

```
fee_amount   = floor(150 × 1000 / 10000) = floor(15.0) = 15
yield_net    = 150 - 15 = 135

total_assets  = 1,500 + 135 = 1,635
total_shares  = 1,500        (unchanged)
fees_collected = 15

exchange rate = 1,635 / 1,500 ≈ 1.090 token/share
```

Both Alice and Bob now hold shares worth more tokens. No new shares were minted.

---

### Event 4 — Carol deposits 300 tokens

```
new_shares = floor(300 × 1,500 / 1,635)
           = floor(450,000 / 1,635)
           = floor(275.229...)
           = 275

Carol's shares  = 275
total_shares    = 1,775
total_assets    = 1,935
exchange rate   = 1,935 / 1,775 ≈ 1.090 token/share
```

Carol pays the current (higher) exchange rate — she gets fewer shares per token than the early depositors did, correctly reflecting that she joined after yield accrued.

---

### Event 5 — Harvest 2: keeper injects 200 tokens of yield

```
fee_amount   = floor(200 × 1000 / 10000) = 20
yield_net    = 200 - 20 = 180

total_assets  = 1,935 + 180 = 2,115
total_shares  = 1,775
fees_collected = 15 + 20 = 35

exchange rate = 2,115 / 1,775 ≈ 1.191 token/share
```

---

### Event 6 — Alice withdraws all 1,000 shares

```
redeem_amount = floor(1,000 × 2,115 / 1,775)
              = floor(2,115,000 / 1,775)
              = floor(1,191.549...)
              = 1,191

Alice receives 1,191 tokens (deposited 1,000 → +19.1% net of fees)

total_shares  = 1,775 - 1,000 = 775
total_assets  = 2,115 - 1,191 = 924
exchange rate = 924 / 775 ≈ 1.192 token/share  (tiny rounding bump for remaining holders)
```

---

### Event 7 — Bob withdraws 200 shares (partial)

```
redeem_amount = floor(200 × 924 / 775)
              = floor(184,800 / 775)
              = floor(238.451...)
              = 238

Bob receives 238 tokens for 200 shares

total_shares  = 775 - 200 = 575
total_assets  = 924 - 238 = 686
exchange rate = 686 / 575 ≈ 1.193 token/share
```

Bob still holds 300 shares worth approximately `floor(300 × 686 / 575) = floor(357.9...) = 357` tokens.

---

### Event 8 — Admin withdraws fees

```
fees_collected = 35
Treasury receives 35 tokens.
fees_collected = 0
```

Note: Fees are tracked separately from `total_assets`. The `withdraw_fees` call transfers tokens from the vault balance to the treasury but does not alter `total_assets` (which was already net of fees from the harvest step).

---

### Final state summary

| Participant | Deposited | Shares held | Approx. tokens at exit | Net return |
|---|---|---|---|---|
| Alice | 1,000 | 0 (exited) | 1,191 | +19.1% |
| Bob | 500 | 300 | ~357 remaining | — |
| Carol | 300 | 275 | ~327 (est.) | — |
| Treasury (fees) | — | — | 35 | — |

---

## 9. Inflation Attack — Scenario and Prevention

### What is an inflation attack?

A share-vault inflation attack exploits the first-deposit seed ratio to manipulate the exchange rate before other depositors arrive. The classic attack:

1. Attacker is the **first depositor**. With `total_shares == 0`, they deposit 1 stroop and receive 1 share.
2. Attacker **directly sends** a large number of tokens to the vault contract address without calling `deposit`. This inflates `total_assets` without minting shares.
3. A victim deposits a normal amount (e.g., 100 tokens). The share formula computes `floor(100_tokens × 1_share / huge_total_assets)` → **0 shares**. The deposit is rejected or rounds to 0, and the attacker's single share now backs all the assets.

### How Aura Vault prevents it

Aura Vault uses a two-layer defense:

**Layer 1 — Flash loan guard (balance check)**

Before executing `deposit`, `withdraw`, or `harvest`, the contract reads the vault's actual on-chain token balance and compares it to `total_deposited`:

```rust
let balance_before = token.balance(&env.current_contract_address());
if balance_before != total_deposited {
    // emit suspicious event
    return Err(VaultError::BalanceMismatch);
}
```

If someone sends tokens directly to the contract (bypassing `deposit`), `balance_before > total_deposited`, the guard triggers, and all three entry points are blocked. This also blocks same-transaction flash loan manipulation.

**Layer 2 — Zero-share rejection fence**

Even if the guard were somehow bypassed, if the computed `new_shares == 0` (because the deposit amount rounds down to zero shares given the inflated exchange rate), the contract rejects the deposit:

```rust
if new_shares <= 0 {
    return Err(VaultError::ZeroAmount);
}
```

This prevents the victim from silently losing their deposit.

### Defense in depth

| Attack vector | Blocked by |
|---|---|
| Direct token transfer to inflate `total_assets` | Flash loan guard (BalanceMismatch) |
| Flash loan to temporarily inflate balance | Flash loan guard (BalanceMismatch) |
| Tiny deposit that rounds to 0 shares | Zero-share rejection (ZeroAmount) |
| Arithmetic overflow in share computation | `checked_mul` / `checked_div` (MathOverflow) |

---

## 10. Summary of Invariants

The contract maintains the following invariants at the end of every transaction:

1. **Solvency:** `total_assets ≤ actual vault token balance + fees_collected`
2. **Share backing:** Every outstanding share is backed by `total_assets / total_shares` tokens.
3. **Balance consistency:** `actual_balance == total_assets + fees_collected` (guaranteed by the flash loan guard at the start of each mutating call).
4. **Monotonic exchange rate (during harvest):** Each harvest strictly increases `total_assets / total_shares` (net of fees), never decreasing it.
5. **No value extraction via rounding:** Floor division on both deposit and withdraw ensures dust stays in the vault, never gifting more than owed.

---

*Issues: [#386](https://github.com/soterika/aura-vault-protocol/issues/386)*

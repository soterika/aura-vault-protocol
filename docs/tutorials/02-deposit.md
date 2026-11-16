# How to Deposit into Aura Vault

**Estimated time:** 3 minutes  
**What you'll learn:** How to deposit underlying tokens into the vault, receive vault shares, and confirm the transaction was successful.

---

## Before You Start

- Complete the [Getting Started](./01-getting-started.md) guide so your wallet is set up and you are on the correct page.
- Make sure your wallet holds enough of the **underlying token** to deposit. You also need a small amount of XLM to cover network fees.
- Decide how many tokens you want to deposit. The minimum is any amount greater than zero that results in at least one share being minted (see [How Shares Work](#how-shares-work) below).

---

## Walkthrough

### 1 — Select the Deposit Tab

On the main page, click the **Deposit** tab button in the navigation row. The active tab is highlighted. The Deposit panel loads and shows:

- A heading: **Deposit**
- A numeric input labelled **Amount**
- A **Deposit** button

### 2 — Enter an Amount

Click the **Amount** input field (placeholder text shows `0.00`).

Type the number of tokens you want to deposit. For example: `100`

Rules the form enforces:
- The value must be a number greater than `0`.
- Decimal values are allowed (the field accepts `step="any"`).
- If you submit with an empty or invalid value, a red error message appears beneath the field: *"Enter a valid amount greater than 0."* Correct the value and try again.

### 3 — Click Deposit

Click the **Deposit** button. Two things happen immediately:

1. The form is replaced by a **loading skeleton** (three placeholder rows) while the transaction is being processed.
2. Your wallet extension will prompt you to **review and sign** the transaction. Check:
   - The contract being called matches the Aura Vault contract address.
   - The function is `deposit`.
   - The amount shown matches what you entered.

Approve the transaction in your wallet.

### 4 — Confirm Success

After the transaction is confirmed on-chain (typically a few seconds on Stellar), the loading skeleton disappears and a **green success toast** appears at the bottom of the screen:

> *"Deposited 100 tokens successfully."*

The Amount field resets to empty, ready for another deposit.

If something goes wrong, an **error message** appears in the panel instead of the toast (see [Troubleshooting](./05-troubleshooting-and-security.md)).

---

## How Shares Work

When you deposit, the vault mints **shares** proportional to your contribution:

- **First depositor:** receives shares at a 1:1 ratio (100 tokens → 100 shares).
- **Subsequent depositors:** receive `floor(amount × total_shares / total_assets)` shares. As yield accrues, the same number of tokens buys fewer shares — but each share is worth more.

Your shares represent your ownership stake in the vault. More shares = larger claim on the vault's total assets when you withdraw.

> **Why might I get fewer shares than tokens I deposited?**  
> This is expected behaviour. If the vault has already accrued yield, total assets exceed the original deposits, so new deposits buy into a higher-priced pool. Your shares will still redeem for more than you paid in, assuming yield continues to accrue.

> **What is a "ZeroAmount" error?**  
> If the number of tokens you deposit is so small that the share calculation rounds down to zero, the vault rejects the transaction with `ZeroAmount` (error 5). Deposit a larger amount.

---

## What Happens On-Chain

The `deposit(caller, amount)` function on the vault contract:

1. Verifies the vault is not paused.
2. Checks the actual on-chain token balance matches `total_deposited` (flash loan guard).
3. Transfers `amount` tokens from your wallet to the vault.
4. Calculates and mints shares to your address.
5. Updates `total_assets` in storage.
6. Emits a `deposit` event.
7. Extends storage TTL (keeps your balance record alive on-chain for 30 days).

---

## Next Steps

- [03 — How to Withdraw](./03-withdraw.md) — redeem your shares for tokens
- [04 — Dashboard Overview](./04-dashboard.md) — check your share balance and vault stats

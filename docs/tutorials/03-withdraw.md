# How to Withdraw from Aura Vault

**Estimated time:** 3 minutes  
**What you'll learn:** How to burn vault shares and receive underlying tokens (plus any accrued yield) back to your wallet.

---

## Before You Start

- You must have previously [deposited](./02-deposit.md) and hold vault shares.
- Know how many shares you want to redeem. You can check your balance using `balance_of` (see [Dashboard Overview](./04-dashboard.md)).
- Have a small amount of XLM available for network fees.

---

## Walkthrough

### 1 — Select the Withdraw Tab

Click the **Withdraw** tab button in the navigation row. The Withdraw panel loads and shows:

- A heading: **Withdraw**
- A numeric input labelled **Shares**
- A **Withdraw** button

### 2 — Enter the Number of Shares to Redeem

Click the **Shares** input field (placeholder text: `0.00`).

Type the number of shares you want to burn. For example: `50`

Validation rules:
- Must be a number greater than `0`.
- Decimals are accepted.
- Leaving the field empty or entering zero displays: *"Enter a valid share amount greater than 0."*

> **How many tokens will I receive?**  
> The vault calculates: `floor(shares × total_assets / total_shares)`. If the vault has earned yield since your deposit, each share redeems for more than the original deposit price. You receive principal + accrued yield proportional to your shares.

### 3 — Click Withdraw

Click the **Withdraw** button. The form is replaced by a loading skeleton and your wallet prompts you to sign the transaction. Verify:

- Contract address matches Aura Vault.
- Function is `withdraw`.
- Share amount matches what you entered.

Approve in your wallet.

### 4 — Confirm Success

Once confirmed on-chain, the loading skeleton disappears and a green toast appears:

> *"Withdrew 50 shares successfully."*

The underlying tokens (plus yield) are now in your wallet. The Shares field resets to empty.

---

## Understanding the Redemption Rate

The token amount you receive depends on the vault's current exchange rate at the time of withdrawal — not the rate at deposit time. This means:

- If yield has been harvested into the vault since your deposit, you receive **more tokens per share** than you put in.
- If no yield has been added, you receive exactly what your shares were worth at deposit.

There is **no lock-up period**. You can withdraw at any time as long as the vault is not paused.

---

## Common Errors During Withdrawal

| Error | Cause | Fix |
|-------|-------|-----|
| `InsufficientShares` (3) | You entered more shares than you own | Check your balance and enter a lower amount |
| `InsufficientUnderlying` (4) | Vault cannot cover the redemption | Vault may be temporarily low on liquidity; try a partial withdrawal or wait |
| `ZeroAmount` (5) | Zero shares entered | Enter a number greater than 0 |
| `VaultPaused` (11) | Admin has paused the vault | Wait for the vault to be unpaused; check announcements |
| `BalanceMismatch` (12) | Flash loan guard triggered | Do not retry immediately; report to the team |

---

## What Happens On-Chain

The `withdraw(caller, shares)` function:

1. Verifies the vault is not paused.
2. Checks the actual on-chain token balance matches `total_deposited` (flash loan guard).
3. Verifies caller holds enough shares.
4. Calculates token amount: `floor(shares × total_assets / total_shares)`.
5. Burns the shares.
6. Transfers tokens from the vault to your wallet.
7. Updates `total_assets` in storage.
8. Emits a `withdraw` event.
9. Extends storage TTL.

---

## Next Steps

- [04 — Dashboard Overview](./04-dashboard.md) — verify your updated balance after withdrawal
- [05 — Troubleshooting & Security](./05-troubleshooting-and-security.md) — what to do if something goes wrong

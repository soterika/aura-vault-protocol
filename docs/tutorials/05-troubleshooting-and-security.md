# Troubleshooting & Security Best Practices

**Estimated time:** 10 minutes  
**What you'll learn:** How to diagnose and fix common errors, what every error code means, and how to keep your funds secure.

---

## Error Reference

Every contract error has a numeric code and a variant name. When an error occurs, the UI shows a dismissible error card with a Retry option.

| Code | Variant | What it means | What to do |
|------|---------|---------------|------------|
| 1 | `NotInitialized` | Vault has not been initialized yet | Contract was not set up correctly; contact the admin |
| 2 | `AlreadyInitialized` | `initialize` called more than once | No action needed; this protects against re-initialization |
| 3 | `InsufficientShares` | You tried to withdraw more shares than you own | Check your balance with `balance_of` and enter a lower amount |
| 4 | `InsufficientUnderlying` | Vault does not have enough tokens to cover your withdrawal | Try a smaller withdrawal; if the issue persists, contact the admin |
| 5 | `ZeroAmount` | Deposited amount is zero, or share calculation rounded to zero | Enter a larger amount |
| 6 | `MathOverflow` | Arithmetic overflow in share formula | The amount entered is extremely large; enter a smaller value |
| 7 | `InvalidAddress` | Reserved for future address validation | Should not appear in normal usage |
| 8 | `ZeroShares` | Harvest attempted on an empty vault | The vault has no depositors; wait for a deposit before harvesting |
| 9 | `UpgradeUnauthorized` | Non-admin tried to upgrade the contract | You do not have admin privileges |
| 10 | `StorageLayoutMismatch` | On-chain storage layout version does not match upgrade | Contact the admin; do not retry |
| 11 | `VaultPaused` | A mutating operation was called while the vault is paused | Wait for the admin to unpause the vault; check the project's announcements |
| 12 | `BalanceMismatch` | Flash loan guard: actual token balance differs from tracked state | Do **not** retry. Stop transacting and contact the admin immediately |

---

## Common Issues

### "Enter a valid amount greater than 0"

This is a client-side validation error — the transaction was never sent. The field is empty, contains text, or contains zero. Type a positive number and try again.

### Transaction spinner never stops

The loading skeleton stays visible while the transaction is in flight. If it does not resolve after 30–60 seconds:

1. Check the [Stellar network status](https://stellar.org/blog) for outages.
2. Open your browser's developer console (F12 → Console) and look for network errors.
3. Check that your wallet approved the transaction — some wallets time out silently if not approved quickly.
4. Refresh the page. The transaction may have succeeded on-chain even if the UI did not update.

### Wallet did not prompt me to sign

- Make sure your wallet extension is installed and unlocked.
- Check that the wallet is set to the correct network (Testnet or Mainnet to match the contract).
- Try refreshing the page and submitting again.
- Some wallets require you to click the extension icon before they respond to page requests.

### I deposited but my shares seem wrong

Share amounts decrease in token-per-share terms as yield accrues — this is expected. See [How Shares Work](./02-deposit.md#how-shares-work). To verify the exact math:

```
shares_received = floor(amount × total_shares / total_assets)
```

Run `total_assets` and `total_shares` read calls to get current values, then verify the calculation yourself.

### I withdrew but received fewer tokens than I deposited

This should not happen if yield has been harvested. Check:

1. Whether `harvest` has been called since your deposit (if not, exchange rate is still 1:1 minus any rounding).
2. Whether you withdrew all your shares or only part of them.
3. Whether fees apply (check the `FEE_SYSTEM.md` in the project root).

### `BalanceMismatch` error (code 12)

This is the flash loan guard triggering. It means the vault's actual on-chain token balance does not match its internal accounting. **This is a serious anomaly.** Stop all transactions and contact the protocol team immediately. Do not retry.

---

## Security Best Practices

### Protect Your Private Keys

- Never share your private key or seed phrase with anyone, including support staff.
- Never enter your seed phrase into a website or app.
- Use a hardware wallet for large amounts.
- Store your seed phrase offline on paper in a secure location.

### Verify Before You Sign

Every time your wallet prompts you to sign a transaction, check:

1. **Contract address** — confirm it matches the published Aura Vault contract ID. Bookmark the official address.
2. **Function name** — should be `deposit`, `withdraw`, or `harvest` depending on what you are doing.
3. **Amount** — confirm it matches what you entered in the UI.

If anything looks wrong, **reject the transaction** and do not retry until you understand what happened.

### Avoid Phishing

- Only access Aura Vault through the bookmarked URL. Never click links in emails, Discord messages, or Twitter/X posts.
- The official app will **never** ask for your seed phrase or private key.
- Check the browser address bar every time you open the app. Phishing sites often use domains that differ by one character (e.g. `aura-vau1t.app` vs `aura-vault.app`).

### Use the Correct Network

Testnet and Mainnet are separate. Testnet tokens have no real value. Before depositing real funds:

1. Confirm your wallet is on **Mainnet**.
2. Confirm the contract ID matches the Mainnet deployment (see `DEPLOYMENT_GUIDE.md`).
3. Start with a small test deposit before depositing large amounts.

### Understand the Pause Mechanism

The admin can pause the vault at any time, halting all deposits, withdrawals, and harvests. When the vault is paused:

- Your funds are safe — they remain in the vault.
- You cannot transact until the vault is unpaused.
- Monitor the project's official channels for announcements.

To check the current pause state:

```bash
stellar contract invoke \
  --id <contract-id> \
  --network mainnet \
  -- is_paused
```

### Keep Browser and Extensions Updated

- Always use the latest version of your browser and wallet extension.
- Enable automatic updates for your wallet.
- On public or shared computers, never use your real wallet.

### Watch for Suspicious Events

The vault emits a `suspicious` event when a `BalanceMismatch` is detected. If you monitor the vault on-chain, treat this event as an immediate alert. Check the [monitoring setup](../../monitoring/) for Prometheus/Grafana alerting.

---

## Getting Help

If you encounter an issue not covered here:

1. Check `SUPPORT_FAQ.md` in the project root for additional Q&A.
2. Review open and closed issues in the GitHub repository.
3. Reach out through the project's official support channel.

When reporting an issue, include:
- The exact error message or code
- Your browser and OS
- The transaction ID if the wallet provided one
- Steps to reproduce

---

## Related Docs

- [01 — Getting Started](./01-getting-started.md)
- [02 — How to Deposit](./02-deposit.md)
- [03 — How to Withdraw](./03-withdraw.md)
- [04 — Dashboard Overview](./04-dashboard.md)

# Getting Started with Aura Vault

For local setup failures, see the [troubleshooting guide](troubleshooting.md).

Aura Vault is a yield-generating vault on the Stellar network. You deposit tokens, receive vault shares, and your shares automatically grow in value as the vault earns yield — no manual compounding required.

> **New to crypto?** Start with [Step 1](#step-1--install-a-wallet). If you already have Freighter installed and funded, jump to [Step 2](#step-2--connect-your-wallet).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1 — Install a Wallet](#step-1--install-a-wallet)
3. [Step 2 — Connect Your Wallet](#step-2--connect-your-wallet)
4. [Step 3 — Make Your First Deposit](#step-3--make-your-first-deposit)
5. [Step 4 — Monitor Your Portfolio](#step-4--monitor-your-portfolio)
6. [Step 5 — Withdraw](#step-5--withdraw)
7. [Understanding Vault Shares](#understanding-vault-shares)
8. [Fee Structure](#fee-structure)
9. [FAQ](#faq)

---

## Prerequisites

Before you start you need:

| What | Why | Where to get it |
|---|---|---|
| A Stellar wallet (Freighter recommended) | To sign transactions and hold tokens | [freighter.app](https://www.freighter.app) |
| A small amount of XLM | To pay Stellar network fees (~0.1 XLM per transaction) | Any crypto exchange |
| The vault's underlying token | The asset you deposit to earn yield | Shown on the app homepage |

> **Testnet tip:** Switch Freighter to **Testnet** and use [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) to create a funded test account — no real money needed while you learn.

---

## Step 1 — Install a Wallet

**Freighter** is the most widely supported browser extension wallet for Stellar.

### Installing Freighter

1. Visit [freighter.app](https://www.freighter.app) in Chrome, Firefox, or Edge.
2. Click **Add to Browser** (or your browser's equivalent install button).
3. Pin the extension to your toolbar for easy access.

### Creating a new wallet

1. Click the Freighter icon in your toolbar.
2. Click **Create New Wallet**.
3. Choose a strong password — this protects your wallet on this device.
4. Write down your **12-word seed phrase** on paper and store it somewhere safe offline.
   > ⚠️ Never photograph or type your seed phrase anywhere. Anyone who has it controls your funds.
5. Confirm the seed phrase when prompted.
6. Your wallet is ready. Your Stellar address starts with `G...`.

### Importing an existing wallet

1. Click **Import Wallet** and enter your 12 or 24-word seed phrase.
2. Choose a password for this device.

### Switching to Testnet (for practice)

1. Click the Freighter icon → Settings (⚙️) → Network.
2. Select **Test SDF Network / Sep 2015** (Testnet).
3. The Freighter header will show **TESTNET** in orange.

---

## Step 2 — Connect Your Wallet

1. Open the Aura Vault app in your browser.
2. Click **Connect Wallet** in the top-right corner.

   > *Screenshot placeholder: top-right Connect Wallet button highlighted*

3. A Freighter popup appears — review the site permission and click **Connect**.
4. Your wallet address (e.g. `GABC…XY`) appears in the header next to the network badge.

   > *Screenshot placeholder: connected wallet address and TESTNET badge in header*

### Troubleshooting connection

| Symptom | Fix |
|---|---|
| "Wrong Network" warning | Open Freighter → Settings → Network → switch to the correct network |
| Freighter popup never appears | Disable popup blockers for this site; make sure the extension is enabled |
| Address not appearing after click | Refresh the page and try again; check Freighter is unlocked |

---

## Step 3 — Make Your First Deposit

1. Once connected, the **Deposit** panel appears on the main page.

   > *Screenshot placeholder: Deposit panel with amount field*

2. Enter the amount of tokens you want to deposit in the **Amount** field.
   - Minimum: any amount > 0, but deposits under ~10 tokens may round to 0 shares.
   - Start with a small amount while you are learning.

3. Click **Deposit**.

   > *Screenshot placeholder: Deposit button highlighted*

4. A transaction preview appears — review the details:
   - **Amount**: tokens you are depositing
   - **Estimated shares**: vault shares you will receive
   - **Network fee**: XLM cost (usually < 0.01 XLM)

5. Click **Approve** in the Freighter popup.

   > *Screenshot placeholder: Freighter approval popup*

6. Wait 5–10 seconds for the transaction to confirm on Stellar.
7. Your **Share Balance** updates below the form once confirmed.

   > *Screenshot placeholder: updated share balance after deposit*

### What happens on-chain

- Your tokens are transferred from your wallet to the vault contract.
- The vault mints vault shares proportional to your deposit and the current exchange rate.
- Your share balance is stored on the Stellar ledger.

---

## Step 4 — Monitor Your Portfolio

After connecting your wallet the **Portfolio** section shows:

| Field | What it means |
|---|---|
| **Total Vault Assets** | Total tokens held by the vault across all depositors |
| **Your Share Balance** | Number of vault shares you own |
| **Price Per Share** | Current value of one share in underlying tokens |
| **Your Underlying Value** | Your shares × price per share = your redeemable tokens |

> *Screenshot placeholder: portfolio section with all four fields labelled*

Click **Refresh** (🔄) at any time to fetch the latest on-chain data.

> *Screenshot placeholder: Refresh button*

The **Portfolio** section only appears when your wallet is connected. Disconnect and it disappears; reconnect and it comes back.

---

## Step 5 — Withdraw

1. Find the **Withdraw** panel on the main page.

   > *Screenshot placeholder: Withdraw panel*

2. Enter the number of **shares** you want to redeem.
   - You cannot enter more than your current share balance.
   - The app shows the estimated tokens you will receive before you confirm.

3. Click **Withdraw**.
4. Review and approve in Freighter.
5. Your underlying tokens arrive in your wallet within 5–10 seconds.

   > *Screenshot placeholder: wallet balance updated after withdrawal*

### Rounding note

The redemption formula uses integer division:

```
tokens_received = floor(shares × total_vault_assets / total_vault_shares)
```

You may receive 1 token less than the theoretical maximum due to rounding. The dust stays in the vault and benefits all remaining shareholders — this is expected and normal.

---

## Understanding Vault Shares

Think of vault shares like ownership units in a shared fund:

- The **vault pool** holds everyone's deposited tokens.
- You own a **percentage** of that pool, represented by your shares.
- When the vault earns yield (via a `harvest` operation), the pool grows — but the share count stays the same. Each share becomes worth more tokens.
- Depositing adds tokens to the pool and mints new shares. Withdrawing burns your shares and returns your proportion of the pool.

### Share pricing rules

| Scenario | Shares you receive |
|---|---|
| First ever deposit (empty vault) | Exactly equal to your deposit amount (1:1 seed) |
| Deposit after yield has accrued | Fewer shares — but each is worth more tokens |
| Deposit after another user deposited | Proportional to your fraction of the new pool |

### Worked example

| Event | Pool (tokens) | Total shares | Share price |
|---|---|---|---|
| Initial state | 0 | 0 | — |
| Alice deposits 1 000 | 1 000 | 1 000 | 1.000 |
| Yield harvest: +200 | 1 200 | 1 000 | 1.200 |
| Bob deposits 600 | 1 800 | 1 500 | 1.200 |
| Alice withdraws 500 shares | 1 200 | 1 000 | 1.200 |

Alice's 500 shares redeem for `500 × 1 200 / 1 000 = 600 tokens` — she earned 100 tokens of yield.

Bob receives `floor(600 / 1.200) = 500 shares` for his 600-token deposit, reflecting the higher share price at the time he joined.

---

## Fee Structure

Aura Vault uses two fee types, both configured by the vault admin in basis points (bps).

| Fee type | Unit | When collected | Example |
|---|---|---|---|
| **Performance fee** | bps of yield | Deducted from yield at harvest time | 200 bps = 2% of each yield injection |
| **Management fee** | bps per period | Applied periodically on total assets | 50 bps/year = 0.5% annualised |

> 1 basis point = 0.01%. Fees go to the vault treasury address set by the admin.

### How fees affect you

Fees are **deducted before yield is credited to the vault pool**, so they do not directly change your share balance. They reduce how much the pool grows per harvest, which slightly lowers the share price increase you would otherwise see.

To check the current fee rates:

- **In the app:** Navigate to Settings → Fee Info.
- **On-chain:** Call `get_fees()` on the contract (returns `(perf_fee_bps, mgmt_fee_bps)`).

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_fees
# returns: (200, 50)  → 2% performance fee, 0.5% management fee
```

---

## FAQ

**Q: Is there a minimum deposit?**  
A: Any amount > 0 is technically accepted. Deposits below ~10 tokens risk rounding to 0 shares and being rejected with a `ZeroAmount` error. Practically, deposits of 10 tokens or more work reliably.

**Q: Can I lose my deposit?**  
A: The vault is non-custodial — only you can withdraw your own shares. The primary risks are:
1. Smart contract bugs (the contract has been audited — see [AUDIT.md](../AUDIT.md))
2. The underlying token losing market value

Your shares cannot be seized, frozen, or transferred by the admin. The admin can only pause the vault in an emergency (see below).

**Q: What happens if the vault is paused?**  
A: The admin can pause the vault to protect funds during an emergency. While paused, deposits, withdrawals, and harvests are blocked. Your funds remain safe in the contract and your share ownership is unchanged. You can check pause state via `is_paused()`. The admin can unpause at any time.

**Q: Why did I receive fewer shares than I expected?**  
A: If you deposited after yield had accrued, the share price is higher than 1.0 so your tokens buy fewer shares. This is correct — each share you hold is worth more tokens than when the vault was first seeded. Your total value is preserved; only the number of shares differs.

**Q: Why did I receive fewer tokens than I deposited when I withdrew?**  
A: Two possible reasons:
1. The share price was below 1.0 (unlikely — would require negative yield).
2. Integer rounding took 1 token less than the theoretical maximum — this is normal. The dust benefits remaining shareholders.

**Q: How often does yield compound?**  
A: Yield is injected by a keeper wallet calling `harvest`. The frequency depends on the vault operator. The vault itself does not impose a schedule — compounding can happen as often as needed.

**Q: How do I see my transaction history?**  
A: The **Transaction History** panel on the dashboard shows your recent deposits and withdrawals. You can also look up your wallet address on [Stellar Expert](https://stellar.expert) or [Horizon](https://horizon.stellar.org) for full on-chain history.

**Q: What wallets are supported?**  
A: Freighter is the primary supported wallet. Other Stellar wallets that expose a compatible API may work but are not officially tested.

**Q: Is there a video walkthrough?**  
A: A video walkthrough is in production. Check the repository README for the latest link once it is published.

**Q: How do I report a bug or get help?**  
A: Open an issue on the [GitHub repository](https://github.com/soterika/aura-vault-protocol). For urgent security issues, follow the responsible disclosure process in [SECURITY.md](../SECURITY.md).

**Q: Are there other languages available?**  
A: The app UI is available in English, Spanish (`es`), French (`fr`), Arabic (`ar`), German (`de`), and Chinese Simplified (`zh`). Use the language switcher in the top-right corner. This guide will be translated to match.

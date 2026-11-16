# Aura Vault Protocol — Frequently Asked Questions

> **Issue:** [#396 — Create FAQ document for common user questions](https://github.com/soterika/aura-vault-protocol/issues/396)  
> **Updated:** August 2026  
> **Update cadence:** Monthly, based on support ticket analysis.  
> **Support:** support@aura-vault.dev | Discord | GitHub Issues

## Table of Contents

- [Getting Started](#getting-started)
- [Deposits](#deposits)
- [Withdrawals](#withdrawals)
- [Yield & Harvests](#yield--harvests)
- [Shares & Pricing](#shares--pricing)
- [Fees](#fees)
- [Security](#security)
- [Technical](#technical)

---

## Getting Started

**Q1. What is Aura Vault Protocol?**

Aura Vault Protocol is a non-custodial, share-based yield vault built on [Soroban](https://soroban.stellar.org/) for the Stellar blockchain. It aggregates deposits of a single SEP-41-compatible token, issues proportional vault shares to each depositor, and automatically compounds yield through permissionless keeper harvests — all governed entirely by on-chain smart contract logic.

See the [README](../README.md) for a technical overview.

---

**Q2. Who runs Aura Vault?**

The vault smart contract runs autonomously on the Stellar blockchain. No team member can move your funds. An admin address can pause the vault in emergencies and upgrade the contract, but cannot withdraw user funds. Yield harvests can be triggered by any external party (a "keeper"), not just the team.

---

**Q3. What do I need to get started?**

You need:

1. A Stellar-compatible wallet (e.g., [Freighter](https://www.freighter.app/))
2. XLM to pay Stellar transaction fees (a small amount — typically less than 1 XLM per operation)
3. The underlying token accepted by the vault you want to join

Connect your wallet via the "Connect Wallet" button in the app header, then navigate to the Deposit tab.

---

**Q4. Which networks does Aura Vault support?**

| Network | Purpose | Contract ID |
|---------|---------|-------------|
| Stellar Testnet | Testing and development | See the app's testnet settings |
| Stellar Mainnet | Production | See the app's mainnet settings |

Always verify the contract ID shown in the app matches the one published in the official [README](../README.md) before interacting with real funds.

---

**Q5. Is there a minimum or maximum deposit amount?**

There is no enforced upper limit. The protocol minimum is any non-zero amount that results in at least 1 vault share being minted. Very tiny deposits may round to zero shares due to integer arithmetic, and the contract will reject them with a `ZeroAmount` error. Practically speaking, deposits equivalent to at least a few cents of underlying token value will always succeed.

---

**Q6. Can I use Aura Vault from a mobile device?**

Yes. The web app is mobile-responsive and works in any modern browser. A native React Native mobile app is also in development. For the best experience on mobile, use the Freighter browser extension from your mobile browser or a wallet that supports WalletConnect.

---

**Q7. Do I need to actively manage my position?**

No. Once you deposit, your position grows automatically as keepers harvest yield and increase the exchange rate. You do not need to claim, reinvest, or compound manually. You simply withdraw when you want to access your funds.

---

## Deposits

**Q8. How do I deposit into the vault?**

1. Connect your wallet on the app
2. Navigate to the **Deposit** tab
3. Enter the amount of underlying tokens you want to deposit
4. Confirm the transaction in your wallet

Shares are minted instantly when the transaction is confirmed on-chain.

---

**Q9. What happens when I deposit?**

The contract transfers your tokens from your wallet into the vault and mints vault shares proportional to your deposit:

- **First depositor:** receives shares at a 1:1 ratio (1 token = 1 share)
- **Subsequent depositors:** receive `floor(amount × total_shares / total_assets)` shares

The floor (truncation toward zero) means you may receive very slightly fewer shares than the exact proportion — this is by design to prevent rounding attacks.

For more detail, see the [contract interface](../README.md#how-it-works).

---

**Q10. I deposited but my share balance looks lower than what I expected. Why?**

This is expected and normal. The share formula uses **integer floor division**, which truncates fractions. The difference is at most 1 share and represents less than 1 underlying token in value. The same convention is used by all major vault protocols (including ERC-4626 vaults on Ethereum).

---

**Q11. Can I deposit multiple times?**

Yes. Each deposit adds to your share balance. There is no limit on the number of deposits. Your average entry price (in terms of the share-to-token ratio) will be blended across all deposits.

---

**Q12. My deposit transaction failed. What should I do?**

Common causes:

| Error | Likely cause | Fix |
|-------|-------------|-----|
| `ZeroAmount` | Entered 0 or the amount rounds to 0 shares | Increase the deposit amount |
| `VaultPaused` | Admin has temporarily paused the vault | Check Discord for announcements, try again later |
| `BalanceMismatch` | Flash loan guard triggered | This is a security check — do not retry, report to the team |
| Insufficient XLM | Not enough XLM for Stellar fees | Add more XLM to your wallet |

If none of the above apply, share your transaction ID in the [Discord](https://discord.gg/aura-vault) support channel.

---

**Q13. Can I deposit on behalf of another address?**

No. The `deposit` function uses `msg.sender` (your connected wallet address) as the recipient of shares. If you want to gift a deposit to another address, the current version does not support this natively — the recipient would need to do the deposit themselves.

---

## Withdrawals

**Q14. How do I withdraw my funds?**

1. Connect your wallet
2. Navigate to the **Withdraw** tab
3. Enter the number of vault shares to burn (or use "Max" for a full withdrawal)
4. Confirm the transaction in your wallet

The contract burns your shares and sends the corresponding underlying tokens to your wallet in the same transaction.

---

**Q15. How much will I receive when I withdraw?**

You receive `floor(shares × total_assets / total_shares)` underlying tokens. Because yield has been compounding since your deposit, the value per share is higher than when you deposited — this is your yield.

Example:
- You deposited 1,000 tokens and received 1,000 shares
- After several harvests, the exchange rate is 1.12 tokens per share
- Withdrawing all 1,000 shares returns 1,120 tokens — your original 1,000 plus 120 in yield

---

**Q16. Is there a withdrawal fee?**

No fee is charged on deposits or withdrawals. Performance fees are only deducted from yield at harvest time, and management fees are accrued from total assets. Your principal is always redeemable without any withdrawal penalty. See the [Fees section](#fees) for the full fee schedule.

---

**Q17. Can I do a partial withdrawal?**

Yes. Enter any amount up to your full share balance. Your remaining shares continue to earn yield on the portion left in the vault.

---

**Q18. My withdrawal failed with "InsufficientShares". Why?**

You tried to withdraw more shares than your current balance holds. This can happen if:

- You entered a shares amount instead of a token amount by mistake
- A previous partial withdrawal already reduced your balance

Check your current share balance in the Portfolio tab, then re-enter a value at or below your balance.

---

**Q19. Can I withdraw while the vault is paused?**

No. When the vault is paused, all mutating operations — including withdrawals — are suspended. The pause is an emergency safety measure and is expected to be temporary. Monitor the official Discord for status updates. Your funds are not at risk; the contract holds them safely and the pause prevents any movement in or out.

---

**Q20. How long do withdrawals take?**

Withdrawals are processed in a single Stellar transaction. Once confirmed by the network (typically 5–10 seconds on Stellar), the tokens are in your wallet. There is no lock-up period or withdrawal queue.

---

## Yield & Harvests

**Q21. Where does the yield come from?**

Yield is injected by external actors called "keepers." A keeper calls the `harvest` function, transferring yield tokens into the vault without minting new shares. This increases the amount of underlying tokens each share represents, benefiting all current shareholders proportionally.

The vault itself is yield-strategy agnostic — it accepts yield from any source a keeper provides. In practice, keepers are automated bots run by the protocol team or any third party.

---

**Q22. How often does yield compound?**

Yield compounds every time a keeper calls `harvest`. Harvest frequency depends on available yield and gas economics. The protocol is permissionless — anyone can trigger a harvest at any time. In a typical deployment, harvests occur at minimum once per day, but this is not guaranteed.

---

**Q23. Do I need to claim my yield?**

No. Yield is reflected automatically in the exchange rate (tokens per share). When you withdraw, you receive all accumulated yield proportional to your shares without any separate claim step.

---

**Q24. Can the vault lose money (negative yield)?**

The vault contract does not implement a loss mechanism — `harvest` only adds tokens to the vault, never removes them. However, the underlying token itself can lose value in fiat terms. If the underlying token's market price drops, the fiat value of your position drops even though the vault's token accounting is correct.

---

**Q25. I was a shareholder during a harvest but I still see the same share balance. Is that normal?**

Yes. Your share count does not change during a harvest. What changes is how many tokens each share is worth. You will only see the benefit of the harvest when you withdraw — you will receive more tokens per share than you would have before the harvest.

---

## Shares & Pricing

**Q26. What is the share price (exchange rate)?**

The exchange rate is `total_assets / total_shares`. It starts at 1:1 for the first depositor and increases over time as yield is harvested.

You can query it on-chain:

```bash
# Divide total_assets by total_shares
stellar contract invoke --id <CONTRACT_ID> --network mainnet -- total_assets
```

The UI also displays the current share price in the Portfolio dashboard.

---

**Q27. What is an "inflation attack" and how does Aura prevent it?**

An inflation attack is a technique where an early depositor manipulates the share price to steal funds from later depositors. Aura prevents this by rejecting any deposit that would mint zero shares (the contract returns `ZeroAmount`). This fence makes the attack economically unfeasible. See [README — Security Properties](../README.md#security-properties).

---

**Q28. What happens to my shares if other users withdraw?**

Nothing — your share count and the vault's exchange rate are unaffected by other users' withdrawals. Withdrawals reduce both `total_assets` and `total_shares` proportionally, keeping the exchange rate constant.

---

## Fees

**Q29. What fees does Aura Vault charge?**

Aura uses a dual-fee model:

| Fee type | Rate | When charged |
|----------|------|--------------|
| Performance fee | 10–20% of yield | Deducted from yield at each harvest |
| Management fee | 0–1% annually | Accrued daily from total assets |

The specific rates are set by the admin and are queryable on-chain via `get_fees()`. Fees are sent to a treasury address and do not affect share counts — they reduce the net yield added to the vault.

For the full fee formula and worked examples, see [FEE_SYSTEM.md](../FEE_SYSTEM.md).

---

**Q30. Are fees charged on my principal when I deposit or withdraw?**

No. Fees are only deducted from yield at harvest time (performance fee) or from total assets over time (management fee). Your deposited principal is never directly fee-deducted.

---

**Q31. What does the performance fee look like in practice?**

Example with a 15% performance fee:
- A keeper harvests 1,000 tokens of yield
- Performance fee: 1,000 × 15% = 150 tokens sent to treasury
- Vault receives: 850 tokens, increasing the share price for all depositors

---

**Q32. Where do the fees go?**

Fees accumulate in an internal counter (`total_fees_collected`). The admin can transfer them to the treasury address at any time by calling `withdraw_fees()`. The treasury address is visible on-chain and publicly queryable.

---

**Q33. Are Stellar network fees (transaction fees) separate from vault fees?**

Yes. Stellar charges a small network fee (denominated in XLM) for every transaction you submit. This is paid to Stellar validators, not to Aura. The vault's performance and management fees are separate and denominated in the underlying vault token.

---

## Security

**Q34. Has Aura Vault been audited?**

Security properties are documented in [AUDIT.md](../AUDIT.md). Independent audit status is detailed there. Always verify the deployed contract hash matches the audited build before trusting the deployment with significant funds.

---

**Q35. Can the admin steal my funds?**

No. The admin can only:
- Pause and unpause the vault
- Upgrade the contract WASM
- Set fees and treasury address
- Call `withdraw_fees()` to move accumulated protocol fees

The admin **cannot** call `withdraw` on behalf of users or transfer user shares. The contract enforces this at the code level.

---

**Q36. What happens if the admin upgrades the contract?**

Contract upgrades are logged with a `upgrade` event and increment the on-chain version number. The upgrade function verifies that the new contract's storage layout matches the existing one (`StorageLayoutMismatch` error prevents mismatched upgrades). Upgrades cannot alter user share balances retroactively.

You can verify the current contract version on-chain:

```bash
stellar contract invoke --id <CONTRACT_ID> --network mainnet -- version
```

---

**Q37. What is the flash loan guard?**

The vault compares its actual on-chain token balance against its internally tracked `total_deposited` before executing any mutating operation. If the two values differ (which would indicate a flash loan attack or unexpected fund movement), the transaction is rejected with a `BalanceMismatch` error and a `suspicious` event is emitted with the observed vs. tracked amounts. This event can be monitored in real-time.

---

**Q38. What should I do if I see a `BalanceMismatch` error?**

This is a security signal. Do not retry. Contact the security team immediately at **emergency@aura-vault.dev** with your transaction ID and the amounts shown in the error. The on-call team will investigate and pause the vault if necessary.

---

**Q39. What does the emergency pause do?**

When the admin calls `pause()`, all mutating operations (`deposit`, `withdraw`, `harvest`) are blocked. Read-only operations (`total_assets`, `balance_of`, `is_paused`) continue to work. The pause is intended only for emergencies (security incidents, critical bugs). The admin can unpause with `unpause()`. Pause and unpause events are emitted on-chain and visible on Stellar Explorer.

---

**Q40. Is the contract open source?**

Yes. The full source code is available in this repository under the MIT license. You can verify the deployed WASM hash matches the source code by building from source with the reproducible Docker build:

```bash
docker compose run contract-builder
```

The resulting hash at `aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm` should match the hash uploaded to the network.

---

## Technical

**Q41. What is a SEP-41 token?**

[SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) is the Stellar token interface standard (analogous to ERC-20 on Ethereum). Any token that implements the SEP-41 interface — `transfer`, `balance`, `allowance`, etc. — can be used as the underlying token for an Aura Vault deployment.

---

**Q42. What blockchain does Aura run on?**

Aura Vault runs on the Stellar network using [Soroban](https://soroban.stellar.org/), Stellar's smart contract platform. The contract is written in Rust and compiled to WebAssembly (WASM). It is not compatible with EVM chains (Ethereum, Polygon, etc.).

---

**Q43. What are TTLs and why do they matter?**

Soroban contracts use a ledger-level TTL (time-to-live) mechanism to prevent storage from accumulating indefinitely. If a contract entry's TTL expires, it is archived. Aura automatically extends the TTL on every mutating call (30-day lifetime, 7-day bump threshold) to ensure your data is never accidentally archived. In practice, as long as the vault is actively used, TTL expiry is not a concern.

---

**Q44. Can I interact with the vault programmatically?**

Yes. See the integration guides in the repository:

- [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md) — General integration overview
- [INTEGRATION_JAVASCRIPT.md](../INTEGRATION_JAVASCRIPT.md) — JavaScript/TypeScript (using `@stellar/stellar-sdk`)
- [INTEGRATION_RUST.md](../INTEGRATION_RUST.md) — Rust integration
- [INTEGRATION_PYTHON.md](../INTEGRATION_PYTHON.md) — Python integration

---

**Q45. What wallets are supported?**

Any wallet that supports Stellar and the SEP-7 or WalletConnect signing protocol. Tested wallets include:

- [Freighter](https://www.freighter.app/) (browser extension, recommended)
- [xBull](https://xbull.app/)
- Any wallet compatible with the Stellar WalletConnect bridge

---

*For questions not covered here, open a [GitHub Issue](https://github.com/soterika/aura-vault-protocol/issues) or ask in the Discord support channel.*  
*This document is updated monthly based on support ticket analysis.*

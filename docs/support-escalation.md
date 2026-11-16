# Support Escalation Guide for Community Moderators

**Aura Vault Protocol — Issue #420**
Last updated: 2026-08-24

---

## Overview

This guide helps community moderators triage incoming support requests and determine when to handle an issue directly versus escalate to the development team. Fast, consistent triage protects users and keeps the dev team focused on engineering work.

---

## Issue Triage Flowchart

```
User reports issue
       │
       ▼
Is the issue a known FAQ / docs gap?
  ├─ YES → Send template response, link docs → RESOLVED (Tier 1)
  └─ NO
       │
       ▼
Does it involve wallet connection, network selection, or UI confusion?
  ├─ YES → Walk through checklist below → RESOLVED (Tier 1)
  └─ NO
       │
       ▼
Does it involve a contract error code, missing funds, or wrong balances?
  ├─ YES → Gather data (tx hash, wallet address, error code) → ESCALATE (Tier 2)
  └─ NO
       │
       ▼
Is it a backend / API issue (slow data, wrong APY, missing history)?
  ├─ YES → Check status page first → if ongoing, update user; if new → ESCALATE (Tier 2)
  └─ NO
       │
       ▼
Does not fit any category → Use judgment; when in doubt → ESCALATE (Tier 2)
```

---

## Tier 1 — Moderator-Resolvable Issues

Moderators can handle these without developer involvement.

### 1.1 Frequently Asked Questions

| Question | Answer |
|---|---|
| What is the vault share exchange rate? | Call `total_assets()` and divide by total supply. The ratio increases as yield is harvested. |
| Why did I receive fewer shares than I deposited tokens? | Shares use floor division: `floor(amount × total_shares / total_assets)`. This is by design. |
| Can I lose my principal? | Not under normal operation. Loss is only possible via a smart contract exploit. |
| Who can call `harvest`? | Any address — it is permissionless. The caller injects yield; no new shares are minted. |
| What tokens does the vault accept? | A single SEP-41-compatible underlying token set at initialization. |
| Is there a withdrawal fee? | No fee at the contract level. Check the UI for any frontend service fees. |

### 1.2 Wallet Connection Issues

1. Confirm the user is on **Stellar Mainnet** or **Testnet** as appropriate.
2. Ask them to disconnect and reconnect their wallet (Freighter, xBull, Lobstr).
3. Check that the wallet extension is up to date.
4. Clear browser cache and retry.
5. Try a different supported browser (Chrome, Brave, Firefox).
6. If the wallet shows "not detected": disable other wallet extensions that may conflict.

### 1.3 Network Mismatch

Symptoms: transaction fails immediately, contract ID not found, wrong balances displayed.

1. Confirm which network the user intends to use (Mainnet / Testnet).
2. Check their wallet's network setting matches the UI network indicator.
3. Ask the user to switch networks in the wallet, refresh the page, and retry.
4. If the UI is showing "Testnet" when user expects Mainnet, direct them to the correct URL:
   - Mainnet: `https://app.auravault.fi`
   - Testnet: `https://testnet.auravault.fi`

---

## Tier 2 — Dev Team Escalation

Escalate these issues immediately. Do **not** ask users to retry repeatedly — gather data and escalate.

### 2.1 Contract Errors

Any Soroban contract error code returned to the user (see table below) requires escalation.

| Error Code | Variant | What to Collect |
|---|---|---|
| 3 | `InsufficientShares` | User's share balance, withdraw amount requested |
| 4 | `InsufficientUnderlying` | Total assets, share redemption amount, tx hash |
| 5 | `ZeroAmount` | Input amount, share calculation result |
| 6 | `MathOverflow` | Input amounts, total_assets, total_shares at time of call |
| 11 | `VaultPaused` | Time of attempt; check if admin issued pause announcement |
| 12 | `BalanceMismatch` | Full tx hash, observed vs tracked amounts from event log |

### 2.2 Backend / API Bugs

- APY or yield figures appear wrong or haven't updated in > 15 minutes
- Transaction history missing or incomplete
- GraphQL / REST API returning 5xx errors
- Price feeds stale or incorrect

### 2.3 Data Discrepancies

- User's share balance in the UI differs from on-chain `balance_of` result
- `total_assets` in UI differs from direct contract query
- Withdrawal received wrong token amount

### 2.4 Security / Suspicious Activity

Escalate **immediately** via the security channel (see Escalation Channels below):
- `suspicious` event observed in contract logs (flash loan guard triggered)
- Unexpected admin actions (pause without announcement, unauthorized upgrade)
- User reports funds missing with no corresponding transaction

---

## Escalation Channels and Response SLAs

| Channel | Use For | SLA |
|---|---|---|
| `#support-escalations` (Discord) | Tier 2 issues — standard | Dev team acknowledges within **4 hours** (business hours), **8 hours** (off-hours) |
| `#security-alerts` (Discord) | Security / suspicious activity | Dev team acknowledges within **1 hour**, 24/7 |
| GitHub Issue (label: `bug`, `needs-triage`) | Reproducible bugs with tx evidence | First response within **1 business day** |
| `security@auravault.fi` | Sensitive security disclosures | Acknowledged within **2 hours** |

**Business hours:** Monday–Friday, 09:00–18:00 UTC.

When posting to `#support-escalations`, use this format:

```
**Issue Type:** [Contract Error / API Bug / Data Discrepancy / Security]
**User:** @username (Discord) or wallet address
**Summary:** One sentence description
**Evidence:**
  - Tx hash: ...
  - Error code: ...
  - Screenshot: (attach)
  - On-chain query result: ...
**Urgency:** [Low / Medium / High / Critical]
```

---

## Template Responses for Common Issues

### T1: Wrong Network

> Hi! It looks like your wallet might be connected to the wrong network. Could you check your wallet settings and make sure you're on **[Mainnet / Testnet]**? After switching, refresh the page and try again. Let me know if that doesn't solve it!

### T2: Wallet Not Connecting

> Thanks for reaching out! Let's try a few quick steps:
> 1. Disconnect your wallet and reconnect it.
> 2. Make sure your wallet extension (Freighter / xBull / Lobstr) is up to date.
> 3. Try clearing your browser cache (Ctrl+Shift+Delete) and refreshing.
> 4. If still stuck, try a different browser.
>
> Let me know which step you're on and I can help further!

### T3: Share Amount Less Than Expected

> The vault uses **proportional share minting** with floor division, so you may receive slightly fewer shares than the raw token amount suggests — this is expected behavior, not a bug. Your shares represent a proportional claim on the vault's total assets, which grows as yield is harvested. You can verify your redemption value with `total_assets × your_shares / total_supply`.

### T4: Contract Error (escalation acknowledgment to user)

> Thanks for the details! This looks like it needs the dev team's attention. I've escalated it with your transaction hash and error information. You should hear back within **4 hours**. In the meantime, please don't retry the transaction, as it could result in duplicate actions. We'll follow up here.

### T5: Vault Is Paused

> The vault is currently **paused** by the admin, which temporarily disables deposits, withdrawals, and harvests. This is usually done for maintenance or in response to a network event. Your funds are safe. We'll post an update in `#announcements` as soon as operations resume.

### T6: General "I Lost Funds" (pre-escalation)

> I'm sorry to hear that — let's get this sorted out as quickly as possible. Could you please share:
> 1. Your wallet address
> 2. The transaction hash(es) involved
> 3. A screenshot of what you're seeing
>
> I'm escalating this to the dev team right now and will follow up shortly.

---

## Moderator Quick Reference

- **Status page:** `https://status.auravault.fi` — check before escalating API issues
- **Contract explorer:** Stellar Expert — search by contract ID to verify on-chain state
- **Error code reference:** See README.md Error Codes table
- **Docs:** `/docs/getting-started.md`, `/docs/api-reference.md`
- **Never ask users to share their private keys or seed phrases** — escalate immediately if a user has already shared one

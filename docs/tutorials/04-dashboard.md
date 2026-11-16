# Dashboard & UI Overview

**Estimated time:** 4 minutes  
**What you'll learn:** A complete tour of the Aura Vault interface — every element on screen, what it does, and how to use it effectively.

---

## Page Layout

The Aura Vault UI is a single page with four distinct zones:

```
┌─────────────────────────────────┐
│  Header: "Aura Vault"           │
├─────────────────────────────────┤
│  Tab Nav: Deposit │ Withdraw │ Harvest │
├─────────────────────────────────┤
│                                 │
│  Active Panel (form / harvest)  │
│                                 │
└─────────────────────────────────┘
     [Toast notifications]
```

---

## Header

The page header contains the application name **"Aura Vault"** and a **"Skip to main content"** link (visible on keyboard focus) for accessibility. There is no wallet connection button in the header — wallet interactions happen at the transaction level when you submit a form.

---

## Tab Navigation

Three tab buttons switch the active panel:

| Tab | What it does |
|-----|-------------|
| **Deposit** | Open to deposit tokens and receive vault shares |
| **Withdraw** | Open to burn shares and redeem underlying tokens |
| **Harvest** | Open to inject yield tokens into the vault (keeper role) |

The active tab is visually highlighted. Click any tab to switch panels instantly. Each panel loads on demand — a skeleton placeholder appears briefly on a slow connection.

Keyboard users can navigate between tabs using standard browser tab/focus behaviour. The panels use ARIA `role="tabpanel"` and `role="tab"` attributes for screen reader compatibility.

---

## Deposit Panel

**How to open:** Click the **Deposit** tab.

Elements:
- **Amount field** — numeric input, accepts any positive decimal number. Placeholder: `0.00`.
- **Inline error** — appears below the field in red if validation fails (e.g. empty or zero value).
- **Transaction error** — a dismissible error card appears above the submit button if the on-chain call fails. It includes a **Retry** button.
- **Deposit button** — submits the transaction.
- **Loading skeleton** — replaces the form while the transaction is in flight.

Refer to [02 — How to Deposit](./02-deposit.md) for a full step-by-step walkthrough.

---

## Withdraw Panel

**How to open:** Click the **Withdraw** tab.

Elements:
- **Shares field** — numeric input for the number of vault shares to redeem. Placeholder: `0.00`.
- **Inline error** — shown below the field on invalid input.
- **Transaction error** — same dismissible card as Deposit, with Retry.
- **Withdraw button** — submits the transaction.
- **Loading skeleton** — displayed while the transaction processes.

Refer to [03 — How to Withdraw](./03-withdraw.md) for a full step-by-step walkthrough.

---

## Harvest Panel

**How to open:** Click the **Harvest** tab.

The Harvest panel is for **keepers** — accounts that inject yield into the vault on behalf of all shareholders. Normal depositors do not need to use this tab.

Elements:
- **Description text** — *"Inject yield into the vault for all shareholders."*
- **Yield Amount field** — numeric input for the amount of yield tokens to inject. Placeholder: `0.00`.
- **Inline error** — validation feedback below the field.
- **Transaction error** — dismissible error card with Retry.
- **Harvest button** — submits the `harvest` call.
- **Loading skeleton** — shown during processing.

When a harvest succeeds, the vault's `total_assets` increases without minting new shares. This raises the redemption value of every existing share — all depositors benefit automatically.

> **Keeper requirement:** The `harvest` function requires at least one shareholder to exist (`total_shares > 0`). Attempting to harvest on an empty vault returns `ZeroShares` (error 8).

---

## Toast Notifications

After a successful transaction, a **toast** appears at the bottom of the screen with a green background. Examples:

- *"Deposited 100 tokens successfully."*
- *"Withdrew 50 shares successfully."*
- *"Harvested 25 yield tokens."*

Toasts dismiss automatically or can be closed manually. Error conditions show an inline error card in the panel instead of a toast.

---

## Checking Your Balances

The current UI does not display a live balance dashboard. To check your vault share balance or the vault's total assets, use the Stellar CLI or your wallet's contract explorer:

```bash
# Check your share balance
stellar contract invoke \
  --id <contract-id> \
  --network testnet \
  -- balance_of \
  --address <your-address>

# Check total assets in the vault
stellar contract invoke \
  --id <contract-id> \
  --network testnet \
  -- total_assets

# Check if vault is paused
stellar contract invoke \
  --id <contract-id> \
  --network testnet \
  -- is_paused
```

---

## Onboarding Modal

On first visit, a 5-step onboarding modal covers the main UI. It can be dismissed with **Skip** at any time. To re-trigger it, clear the site's `localStorage` in your browser's developer tools (`Application → Local Storage → Clear`).

---

## Next Steps

- [05 — Troubleshooting & Security](./05-troubleshooting-and-security.md) — error codes, common issues, and security practices

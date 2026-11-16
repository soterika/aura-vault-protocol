# End-User Video Script: Deposit Walkthrough

**Document Version:** 1.0  
**Target Video Length:** 6 minutes 30 seconds  
**Production Resolution:** 1080p (1920×1080) @ 60fps  
**Audio Format:** 48kHz, 24-bit WAV (Stereo)  
**Host / Presenter:** Aura Vault Protocol Community Advocate  
**Target Audience:** New DeFi users, Stellar ecosystem participants, liquidity depositors  
**Primary Surfaces Covered:** Freighter Wallet Extension, Stellar Laboratory Friendbot, Aura Vault Web Application (`ui/src/`)

---

## Production Overview & Checklist

### Screen Recording Setup
- Browser: Chromium or Firefox with a fresh, clean user profile (no personal bookmarks or extensions except Freighter).
- Resolution: Native 1920×1080 with 125% browser zoom for readability.
- Dark mode enabled in OS and browser settings to match the application default theme.
- System cursor set to medium size with subtle yellow highlight ring on mouse clicks.
- Cursor smoothing enabled in recording software (OBS Studio / Screenflow).

### Pre-Recording Checklist
- [ ] Testnet account funded with 10,000 XLM via Friendbot.
- [ ] Testnet underlying token trustline established and funded (e.g. 500 testnet USDC).
- [ ] Aura Vault local frontend or testnet staging running without latency.
- [ ] Audio levels checked (peak at -6 dB, noise floor below -55 dB).
- [ ] Browser notifications and OS sounds silenced.

---

## Video Outline & Timeline

| Step | Section Title | Start | Duration | Core Goal |
|---|---|---|---|---|
| **1** | [Introduction: What Aura Vault Is](#step-1--introduction-what-aura-vault-is) | 00:00 | 00:30 | Explain value proposition, non-custodial yield, and Soroban contract security |
| **2** | [Wallet Setup: Installing Freighter](#step-2--wallet-setup-installing-freighter) | 00:30 | 01:00 | Download, configure extension, secure seed phrase, switch to Testnet |
| **3** | [Getting Testnet Tokens](#step-3--getting-testnet-tokens) | 01:30 | 01:00 | Fund wallet with testnet XLM via Friendbot and obtain deposit test tokens |
| **4** | [Connecting Wallet to App](#step-4--connecting-wallet-to-app) | 02:30 | 00:30 | Approve wallet connection on the Aura Vault frontend |
| **5** | [Making a Deposit](#step-5--making-a-deposit) | 03:00 | 02:00 | Enter amount, review validation, sign Soroban transaction, view success toast |
| **6** | [Understanding Your Share Balance](#step-6--understanding-your-share-balance) | 05:00 | 01:00 | Demystify ERC-4626 share tokens vs underlying asset value and exchange rates |
| **7** | [Watching Yield Accumulate](#step-7--watching-yield-accumulate) | 06:00 | 00:30 | Explore auto-compounding harvests, performance graphs, and wrap-up |

---

## Detailed Step-by-Step Script & Capture Guide

### Step 1 — Introduction: What Aura Vault Is

- **Timestamp:** `00:00 - 00:30` (Duration: 30 seconds)
- **Visual Scene:** Wide capture of the Aura Vault landing page (`https://app.auravault.finance` or local `localhost:3000`). Animated title card overlay: *"Aura Vault Protocol — Deposit Walkthrough"*.
- **On-Screen Action:** Slow smooth pan down past the protocol banner showing current TVL, APY counter, and key feature highlights (non-custodial, permissionless compounding, built on Stellar Soroban).

```
+-----------------------------------------------------------------------------------+
|  [Logo] Aura Vault                                        [Connect Wallet] [Theme]|
+-----------------------------------------------------------------------------------+
|                                                                                   |
|           Automated Yield Optimization on Stellar Soroban                         |
|     Deposit underlying assets. Receive yield-bearing vault shares.                |
|                                                                                   |
|     +-------------------+   +--------------------+   +--------------------+       |
|     |  Total Value (TVL)|   |     Current APY    |   |    Vault Status    |       |
|     |    $2,450,000     |   |       12.8%        |   |       Active       |       |
|     +-------------------+   +--------------------+   +--------------------+       |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. Navigate to the Aura Vault web interface.
2. Observe the main application header with the title **"Aura Vault"** and navigation tabs.
3. Bring up the initial onboarding welcome dialog or highlight the core metrics bar.

#### Voiceover Script
> "Welcome to Aura Vault Protocol! Aura Vault is a decentralized, non-custodial yield optimization platform built on Stellar's native smart contract platform, Soroban.
> 
> When you deposit tokens into an Aura Vault, the protocol issues proportional vault shares that automatically compound yield in real time through automated keepers. 
> 
> In this video, we'll walk through the entire deposit experience step by step—from setting up a Stellar wallet to watching your yield accumulate on the testnet. Let's dive in!"

#### Screen-Capture Notes
- Use a subtle zoom-in on the **Current APY** and **Vault Status** badges as the voiceover mentions automated compounding.

---

### Step 2 — Wallet Setup: Installing Freighter

- **Timestamp:** `00:30 - 01:30` (Duration: 1 minute)
- **Visual Scene:** Browser transitions to the official Freighter website at `https://www.freighter.app/`.
- **On-Screen Action:** Click "Download Extension", install from Chrome Web Store, set password, emphasize seed phrase safety (blur seed phrase), switch network to Testnet.

```
+-----------------------------------------------------------------------------------+
|  Freighter — A Stellar Wallet for your browser                                   |
|                                                                                   |
|  [ Install Extension for Chrome ]                                                 |
|                                                                                   |
|  +-------------------------------------+                                          |
|  |  Freighter Extension Popup          |                                          |
|  |  ---------------------------------- |                                          |
|  |  [ Create a new wallet ]            |                                          |
|  |  Set Password: [ ************ ]     |                                          |
|  |  Confirm:      [ ************ ]     |                                          |
|  |                                     |                                          |
|  |  Network: [ Stellar Testnet    v ]  |<-- CRITICAL STEP                         |
|  |  Address: GABCKXYZ...1234           |                                          |
|  +-------------------------------------+                                          |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. Open a new tab and go to `https://www.freighter.app`.
2. Click **Install Extension** and complete the standard browser extension prompt.
3. Open the Freighter extension from your browser toolbar.
4. Select **Create a new wallet** and create a secure password.
5. Record the 12-word recovery phrase offline.
6. Open the Freighter settings dropdown at the top right of the popup window.
7. Switch the network dropdown from **Public Network** to **Testnet**.
8. Click on your account name to copy your public key (`G...`).

#### Voiceover Script
> "To interact with Stellar smart contracts, you'll need a compatible browser wallet. We recommend **Freighter**, the leading non-custodial wallet designed specifically for Stellar and Soroban.
> 
> Head over to `freighter.app` and click 'Install Extension'. Once added to your browser, open Freighter and click 'Create a new wallet'. Choose a strong password.
> 
> Freighter will present your twelve-word recovery phrase. Write this phrase down on paper and keep it secure—anyone with these words can access your funds.
> 
> Because we are using the testnet for this tutorial, click the network selector in the top-right corner of the Freighter popup and switch it from 'Public' to 'Testnet'. Now, copy your public address by clicking your account name at the top."

#### Screen-Capture Notes
- **SECURITY CALLOUT**: Apply a pixelation or blur box over the recovery seed words when they appear on screen.
- Place a red callout circle around the network toggle highlighting **"Testnet"**.

---

### Step 3 — Getting Testnet Tokens

- **Timestamp:** `01:30 - 02:30` (Duration: 1 minute)
- **Visual Scene:** Browser transitions to the Stellar Laboratory Friendbot page (`https://laboratory.stellar.org/#account-creator?network=testnet`).
- **On-Screen Action:** Paste the copied address into the Friendbot input field, click "Get test network Lumens", show the success confirmation, switch to the test token faucet or verify Freighter balance update.

```
+-----------------------------------------------------------------------------------+
|  Stellar Laboratory — Account Creator (Testnet)                                  |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  Friendbot: Fund a new testnet account with 10,000 Lumens (XLM)                  |
|                                                                                   |
|  Public Key: [ GABCKXYZ4567SAMPLEKEYFORTESTNETPURPOSES... ]                      |
|                                                                                   |
|  [ Get test network Lumens ]                                                     |
|                                                                                   |
|  [v] Response 200: Successfully funded account GABCKXYZ... with 10,000 XLM        |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. Navigate to `https://laboratory.stellar.org/#account-creator?network=testnet`.
2. Paste your copied Freighter public address into the **Friendbot Public Key** input box.
3. Click the **Get test network Lumens** button.
4. Wait 2 seconds until the green JSON response confirms the account creation with 10,000 testnet XLM.
5. Open the Freighter extension popup to confirm the updated balance shows `10,000 XLM`.
6. Open the underlying test token faucet (or claim testnet deposit tokens).

#### Voiceover Script
> "Before we can test our deposit, our testnet wallet needs funds. Stellar provides a free faucet called **Friendbot** that funds test accounts instantly.
> 
> Navigate to the Stellar Laboratory account creator, make sure the network toggle is set to Testnet, paste your copied public address, and click 'Get test network Lumens'.
> 
> Within seconds, Friendbot credits your wallet with ten thousand testnet Lumens. These Lumens will cover the microscopic network transaction fees on Stellar.
> 
> Next, ensure you have the underlying token accepted by the vault—for example, testnet USDC. With our test tokens ready, let's return to the Aura Vault application."

#### Screen-Capture Notes
- Highlight the instant ledger finality on Stellar when the Friendbot request succeeds.
- Show Freighter's balance refreshing from `0` to `10,000 XLM`.

---

### Step 4 — Connecting Wallet to App

- **Timestamp:** `02:30 - 03:00` (Duration: 30 seconds)
- **Visual Scene:** Return to the Aura Vault web app tab.
- **On-Screen Action:** Click "Connect Wallet" button in the navbar, select Freighter from modal, approve the Freighter authorization popup, observe navbar update to show connected status with truncated public address.

```
+-----------------------------------------------------------------------------------+
|  [Logo] Aura Vault                           [ GABC...1234 (Testnet) v ] [Theme] |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|   +-------------------+  +-------------------+  +-----------+  +---------------+  |
|   |  Deposit (Active) |  |     Withdraw      |  |  Harvest  |  |  Performance  |  |
|   +-------------------+  +-------------------+  +-----------+  +---------------+  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. On the Aura Vault page, click the prominent **Connect Wallet** button in the top-right corner.
2. In the wallet selector modal, click **Freighter**.
3. When the Freighter extension popup window appears asking *"Allow Aura Vault to view your address?"*, click **Approve**.
4. Observe the button transforming into an active account badge displaying truncated address `GABC...1234` with a green connection dot.

#### Voiceover Script
> "Back in the Aura Vault application, click the 'Connect Wallet' button in the top-right corner.
> 
> Select 'Freighter' from the list. Freighter will display a permission modal requesting permission to share your public address with Aura Vault. 
> 
> Click 'Approve'. Aura Vault is strictly non-custodial: connecting your wallet only grants the app read access to your public balance. It can never move funds without your explicit signature for each transaction.
> 
> Notice the green indicator in the navigation bar—we're connected and ready to deposit!"

#### Screen-Capture Notes
- Pause 2 seconds on the Freighter connection modal so viewers can clearly read the permissions requested.

---

### Step 5 — Making a Deposit

- **Timestamp:** `03:00 - 05:00` (Duration: 2 minutes)
- **Visual Scene:** The active **Deposit** panel on the application dashboard.
- **On-Screen Action:** Point out the tabs, click the Amount input, demonstrate validation with invalid input (0 or negative), type `100.00`, click "Deposit", inspect the skeleton loading animation, approve transaction in Freighter popup, verify success toast.

```
+-----------------------------------------------------------------------------------+
|  Deposit Tokens into Aura Vault                                                   |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  Select Asset: [ USDC - Stellar Testnet              v ]                          |
|  Available in Wallet: 500.00 USDC                    [ Max ]                      |
|                                                                                   |
|  Amount                                                                           |
|  +-----------------------------------------------------------------------------+  |
|  | 100.00                                                                 USDC |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  Transaction Summary:                                                             |
|  • Expected Vault Shares (avUSDC):   95.2381 shares                               |
|  • Share Exchange Ratio:             1.0500 USDC per share                        |
|  • Est. Network Fee:                 0.00001 XLM                                  |
|  • Slippage Tolerance:               0.5%                                         |
|                                                                                   |
|  [                              Deposit                                     ]     |
|                                                                                   |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [v] Toast: "Deposited 100 tokens successfully."                                  |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. Confirm the **Deposit** tab is highlighted in the navigation bar (`ui/src/App.tsx`).
2. Point cursor to the numeric input labelled **Amount** with default placeholder `0.00`.
3. To demonstrate built-in error handling: enter `0` and click **Deposit**. Show the inline validation error message:
   ```
   "Enter a valid amount greater than 0."
   ```
4. Clear the field and type `100.00`.
5. Review the **Transaction Summary** section showing:
   - Expected Vault Shares minted (`new_shares`).
   - Current exchange rate (`1 share = 1.05 underlying`).
   - Estimated Stellar network fee (< 0.0001 XLM).
6. Click the purple **Deposit** button.
7. Observe the deposit form immediately entering a **loading skeleton** state with three placeholder animated shimmer rows.
8. The Freighter transaction popup appears:
   - Verify Contract ID matches the official Aura Vault Soroban address.
   - Verify Function Name: `deposit`.
   - Verify Arguments: `caller = GABC...`, `amount = 1000000000` (in base units).
9. Click **Sign Transaction** in Freighter.
10. The popup closes, the loading skeleton clears, the Amount input resets to empty, and a green success notification toast slides in at the bottom right:
    ```
    "Deposited 100 tokens successfully."
    ```

#### Voiceover Script
> "Now for the main event: making our deposit.
> 
> Under the 'Deposit' tab, you'll see your available wallet balance and the deposit form. The form has robust client-side validation—if you leave it blank or enter zero, it clearly alerts you that a valid amount greater than zero is required.
> 
> Let's enter one hundred tokens.
> 
> Right below the input, the summary card calculates exactly what you will receive. It shows the expected vault shares to be minted, the current share price, and the estimated network fee—which is just a fraction of a cent on Stellar.
> 
> When you're ready, click 'Deposit'.
> 
> The form enters a loading skeleton state while preparing the Soroban transaction data, and Freighter immediately pops up for your review.
> 
> Always verify transaction details: you can see the target Soroban contract address, the function name 'deposit', and the exact token amount. Everything looks great, so click 'Sign Transaction'.
> 
> Stellar processes transactions in around three to five seconds. And there it is! The green confirmation toast confirms: 'Deposited 100 tokens successfully.'"

#### Screen-Capture Notes
- Zoom in 150% on the Freighter review popup when verifying the function name `deposit` and amount.
- Show the cursor smoothly moving to the **Sign Transaction** button.
- Capture the animated shimmer effect on the loading skeleton before the success toast appears.

---

### Step 6 — Understanding Your Share Balance

- **Timestamp:** `05:00 - 06:00` (Duration: 1 minute)
- **Visual Scene:** Scroll down slightly to the **User Portfolio / Share Balance** card (`ui/src/components/DataDisplay.tsx` / `Portfolio.tsx`).
- **On-Screen Action:** Highlight the "Vault Shares" balance vs "Underlying Asset Equivalent", explain how share ratios work, and show the exchange formula tooltip.

```
+-----------------------------------------------------------------------------------+
|  Your Vault Portfolio                                                             |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  +------------------------------+     +-------------------------------+           |
|  | Vault Shares (avUSDC)        |     | Underlying Value              |           |
|  | 95.2381                      |     | 100.00 USDC                   |           |
|  +------------------------------+     +-------------------------------+           |
|                                                                                   |
|  Share Valuation Formula:                                                         |
|  Underlying Value = (Your Shares * Total Vault Assets) / Total Vault Shares       |
|                                                                                   |
|  • Your Share of Vault: 0.04%                                                     |
|  • Current Share Price: 1.0500 USDC                                               |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. Navigate to the **Portfolio** display area beneath the deposit tabs.
2. Highlight the **Vault Shares (avUSDC)** card showing `95.2381`.
3. Highlight the adjacent **Underlying Value** card showing `100.00 USDC`.
4. Hover over the information tooltip on **Share Valuation Formula** to reveal the math breakdown:
   $$\text{Underlying Value} = \frac{\text{User Shares} \times \text{Total Vault Assets}}{\text{Total Vault Shares}}$$
5. Emphasize that while the share count (`95.2381`) remains fixed, the underlying token value will steadily grow over time.

#### Voiceover Script
> "Now that your deposit has settled, let's look at your portfolio card below.
> 
> A common question from new depositors is: 'I deposited 100 tokens, so why does my balance show 95.23 shares?'
> 
> Aura Vault uses a standardized share-token mechanism similar to ERC-4626. When you deposit into an established vault that has already earned yield, each share is worth more than one underlying token.
> 
> In this case, each share is currently worth one dollar and five cents. So your ninety-five point two-four shares equal exactly your one hundred dollars deposited!
> 
> As the vault generates yield, the total underlying assets in the vault increase, but the number of shares in circulation does not change. That means each of your shares automatically represents more underlying tokens every single day—no manual re-staking required."

#### Screen-Capture Notes
- Use a split-screen graphical graphic or side-by-side callout showing:
  - Left: *Initial deposit (100 USDC = 95.23 Shares @ 1.05)*
  - Right: *After yield (105 USDC = 95.23 Shares @ 1.10)*

---

### Step 7 — Watching Yield Accumulate

- **Timestamp:** `06:00 - 06:30` (Duration: 30 seconds)
- **Visual Scene:** Click through to the **Performance** and **Harvest** tabs (`ui/src/components/PerformanceCharts.tsx` & `HarvestPanel.tsx`).
- **On-Screen Action:** Showcase the historical APY growth chart, demonstrate keeper auto-compounding on the Harvest panel, and show the closing title card with documentation links.

```
+-----------------------------------------------------------------------------------+
|  [ Deposit ]  [ Withdraw ]  [ Harvest ]  [ Performance (Active) ]                 |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|   Historical Yield Growth & Share Price                                           |
|   +----------------------------------------------------------------------------+  |
|   |  Share Price: $1.052  (+12.8% APY)                                         |  |
|   |       _--~--_                                                              |  |
|   |     _-       \                                                             |  |
|   |   _/          \                                                            |  |
|   +----------------------------------------------------------------------------+  |
|                                                                                   |
|   Documentation: docs.auravault.finance | GitHub: github.com/soterika/aura-vault  |
+-----------------------------------------------------------------------------------+
```

#### Exact UI Steps
1. Click the **Performance** tab in the main tab list.
2. Pan over the historical yield chart displaying continuous share price appreciation.
3. Briefly click the **Harvest** tab to show that keeper bots trigger harvests autonomously.
4. Return to the main screen; show concluding title slide with links to GitHub, Discord, and documentation.

#### Voiceover Script
> "To monitor your earnings over time, switch to the 'Performance' tab. Here you can track historical yield curves, 30-day APY trends, and overall vault growth.
> 
> You can also check the 'Harvest' tab to view recent protocol compounding cycles executed by automated keepers.
> 
> When you're ready to exit, simply click the 'Withdraw' tab to redeem your shares for your initial deposit plus all accumulated yield.
> 
> Thanks for watching! Check out the description below for links to our documentation, GitHub repository, and community Discord. Happy yield farming on Stellar!"

#### Screen-Capture Notes
- Fade out to end screen showing:
  - **Aura Vault Protocol**
  - Docs: `docs/getting-started.md` & `docs/tutorials/02-deposit.md`
  - GitHub: `github.com/soterika/aura-vault-protocol`
  - Support & Discord Links

---

## Technical Accuracy Review & Verification

This script was audited against the codebase for UI accuracy:
- Form fields and validation messages match [`ui/src/components/DepositForm.tsx`](file:///workspaces/aura-vault-protocol/ui/src/components/DepositForm.tsx).
- Tab controls and routing match [`ui/src/App.tsx`](file:///workspaces/aura-vault-protocol/ui/src/App.tsx).
- Wallet connection and authorization flows adhere to [`docs/wallet-integration.md`](file:///workspaces/aura-vault-protocol/docs/wallet-integration.md).
- Contract function names, parameters, and share calculation formulas reflect [`aura-vault/src/lib.rs`](file:///workspaces/aura-vault-protocol/aura-vault/src/lib.rs).

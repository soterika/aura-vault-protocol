# Video Tutorial Series — Aura Vault Protocol

This document contains the complete production scripts, shot lists, and captions for the three-video Aura Vault tutorial series. Scripts are reviewed and approved here before recording begins.

> **Hosting:** All videos will be published on the [Aura Vault YouTube channel](https://youtube.com/@auravaultprotocol) and linked from the [Getting Started docs](/docs/getting-started.md).

---

## Series Overview

| # | Title | Target length | Primary audience |
|---|-------|---------------|-----------------|
| 1 | Connect Your Wallet and Make Your First Deposit | 5 min | New users, no prior Stellar experience needed |
| 2 | Monitor Your Portfolio and Withdraw | 4 min | Active depositors |
| 3 | Harvest, Admin Features, and Security Tips | 6 min | Power users, keepers, protocol admins |

---

## Production Checklist

Before recording:
- [ ] Scripts reviewed and approved (this document)
- [ ] Screen layouts prepared at 1920×1080
- [ ] Testnet accounts funded via Friendbot
- [ ] Contract deployed and initialized on testnet
- [ ] Caption template file created (`.srt` format)
- [ ] Intro/outro bumpers rendered
- [ ] Thumbnail designs approved

After recording:
- [ ] Captions uploaded and synced (YouTube auto-captions + manual review)
- [ ] Videos listed as `Unlisted` for internal review
- [ ] Links added to docs
- [ ] Videos published and listed in this document

---

## Video 1: Connect Your Wallet and Make Your First Deposit

**Target length:** 5 minutes  
**YouTube link:** *(add after publishing)*

### Description (YouTube)

Learn how to connect your Stellar wallet to Aura Vault Protocol and make your very first deposit — in under 5 minutes. No prior Stellar experience needed.

Aura Vault auto-compounds your yield through permissionless keepers so you earn more without doing anything after depositing.

Chapters:
00:00 Introduction
00:30 What you need before you start
01:15 Connecting your Freighter wallet
02:00 Understanding the vault dashboard
02:45 Approving the token allowance
03:15 Making your first deposit
04:10 Checking your share balance
04:40 Summary and next steps

---

### Script

---

**[00:00 — Intro]**

*[Screen: Aura Vault homepage hero animation]*

**NARRATOR (V.O.):**
Welcome to Aura Vault Protocol — the easiest way to earn auto-compounded yield on Stellar.

In this video I'll show you how to connect your Freighter wallet and make your first deposit in under five minutes. You don't need any prior Stellar experience.

---

**[00:30 — What you need]**

*[Screen: Static slide listing prerequisites]*

**NARRATOR (V.O.):**
Before we start, you'll need three things:

First — the **Freighter browser extension**. It's Stellar's most popular non-custodial wallet and it's free. If you don't have it yet, go to freighter.app and follow the setup guide. I'll link it in the description.

Second — some **XLM in your wallet** for transaction fees. A couple of dollars worth is more than enough — Stellar fees are tiny, typically fractions of a cent.

Third — the **underlying token** that this vault accepts. For this demo I'm using test tokens on Stellar's testnet, but the steps are identical on mainnet.

---

**[01:15 — Connecting the wallet]**

*[Screen: Browser with Aura Vault app at app.auravault.io/testnet]*

**NARRATOR (V.O.):**
Let's open the Aura Vault app. I'm on the testnet version — notice the orange "Testnet" badge at the top.

Click the **Connect Wallet** button in the top-right corner.

*[Clicks "Connect Wallet"]*

A modal appears listing the supported wallet options. I'll choose **Freighter**.

*[Freighter popup appears]*

The Freighter extension is asking me to approve the connection request. I'll click **Connect**.

*[Clicks Connect in Freighter]*

And just like that — my wallet is connected. You can see my address truncated in the top-right corner. If I hover over it I can see the full address.

The dashboard now shows my current vault share balance — which is zero because I haven't deposited yet.

---

**[02:00 — The vault dashboard]**

*[Screen: Dashboard overview, mouse highlights each metric card]*

**NARRATOR (V.O.):**
Let's take 30 seconds to understand what we're looking at.

**Total Assets** shows the total value locked in the vault right now — that's everyone's deposits plus all the yield that's been harvested and compounded.

**Share Price** is the current exchange rate: one share is worth this many underlying tokens. It starts at 1.0 and increases every time yield is harvested.

**Your Shares** is your personal balance. Zero right now.

**Estimated APY** is based on the last 7 days of yield harvests — it's an estimate, not a guarantee.

---

**[02:45 — Token allowance]**

*[Screen: Deposit panel, amount input focused]*

**NARRATOR (V.O.):**
Now I'll make a deposit. I'll type 100 into the deposit field — that's 100 of the underlying tokens.

*[Types 100 in the deposit field]*

Before the vault can pull tokens from my wallet, I need to give it permission. This is called an **allowance** or **approval** — it's standard across all DeFi protocols.

Click **Approve**.

*[Approval transaction appears in Freighter]*

Freighter is asking me to approve a token allowance. I'll click **Approve** here.

*[Clicks Approve]*

This takes a second to confirm on-chain. You'll see a spinner, then a green tick when it's done.

---

**[03:15 — Making the deposit]**

*[Screen: Deposit button now active]*

**NARRATOR (V.O.):**
Now the **Deposit** button is enabled. Let's click it.

*[Clicks Deposit]*

Freighter pops up again — this time asking me to sign the deposit transaction. I can see the amount: 100 tokens going into the vault. I'll approve it.

*[Clicks Approve in Freighter]*

The transaction is submitted to the Stellar network. Stellar's average block time is about 5 seconds, so this is quick.

*[Confirmation animation plays]*

Done! The vault confirmed my deposit.

Let me walk through what just happened:
- I sent 100 underlying tokens into the vault.
- Because I'm the first depositor, the vault minted exactly **100 shares** for me at a 1:1 ratio.
- The vault's `total_assets` is now 100, and my `balance_of` is 100 shares.

---

**[04:10 — Checking your balance]**

*[Screen: Dashboard refreshes showing updated balance]*

**NARRATOR (V.O.):**
The dashboard has refreshed automatically. I can see:

- **Your Shares: 100**
- **Estimated Value: 100 tokens** (share price is still 1.0 right after deposit)
- **Your Pool Share: 100%** — I'm currently the only depositor

Over time, as yield is harvested by keepers and the share price increases, my 100 shares will be worth more than 100 tokens.

---

**[04:40 — Summary]**

*[Screen: Split view — dashboard on left, short bullet list on right]*

**NARRATOR (V.O.):**
That's everything! Let's recap:

1. Install Freighter and fund it with a small amount of XLM.
2. Connect to the Aura Vault app and approve the wallet.
3. Enter an amount and approve the token allowance.
4. Confirm the deposit transaction — your shares are minted immediately.
5. Watch your share value grow as yield is harvested automatically.

In the next video I'll show you how to track your portfolio performance and withdraw your funds whenever you want.

Subscribe so you don't miss it, and drop any questions in the comments.

---

### Captions (SRT excerpt)

```srt
1
00:00:00,000 --> 00:00:05,500
Welcome to Aura Vault Protocol — the easiest way
to earn auto-compounded yield on Stellar.

2
00:00:05,500 --> 00:00:11,000
In this video I'll show you how to connect
your Freighter wallet and make your first deposit
in under five minutes.

3
00:00:11,000 --> 00:00:15,500
You don't need any prior Stellar experience.

4
00:00:30,000 --> 00:00:36,000
Before we start, you'll need three things.

5
00:00:36,000 --> 00:00:44,000
First — the Freighter browser extension.
It's Stellar's most popular non-custodial wallet
and it's free.
```

*(Full caption file: `captions/video-01-en.srt` — to be generated from final recording)*

---

---

## Video 2: Monitor Your Portfolio and Withdraw

**Target length:** 4 minutes  
**YouTube link:** *(add after publishing)*

### Description (YouTube)

Already deposited into Aura Vault? In this short tutorial you'll learn how to monitor your portfolio performance — including your current yield — and how to withdraw your tokens at any time.

Your withdrawal happens in seconds. There are no lock-up periods or withdrawal queues.

Chapters:
00:00 Introduction
00:20 Reading the portfolio dashboard
01:10 Understanding share price and yield
01:55 Calculating how much you'd receive on withdrawal
02:35 Withdrawing your shares
03:20 Checking your token balance after withdrawal
03:45 Summary

---

### Script

---

**[00:00 — Intro]**

*[Screen: Dashboard showing a non-zero share balance and positive APY]*

**NARRATOR (V.O.):**
In Video 1 we made a deposit and received vault shares. Now I want to show you how to keep an eye on your position and — when the time comes — how to withdraw.

This is a 4-minute video. Let's dive in.

---

**[00:20 — Reading the dashboard]**

*[Screen: Dashboard, mouse moves between metric cards]*

**NARRATOR (V.O.):**
Here's the portfolio dashboard. I have 100 shares. Let's walk through what each number tells me.

**Share Price** is the most important number. It started at 1.00 when I deposited and it's now 1.09. That means each of my 100 shares is now worth 1.09 underlying tokens.

**Estimated Value** does the maths for me: 100 shares × 1.09 = 109 tokens. I deposited 100 tokens, so I've earned 9 tokens in yield so far.

**Estimated APY** shows the annualised rate based on recent harvest history. This is an estimate — actual returns depend on ongoing yield and keeper activity.

**Performance chart** shows share price over time. Each upward step is a harvest event.

---

**[01:10 — Share price and yield mechanics]**

*[Screen: Chart zoomed in on a harvest event, with an annotation explaining the jump]*

**NARRATOR (V.O.):**
Let me quickly explain why your share price goes up.

When a keeper harvests yield, they inject underlying tokens into the vault. The vault's `total_assets` increases, but the number of shares stays the same. So each share is now worth more tokens.

You don't need to do anything to receive this yield. You benefit automatically just by holding shares.

This is auto-compounding: the yield you earn in week one becomes part of `total_assets`, which earns more yield in week two, and so on.

---

**[01:55 — Calculating withdrawal value]**

*[Screen: Withdraw panel, amount input]*

**NARRATOR (V.O.):**
Let's say I want to withdraw some of my position. I'll navigate to the **Withdraw** tab.

I can type in the number of shares I want to redeem. Let me enter 50.

The panel immediately shows me the **estimated underlying tokens** I'll receive: 50 shares × share price 1.09 = ~54.5 tokens.

Notice the small **slippage note** at the bottom — the final amount uses a floor division in the contract, so you may receive very slightly less than the displayed estimate if the share price ticked up between now and when the transaction confirms.

I can also click **Max** to withdraw all my shares at once.

---

**[02:35 — Withdrawing]**

*[Screen: 50 typed in shares field, Withdraw button prominent]*

**NARRATOR (V.O.):**
I'm happy with 50 shares. Let me click **Withdraw**.

*[Freighter popup]*

Freighter is asking me to sign the withdraw transaction. The fee is a fraction of a cent. I'll approve it.

*[Clicks Approve]*

A few seconds later — confirmed.

The vault burned my 50 shares and sent me approximately 54.5 underlying tokens. My remaining balance is 50 shares.

---

**[03:20 — Checking the token balance]**

*[Screen: Token balance in wallet, and updated dashboard]*

**NARRATOR (V.O.):**
I can confirm the withdrawal was successful in two ways.

On the Aura Vault dashboard, my **Your Shares** dropped from 100 to 50.

In my Freighter wallet, my underlying token balance increased by ~54 tokens.

Because I still hold 50 shares, I continue earning yield on the remaining position. I can withdraw the rest at any time — there are no lock-up periods.

---

**[03:45 — Summary]**

*[Screen: Dashboard with 50-share balance]*

**NARRATOR (V.O.):**
Let's recap:

1. Track your position on the dashboard — share price tells you how much yield you've earned.
2. The share price increases automatically after every keeper harvest — you don't need to claim anything.
3. To withdraw, go to the Withdraw tab, enter shares, confirm in Freighter. Tokens arrive in seconds.
4. There are no lock-ups. Withdraw any amount, any time.

In Video 3 we'll look at advanced features: how keepers harvest, how the admin manages the vault, and the most important security tips.

---

### Captions (SRT excerpt)

```srt
1
00:00:00,000 --> 00:00:06,000
In Video 1 we made a deposit and received vault shares.
Now I want to show you how to monitor your position
and how to withdraw.

2
00:00:20,000 --> 00:00:28,000
Share Price is the most important number.
It started at 1.00 when I deposited
and it's now 1.09.

3
00:00:28,000 --> 00:00:36,000
That means each of my 100 shares
is now worth 1.09 underlying tokens.
```

*(Full caption file: `captions/video-02-en.srt` — to be generated from final recording)*

---

---

## Video 3: Harvest, Admin Features, and Security Tips

**Target length:** 6 minutes  
**YouTube link:** *(add after publishing)*

### Description (YouTube)

Go deeper with Aura Vault. This video covers how permissionless keepers harvest yield and increase your returns, how admins manage the vault including the emergency pause, and the most important security practices every user should know.

Chapters:
00:00 Introduction
00:25 What is a keeper and why permissionless?
01:15 How harvest increases your share price (live demo)
02:10 Running a keeper bot
02:55 Admin features: fees, treasury, pause
04:10 Emergency pause — what it means for your funds
04:55 Security tips for every user
05:35 Summary and next steps

---

### Script

---

**[00:00 — Intro]**

*[Screen: Terminal window + Aura Vault dashboard side by side]*

**NARRATOR (V.O.):**
Welcome to Video 3, the advanced deep-dive into Aura Vault Protocol.

We'll cover three topics in 6 minutes:

One: how keepers harvest yield and make your shares more valuable.
Two: the admin tools that protect the vault.
Three: the most important security practices to keep your funds safe.

Let's go.

---

**[00:25 — Keepers and permissionless harvesting]**

*[Screen: Diagram — yield source → keeper wallet → harvest() → vault total_assets]*

**NARRATOR (V.O.):**
The vault's yield doesn't appear by magic. Someone has to call the `harvest` function to inject it.

That someone is a **keeper** — any Stellar account can be a keeper. There is no allowlist. There is no special registration. It's completely open.

Here's the flow:

1. Yield accrues somewhere outside the vault — maybe from a liquidity pool, a lending protocol, or a yield-generating strategy.
2. A keeper collects those tokens.
3. The keeper calls `harvest(caller, yield_amount)` on the vault.
4. The vault pulls the tokens in, deducts the performance fee, and credits the net yield to `total_assets`.
5. Because `total_assets` went up and `total_shares` stayed the same, the share price ticks up for every single depositor instantly.

Why permissionless? Because it means no single keeper can hold yield hostage. If one keeper goes offline, any other participant can step in. Competition among keepers means depositors get more timely yield distribution.

---

**[01:15 — Live harvest demo]**

*[Screen: Terminal running a keeper script, dashboard visible in corner]*

**NARRATOR (V.O.):**
Let me show you a harvest in action. I have a simple script running here that watches a yield source and calls harvest when enough has accumulated.

*[Terminal shows: "Accumulated yield: 50000. Executing harvest…"]*

The script detected 50,000 tokens of accumulated yield. It's now building and signing the harvest transaction.

*[Terminal: "TX submitted: abc123…"]*
*[Terminal: "✅ Confirmed in ledger 4523891"]*

Transaction confirmed. Let's switch to the dashboard.

*[Screen: Dashboard refreshes, Share Price ticks up]*

The Share Price just jumped from 1.090 to 1.134. That's the 50,000 tokens net of the 10% performance fee — 45,000 tokens added to `total_assets`, divided among all outstanding shares.

Every depositor's position just became worth more, automatically, without them doing anything.

---

**[02:10 — Running a keeper bot]**

*[Screen: Code editor showing keeper-bot.js]*

**NARRATOR (V.O.):**
If you want to run your own keeper, we've published a full Node.js bot in the [Keeper Guide](/docs/keeper-guide.md).

The key pieces are:

- **A check for vault state** — is the vault initialised? Is it paused? Are there any depositors? The bot skips harvest if any of these fail.
- **A yield threshold** — only harvest when accumulated yield exceeds your configured minimum. This prevents wasting fees on tiny harvests.
- **A time-based fallback** — harvest at least once every N hours even if the yield threshold hasn't been reached, to keep compounding active.
- **A polling loop** — the bot polls for transaction confirmation and logs results.

The keeper key only needs enough XLM for transaction fees — no special privileges required.

---

**[02:55 — Admin features]**

*[Screen: Admin panel in the UI]*

**NARRATOR (V.O.):**
Now let's look at the vault from the admin's perspective.

The **admin** is the address configured at vault initialization. They have three exclusive powers:

**Set Fees** — the admin can update the performance fee (0–20%) and the annual management fee (0–1%). These changes take effect on the next harvest.

*[Shows set_fees form with sliders]*

**Set Treasury** — the address where accumulated protocol fees are sent when `withdraw_fees` is called.

**Pause and Unpause** — the emergency circuit breaker.

There is also an **on-chain governance system** for sensitive admin operations like changing the admin address itself. Governance changes require a quorum of signers and a time-lock, so no single key can unilaterally replace the admin.

---

**[04:10 — Emergency pause]**

*[Screen: Pause button in admin panel, then a paused vault banner]*

**NARRATOR (V.O.):**
The emergency pause is one of the most important safety mechanisms. If the admin detects suspicious activity — like an unusual balance discrepancy or an attempted attack — they can call `pause()` to halt all deposits, withdrawals, and harvests immediately.

*[Clicks Pause in demo UI]*

When the vault is paused, users see this orange banner. All read-only operations still work — you can still check your balance and the total assets. But you cannot move funds in or out until the admin calls `unpause()`.

**Your funds are safe when the vault is paused.** A paused vault is in a protective state, not a compromised one. The admin pauses _to prevent loss_, not because funds are already gone.

As a user, if you see the paused banner:
1. Do not panic.
2. Check the protocol's official Twitter / Discord for an update.
3. Wait for the all-clear before resuming.

---

**[04:55 — Security tips]**

*[Screen: Clean slide with bullet points appearing one by one]*

**NARRATOR (V.O.):**
Regardless of whether you're a depositor, keeper, or admin, here are the most important security practices for using Aura Vault.

**Tip 1: Verify the contract ID.**
Always confirm you're interacting with the official deployed contract. The official contract ID is published on our docs site and pinned in our Discord. Phishing sites may use lookalike addresses.

**Tip 2: Never send tokens directly to the vault address.**
The only legitimate way to deposit is through the `deposit` function. Sending tokens directly bypasses share issuance — you would not receive any shares, and the vault's balance-tracking guard would trigger a `BalanceMismatch` error on the next legitimate transaction.

**Tip 3: Small test transactions first.**
When integrating a new tool or script, test with a small amount before committing large positions.

**Tip 4: Watch for the `suspicious` event.**
On-chain tools and dashboards that monitor the vault's event log will surface `suspicious` events immediately when a balance discrepancy is detected. If you see this, stop transacting and investigate.

**Tip 5: Use hardware wallets for large positions.**
Freighter supports Ledger hardware wallets. For holdings above your personal risk threshold, sign transactions with a hardware wallet for an extra layer of protection.

---

**[05:35 — Summary and next steps]**

*[Screen: Three-column layout — links to docs, Discord, YouTube]*

**NARRATOR (V.O.):**
That's a wrap on the Aura Vault video series. Let's review what we covered across all three videos:

- Video 1: Connect your wallet and make your first deposit.
- Video 2: Monitor your position and withdraw on your schedule.
- Video 3: How keepers earn you yield, admin tools, and the security properties that protect your funds.

For deeper technical documentation, head to our docs site — links are in the description.

If you want to run a keeper bot, the full Node.js source is in the Keeper Guide.

Join our Discord to ask questions, report issues, or just say hello.

Thanks for watching. Safe yields.

---

### Captions (SRT excerpt)

```srt
1
00:00:00,000 --> 00:00:07,000
Welcome to Video 3, the advanced deep-dive
into Aura Vault Protocol.

2
00:00:07,000 --> 00:00:14,000
We'll cover three topics in 6 minutes:
how keepers harvest yield,
the admin tools that protect the vault,
and the most important security practices.

3
00:00:25,000 --> 00:00:34,000
The vault's yield doesn't appear by magic.
Someone has to call the harvest function
to inject it.

4
00:00:34,000 --> 00:00:40,000
That someone is a keeper —
any Stellar account can be a keeper.
There is no allowlist.
```

*(Full caption file: `captions/video-03-en.srt` — to be generated from final recording)*

---

## Caption Standards

All captions must meet the following criteria before a video is published:

- **Language:** English (`en`) captions manually reviewed (do not rely solely on YouTube auto-captions).
- **Line length:** Maximum 42 characters per line, 2 lines per caption block.
- **Reading speed:** Maximum 17 words per second; aim for 14.
- **Timing accuracy:** Captions must be synchronised to within ±0.2 seconds of the spoken word.
- **Technical terms:** Spell out correctly: `harvest`, `total_assets`, `balance_of`, `VaultError`, `Freighter`, `SEP-41`.
- **Numbers:** Write numerals (`100 tokens`) not words (`one hundred tokens`) for amounts.
- **Format:** Standard `.srt` file uploaded to YouTube. Also export `.vtt` for the website player.

Additional languages will be added as community-contributed translations are reviewed.

---

## Links

- YouTube channel: https://youtube.com/@auravaultprotocol *(pending setup)*
- Keeper Guide: [/docs/keeper-guide.md](/docs/keeper-guide.md)
- Error Reference: [/docs/error-reference.md](/docs/error-reference.md)
- Rust Integration: [/docs/integration-rust.md](/docs/integration-rust.md)
- Getting Started: [/docs/getting-started.md](/docs/getting-started.md)

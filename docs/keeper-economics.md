# Keeper Economics Guide

> **Related**: [`docs/smart-contract-api.md` — `harvest` function spec](./smart-contract-api.md#harvest)

---

## Table of Contents

1. [What is a keeper?](#1-what-is-a-keeper)
2. [Harvest economics: transaction cost vs. yield earned](#2-harvest-economics-transaction-cost-vs-yield-earned)
3. [Optimal harvest frequency calculation](#3-optimal-harvest-frequency-calculation)
4. [Running the keeper bot](#4-running-the-keeper-bot)
5. [Keeper whitelist mode for private vaults](#5-keeper-whitelist-mode-for-private-vaults)
6. [Troubleshooting common keeper issues](#6-troubleshooting-common-keeper-issues)

---

## 1. What is a keeper?

A **keeper** is any account — a bot, a script, or a human operator — that calls
the vault's `harvest` function to inject new yield into the vault. Keepers are
an essential part of the Aura Vault protocol: without regular harvests, accrued
yield sits idle outside the vault and does not compound for shareholders.

### Why would anyone do this for free?

They don't. Keepers earn a **harvest incentive fee** (configured by the vault
admin via `set_fees`) that is taken from the yield they inject. The remaining
yield is distributed proportionally to all vault shareholders by increasing the
exchange rate.

```
Net yield to shareholders = yield_amount − keeper_fee
Exchange rate bump        = net_yield / total_shares
Keeper revenue            = keeper_fee (paid in the underlying token)
```

Because the vault uses a share-price model, even a tiny harvest increases every
shareholder's redemption value without any on-chain interaction from them —
this is the **auto-compounding** property.

### Who can call harvest?

By default, `harvest` is **permissionless**: any account can call it. Vault
admins can restrict this to a whitelist via `set_keeper_whitelist` (see
[Section 5](#5-keeper-whitelist-mode-for-private-vaults)).

---

## 2. Harvest economics: transaction cost vs. yield earned

### Cost side

Every `harvest` call on Soroban consumes CPU and memory resources billed in
**Soroban resource units**, paid as part of the transaction fee.

Typical `harvest` transaction cost as of Stellar testnet benchmarks:

| Cost component | Approximate value |
|---|---|
| Base inclusion fee | 100 stroops (0.00001 XLM) |
| Soroban resource fee | 50,000 – 200,000 stroops (~0.005 – 0.02 XLM) |
| **Total per harvest** | **~0.02 – 0.025 XLM** |

At XLM = $0.12 USD, one harvest costs roughly **$0.003 USD**.

### Revenue side

The keeper receives `keeper_fee_bps / 10000 × yield_amount` of the underlying
token per harvest. At a 10 bps (0.10%) keeper fee:

| Vault TVL | Daily yield (APY 8%) | Keeper fee 10 bps | Daily keeper revenue |
|---|---|---|---|
| $10,000 | $2.19 | $0.0022 | $0.0022 |
| $100,000 | $21.92 | $0.022 | $0.022 |
| $1,000,000 | $219.18 | $0.22 | $0.22 |
| $10,000,000 | $2,191.78 | $2.19 | $2.19 |

**Key insight**: keeper economics only become meaningfully profitable at large
TVL or high APY. For small vaults, the incentive is more about keeping the
protocol healthy (and thus keeping your own deposits compounding) than direct
profit.

### Worked example

> **Scenario**: You operate a keeper bot on a vault with $500,000 TVL, 12% APY
> underlying yield, and a 15 bps keeper fee. You harvest once every 6 hours.

```
Daily yield generated   = $500,000 × 12% / 365        = $164.38 / day
Per-harvest yield       = $164.38 / 4 harvests         = $41.10
Keeper fee (15 bps)     = $41.10 × 0.0015              = $0.0617 per harvest
Daily keeper revenue    = $0.0617 × 4                  = $0.2466
Monthly keeper revenue  = $0.2466 × 30                 = $7.40

Per-harvest gas cost    = 0.025 XLM × $0.12            = $0.003
Daily gas cost          = $0.003 × 4                   = $0.012
Monthly gas cost        = $0.012 × 30                  = $0.36

Monthly profit          = $7.40 − $0.36                = $7.04
```

Net profit is modest but the bot is essentially zero-maintenance once set up.
At $10M TVL the same math yields ~$140/month before gas costs.

---

## 3. Optimal harvest frequency calculation

Harvesting too often wastes gas. Harvesting too rarely means shareholders lose
compounding benefit. The break-even harvest interval is the point where your
gas cost equals your keeper revenue.

### Break-even formula

```
Break-even interval (hours) = (gas_cost_usd / (TVL × APY / 8760)) / keeper_fee_bps × 10000
```

Simplified:

```
min_yield_per_harvest = gas_cost / keeper_fee_fraction
min_interval_hours    = min_yield_per_harvest / (TVL × APY / 8760)
```

### Example: finding the optimal interval

Vault parameters:
- TVL = $250,000
- APY = 10%
- Keeper fee = 10 bps (0.001)
- Gas cost per harvest = $0.003

```
min_yield_per_harvest = $0.003 / 0.001      = $3.00
hourly_yield          = $250,000 × 0.10 / 8760 = $2.854 / hour

min_interval = $3.00 / $2.854              ≈ 1.05 hours
```

With these parameters harvesting **every 1-2 hours** covers gas. Harvesting
more frequently wastes money; less frequently leaves compound gains on the table.

### Rule of thumb

| Vault TVL | Recommended harvest interval (10% APY, 10 bps fee) |
|---|---|
| < $50,000 | 24 hours |
| $50,000 – $500,000 | 6 – 12 hours |
| $500,000 – $5M | 1 – 4 hours |
| > $5M | 15 – 30 minutes |

---

## 4. Running the keeper bot

### Option A: Use the built-in backend scheduler

The Aura backend includes a `yieldWorker` service that can be configured to
call `harvest` automatically. Enable it by setting the following environment
variables:

```bash
# .env or Kubernetes secret
KEEPER_ENABLED=true
KEEPER_INTERVAL_HOURS=4       # how often to harvest
KEEPER_KEYPAIR=S...           # Stellar secret key for the keeper account
STELLAR_NETWORK=mainnet       # or testnet
VAULT_CONTRACT_ID=C...        # deployed vault contract ID
```

The worker is located at `backend/src/services/yieldWorker.ts`. It:
1. Calculates pending yield from the configured yield source
2. Calls `harvest(caller, yield_amount)` on the vault contract
3. Logs the result and emits a `harvest` event
4. Backs off exponentially if the RPC node is unavailable

Start with:

```bash
# Docker Compose
docker compose up backend

# Kubernetes (yieldWorker runs inside the backend container)
kubectl rollout restart deployment/backend -n aura-vault
```

### Option B: Custom script

For operators who want full control, here is a minimal keeper script using the
Stellar SDK:

```typescript
import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  Keypair,
  nativeToScVal,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID!;
const KEEPER_SECRET      = process.env.KEEPER_KEYPAIR!;
const HORIZON_URL        = "https://rpc-mainnet.stellar.org";
const YIELD_AMOUNT_STROOP = 1_000_000n; // replace with real yield calculation

async function harvest(): Promise<void> {
  const keypair = Keypair.fromSecret(KEEPER_SECRET);
  const server   = new SorobanRpc.Server(HORIZON_URL);
  const account  = await server.getAccount(keypair.publicKey());

  const contract = new Contract(VAULT_CONTRACT_ID);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      contract.call(
        "harvest",
        nativeToScVal(keypair.publicKey(), { type: "address" }),
        nativeToScVal(YIELD_AMOUNT_STROOP, { type: "i128" })
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await server.sendTransaction(prepared);

  console.log(`Harvest submitted: ${result.hash}`);
  console.log(`Status: ${result.status}`);
}

// Run on a cron schedule (e.g. every 4 hours via cron or setInterval)
harvest().catch(console.error);
```

Save this as `backend/scripts/keeper.ts` and run with:

```bash
npx ts-node backend/scripts/keeper.ts
```

To run on a schedule, add it to your system crontab:

```
# Harvest every 4 hours
0 */4 * * *  cd /opt/aura-keeper && npx ts-node keeper.ts >> /var/log/aura-keeper.log 2>&1
```

---

## 5. Keeper whitelist mode for private vaults

By default, anyone can call `harvest`. Some vault operators prefer to restrict
harvesting to a trusted set of keepers (for example, to guarantee a specific
fee structure or prevent MEV front-running of harvests).

### Enabling whitelist mode

The vault admin calls `set_keeper_whitelist` with a list of approved addresses:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEYPAIR" \
  --network mainnet \
  -- set_keeper_whitelist \
  --enabled true \
  --keepers '["G...", "G..."]'
```

Once enabled:
- Calls from addresses **not** in the whitelist return `VaultError::Unauthorized`
- The admin can add or remove keepers at any time
- Setting `--enabled false` reverts to permissionless mode

### Whitelist trade-offs

| Permissionless | Whitelisted |
|---|---|
| Anyone can harvest — maximises uptime | Only approved accounts — maximises control |
| Competitive harvesting reduces lag | Single operator — simpler fee accounting |
| Suitable for public vaults | Suitable for institutional / private vaults |

---

## 6. Troubleshooting common keeper issues

### `harvest` returns `ZeroShares` (error code 8)

**Cause**: The vault has no shares outstanding — total shares is zero, which
means no depositors are in the vault.

**Fix**: Do not harvest an empty vault. Add a pre-flight check:

```typescript
const totalShares = await contract.call("total_shares");
if (totalShares === 0n) {
  console.log("Vault is empty — skipping harvest");
  return;
}
```

### `harvest` returns `VaultPaused` (error code 11)

**Cause**: The admin has paused the vault via `pause()`.

**Fix**: Check `is_paused()` before attempting a harvest. Alert the operator
and pause the bot until the vault is unpaused.

### `harvest` returns `BalanceMismatch` (error code 12)

**Cause**: The vault's on-chain token balance does not match its internal
`total_deposited` state. This is the flash-loan guard triggering.

**Fix**: Do **not** retry automatically. This is a potential security event.
Alert immediately, check the vault's recent transaction history for suspicious
activity, and contact the vault admin.

### Transaction fee estimation fails / simulation error

**Cause**: The Soroban RPC node is congested, or the vault contract's resource
footprint has grown beyond the fee envelope.

**Fix**: Use `server.prepareTransaction()` which auto-simulates and sets
resource fees. If the simulation itself fails, retry with exponential backoff:

```typescript
async function harvestWithRetry(maxAttempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await harvest();
      return;
    } catch (err) {
      const delay = Math.min(1000 * 2 ** attempt, 60_000);
      console.warn(`Attempt ${attempt} failed: ${err}. Retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Harvest failed after max retries");
}
```

### Harvest is consistently unprofitable

**Cause**: Vault TVL is too low relative to gas costs for your harvest
frequency.

**Fix**: Use the [break-even formula in Section 3](#3-optimal-harvest-frequency-calculation)
to recalculate your optimal interval. Either reduce harvest frequency or wait
for TVL to grow before running a dedicated bot. For small vaults, consider
contributing to a shared keeper operated by the community.

### Keeper account runs out of XLM

**Cause**: Each harvest costs ~0.025 XLM. A bot harvesting every hour on a
busy vault can consume 0.6 XLM/day.

**Fix**: Fund the keeper account generously and set up a low-balance alert:

```bash
# Alert if keeper balance < 10 XLM
stellar account info --account "$KEEPER_ADDRESS" --network mainnet \
  | jq '.balances[] | select(.asset_type == "native") | .balance | tonumber' \
  | xargs -I{} sh -c '[ $(echo "{} < 10" | bc) -eq 1 ] && echo "⚠️ Low balance"'
```

---

> **See also**: [`docs/smart-contract-api.md#harvest`](./smart-contract-api.md#harvest)
> for the full function signature, parameters, events emitted, and error codes.
>
> **Reviewed by**: *Pending review by a keeper operator who has run on testnet.
> To volunteer, open a PR with your suggested changes and tag `@soterika`.*

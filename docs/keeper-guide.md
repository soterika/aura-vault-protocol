# Keeper Guide — Aura Vault Protocol

Keepers are the agents that make the Aura Vault auto-compound. This guide explains the keeper role, how harvest works under the hood, how to calculate optimal timing, and how to build and operate an automated keeper bot.

---

## Table of Contents

1. [What Is a Keeper?](#what-is-a-keeper)
2. [How Harvest Works](#how-harvest-works)
3. [Fee Mechanics and Keeper Rewards](#fee-mechanics-and-keeper-rewards)
4. [Optimal Harvest Timing](#optimal-harvest-timing)
5. [Gas Cost Analysis](#gas-cost-analysis)
6. [Automated Keeper Bot (Node.js)](#automated-keeper-bot-nodejs)
7. [Running the Bot](#running-the-bot)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)
10. [See Also](#see-also)

---

## What Is a Keeper?

A **keeper** is any Stellar account that calls the `harvest` function on the Aura Vault. The vault uses a **permissionless keeper model**: anyone can act as a keeper at any time. There is no allowlist, no registration, and no exclusive keeper role.

### Why permissionless?

Permissionless harvesting is a deliberate design choice:

- **Censorship resistance** — no single entity can block yield distribution.
- **Liveness** — if the primary keeper goes offline, any other participant can step in.
- **Competition** — multiple keepers competing to harvest in a timely manner ensures depositors receive yield promptly.
- **Trust minimisation** — keepers cannot steal funds; they can only inject new yield into the vault.

### What does a keeper do?

1. Monitors an external yield source (a liquidity pool, lending protocol, or strategy contract).
2. Collects the accrued yield tokens on behalf of the vault.
3. Calls `harvest(caller, yield_amount)` to inject those tokens into the vault.
4. The vault distributes the net yield (after the performance fee) proportionally across all existing shareholders by increasing `total_assets`.

---

## How Harvest Works

At the smart-contract level, `harvest` executes the following steps atomically:

```
1. Validate inputs
   - yield_amount must be > 0  (→ ZeroAmount if not)
   - vault must be initialized  (→ NotInitialized)
   - vault must not be paused   (→ VaultPaused)
   - total_shares must be > 0   (→ ZeroShares)

2. Flash-loan guard
   - Reads actual on-chain token balance
   - Compares with stored total_deposited
   - If they differ: emits "suspicious" event → returns BalanceMismatch

3. Performance fee deduction
   fee_amount       = yield_amount × perf_fee_bps / 10_000
   yield_after_fee  = yield_amount − fee_amount

4. State update
   new_total_deposited = total_deposited + yield_after_fee
   total_fee_collected += fee_amount

5. Token transfer
   SEP-41 transfer: caller → vault contract, amount = yield_amount

6. Event emission
   topics: ("harvest", caller, yield_amount)
   data:   (yield_after_fee, fee_amount, new_total_deposited)
```

The key property: **no new shares are minted**. When `total_assets` increases while `total_shares` stays constant, the exchange rate (`total_assets / total_shares`) goes up. All existing shareholders receive yield proportionally, automatically, just by holding their shares.

### Example

- Before harvest: `total_assets = 1,000,000`, `total_shares = 1,000,000`
- Exchange rate: 1.000 (1 token per share)
- Keeper injects `100,000` yield tokens, `perf_fee_bps = 1000` (10%)
- `fee_amount = 10,000`, `yield_after_fee = 90,000`
- After harvest: `total_assets = 1,090,000`, `total_shares = 1,000,000`
- Exchange rate: 1.090 (1.09 tokens per share)
- A holder of 500,000 shares can now redeem ~545,000 tokens (up from 500,000)

---

## Fee Mechanics and Keeper Rewards

### Performance fee

The performance fee is taken from each harvest yield amount:

```
fee_amount = floor(yield_amount × perf_fee_bps / 10_000)
```

| `perf_fee_bps` | Fee rate | Fee on 1,000,000 yield |
|---|---|---|
| 0 | 0% | 0 |
| 500 | 5% | 50,000 |
| 1000 | 10% | 100,000 |
| 2000 | 20% (max) | 200,000 |

The accumulated fee is stored in `total_fees_collected` and is paid to the treasury when the admin calls `withdraw_fees`.

### Management fee

An annual management fee accrues daily:

```
daily_fee = floor(total_assets × mgmt_fee_bps / 10_000 / 365)
```

The management fee is currently 0–100 bps (0–1%) annually.

### Keeper rewards

Aura Vault does not pay keepers directly from the protocol fee. The keeper incentive model is:

1. **Reciprocal benefit** — keepers are typically large vault depositors. By harvesting, they increase the exchange rate, which increases the value of their own shares.
2. **Gas reimbursement schemes** — third-party reward aggregators or the protocol DAO may reimburse gas costs for keepers who meet minimum harvest intervals.
3. **MEV / arbitrage** — sophisticated keepers may extract additional value from price discrepancies created by a harvest.

To claim gas reimbursement (when available), keepers must submit their transaction hash and the harvested amount to the configured reward contract or off-chain portal.

---

## Optimal Harvest Timing

Calling `harvest` too often wastes gas with negligible yield gain. Calling it too rarely lets yield sit idle and reduces depositor APY. The optimal timing depends on three factors:

### 1. Accumulated yield threshold

Only harvest when the accumulated off-vault yield exceeds the gas cost by a meaningful margin. A common heuristic:

```
harvest when: yield_accumulated > gas_cost_usd × safety_factor
```

For Stellar's current fee schedule (approximately 100,000 stroops ≈ $0.003–$0.01 per transaction), harvests are economical even for small amounts. A practical threshold is:

```
minimum_yield_to_harvest = 50 × estimated_gas_cost_in_underlying_tokens
```

### 2. Time-based interval

Even when yield is low, harvesting at regular intervals prevents the management fee accrual clock from drifting. A weekly harvest cadence is a reasonable minimum.

### 3. APY sensitivity

For a given yield rate `r` per period and harvest interval `n` periods, the compound APY approximation is:

```
APY ≈ (1 + r)^(365/n) − 1
```

| Daily yield rate | Harvest every 1 day | Harvest every 7 days | Harvest every 30 days |
|---|---|---|---|
| 0.01% | 3.76% APY | 3.62% APY | 3.22% APY |
| 0.05% | 20.11% APY | 19.27% APY | 17.09% APY |
| 0.1% | 44.03% APY | 42.09% APY | 37.18% APY |

Harvesting daily maximises depositor APY. Harvesting weekly loses roughly 0.4–0.6 percentage points at moderate yield rates — acceptable for most strategies given gas savings.

### Decision algorithm

```
every 5 minutes:
  accumulated_yield = query_external_yield_source()
  gas_cost          = estimate_harvest_gas()
  
  if accumulated_yield > gas_cost * 50:
    harvest now
  elif time_since_last_harvest > 7 days:
    harvest now (time-based fallback)
  else:
    wait
```

---

## Gas Cost Analysis

### Harvest transaction cost components

| Component | Approximate cost (stroops) |
|---|---|
| Base transaction fee | 100 |
| Host function execution | ~50,000–80,000 |
| Storage reads (instance) | ~5,000 |
| Storage writes (instance) | ~10,000 |
| SEP-41 token transfer | ~30,000 |
| **Total (typical)** | **~100,000–130,000 stroops** |

At an XLM price of $0.10 and 10,000,000 stroops per XLM, 130,000 stroops ≈ **$0.0013 per harvest call**.

### Fee simulation

Before executing a harvest, simulate the transaction to confirm the fee and verify the call will succeed:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_ADDRESS> \
  --network testnet \
  --sim-only \
  -- harvest \
  --caller <KEEPER_ADDRESS> \
  --yield_amount <AMOUNT>
```

---

## Automated Keeper Bot (Node.js)

The following bot monitors a yield source, checks harvest conditions, and calls the vault automatically. It uses the `@stellar/stellar-sdk` package.

### Installation

```bash
npm install @stellar/stellar-sdk node-cron dotenv
```

### `.env` file

```env
KEEPER_SECRET_KEY=SKEEPER...
VAULT_CONTRACT_ID=CABC...
TOKEN_CONTRACT_ID=CTOKEN...
YIELD_SOURCE_URL=https://your-yield-api.example.com/accrued
NETWORK=testnet
RPC_URL=https://soroban-testnet.stellar.org
MIN_YIELD_THRESHOLD=10000
HARVEST_INTERVAL_HOURS=6
```

### `keeper-bot.js`

```javascript
/**
 * Aura Vault Keeper Bot
 * Permissionless harvester that monitors yield and calls harvest() on schedule.
 */

require('dotenv').config();
const {
  Keypair,
  Networks,
  SorobanRpc,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  TransactionBuilder,
  BASE_FEE,
} = require('@stellar/stellar-sdk');
const cron = require('node-cron');

// ── Configuration ─────────────────────────────────────────────────────────────
const KEEPER_KEYPAIR    = Keypair.fromSecret(process.env.KEEPER_SECRET_KEY);
const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID;
const TOKEN_CONTRACT_ID = process.env.TOKEN_CONTRACT_ID;
const RPC_URL           = process.env.RPC_URL;
const NETWORK_PASSPHRASE = process.env.NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET;

const MIN_YIELD_THRESHOLD = BigInt(process.env.MIN_YIELD_THRESHOLD || '10000');
const server              = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// ── State ─────────────────────────────────────────────────────────────────────
let lastHarvestTime   = 0;
let totalHarvested    = 0n;
let harvestCount      = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Query the vault's total_assets (read-only simulation).
 * Returns 0n if the vault is empty or uninitialized.
 */
async function getTotalAssets() {
  try {
    const contract  = new Contract(VAULT_CONTRACT_ID);
    const operation = contract.call('total_assets');
    const account   = await server.getAccount(KEEPER_KEYPAIR.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      console.error('simulateTransaction error:', simResult.error);
      return 0n;
    }

    const retval = simResult.result?.retval;
    if (!retval) return 0n;

    // Decode i128 from ScVal
    const scVal = xdr.ScVal.fromXDR(Buffer.from(retval.toXDR('base64'), 'base64'));
    return BigInt(scVal.i128().lo().toString());
  } catch (err) {
    console.error('getTotalAssets error:', err.message);
    return 0n;
  }
}

/**
 * Check whether the vault is paused.
 */
async function isVaultPaused() {
  try {
    const contract  = new Contract(VAULT_CONTRACT_ID);
    const operation = contract.call('is_paused');
    const account   = await server.getAccount(KEEPER_KEYPAIR.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) return true; // assume paused on error
    const retval = simResult.result?.retval;
    return retval?.bool() ?? false;
  } catch {
    return true;
  }
}

/**
 * Query accumulated yield from an external source (replace with real logic).
 * Should return the amount of underlying tokens ready to harvest.
 */
async function queryAccumulatedYield() {
  try {
    // Replace with your actual yield source query.
    // Examples:
    //   - Read from a Stellar liquidity pool's accrued rewards
    //   - Query an off-chain aggregator API
    //   - Check a strategy contract balance
    const response = await fetch(process.env.YIELD_SOURCE_URL);
    const data     = await response.json();
    return BigInt(data.accrued_yield ?? 0);
  } catch (err) {
    console.warn('Could not query yield source:', err.message);
    return 0n;
  }
}

/**
 * Build, sign, submit, and confirm a harvest transaction.
 */
async function executeHarvest(yieldAmount) {
  console.log(`[harvest] Executing harvest of ${yieldAmount} underlying tokens…`);

  const caller    = new Address(KEEPER_KEYPAIR.publicKey()).toScVal();
  const amount    = nativeToScVal(yieldAmount.toString(), { type: 'i128' });
  const contract  = new Contract(VAULT_CONTRACT_ID);
  const operation = contract.call('harvest', caller, amount);

  // Build and simulate first to get the fee and footprint
  const account = await server.getAccount(KEEPER_KEYPAIR.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Assemble and sign the final transaction
  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  assembled.sign(KEEPER_KEYPAIR);

  // Submit
  const sendResult = await server.sendTransaction(assembled);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Submit error: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll for confirmation
  const txHash = sendResult.hash;
  console.log(`[harvest] TX submitted: ${txHash}`);

  let confirmed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await server.getTransaction(txHash);

    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      confirmed = true;
      console.log(`[harvest] ✅ Confirmed in ledger ${status.ledger}`);
      break;
    }
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction FAILED: ${JSON.stringify(status)}`);
    }
  }

  if (!confirmed) {
    throw new Error(`Transaction ${txHash} did not confirm within timeout`);
  }

  // Update metrics
  totalHarvested += yieldAmount;
  harvestCount++;
  lastHarvestTime = Date.now();

  console.log(
    `[harvest] Stats — count: ${harvestCount}, total harvested: ${totalHarvested}`
  );

  return txHash;
}

// ── Main harvest logic ─────────────────────────────────────────────────────────

async function runKeeperCycle() {
  console.log(`[keeper] Running cycle at ${new Date().toISOString()}`);

  // 1. Check vault is operational
  const paused = await isVaultPaused();
  if (paused) {
    console.log('[keeper] Vault is paused — skipping harvest');
    return;
  }

  // 2. Confirm there are depositors
  const totalAssets = await getTotalAssets();
  if (totalAssets === 0n) {
    console.log('[keeper] Vault has no deposits — skipping harvest');
    return;
  }

  // 3. Check accumulated yield
  const accumulatedYield = await queryAccumulatedYield();
  console.log(`[keeper] Accumulated yield: ${accumulatedYield}`);

  // 4. Evaluate harvest conditions
  const hoursSinceLastHarvest = (Date.now() - lastHarvestTime) / 3_600_000;
  const timeBasedFallback     = hoursSinceLastHarvest > Number(process.env.HARVEST_INTERVAL_HOURS || 6);
  const yieldSufficient       = accumulatedYield >= MIN_YIELD_THRESHOLD;

  if (!yieldSufficient && !timeBasedFallback) {
    console.log(
      `[keeper] Yield ${accumulatedYield} below threshold ${MIN_YIELD_THRESHOLD} ` +
      `and last harvest was ${hoursSinceLastHarvest.toFixed(1)}h ago — waiting`
    );
    return;
  }

  if (accumulatedYield === 0n) {
    console.log('[keeper] No yield to harvest');
    return;
  }

  // 5. Execute harvest
  try {
    const txHash = await executeHarvest(accumulatedYield);
    console.log(`[keeper] Harvest successful: ${txHash}`);
  } catch (err) {
    console.error('[keeper] Harvest failed:', err.message);
    // Non-fatal: bot continues running; will retry next cycle
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

// Check every 5 minutes
cron.schedule('*/5 * * * *', runKeeperCycle);

console.log('🤖 Aura Vault keeper bot started');
console.log(`   Contract: ${VAULT_CONTRACT_ID}`);
console.log(`   Keeper:   ${KEEPER_KEYPAIR.publicKey()}`);
console.log(`   Network:  ${process.env.NETWORK}`);
console.log(`   Min yield threshold: ${MIN_YIELD_THRESHOLD}`);

// Run one cycle immediately on startup
runKeeperCycle().catch(console.error);
```

### `package.json`

```json
{
  "name": "aura-vault-keeper",
  "version": "1.0.0",
  "description": "Permissionless keeper bot for Aura Vault Protocol",
  "main": "keeper-bot.js",
  "scripts": {
    "start": "node keeper-bot.js",
    "start:testnet": "NETWORK=testnet node keeper-bot.js"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^13.1.0",
    "dotenv": "^16.4.5",
    "node-cron": "^3.0.3"
  }
}
```

---

## Running the Bot

### Testnet

```bash
# Clone and enter the keeper directory
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol

# Create and populate the .env file
cp .env.staging.example keeper/.env
# Edit keeper/.env with your keys and contract IDs

# Install dependencies
npm install

# Start (testnet)
npm run start:testnet
```

### Production / Mainnet

```bash
# Run as a background service with automatic restart
npm install -g pm2
pm2 start keeper-bot.js --name aura-keeper
pm2 save
pm2 startup
```

### Monitoring

The bot logs to stdout in a structured format. Pipe it to your preferred log aggregator:

```bash
pm2 start keeper-bot.js --name aura-keeper --log ./keeper.log
```

Monitor key metrics:
- `harvestCount` — total number of harvests this session
- `totalHarvested` — cumulative yield injected
- `lastHarvestTime` — timestamp of last successful harvest
- Transaction hash per harvest (for on-chain verification)

---

## Security Considerations

### Key management

- Store `KEEPER_SECRET_KEY` in an environment variable or a secrets manager (AWS Secrets Manager, HashiCorp Vault). Never commit it to version control.
- The keeper key only needs enough XLM to pay transaction fees. Do not fund it with large token balances.
- Rotate the keeper key periodically. Anyone can call `harvest`, so there is no need to update allowlists when rotating.

### Yield source validation

- Validate that the `yield_amount` you are injecting genuinely came from the configured yield source. A keeper that injects tokens it does not own (e.g., from a misconfigured wallet balance) will still succeed on-chain but will drain the keeper's own funds.
- Cross-check the amount with the external yield API before every harvest call.

### Flash-loan guard

The vault's `BalanceMismatch (12)` protection is your first line of defense against balance manipulation. If your keeper receives this error, stop harvesting immediately and alert the protocol admin.

### Rate limiting

Soroban enforces per-account transaction rate limits. If you are running multiple keeper instances from the same keypair, serialize them to avoid throttling.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ZeroAmount (5)` | `yield_amount` is 0 or negative | Check yield source before calling harvest |
| `ZeroShares (8)` | No depositors in the vault | Wait for deposits; add guard in bot |
| `VaultPaused (11)` | Admin paused the vault | Check `is_paused()`; wait for unpause |
| `BalanceMismatch (12)` | Flash-loan guard triggered | Stop bot; investigate on-chain state; alert admin |
| `NotInitialized (1)` | Wrong contract ID | Verify `VAULT_CONTRACT_ID` in `.env` |
| Simulation fails | Insufficient XLM in keeper account | Fund the keeper account on the configured network |
| TX not confirmed | Network congestion or fee too low | Increase `BASE_FEE` multiplier; retry with backoff |

---

## See Also

- [Error Reference](/docs/error-reference.md) — all 12 error codes
- [Rust Integration Guide](/docs/integration-rust.md) — building a keeper in Rust
- [Smart Contract API](/docs/smart-contract-api.md) — full on-chain ABI
- [Security Policy](/SECURITY.md) — reporting suspicious activity

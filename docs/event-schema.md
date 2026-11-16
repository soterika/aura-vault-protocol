# Aura Vault — Contract Event Schema

This document is the authoritative reference for every event emitted by the `AuraVault` Soroban contract. It covers field names, types, units, example values, and guidance on subscribing to and parsing events using Horizon and the Stellar SDK.

---

## Event Structure Overview

Soroban contract events have two parts:

| Part | Description |
|------|-------------|
| **topics** | Indexed fields. Efficiently filterable by Horizon. The first topic is always the event name (`Symbol`). |
| **data** | Non-indexed contextual payload. Retrieved alongside the event but not directly filterable. |

All token amounts in this contract are denominated in the smallest indivisible unit of the underlying SEP-41 token (analogous to "stroops" or "wei"). There is no implicit decimal scaling — consumers must apply the token's own `decimals` field when displaying human-readable values.

---

## Events

### 1. `deposit`

Emitted when a depositor successfully deposits underlying tokens and receives vault shares.

**Trigger:** Successful execution of `deposit(caller, amount)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"deposit"` |
| 1 | `caller` | `Address` | The Stellar address that called `deposit` and whose tokens were transferred |
| 2 | `amount` | `i128` | Underlying token amount deposited, in base units |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `new_shares` | `i128` | Number of vault shares minted to `caller` this call |
| `new_total_shares` | `i128` | Total vault shares outstanding after this deposit |
| `new_total_deposited` | `i128` | Total underlying tokens held by the vault after this deposit |

#### Example

```json
{
  "topics": [
    { "type": "symbol", "value": "deposit" },
    { "type": "address", "value": "GABC...XYZ" },
    { "type": "i128",    "value": "1000000" }
  ],
  "data": [
    { "type": "i128", "value": "1000000" },
    { "type": "i128", "value": "5000000" },
    { "type": "i128", "value": "5000000" }
  ]
}
```

> First deposit: 1,000,000 units in → 1,000,000 shares out (1:1 seed ratio). After deposit, vault holds 5,000,000 total shares and 5,000,000 total underlying.

---

### 2. `withdraw`

Emitted when a shareholder burns shares and redeems underlying tokens.

**Trigger:** Successful execution of `withdraw(caller, shares)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"withdraw"` |
| 1 | `caller` | `Address` | The Stellar address that called `withdraw` and received tokens |
| 2 | `shares` | `i128` | Number of vault shares burned |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `redeem_amount` | `i128` | Underlying tokens sent back to `caller`, computed as `floor(shares × total_deposited / total_shares)` |
| `new_total_shares` | `i128` | Total vault shares outstanding after this withdrawal |
| `new_total_deposited` | `i128` | Total underlying tokens held by the vault after this withdrawal |

#### Example

```json
{
  "topics": [
    { "type": "symbol",  "value": "withdraw" },
    { "type": "address", "value": "GABC...XYZ" },
    { "type": "i128",    "value": "500000" }
  ],
  "data": [
    { "type": "i128", "value": "750000" },
    { "type": "i128", "value": "4500000" },
    { "type": "i128", "value": "4250000" }
  ]
}
```

> Burned 500,000 shares, received 750,000 underlying (exchange rate > 1 due to prior harvests).

---

### 3. `harvest`

Emitted when a permissionless keeper injects yield denominated in the vault's underlying token. No new shares are minted, so the exchange rate for all existing shareholders increases.

**Trigger:** Successful execution of `harvest(caller, yield_amount)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"harvest"` |
| 1 | `caller` | `Address` | The keeper address that provided yield |
| 2 | `yield_amount` | `i128` | Gross yield injected, in base units (before fee deduction) |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `yield_after_fee` | `i128` | Net yield credited to depositors (`yield_amount − fee_amount`) |
| `fee_amount` | `i128` | Performance fee retained by the vault treasury (`yield_amount × perf_fee_bps / 10000`) |
| `new_total` | `i128` | Total underlying tokens held by the vault after this harvest (= previous total + yield_after_fee) |

#### Example

```json
{
  "topics": [
    { "type": "symbol",  "value": "harvest" },
    { "type": "address", "value": "GKEEPER...ABC" },
    { "type": "i128",    "value": "1000000" }
  ],
  "data": [
    { "type": "i128", "value": "900000" },
    { "type": "i128", "value": "100000" },
    { "type": "i128", "value": "5900000" }
  ]
}
```

> 1,000,000 gross yield injected. 10% performance fee = 100,000. Net 900,000 added to vault. New total deposited = 5,900,000.

---

### 4. `harvest_token`

Emitted when a keeper injects yield in a whitelisted alternative token (not the vault's underlying). The contract converts the alt-token yield to an equivalent underlying value.

**Trigger:** Successful execution of `harvest_token(caller, alt_token, yield_amount, underlying_amount)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"harvest_token"` |
| 1 | `caller` | `Address` | The keeper address that provided yield |
| 2 | `alt_token` | `Address` | Contract address of the alternative yield token transferred |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `yield_amount` | `i128` | Amount of the alt-token transferred to the vault |
| `net_underlying` | `i128` | Equivalent underlying value credited to depositors (after fee) |
| `fee_amount` | `i128` | Performance fee on the underlying-equivalent value |

#### Example

```json
{
  "topics": [
    { "type": "symbol",  "value": "harvest_token" },
    { "type": "address", "value": "GKEEPER...ABC" },
    { "type": "address", "value": "GTOKEN...ALT" }
  ],
  "data": [
    { "type": "i128", "value": "500000" },
    { "type": "i128", "value": "450000" },
    { "type": "i128", "value": "50000" }
  ]
}
```

---

### 5. `yield_token_registered`

Emitted when the admin whitelists a new alternative yield token.

**Trigger:** Successful execution of `register_yield_token(alt_token)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"yield_token_registered"` |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `alt_token` | `Address` | Contract address of the newly whitelisted token |

---

### 6. `paused`

Emitted when the admin halts all mutating vault operations (`deposit`, `withdraw`, `harvest`).

**Trigger:** Successful execution of `pause(admin)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"paused"` |

#### Data

None. The data value is the Soroban unit type `()`.

#### Example

```json
{
  "topics": [
    { "type": "symbol", "value": "paused" }
  ],
  "data": null
}
```

---

### 7. `unpaused`

Emitted when the admin resumes normal vault operations after a pause.

**Trigger:** Successful execution of `unpause(admin)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"unpaused"` |

#### Data

None.

---

### 8. `upgrade`

Emitted when the admin upgrades the contract Wasm to a new version.

**Trigger:** Successful execution of `upgrade(new_wasm_hash)`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"upgrade"` |
| 1 | `admin` | `Address` | The admin address that initiated the upgrade |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `old_version` | `u32` | Logical version number before the upgrade |
| `new_version` | `u32` | Logical version number after the upgrade (`old_version + 1`) |

#### Example

```json
{
  "topics": [
    { "type": "symbol",  "value": "upgrade" },
    { "type": "address", "value": "GADMIN...XYZ" }
  ],
  "data": [
    { "type": "u32", "value": 1 },
    { "type": "u32", "value": 2 }
  ]
}
```

---

### 9. `suspicious`

Emitted whenever the flash-loan guard detects that the vault's actual on-chain token balance differs from its internally tracked `total_deposited`. This is a **security alert** — any system monitoring the vault should treat this event as a high-priority incident.

**Trigger:** Balance mismatch detected at the start of `deposit`, `withdraw`, `harvest`, or `harvest_token`.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"suspicious"` |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `reason` | `Symbol` | Always `"balance_mismatch"` |
| `balance_before` | `i128` | Actual on-chain token balance observed by the contract |
| `total_deposited` | `i128` | Internally tracked total deposited (expected balance) |

#### Example

```json
{
  "topics": [
    { "type": "symbol", "value": "suspicious" }
  ],
  "data": [
    { "type": "symbol", "value": "balance_mismatch" },
    { "type": "i128",   "value": "1200000" },
    { "type": "i128",   "value": "1000000" }
  ]
}
```

> Vault expected 1,000,000 but found 1,200,000 on-chain. The 200,000 discrepancy could indicate a flash-loan manipulation attempt or a direct token transfer not going through the vault interface.

---

### 10. `fees_withdrawn`

Emitted when the admin withdraws accumulated performance fees to the treasury.

**Trigger:** Successful execution of `withdraw_fees(admin)` when fees > 0.

#### Topics

| Position | Field | Type | Description |
|----------|-------|------|-------------|
| 0 | `event_name` | `Symbol` | Always `"fees_withdrawn"` |
| 1 | `admin` | `Address` | Admin address that initiated the fee withdrawal |

#### Data

| Field | Type | Description |
|-------|------|-------------|
| `fees` | `i128` | Total accumulated fees transferred to treasury |
| `treasury` | `Address` | Treasury address that received the fees |

---

## Subscribing via Horizon

Horizon exposes contract events through its `/transactions/{id}/operations` and, more directly, the `/transactions` endpoint with `include_failed=false`. For streaming events, use the Horizon Server-Sent Events (SSE) endpoint.

### Stream all contract events (Horizon REST)

```bash
curl "https://horizon-testnet.stellar.org/contracts/<CONTRACT_ID>/events?cursor=now&order=asc" \
  -H "Accept: text/event-stream"
```

### Filter by event topic (deposit only)

Horizon supports `topic[0]` through `topic[4]` filter parameters:

```bash
curl "https://horizon-testnet.stellar.org/contracts/<CONTRACT_ID>/events?topic[0]=deposit"
```

### Filter by caller address (topic[1])

```bash
curl "https://horizon-testnet.stellar.org/contracts/<CONTRACT_ID>/events?topic[0]=deposit&topic[1]=GABC...XYZ"
```

### Pagination

Events are paginated by `cursor`. Persist the cursor of the last processed event to resume from where you left off after a restart.

```bash
curl "https://horizon-testnet.stellar.org/contracts/<CONTRACT_ID>/events?cursor=<LAST_CURSOR>&limit=200"
```

---

## Parsing Events from Transaction Results

### Rust (Soroban SDK)

```rust
use soroban_sdk::{Env, Symbol, Address, Val, Vec};

/// Parse a deposit event from a raw transaction result.
///
/// In production, retrieve the transaction via Horizon and iterate over
/// `transaction.result_meta_v3.soroban_meta.events`.
fn parse_deposit_event(env: &Env, topics: &Vec<Val>, data: &Vec<Val>) {
    // topics[0] = event name
    let event_name: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
    assert_eq!(event_name, Symbol::new(env, "deposit"));

    // topics[1] = caller address
    let caller: Address = topics.get(1).unwrap().try_into_val(env).unwrap();

    // topics[2] = amount
    let amount: i128 = topics.get(2).unwrap().try_into_val(env).unwrap();

    // data[0] = new_shares
    let new_shares: i128 = data.get(0).unwrap().try_into_val(env).unwrap();

    // data[1] = new_total_shares
    let new_total_shares: i128 = data.get(1).unwrap().try_into_val(env).unwrap();

    // data[2] = new_total_deposited
    let new_total_deposited: i128 = data.get(2).unwrap().try_into_val(env).unwrap();

    println!(
        "Deposit: caller={caller:?} amount={amount} new_shares={new_shares} \
         total_shares={new_total_shares} total_deposited={new_total_deposited}"
    );
}
```

### TypeScript (Stellar SDK + Horizon)

```typescript
import { SorobanRpc, xdr, Networks, BASE_FEE } from "@stellar/stellar-sdk";

const CONTRACT_ID = "C..."; // Your AuraVault contract ID
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// ── Type definitions ────────────────────────────────────────────────────────

interface DepositEvent {
  type: "deposit";
  caller: string;
  amount: bigint;
  newShares: bigint;
  newTotalShares: bigint;
  newTotalDeposited: bigint;
  txHash: string;
  ledger: number;
}

interface WithdrawEvent {
  type: "withdraw";
  caller: string;
  shares: bigint;
  redeemAmount: bigint;
  newTotalShares: bigint;
  newTotalDeposited: bigint;
  txHash: string;
  ledger: number;
}

interface HarvestEvent {
  type: "harvest";
  caller: string;
  yieldAmount: bigint;
  yieldAfterFee: bigint;
  feeAmount: bigint;
  newTotal: bigint;
  txHash: string;
  ledger: number;
}

interface SuspiciousEvent {
  type: "suspicious";
  balanceBefore: bigint;
  totalDeposited: bigint;
  txHash: string;
  ledger: number;
}

type VaultEvent = DepositEvent | WithdrawEvent | HarvestEvent | SuspiciousEvent;

// ── XDR ScVal helpers ────────────────────────────────────────────────────────

function decodeSymbol(val: xdr.ScVal): string {
  if (val.switch() !== xdr.ScValType.scvSymbol()) {
    throw new Error(`Expected symbol, got ${val.switch().name}`);
  }
  return val.sym().toString();
}

function decodeAddress(val: xdr.ScVal): string {
  if (val.switch() !== xdr.ScValType.scvAddress()) {
    throw new Error(`Expected address, got ${val.switch().name}`);
  }
  return val.address().toBuffer().toString("hex"); // use StellarBase.Address for real decoding
}

function decodeI128(val: xdr.ScVal): bigint {
  if (val.switch() !== xdr.ScValType.scvI128()) {
    throw new Error(`Expected i128, got ${val.switch().name}`);
  }
  const parts = val.i128();
  const hi = BigInt(parts.hi().toString());
  const lo = BigInt(parts.lo().toString());
  return (hi << 64n) | lo;
}

// ── Event parser ─────────────────────────────────────────────────────────────

function parseVaultEvent(
  rawEvent: SorobanRpc.Api.RawEventResponse
): VaultEvent | null {
  if (rawEvent.type !== "contract") return null;
  if (rawEvent.contractId !== CONTRACT_ID) return null;

  const topics = rawEvent.topic.map((t) => xdr.ScVal.fromXDR(t, "base64"));
  const dataVal = xdr.ScVal.fromXDR(rawEvent.value, "base64");

  // Decode data tuple — Soroban encodes multi-value data as a Vec<ScVal>
  const dataItems: xdr.ScVal[] =
    dataVal.switch() === xdr.ScValType.scvVec()
      ? (dataVal.vec() as xdr.ScVal[])
      : [dataVal];

  if (topics.length === 0) return null;
  const eventName = decodeSymbol(topics[0]);

  const meta = { txHash: rawEvent.txHash, ledger: rawEvent.ledger };

  switch (eventName) {
    case "deposit":
      return {
        type: "deposit",
        caller: decodeAddress(topics[1]),
        amount: decodeI128(topics[2]),
        newShares: decodeI128(dataItems[0]),
        newTotalShares: decodeI128(dataItems[1]),
        newTotalDeposited: decodeI128(dataItems[2]),
        ...meta,
      };

    case "withdraw":
      return {
        type: "withdraw",
        caller: decodeAddress(topics[1]),
        shares: decodeI128(topics[2]),
        redeemAmount: decodeI128(dataItems[0]),
        newTotalShares: decodeI128(dataItems[1]),
        newTotalDeposited: decodeI128(dataItems[2]),
        ...meta,
      };

    case "harvest":
      return {
        type: "harvest",
        caller: decodeAddress(topics[1]),
        yieldAmount: decodeI128(topics[2]),
        yieldAfterFee: decodeI128(dataItems[0]),
        feeAmount: decodeI128(dataItems[1]),
        newTotal: decodeI128(dataItems[2]),
        ...meta,
      };

    case "suspicious":
      return {
        type: "suspicious",
        balanceBefore: decodeI128(dataItems[1]),
        totalDeposited: decodeI128(dataItems[2]),
        ...meta,
      };

    default:
      return null;
  }
}

// ── Streaming example ─────────────────────────────────────────────────────────

async function streamVaultEvents(startLedger: number): Promise<void> {
  const stream = server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
      },
    ],
  });

  for await (const page of stream) {
    for (const rawEvent of page.events) {
      const parsed = parseVaultEvent(rawEvent);
      if (!parsed) continue;

      if (parsed.type === "suspicious") {
        console.error("🚨 SUSPICIOUS EVENT DETECTED", parsed);
        // Trigger your alerting pipeline here
      } else {
        console.log(`[${parsed.type}]`, parsed);
      }
    }
  }
}

// Start streaming from ledger 1000000
streamVaultEvents(1_000_000).catch(console.error);
```

---

## Event Quick Reference

| Event | When | Indexed Topics | Data Fields |
|-------|------|---------------|-------------|
| `deposit` | Tokens deposited | `event_name`, `caller`, `amount` | `new_shares`, `new_total_shares`, `new_total_deposited` |
| `withdraw` | Shares redeemed | `event_name`, `caller`, `shares` | `redeem_amount`, `new_total_shares`, `new_total_deposited` |
| `harvest` | Yield injected (underlying) | `event_name`, `caller`, `yield_amount` | `yield_after_fee`, `fee_amount`, `new_total` |
| `harvest_token` | Yield injected (alt token) | `event_name`, `caller`, `alt_token` | `yield_amount`, `net_underlying`, `fee_amount` |
| `yield_token_registered` | Alt token whitelisted | `event_name` | `alt_token` |
| `paused` | Vault paused | `event_name` | _(none)_ |
| `unpaused` | Vault resumed | `event_name` | _(none)_ |
| `upgrade` | Contract Wasm upgraded | `event_name`, `admin` | `old_version`, `new_version` |
| `suspicious` | Flash-loan guard triggered | `event_name` | `reason`, `balance_before`, `total_deposited` |
| `fees_withdrawn` | Fees sent to treasury | `event_name`, `admin` | `fees`, `treasury` |

---

## Security Considerations

- **`suspicious` events should trigger immediate incident response.** See the [Incident Response Playbook](./incident-response-playbook.md) for the "Suspicious balance mismatch" scenario.
- When filtering events for a specific user, match on `topic[1]` (the `caller` address) alongside `topic[0]` (the event name) to avoid false positives from multi-topic queries.
- All amounts are raw `i128` values. Token decimals are a display concern only — never apply decimal scaling when comparing on-chain values.

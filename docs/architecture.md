# Architecture — Aura Vault Protocol

## System Overview

Aura is a single-contract, share-based yield vault deployed on the Stellar network via Soroban. It custodies one SEP-41 token, mints proportional shares to depositors, and compounds yield through keeper-triggered harvests. There is no proxy, no upgrade path, and no off-chain component required for core operation.

```
┌─────────────────────────────────────────────────────┐
│                  External Actors                    │
│  Depositor  │  Keeper (permissionless)  │  Integrator │
└──────┬──────┴────────────┬─────────────┴──────┬──────┘
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              AuraVault (Soroban Contract)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ lib.rs   │  │storage.rs│  │   interface.rs   │   │
│  │(logic)   │◄─│(helpers) │  │(AuraVaultTrait)  │   │
│  └────┬─────┘  └────┬─────┘  └──────────────────┘   │
│       │             │                                │
│  ┌────▼─────┐  ┌────▼───────────────────────────┐   │
│  │errors.rs │  │     Soroban Ledger Storage      │   │
│  │(VaultErr)│  │  Instance (global) │ Persistent  │   │
│  └──────────┘  └──────────────────────────────── ┘   │
└──────────────────────────┬──────────────────────────┘
                           │ token::transfer / transfer_from
                           ▼
              ┌────────────────────────┐
              │  SEP-41 Token Contract │
              │  (underlying token)    │
              └────────────────────────┘
```

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `lib.rs` | Full call lifecycle: auth → arithmetic → CEI writes → TTL bumps |
| `interface.rs` | Public ABI trait (`AuraVaultTrait`); no logic |
| `storage.rs` | All `DataKey` definitions, TTL constants, get/set helper pairs |
| `errors.rs` | `VaultError` enum; no logic |
| `test.rs` | Full test suite (unit + property-based); `#[cfg(test)]`-gated |

## Data Flows

### Deposit Flow

```
Caller ──deposit(amount)──► AuraVault
  1. Guard: amount > 0, vault initialized
  2. Read: total_shares, total_deposited
  3. Compute: new_shares = floor(amount × total_shares / total_assets)
             (or amount if total_shares == 0 — 1:1 seed)
  4. Guard: new_shares > 0 (inflation-attack fence)
  5. Interact: token.transfer_from(caller → vault, amount)
  6. Write: balance[caller] += new_shares
            total_shares   += new_shares
            total_deposited += amount
  7. Bump TTLs
  Returns: new_shares
```

### Withdraw Flow

```
Caller ──withdraw(shares)──► AuraVault
  1. Guard: shares > 0, vault initialized
  2. Read: balance[caller], total_shares, total_deposited
  3. Guard: shares ≤ balance[caller]
  4. Compute: redeem = floor(shares × total_deposited / total_shares)
  5. Guard: vault has sufficient underlying
  6. Write: balance[caller] -= shares
            total_shares    -= shares
            total_deposited -= redeem
  7. Interact: token.transfer(vault → caller, redeem)
  8. Bump TTLs
  Returns: redeem
```

> CEI note: effects (storage writes) precede the interaction (token transfer) on withdraw, and the interaction precedes effects on deposit. This prevents re-entrancy from exploiting intermediate state.

### Harvest Flow

```
Keeper ──harvest(yield_amount)──► AuraVault
  1. Guard: yield_amount > 0, vault initialized, total_shares > 0
  2. Interact: token.transfer_from(keeper → vault, yield_amount)
  3. Write: total_deposited += yield_amount
  4. Bump TTL
  Exchange rate strictly increases; no new shares minted.
```

## Storage Layout

| Key | Bucket | Type | Notes |
|---|---|---|---|
| `DataKey::Admin` | Instance | `Address` | Set once at init; never changed |
| `DataKey::UnderlyingToken` | Instance | `Address` | SEP-41 token contract |
| `DataKey::TotalShares` | Instance | `i128` | Sum of all outstanding shares |
| `DataKey::TotalDeposited` | Instance | `i128` | Principal + harvested yield |
| `DataKey::Balance(addr)` | Persistent | `i128` | Per-user share balance; 0 default |

Instance storage holds global state with a single shared TTL. Persistent storage gives each user balance entry an independent TTL — critical for users who may be inactive for weeks without causing vault-wide archival.

## TTL / Archival Strategy

Soroban ledgers close ~every 5 seconds (17,280 ledgers ≈ 1 day).

| Constant | Value | Purpose |
|---|---|---|
| `INSTANCE_LIFETIME_THRESHOLD` | 7 days | Trigger threshold for bump |
| `INSTANCE_BUMP_AMOUNT` | 30 days | TTL set on every mutating call |
| `PERSISTENT_LIFETIME_THRESHOLD` | 7 days | Per-user trigger |
| `PERSISTENT_BUMP_AMOUNT` | 30 days | Per-user TTL extended on deposit/withdraw |

TTL bumps happen unconditionally at the end of every mutating function — not guarded by the threshold — to avoid any race between the TTL check and the bump itself.

## Security Design Decisions

### No live balance reads
`TotalDeposited` is an internal counter incremented only via `deposit` and `harvest`. The contract never reads `token.balance(vault_address)`. This blocks donation-based inflation attacks where an attacker sends tokens directly to the vault address to manipulate the exchange rate.

### Inflation attack fence
If `floor(amount × total_shares / total_assets) == 0`, the deposit is rejected with `ZeroAmount` before any token transfer occurs. The caller's tokens are never moved.

### Checked arithmetic everywhere
All multiplications and divisions use `checked_mul` / `checked_div`. `overflow-checks = true` is set in the release Cargo profile as a second layer. `MathOverflow` is returned before any storage write.

### Non-upgradeability
There is no `set_code`, admin-controlled upgrade hook, or proxy. Immutability is intentional — for a DeFi primitive holding user funds, the inability to change the contract is itself a security property. A bug would require deploying a new contract and migrating users.

## Deployment Topology

```
Developer Machine
  └─ cargo build --target wasm32-unknown-unknown --release
       └─► aura_vault.wasm

Stellar Network (Testnet / Mainnet)
  ├─ stellar contract upload   →  Wasm blob stored on-chain (has its own TTL)
  ├─ stellar contract deploy   →  Contract instance created (has instance storage TTL)
  └─ AuraVault.initialize()    →  Admin + token set; vault ready for deposits
```

There is no off-chain infrastructure. Keepers call `harvest` permissionlessly. Any standard Stellar wallet or SDK can call `deposit` and `withdraw`.

## Trade-off Rationale

| Decision | Alternative | Reason chosen |
|---|---|---|
| Internal `TotalDeposited` counter | Read live `token.balance()` | Immune to direct-transfer inflation |
| `i128` for all amounts | `u128` or custom fixed-point | Matches SEP-41 token standard natively |
| Non-upgradeable | WASM upgrade hook | Eliminates admin-key attack surface |
| Permissionless keeper | Whitelisted keepers | Simpler; whitelist can be added as v2 feature |
| Instance storage for globals | All persistent | Cheaper gas; single TTL entry to manage |
| 1:1 seeding for first depositor | Virtual shares (OpenZeppelin pattern) | Simpler; zero-share fence achieves same protection |

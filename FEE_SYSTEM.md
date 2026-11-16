# Aura Vault Fee System

## Overview

Aura Vault implements a dual-fee model:
- **Performance fees**: Collected on yield (10-20%)
- **Management fees**: Annual base fee (0-1%)

## Fee Types

### Performance Fee (10-20%)

Collected when keepers inject yield into the vault.

**Formula**:
```
perf_fee = yield × perf_fee_bps / 10,000
yield_to_vault = yield - perf_fee
```

**Example** (20% performance fee):
- Keeper injects 1000 tokens yield
- Fee deducted: 1000 × 2000 / 10,000 = 200 tokens
- Vault receives: 800 tokens

### Management Fee (0-1% annually)

Annual fee accrued as percentage of total assets.

**Formula**:
```
daily_fee = total_assets × mgmt_fee_bps / 10,000 / 365
```

**Example** (0.5% annual management fee):
- Total assets: 100,000 tokens
- Daily fee: 100,000 × 50 / 10,000 / 365 = 0.137 tokens

## Contract Functions

### Admin Functions

#### `set_fees(perf_fee_bps, mgmt_fee_bps)` → Result<(), VaultError>

Set performance and management fee percentages.

**Parameters**:
- `perf_fee_bps`: Performance fee in basis points (1000-2000 for 10-20%)
- `mgmt_fee_bps`: Management fee in basis points (0-100 for 0-1%)

**Authorization**: Admin only

**Validation**:
- perf_fee_bps ∈ [1000, 2000]
- mgmt_fee_bps ∈ [0, 100]

**Example**:
```rust
set_fees(env, 1500, 50)?;  // 15% perf, 0.5% mgmt
```

#### `set_treasury(treasury: Address)` → Result<(), VaultError>

Set treasury address for fee collection.

**Parameters**:
- `treasury`: Address to receive collected fees

**Authorization**: Admin only

**Example**:
```rust
set_treasury(env, treasury_address)?;
```

#### `withdraw_fees()` → Result<i128, VaultError>

Transfer collected fees to treasury.

**Returns**: Amount of fees transferred

**Authorization**: Admin only

**Side Effects**:
- Transfers all accumulated fees to treasury
- Resets total_fee_collected to 0

**Example**:
```rust
let amount = withdraw_fees(env)?;
println!("Withdrew {} fees", amount);
```

### Query Functions

#### `get_fees()` → (u32, u32)

Get current fee settings.

**Returns**: Tuple of (perf_fee_bps, mgmt_fee_bps)

**Authorization**: None (read-only)

**Example**:
```rust
let (perf, mgmt) = get_fees(env);
// perf: 1500 (15%)
// mgmt: 50 (0.5%)
```

#### `total_fees_collected()` → i128

Get total fees accumulated since genesis.

**Returns**: Total fees collected

**Authorization**: None (read-only)

**Example**:
```rust
let total = total_fees_collected(env);
println!("Total collected: {}", total);
```

## Fee Accuracy

### Precision Guarantees

- **Basis points**: 1 bps = 0.01% (10,000 basis points = 100%)
- **Accuracy requirement**: Within 0.01% of calculated amount
- **Rounding**: Floor division (truncates down)

### Validation Function

```rust
validate_fee_accuracy(collected: i128, calculated: i128) → Result<(), VaultError>
```

Ensures collected fees match calculated fees within tolerance.

**Tolerance**: calculated_fee / 10,000 (0.01%)

## Storage Layout

### DataKey Variants

```rust
Treasury         // Address to receive fees
PerfFeeBps       // Performance fee percentage (basis points)
MgmtFeeBps       // Management fee percentage (basis points)
TotalFeeCollected // Cumulative fees collected
LastMgmtFeeTime   // Timestamp of last management fee accrual
```

### Storage Class

All fee-related keys use **instance storage** (shared state):
- TTL: 30 days, extended on every mutation
- Threshold: 7 days before expiry

## Integration Points

### Harvest Function

Performance fees collected when `harvest()` called:

```
1. Calculate yield × perf_fee_bps / 10,000
2. Deduct from yield before adding to vault
3. Track in total_fee_collected
4. Update total_assets with (yield - fee)
```

**Example**:
```
Before: total_assets = 1000, fees = 0
Harvest 500 with 20% perf fee:
  fee = 500 × 2000 / 10,000 = 100
  total_assets = 1000 + (500 - 100) = 1400
  fees = 0 + 100 = 100
```

### Deposit/Withdraw

No fees charged on user deposit/withdraw actions.

## Security Properties

1. **No fee loss**: All collected fees tracked in total_fee_collected
2. **No fee duplication**: Each harvest increments exactly once
3. **Atomic operations**: CEI pattern enforced
4. **Configurable**: Admin can adjust fees anytime
5. **Transparent**: All fees queryable

## Basis Points Reference

| Percentage | Basis Points |
|-----------|--------------|
| 0.01% | 1 |
| 0.1% | 10 |
| 1% | 100 |
| 10% | 1000 |
| 15% | 1500 |
| 20% | 2000 |
| 50% | 5000 |
| 100% | 10000 |

## Example Scenarios

### Scenario 1: 15% Performance Fee

```
Initial state:
  total_assets = 1000
  fees = 0

Harvest 600 yield with 15% perf fee:
  perf_fee = 600 × 1500 / 10,000 = 90
  yield_to_vault = 600 - 90 = 510
  total_assets = 1000 + 510 = 1510
  fees = 0 + 90 = 90

Admin withdraws fees:
  transfer(vault, treasury, 90)
  fees = 0
```

### Scenario 2: Multi-Harvest with Fees

```
Day 1: Harvest 1000 with 15% fee
  fee = 150, assets = 1000 + 850 = 1850

Day 2: Harvest 500 with 15% fee
  fee = 75, assets = 1850 + 425 = 2275
  total_fees = 150 + 75 = 225

Day 3: Admin withdraws
  transfer(vault, treasury, 225)
  total_fees = 0
```

## Testing

### Test Coverage

1. **Fee calculation**: Accuracy within 0.01%
2. **Fee collection**: All harvest amounts tracked
3. **Fee withdrawal**: Correct transfer to treasury
4. **Fee configuration**: Admin can set valid fees
5. **Invariants**: No fee loss, no duplication

### Test Commands

```bash
cd aura-vault

# Run fee tests
cargo test --lib fee

# Run all tests
cargo test --lib
```

## Compliance

- ✅ Configurable by admin
- ✅ Accurate within 0.01%
- ✅ Transparent tracking (total_fees_collected)
- ✅ No loss or duplication (atomic operations)
- ✅ Performance fee: 10-20% range
- ✅ Management fee: 0-1% range

---

**Version**: 1.0  
**Status**: Implemented

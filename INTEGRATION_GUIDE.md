# Aura Vault Protocol - Technical Integration Guide

## Table of Contents
1. [API Overview](#api-overview)
2. [Smart Contract Interaction](#smart-contract-interaction)
3. [Integration Examples](#integration-examples)
4. [Webhook Setup](#webhook-setup)
5. [Testing Checklist](#testing-checklist)
6. [Deployment Guidance](#deployment-guidance)
7. [Support](#support)

---

## API Overview

### Contract Address Format
All Aura Vault instances are deployed as Soroban smart contracts on the Stellar network:
- **Testnet**: Contract ID provided after deployment
- **Mainnet**: Contract ID provided after mainnet deployment

### Function Signatures

| Function | Parameters | Returns | Auth Required |
|----------|-----------|---------|----------------|
| `initialize` | `admin: Address`, `underlying_token: Address` | `Result<(), VaultError>` | Admin |
| `deposit` | `caller: Address`, `amount: i128` | `Result<i128, VaultError>` (shares minted) | Yes |
| `withdraw` | `caller: Address`, `shares: i128` | `Result<i128, VaultError>` (tokens redeemed) | Yes |
| `harvest` | `caller: Address`, `yield_amount: i128` | `Result<(), VaultError>` | Yes |
| `total_assets` | - | `i128` (total underlying tokens) | No |
| `balance_of` | `address: Address` | `i128` (share balance) | No |
| `upgrade` | `new_wasm_hash: BytesN<32>` | `Result<(), VaultError>` | Admin only |
| `version` | - | `u32` | No |

### Error Codes

| Code | Variant | Meaning |
|------|---------|---------|
| 1 | `NotInitialized` | Vault not yet initialized |
| 2 | `AlreadyInitialized` | Initialize called more than once |
| 3 | `InsufficientShares` | Withdrawal amount exceeds caller's share balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover redemption |
| 5 | `ZeroAmount` | Zero or negative input |
| 6 | `MathOverflow` | Arithmetic overflow in calculations |
| 7 | `InvalidAddress` | Reserved for future address validation |
| 8 | `ZeroShares` | Harvest called when total shares is zero |
| 9 | `UpgradeUnauthorized` | Caller is not the admin |
| 10 | `StorageLayoutMismatch` | On-chain layout version mismatch |

---

## Smart Contract Interaction

### Prerequisites
- Stellar account with test/main net funds
- Soroban CLI installed: `stellar contract`
- SEP-41 token contract address
- Aura Vault contract ID (after deployment)

### Core Workflows

#### 1. Initialize Vault
Initialize the vault once with admin and underlying token:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --underlying_token <TOKEN_CONTRACT_ID>
```

#### 2. Deposit into Vault
Deposit underlying tokens and receive shares:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller <USER_ADDRESS> \
  --amount 1000000
```

**Response**: Returns number of shares minted (i128)

#### 3. Withdraw from Vault
Burn shares to redeem underlying tokens:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --network testnet \
  -- withdraw \
  --caller <USER_ADDRESS> \
  --shares 500000
```

**Response**: Returns underlying tokens redeemed (i128)

#### 4. Harvest Yield
Inject yield tokens (increases exchange rate for all shareholders):

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEYPAIR> \
  --network testnet \
  -- harvest \
  --caller <KEEPER_ADDRESS> \
  --yield_amount 100000
```

#### 5. Read Total Assets
Query total underlying tokens in vault (gas-free):

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- total_assets
```

**Response**: i128 total underlying tokens

#### 6. Read Share Balance
Query vault shares for any address (gas-free):

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- balance_of \
  --address <USER_ADDRESS>
```

**Response**: i128 share balance

---

## Integration Examples

See separate files:
- [JavaScript/TypeScript Integration](./INTEGRATION_JAVASCRIPT.md)
- [Python Integration](./INTEGRATION_PYTHON.md)
- [Rust Integration](./INTEGRATION_RUST.md)

---

## Webhook Setup

See [Webhook Documentation](./WEBHOOK_SETUP.md)

---

## Testing Checklist

See [Testing Procedures](./TESTING_CHECKLIST.md)

---

## Deployment Guidance

See [Deployment Steps](./DEPLOYMENT_GUIDE.md)

---

## Support

**Documentation**: https://github.com/aura-vault/aura-vault-protocol
**Issues**: Report bugs at https://github.com/aura-vault/aura-vault-protocol/issues
**Discord**: (to be added)
**Email**: support@aura-vault.dev

### Common Integration Issues

#### Issue: Contract not initialized
**Solution**: Call `initialize` with admin and token address before any operations

#### Issue: Insufficient shares
**Solution**: Ensure user has deposited tokens first; check `balance_of` before withdrawing

#### Issue: MathOverflow error
**Solution**: Amounts too large; use smaller increments or check vault capacity

#### Issue: ZeroShares error
**Solution**: Cannot harvest when total shares = 0; ensure at least one deposit exists

---

## Key Integration Points

1. **Authentication**: All mutating functions require `require_auth()` from caller
2. **Token Transfers**: Vault uses SEP-41 token contract for deposits/withdrawals
3. **Share Exchange Rate**: Calculated as `shares × total_assets ÷ total_shares`
4. **TTL Management**: All mutating calls auto-extend archival TTL (30-day lifetime)
5. **Atomic Operations**: Checks-Effects-Interactions ordering prevents reentrancy

# Aura Vault - Quick Reference Card

**Print this page for quick access to common tasks**

---

## Contract Functions

```
initialize(admin, token)         # One-time setup
deposit(caller, amount)          # Mint shares
withdraw(caller, shares)         # Burn shares, get tokens
harvest(caller, yield_amount)    # Increase exchange rate
total_assets()                   # Read vault total
balance_of(address)              # Read share balance
upgrade(new_wasm_hash)           # Admin only
version()                        # Get contract version
```

---

## Common Commands

### Initialize Vault
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --underlying_token <TOKEN_ID>
```

### Deposit
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER> \
  --network testnet \
  -- deposit \
  --caller <USER_ADDRESS> \
  --amount 1000000
```

### Withdraw
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER> \
  --network testnet \
  -- withdraw \
  --caller <USER_ADDRESS> \
  --shares 500000
```

### Harvest
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER> \
  --network testnet \
  -- harvest \
  --caller <KEEPER_ADDRESS> \
  --yield_amount 100000
```

### Query Total
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- total_assets
```

### Query Balance
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- balance_of \
  --address <USER_ADDRESS>
```

---

## Error Codes

| Code | Error | Fix |
|------|-------|-----|
| 1 | NotInitialized | Call initialize() first |
| 2 | AlreadyInitialized | Use different contract |
| 3 | InsufficientShares | Deposit more tokens |
| 4 | InsufficientUnderlying | Contact admin |
| 5 | ZeroAmount | Increase amount |
| 6 | MathOverflow | Use smaller amount |
| 7 | InvalidAddress | (Reserved) |
| 8 | ZeroShares | Need ≥1 deposit |
| 9 | UpgradeUnauthorized | Admin only |
| 10 | StorageLayoutMismatch | Contact support |

---

## Formulas

### Shares on First Deposit
```
shares_minted = amount (1:1 ratio)
```

### Shares on Subsequent Deposit
```
shares_minted = floor(amount × total_shares ÷ total_assets)
```

### Tokens on Withdraw
```
tokens_redeemed = floor(shares × total_assets ÷ total_shares)
```

### Exchange Rate
```
rate = total_assets ÷ total_shares
(improves with each harvest)
```

---

## Documentation Index

| Doc | Purpose | Size |
|-----|---------|------|
| [TECHNICAL_INTEGRATION_INDEX.md](./TECHNICAL_INTEGRATION_INDEX.md) | Navigation & overview | 394 lines |
| [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) | API reference | 200 lines |
| [INTEGRATION_JAVASCRIPT.md](./INTEGRATION_JAVASCRIPT.md) | JS/TS code | 283 lines |
| [INTEGRATION_PYTHON.md](./INTEGRATION_PYTHON.md) | Python code | 297 lines |
| [INTEGRATION_RUST.md](./INTEGRATION_RUST.md) | Rust code | 352 lines |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Deploy steps | 469 lines |
| [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md) | Event monitoring | 323 lines |
| [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md) | Test procedures | 472 lines |
| [SUPPORT_FAQ.md](./SUPPORT_FAQ.md) | Troubleshooting | 491 lines |
| [DELIVERY_SUMMARY.md](./DELIVERY_SUMMARY.md) | What's included | 414 lines |

---

## Language Examples

### JavaScript
```typescript
const vault = new AuraVaultClient('CABC...');
const shares = await vault.deposit(keypair, 1_000_000);
const balance = await vault.getBalance(address);
```

### Python
```python
vault = AuraVaultClient('CABC...')
shares = vault.deposit(keypair, 1_000_000)
balance = vault.get_balance(address)
```

### Rust
```rust
let vault = AuraVaultClient::new("CABC...", rpc_url);
let shares = vault.deposit(&caller, 1_000_000).await?;
let balance = vault.get_balance(&address).await?;
```

---

## Setup Checklist

- [ ] Account funded with XLM
- [ ] SEP-41 token contract deployed
- [ ] Admin keypair ready
- [ ] Build WASM: `cargo build --target wasm32-unknown-unknown --release`
- [ ] Upload: `stellar contract upload --wasm ...`
- [ ] Deploy: `stellar contract deploy --wasm-hash ...`
- [ ] Initialize: `stellar contract invoke ... -- initialize ...`
- [ ] Test deposit: `stellar contract invoke ... -- deposit ...`
- [ ] Verify: `stellar contract invoke ... -- total_assets`

---

## Support

| Issue | Channel | Time |
|-------|---------|------|
| General Q | GitHub Issues | 24-48h |
| Questions | Discord | Real-time |
| Production | support@aura-vault.dev | 24h |
| Emergency | emergency@aura-vault.dev | 1h (24/7) |

---

## Key Files Location

```
aura-vault-protocol/
├── INTEGRATION_GUIDE.md              ← API Reference
├── INTEGRATION_JAVASCRIPT.md         ← JS/TS Code
├── INTEGRATION_PYTHON.md             ← Python Code
├── INTEGRATION_RUST.md               ← Rust Code
├── DEPLOYMENT_GUIDE.md               ← Deploy Steps
├── WEBHOOK_SETUP.md                  ← Monitoring
├── TESTING_CHECKLIST.md              ← Testing
├── SUPPORT_FAQ.md                    ← Troubleshooting
├── TECHNICAL_INTEGRATION_INDEX.md    ← Navigation
├── DELIVERY_SUMMARY.md               ← What's Here
└── QUICK_REFERENCE.md                ← This File
```

---

## Deploy Procedure (Quick)

```bash
# 1. Build
cargo build --target wasm32-unknown-unknown --release

# 2. Upload
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source $ADMIN_KEY \
  --network testnet

# 3. Deploy (use WASM hash from step 2)
stellar contract deploy \
  --wasm-hash $WASM_HASH \
  --source $ADMIN_KEY \
  --network testnet

# 4. Initialize (use contract ID from step 3)
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_KEY \
  --network testnet \
  -- initialize \
  --admin $ADMIN_ADDRESS \
  --underlying_token $TOKEN_ID

# 5. Verify
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- version
```

---

## Test Procedure (Quick)

```bash
# 1. Deposit 1M
stellar contract invoke --id $ID --source $USER --network testnet \
  -- deposit --caller $USER --amount 1000000
# Expected: 1000000 shares (1:1 ratio)

# 2. Check balance
stellar contract invoke --id $ID --network testnet \
  -- balance_of --address $USER
# Expected: 1000000

# 3. Check total
stellar contract invoke --id $ID --network testnet \
  -- total_assets
# Expected: 1000000

# 4. Harvest 300k
stellar contract invoke --id $ID --source $KEEPER --network testnet \
  -- harvest --caller $KEEPER --yield_amount 300000
# Expected: Success

# 5. Check total again
stellar contract invoke --id $ID --network testnet \
  -- total_assets
# Expected: 1300000 (exchange rate improved to 1.3x)
```

---

## Common Questions

**Q: How do I get testnet XLM?**  
A: Use https://stellar.org/developers/testnet-lab

**Q: Can I undo a transaction?**  
A: No, but you can withdraw your tokens anytime

**Q: What's the minimum deposit?**  
A: 1,000 tokens (adjust for decimals)

**Q: How often should I harvest?**  
A: As frequently as you have yield to inject

**Q: Can I pause the vault?**  
A: Yes, via contract upgrade (admin only)

**See [SUPPORT_FAQ.md](./SUPPORT_FAQ.md) for more Q&A**

---

**Last Updated**: 2024-06-25  
**Version**: 1.0

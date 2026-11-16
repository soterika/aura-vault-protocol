# Aura Vault - Support & FAQ

## Getting Help

### Support Channels

| Channel | Use Case | Response Time |
|---------|----------|----------------|
| **GitHub Issues** | Bug reports, feature requests | 24-48 hours |
| **Discord** | General questions, community | Real-time |
| **Email: support@aura-vault.dev** | Account-related, production issues | 24 hours |
| **Email: emergency@aura-vault.dev** | Critical issues, security | 1 hour (24/7) |

### Documentation

- **API Reference**: `INTEGRATION_GUIDE.md`
- **JavaScript/TypeScript**: `INTEGRATION_JAVASCRIPT.md`
- **Python**: `INTEGRATION_PYTHON.md`
- **Rust**: `INTEGRATION_RUST.md`
- **Webhooks**: `WEBHOOK_SETUP.md`
- **Testing**: `TESTING_CHECKLIST.md`
- **Deployment**: `DEPLOYMENT_GUIDE.md`

---

## Common Issues & Solutions

### Integration Issues

#### Q: "Contract not initialized" (Error 1)

**Problem**: Receiving VaultError code 1 on any operation.

**Solution**:
1. Verify contract has been initialized:
   ```bash
   stellar contract invoke --id <CONTRACT_ID> --network testnet -- version
   ```
2. If returns error, initialize the vault:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source <ADMIN_KEYPAIR> \
     --network testnet \
     -- initialize \
     --admin <ADMIN_ADDRESS> \
     --underlying_token <TOKEN_CONTRACT_ID>
   ```
3. Wait for TX to confirm, then retry your operation

#### Q: "Already initialized" (Error 2)

**Problem**: Cannot initialize vault a second time.

**Solution**: This is expected behavior. Vaults can only be initialized once. If you need a fresh vault:
1. Deploy a new contract instance
2. Reference the new contract ID in your integration

#### Q: "Insufficient shares" (Error 3)

**Problem**: Withdrawal fails because user doesn't have enough shares.

**Solution**:
1. Check current share balance:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --network testnet \
     -- balance_of \
     --address <USER_ADDRESS>
   ```
2. Ensure withdrawal amount ≤ balance
3. Note: Share balance may increase due to harvests (exchange rate improvement)

#### Q: "Zero amount" (Error 5)

**Problem**: Deposit or withdrawal of zero or negative amount.

**Solution**:
1. Ensure amount > 0
2. For deposits that round down to zero shares due to inflation attack protection, increase deposit size
3. Typical minimum: 1,000 tokens (adjust based on token decimals)

#### Q: "Math overflow" (Error 6)

**Problem**: Arithmetic overflow in share calculation.

**Solution**:
1. Reduce deposit size if possible
2. Break large deposits into multiple smaller transactions
3. Check total vault capacity isn't exceeded
4. Contact support if issue persists

#### Q: "Zero shares on harvest" (Error 8)

**Problem**: Cannot harvest when vault has no deposits.

**Solution**:
1. Ensure at least one deposit exists in vault
2. Check `total_assets()` > 0
3. Retry harvest after deposits are made

---

### Transaction Issues

#### Q: TX keeps timing out

**Problem**: Transactions never confirm.

**Solution**:
1. Increase gas/fee:
   ```bash
   stellar contract invoke ... --fee 1000000
   ```
2. Check network status (Testnet/Mainnet up?)
3. Verify account has sufficient XLM for fees
4. Try again in 5 minutes

#### Q: "Invalid authorization"

**Problem**: Auth check fails.

**Solution**:
1. Ensure `--source` keypair matches `--caller` address:
   ```bash
   # These must match:
   --source <KEYPAIR>              # Must match...
   --caller <SAME_ACCOUNT_ADDRESS>
   ```
2. Verify signature is valid:
   ```bash
   # Check keypair is valid
   stellar keys list
   ```
3. Ensure account is funded (has XLM)

---

### Query Issues

#### Q: `total_assets()` or `balance_of()` returns wrong value

**Problem**: Query results don't match expectations.

**Solution**:
1. Verify no failed deposits/withdrawals between queries
2. Account for harvest impact on exchange rate
3. Note: All results use floor division, so slight rounding expected
4. Example calculation:
   ```
   If 1M tokens deposited (1M shares)
   Then 300k harvested (no new shares)
   New exchange rate = 1.3x
   
   If someone deposits 1M tokens now:
   Shares = floor(1M * 1M / 1.3M) = 769,230 shares
   ```

#### Q: Share balance increased without deposit

**Problem**: User's shares went up unexpectedly.

**Explanation**: This is correct behavior! Harvest operations increase the exchange rate for all shareholders:
- Harvest adds tokens to vault without minting shares
- This increases `total_assets / total_shares`
- No code changes needed; this is a feature

#### Q: `balance_of` still returns old value after deposit

**Problem**: Query not reflecting recent deposit.

**Solution**:
1. Wait a few blocks for finality
2. Verify deposit TX succeeded:
   ```bash
   # Check if deposit TX exists
   stellar account info <USER_ACCOUNT>
   ```
3. Retry query
4. Check you're querying correct contract ID

---

### Integration Testing

#### Q: How do I test my integration?

**See**: `TESTING_CHECKLIST.md` for comprehensive testing procedures.

Quick start:
```bash
# 1. Deploy to testnet
cd aura-vault
cargo test
stellar contract upload --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm --network testnet

# 2. Test with your integration code
python test_my_integration.py

# 3. Verify state with direct queries
stellar contract invoke --id <CONTRACT_ID> --network testnet -- total_assets
```

#### Q: How much testnet XLM do I need?

**Estimate**:
- Each TX: ~0.00001 - 0.0001 XLM
- Test budget: 1-10 XLM (plenty for 100-1000s of TXs)
- Get testnet funds: https://stellar.org/developers/testnet-lab

---

### Webhook Issues

#### Q: Webhooks not being received

**Problem**: Events not arriving at webhook URL.

**Solution**:
1. Verify webhook URL is HTTPS and publicly accessible
2. Check webhook receiver is running:
   ```bash
   curl -X POST https://your-webhook.url/webhooks/vault -d '{"test": "payload"}'
   ```
3. Check firewall/proxy isn't blocking
4. Verify signature verification not rejecting valid requests
5. Check server logs for errors
6. See `WEBHOOK_SETUP.md` for debugging steps

#### Q: Lost events during downtime

**Problem**: Webhook receiver went down, events weren't queued.

**Solution**: Webhook system doesn't guarantee delivery during receiver downtime. For critical systems:
1. Implement event log in database
2. Periodically query `total_assets()` to verify state
3. Use polling as fallback
4. Set up monitoring to alert on receiver downtime

---

### Performance Issues

#### Q: Deposits taking very long

**Problem**: Deposit TXs slow to confirm.

**Solution**:
1. Testnet can be slow; wait up to 30 seconds
2. Check Testnet status
3. Increase fee:
   ```bash
   --fee 10000000  # 10M stroops
   ```
4. If mainnet: contact support

#### Q: Too many errors during load test

**Problem**: Error rate spikes during high volume.

**Solution**:
1. Space out TXs by 1+ second to avoid mempool congestion
2. Implement rate limiting in your client
3. Use connection pooling
4. See `TESTING_CHECKLIST.md` performance section

---

## Frequently Asked Questions

### General

**Q: What is Aura Vault?**

A: A share-based yield vault on Soroban. Users deposit tokens, receive shares, keepers inject yield, and all shareholders benefit from improved exchange rates.

**Q: Can I trust the smart contract?**

A: The contract uses Checks-Effects-Interactions (CEI) pattern, overflow protection, and has been audited. See `DEPLOYMENT_GUIDE.md` for audit info.

**Q: What token does Aura support?**

A: Any SEP-41 compatible token. Specify during initialization.

**Q: Is there a fee?**

A: No protocol fees. Only TX fees (negligible) paid to Stellar network.

---

### Technical

**Q: How are shares calculated on deposit?**

A:
- First deposit: 1:1 ratio (1 token = 1 share)
- Subsequent: `floor(amount × total_shares ÷ total_assets)`

**Q: What happens if I deposit a tiny amount?**

A: If deposit rounds down to zero shares, you get error code 5 (ZeroAmount). Increase deposit size or wait for harvest to improve exchange rate.

**Q: Can I be front-run on deposits?**

A: Soroban is atomic, so all operations in a block are truly atomic. No traditional front-running, but large deposits still impact price (expected behavior).

**Q: Is the contract upgradeable?**

A: Yes, admin can deploy new WASM. See `DEPLOYMENT_GUIDE.md` upgrade section.

---

### Operational

**Q: What if there's a security bug?**

A: Contact emergency@aura-vault.dev immediately. We will:
1. Pause deposits (if needed)
2. Deploy emergency fix
3. Notify all users

**Q: Can I access my funds?**

A: Always. Withdraw anytime with `withdraw(caller, shares)`. You receive proportional tokens.

**Q: How long does my money stay deposited?**

A: As long as you want. Withdraw anytime without lock-up.

**Q: What are harvest APY/returns?**

A: Depends on yield source. Aura just distributes whatever yield is injected by keepers.

**Q: Can the admin steal my funds?**

A: No. Admin can only:
- Initialize vault once
- Upgrade contract (to new bytecode)

Admin cannot:
- Transfer user funds
- Modify exchange rates
- Mint shares

---

### Integration

**Q: Which language should I use?**

A: Soroban supports:
- JavaScript/TypeScript (via @stellar/js-stellar-sdk)
- Python (via stellar-sdk)
- Rust (via soroban-sdk)

See integration guides for each.

**Q: Can I use my own contract?**

A: Yes. Call Aura Vault from your contract using Soroban's cross-contract call interface.

**Q: How do I get test tokens?**

A: 
- Testnet: Create token via frontend or deploy SEP-41 contract
- Mainnet: Must acquire real tokens

---

## Troubleshooting Flowchart

```
Error received?
├─ Error 1 (NotInitialized)
│  └─ Call initialize(admin, token)
│
├─ Error 2 (AlreadyInitialized)
│  └─ Use existing vault or deploy new contract
│
├─ Error 3 (InsufficientShares)
│  └─ Check balance_of(), deposit more tokens
│
├─ Error 4 (InsufficientUnderlying)
│  └─ Vault doesn't have tokens; contact admin
│
├─ Error 5 (ZeroAmount)
│  └─ Increase amount or wait for harvest
│
├─ Error 6 (MathOverflow)
│  └─ Reduce amount, break into smaller TXs
│
├─ Error 8 (ZeroShares)
│  └─ Ensure at least 1 deposit exists
│
├─ Error 9 (UpgradeUnauthorized)
│  └─ Only admin can upgrade contract
│
├─ Error 10 (StorageLayoutMismatch)
│  └─ Contract state corruption; contact support
│
└─ TX Timeout
   └─ Increase fee or wait & retry
```

---

## Performance Benchmarks

Typical performance on Testnet:

| Operation | Time | Gas |
|-----------|------|-----|
| Initialize | 5s | ~50k ops |
| Deposit | 5s | ~100k ops |
| Withdraw | 5s | ~100k ops |
| Harvest | 5s | ~50k ops |
| Query (total_assets) | <1s | ~5k ops |
| Query (balance_of) | <1s | ~5k ops |

Mainnet should be similar or slightly faster.

---

## Security Best Practices

1. **Never share private keys** - especially admin keys
2. **Verify contract IDs** - copy from official sources only
3. **Use HTTPS** - for all API calls
4. **Enable 2FA** - on exchange/custody accounts
5. **Test on testnet first** - before mainnet integration
6. **Monitor your integration** - watch for anomalies
7. **Keep backups** - of keypairs and configs
8. **Rotate keys periodically** - if using service accounts

---

## Reporting Issues

### Bug Report Template

```
Title: [One-line description]

Environment:
- Network: testnet/mainnet
- Contract ID: C...
- Integration: JavaScript/Python/Rust
- Error code: X

Steps to Reproduce:
1. ...
2. ...
3. ...

Expected Behavior:
...

Actual Behavior:
...

Logs:
[Attach relevant logs, TX hashes, etc.]

Workaround (if any):
...
```

Submit to: support@aura-vault.dev

---

## Service Status

Monitor service status:
- **Status Page**: https://status.aura-vault.dev
- **X/Twitter**: @aura_vault
- **Discord**: https://discord.gg/aura-vault (if applicable)

---

## Additional Resources

- **Stellar Documentation**: https://developers.stellar.org
- **Soroban Book**: https://soroban.stellar.org
- **SEP-41 Standard**: https://stellar.org/protocol/sep-41

---

**Last Updated**: 2024-06-25  
**Version**: 1.0

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
- **Troubleshooting**: `docs/troubleshooting.md`

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

## Vault States: Paused, Capacity-Limited, and Unknown Capacity

A vault can reject new deposits for three different reasons. The dashboard
symptoms look similar, but the on-chain behaviour and the next step are
different. Identify the state before advising the user.

| State | Dashboard indicator | On-chain signal | New deposits | Withdrawals / exit |
|---|---|---|---|---|
| **Paused** | Amber banner: "⚠️ Vault operations are currently paused. Withdrawals remain available. Deposits and harvests are suspended until the admin resumes the vault." Deposit button reads **Vault Paused**; notice: "Actions are disabled while the vault is paused." | `is_paused()` returns `true`; `paused` event; mutations return error **11 (VaultPaused)** | Blocked | Normal Withdraw is disabled and reverts with error 11. The contract-level exit is `emergency_withdraw(caller, shares)`, callable **only while paused**, with no fee and no queue. |
| **Capacity limit reached** | Capacity bar is red: **Vault Capacity: 100.0% full**; **Details** shows Current TVL = Cap and Remaining **0.00**. At 80–95% the bar is amber (warning only). | `get_tvl_caps()` / `get_tvl_cap()` returns the hard cap; deposits that would exceed it return error **16 (TvlCapExceeded)** | Blocked at the cap; a smaller deposit that fits the remaining capacity succeeds | Withdrawals are unaffected unless the vault is also paused |
| **Capacity information unavailable** | No capacity bar is shown at all. If the stats request itself fails, the dashboard shows **Failed to load vault data** with a **Retry** button. | `/api/v1/vault/stats` returns HTTP 500, a non-JSON body, or no `tvl_cap`; `get_tvl_caps()` is the authoritative on-chain check | Depends on the real cap; do not promise capacity | Withdrawals are unaffected |

> `tvl_cap: null` means **no cap is configured** (unlimited), not that the
> information is unavailable. Only treat a missing bar as "unknown" after
> confirming whether the stats request failed or the cap is genuinely unset.

### 1. Paused vault

**Example dashboard messages**

- Banner: `⚠️ Vault operations are currently paused. Withdrawals remain available.`
- Button: `Vault Paused`
- Inline notice: `Actions are disabled while the vault is paused.`
- Contract error: `11 — Vault is paused` (the UI shows "Vault Paused: The vault is currently paused. Please wait for the admin to resume operations.")

**What is verified on-chain**

`pause(admin)` is an admin/GUARDIAN operation. While paused, `deposit`,
`deposit_with_swap`, `batch_deposit`, `withdraw`, `batch_withdraw`,
`claim_queued_withdrawal`, `harvest`, and `harvest_strategy` all return
`VaultPaused` (11). Read-only calls (`is_paused`, `balance_of`,
`total_assets`, `total_shares`, `get_tvl_caps`) keep working.

**Actions that remain available**

- Read balances and share price; queued withdrawals stay queued.
- `emergency_withdraw(caller, shares)` — burns shares and transfers the
  pro-rata underlying immediately, with no fee and no queue. It can only be
  called while the vault is paused; when the vault is unpaused it returns
  `VaultNotPaused` and the user must use the normal `withdraw`.
- An admin/GUARDIAN can call `unpause` to restore normal operations.

Do not tell users that the normal **Withdraw** button works during a pause.
The banner says "withdrawals remain available", but the on-chain `withdraw`
function is blocked while paused; the exit path is `emergency_withdraw` (or an
admin `unpause`).

**Escalate when** the pause was not announced, has lasted longer than the
status page indicates, or `is_paused()` returns `true` while the admin says
the vault is open.

### 2. Capacity limit reached (TVL cap)

**Example dashboard messages**

- Capacity label: `Vault Capacity: 100.0% full` (red).
- Details tooltip: `Current TVL 1.00M`, `Cap 1.00M`, `Remaining 0.00`.
- Deposit error: `16 — TVL Cap Exceeded` — "This deposit would exceed the vault's total-value-locked cap. Try a smaller amount or wait for capacity."
- At 80–95%: amber bar (`Vault Capacity: 87.3% full`). This is a warning
  only; deposits still succeed until the hard cap is reached. A configured
  soft cap emits a `tvl_soft_cap_warning` event but does not revert.

**Actions that remain available**

- Deposit an amount that fits the remaining capacity (`cap - total_assets`).
- Withdraw/redeem normally (this frees capacity) unless the vault is paused.
- Wait for other users to withdraw, or ask the admin to raise/remove the cap
  with `set_tvl_caps(soft, hard)` or `set_tvl_cap(admin, cap)`.

**Escalate when** the bar is red but the reported capacity does not match
`get_tvl_caps()`, deposits below the cap still fail with error 16, or the cap
was changed without an announcement.

### 3. Capacity information unavailable

**Example dashboard messages**

- No "Vault Capacity" section at all.
- `Failed to load vault data` card with a `Retry` button (stats request failed).
- `GET /api/v1/vault/stats` → `500` with `Failed to retrieve vault stats`, or a
  response that has no `tvl_cap` field.

**What to check**

1. Retry the dashboard; the capacity bar refreshes every 60 seconds.
2. Check the `/api/v1/vault/stats` response and its `X-Cache` header
   (`HIT`, `MISS`, or `STALE`).
3. Query the contract directly with `get_tvl_caps()` (or `get_tvl_cap()`) for
   the authoritative caps; the dashboard bar is only a convenience view.
4. Confirm the vault ID/contract ID; an unknown `vaultId` returns 404.

**Actions that remain available**

- Deposits and withdrawals follow the on-chain state, not the dashboard. If
  `get_tvl_caps()` shows capacity, deposits up to that cap work.
- Users who need certainty should read the caps directly from the contract.

**Escalate when** the stats endpoint returns 500 for multiple vaults, cached
values stay stale beyond the 30-second TTL, or the bar is missing while
`get_tvl_caps()` reports a cap.

### Information to include in every escalation

- Network (testnet/mainnet), contract ID, and vault ID.
- Exact dashboard text or screenshot and the error code (11, 16, or none).
- `is_paused()`, `get_tvl_caps()` / `get_tvl_cap()`, `total_assets`, and
  `total_shares` at the time of the report.
- Failing transaction hashes and the `/api/v1/vault/stats` response with its
  `X-Cache` header.
- Timestamp (UTC) and whether the behaviour is reproducible.

For step-by-step checks, see
[docs/troubleshooting.md](docs/troubleshooting.md#vault-state-paused-capacity-or-unknown-capacity).

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
├─ Error 11 (VaultPaused)
│  └─ Read-only calls still work; use emergency_withdraw to exit while paused
│
├─ Error 16 (TvlCapExceeded)
│  └─ Check capacity bar / get_tvl_caps(); deposit less or withdraw first
│
├─ Capacity bar missing
│  └─ Treat as unknown; verify get_tvl_caps() and /api/v1/vault/stats
│
└─ TX Timeout
   └─ Increase fee or wait & retry
```

For the full paused vs capacity-limited vs unknown-capacity guide, see
[Vault States](#vault-states-paused-capacity-limited-and-unknown-capacity).

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

# Operations Runbook

Quick reference for common operational tasks and troubleshooting.

## Daily Operations

### Morning Health Check (5 min)

```bash
#!/bin/bash
set -e

echo "=== Aura Vault Daily Health Check ==="
CONTRACT_ID=$1
NETWORK=${2:-mainnet}

# 1. Contract responsive
echo "✓ Testing contract responsiveness..."
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- total_assets

# 2. No pause
echo "✓ Checking pause status..."
PAUSED=$(stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- is_paused)
if [ "$PAUSED" = "true" ]; then
  echo "⚠️  WARNING: Vault is paused!"
fi

# 3. Monitor metrics
echo "✓ Fetching latest metrics..."
curl -s http://localhost:8080/metrics | jq '.totalAssets, .lastHarvest'

# 4. Check logs for errors
echo "✓ Checking error logs..."
tail -20 combined.log | grep ERROR || echo "No errors found"

echo "✅ Health check complete"
```

Usage:
```bash
./daily-health-check.sh CABC... mainnet
```

### Weekly Maintenance (15 min)

**Monday 2 PM UTC**:

```bash
# 1. Review incident logs
ls -lt combined.log | head -20

# 2. Check backup status (S3)
aws s3 ls s3://BACKUP_BUCKET/postgres-backups/ | sort | tail -5

# 3. Verify monitoring alerts
# Open Grafana dashboard, check alert status

# 4. Review failed transactions
grep "failed\|error" combined.log | wc -l

# 5. Update documentation if needed
git log --oneline docs/ | head -10
```

### Checking Backup Health

```bash
# List recent backups in S3
aws s3 ls s3://BACKUP_BUCKET/postgres-backups/ --region us-east-1 | sort | tail -7

# Verify backup metric in Prometheus
curl -s http://prometheus:9090/api/v1/query \
  --data-urlencode 'query=backup_last_success_timestamp_seconds'

# Manually trigger a backup (K8s)
kubectl create job --from=cronjob/postgres-backup manual-$(date +%Y%m%d) -n aura-vault

# Run a restore integrity check
BACKUP_BUCKET="..." BACKUP_ENCRYPTION_KEY="..." \
  PGHOST=localhost PGPASSWORD="..." \
  ./scripts/restore-test.sh
```

See [docs/backup-recovery.md](docs/backup-recovery.md) for full runbooks including
the break-glass production restore procedure.

## Common Issues & Solutions

### 1. Deposit Failures: "Insufficient Token Balance"

**Symptom**: User deposit rejected, error: `insufficient_balance`

**Diagnosis**:
```bash
# Check user's token balance
stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --network mainnet \
  -- balance \
  --id "USER_ACCOUNT_ID"

# Check allowance to vault
stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --network mainnet \
  -- allowance \
  --from "USER_ACCOUNT_ID" \
  --spender $CONTRACT_ID
```

**Solution**:
- User needs to transfer tokens to their account
- Or increase allowance: `approve()` call on token contract
- Or reduce deposit amount

**User communication**:
```
Your token balance is insufficient for this deposit.
Options:
1. Deposit a smaller amount
2. Transfer more tokens to your account
3. Increase allowance for the vault
```

---

### 2. Withdrawal Failures: "Insufficient Liquidity"

**Symptom**: Withdrawal rejected during high redemption activity

**Diagnosis**:
```bash
# Check total vault assets
TOTAL=$(stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- total_assets)
echo "Vault assets: $TOTAL stroops"

# Check user's share balance
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- balance_of \
  --address "USER_ADDRESS"

# Check actual token balance in vault
stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --network mainnet \
  -- balance \
  --id $CONTRACT_ID
```

**Solutions** (in priority order):

1. **Wait for harvests** (no action needed)
   - Harvesters typically run every 6-24 hours
   - Vault receives yield → more liquidity available
   - User can retry in 1 hour

2. **Reduce withdrawal amount**
   - User withdraws smaller amount first
   - Retry remaining amount later

3. **Emergency liquidity injection** (admin action)
   ```bash
   # Only if vault is actually depleted
   # Requires admin action to transfer tokens into vault
   stellar contract invoke \
     --id $TOKEN_CONTRACT_ID \
     --source admin \
     --network mainnet \
     -- transfer \
     --from admin_account \
     --to $CONTRACT_ID \
     --amount 1000000000  # Add liquidity
   ```

**User communication**:
```
High withdrawal demand detected. Temporary liquidity limited.
Options:
1. Withdraw a smaller amount now
2. Retry your full withdrawal in 1 hour (after next harvest)
3. Contact support for large redemptions
```

---

### 3. Harvest Not Running

**Symptom**: Exchange rate not increasing, `last_harvest` timestamp old

**Diagnosis**:
```bash
# Check if vault is paused (would prevent harvest)
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- is_paused

# Check if yield source contract is working
stellar contract invoke \
  --id $YIELD_SOURCE_CONTRACT \
  --network mainnet \
  -- total_yield

# Check if harvester account is funded
stellar account info --account HARVESTER_ACCOUNT --network mainnet
```

**Solutions**:

1. **Yield source is depleted**
   - No new yield generated
   - Wait for yield source to accumulate rewards
   - Check yield source contract for issues

2. **Harvester account out of funds**
   ```bash
   # Top up harvester XLM for transaction fees
   stellar account pay \
     --source admin \
     --amount 10 \
     --to HARVESTER_ACCOUNT \
     --network mainnet
   ```

3. **Contract has bugs** (rare)
   - Review recent changes to yield source
   - Test harvest on testnet first
   - May require update/redeploy

**User communication**:
```
No new yield was generated this period.
This is normal if the yield source has paused.
Harvest will resume automatically when yield is available.
```

---

### 4. High Gas Costs

**Symptom**: Users complaining about fees, deposit costs 100,000+ stroops

**Diagnosis**:
```bash
# Check Stellar network congestion
stellar ledger info --network mainnet

# Compare against historical gas prices
curl -s https://soroban-mainnet.stellar.org/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"getRPC","params":[],"id":1}' | jq '.result.fees'
```

**Solutions**:

1. **Network congestion** (temporary)
   - Advise users: "Network busy, retry in 1 hour"
   - No action needed, will resolve naturally

2. **Contract storage bloat**
   - Check storage size: too much data = higher fees
   - Archive old events if implemented
   - Optimize contract state

3. **RPC node busy**
   - Switch to backup RPC endpoint
   - Load balance across multiple RPC nodes

**User communication**:
```
Transaction fees are elevated due to network congestion.
Retry during off-peak hours (UTC: midnight-6am) for lower fees.
```

---

### 5. RPC Connection Failures

**Symptom**: "Connection refused" or "timeout" errors

**Diagnosis**:
```bash
# Check if RPC is responding
curl -v https://soroban-mainnet.stellar.org/health

# Check DNS resolution
nslookup soroban-mainnet.stellar.org

# Test from backend server
ssh backend-server
curl https://soroban-mainnet.stellar.org/health
```

**Solutions**:

1. **RPC node is down**
   - Switch to backup RPC: `https://backup-soroban.stellar.org`
   - Update `.env` file
   - Restart backend service
   - Monitor for recovery

2. **Network firewall blocking**
   - Check firewall rules allow port 443
   - Check if behind corporate proxy
   - May need to whitelist RPC IP

3. **Backend DNS issue**
   - Flush DNS cache: `systemctl restart systemd-resolved`
   - Manually set DNS: `8.8.8.8` in `/etc/resolv.conf`

**Recovery script**:
```bash
#!/bin/bash
# Failover to backup RPC
NEW_RPC="https://backup-soroban.stellar.org"
sed -i "s|STELLAR_RPC_URL=.*|STELLAR_RPC_URL=$NEW_RPC|" .env

# Restart backend
systemctl restart aura-vault-backend

# Verify it works
sleep 5
curl $NEW_RPC/health
```

---

### 6. Balance Mismatch Detected

**Symptom**: Vault emitted `suspicious` event with balance discrepancy

**Diagnosis**:
```bash
# Get the suspicious event details
stellar events --contract $CONTRACT_ID \
  --network mainnet \
  --topic suspicious \
  --limit 1

# Check reported vs actual
REPORTED=$(stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- total_assets)

ACTUAL=$(stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --network mainnet \
  -- balance \
  --id $CONTRACT_ID)

echo "Reported: $REPORTED"
echo "Actual: $ACTUAL"
echo "Difference: $((ACTUAL - REPORTED)) stroops"
```

**Analysis**:

- **Difference = 0**: False alarm, resume operations
- **Difference < 100 stroops**: Dust/rounding, safe to ignore
- **Difference > 1000 stroops**: Investigate source of difference
- **Negative (Actual < Reported)**: Critical, funds missing

**Actions**:

If safe (direct transfer in):
```bash
# Resume vault
stellar contract invoke \
  --id $CONTRACT_ID \
  --source admin \
  --network mainnet \
  -- unpause
```

If suspicious:
1. Keep vault paused
2. Notify security team
3. Investigate transaction logs
4. File incident report
5. Only resume after verification

---

### 7. Governance Vote Stuck

**Symptom**: Multi-sig vote proposed but signers haven't voted

**Diagnosis**:
```bash
# Get active proposals
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- get_active_proposals

# Check vote status for specific proposal
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- get_proposal_votes \
  --proposal_id PROPOSAL_ID
```

**Solution**:

1. **Reminder to signers** (if time-sensitive)
   - DM signers directly
   - Post in #governance channel
   - Escalate to governance lead

2. **Timelock approaching**
   - If proposal has 24h timelock, check remaining time
   - Recommend signers vote soon

3. **Proposal expires**
   - If vote fails after 24h, resubmit new proposal
   - Follow governance procedures

---

## Scheduled Tasks

### Daily (Automated)
- Health check script runs at 00:00, 08:00, 16:00 UTC
- Harvest keeper polls every 6 hours
- Metrics collection every 30 seconds
- Log rotation (keep 7 days)

### Weekly (Manual)
- Monday 14:00 UTC: Health review
- Thursday 14:00 UTC: Backup verification
- Friday 15:00 UTC: Week summary report

### Monthly
- 1st of month: Full security audit
- 15th of month: Performance review
- Last day: Capacity planning

## Emergency Contacts

```
On-Call Engineer: [NAME] - [PHONE]
Tech Lead: [NAME] - [EMAIL]
Governance Lead: [NAME] - [SLACK]
Legal: [EMAIL]
Stellar Support: support@stellar.org
```

## Useful Commands

```bash
# Quick vault status
stellar contract invoke --id $CONTRACT_ID --network mainnet -- total_assets

# Last 10 deposits
stellar events --contract $CONTRACT_ID --network mainnet --topic deposit --limit 10

# User share balance
stellar contract invoke --id $CONTRACT_ID --network mainnet -- balance_of --address GABC...

# Pause vault
stellar contract invoke --id $CONTRACT_ID --source admin --network mainnet -- pause

# Resume vault
stellar contract invoke --id $CONTRACT_ID --source admin --network mainnet -- unpause

# Check pause status
stellar contract invoke --id $CONTRACT_ID --network mainnet -- is_paused
```

## Documentation

- **Deployment**: DEPLOYMENT_GUIDE.md
- **Monitoring**: OPERATIONS_MONITORING.md
- **Incidents**: INCIDENT_RESPONSE.md
- **Integration**: INTEGRATION_GUIDE.md
- **Contract**: aura-vault/README.md

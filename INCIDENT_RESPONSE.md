# Incident Response Procedures

Emergency procedures for common production incidents.

## Severity Classification

| Level | Impact | Response Time | Example |
|-------|--------|----------------|---------|
| **Critical** | Users unable to withdraw | 5 min | Vault contract crashed |
| **High** | Degraded functionality | 15 min | 50% of deposits failing |
| **Medium** | Minor degradation | 1 hour | 5% failure rate |
| **Low** | No user impact | Next business day | Documentation needed |

## Critical: Vault Becomes Unresponsive

**Symptoms**: Contract invocations timeout or return errors

**Steps**:

1. **Verify network** (1 min)
   ```bash
   # Check RPC health
   curl -s https://soroban-mainnet.stellar.org/health | jq
   
   # Verify ledger is progressing
   stellar ledger info --network mainnet
   ```

2. **Check contract state** (2 min)
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --network mainnet \
     -- total_assets
   ```

3. **If Stellar network is down**:
   - Post update in #status-page channel
   - Direct users to Stellar status: https://status.stellar.org
   - Wait for network recovery
   - Post all-clear update once network stable for 30+ min

4. **If contract is unresponsive but network is up**:
   - Check if contract storage corrupted (rare)
   - **Last resort**: Trigger emergency pause (requires multi-sig)
   - Coordinate with governance signers
   - Announce downtime on all channels

5. **Communication**:
   - Slack: #ops-alerts → Detailed technical info
   - Twitter/Status: "Investigating issue with vault access"
   - Email: Auto-responder to all affected users

**Escalation**: Page on-call engineer if not resolved in 10 min

---

## Critical: Balance Mismatch (Potential Exploit)

**Symptoms**: `balance_mismatch` event emitted, `total_assets` != actual token balance

**Steps**:

1. **Immediate actions** (1 min):
   - Call `pause()` to halt all operations
   - **Do not proceed without majority multi-sig approval**
   - Coordinate with 3+ governance signers

2. **Investigation** (5 min):
   ```bash
   # Check contract view
   stellar contract invoke \
     --id $CONTRACT_ID \
     --network mainnet \
     -- total_assets
   
   # Check actual token balance
   stellar contract invoke \
     --id $TOKEN_CONTRACT_ID \
     --network mainnet \
     -- balance \
     --id $CONTRACT_ID
   ```

3. **Determine cause**:
   - **Direct transfer**: Someone sent tokens outside deposit → safe to unpause
   - **Flash loan attempt**: See [Flash Loan Guard Tests](aura-vault/src/test.rs#L600)
   - **RPC data corruption**: Restore from Stellar network consensus
   - **Contract bug**: Critical - notify all users

4. **Recovery**:
   - For safe cases: Unpause and monitor
   - For unsafe: Initiate governance vote for admin action
   - Document in incident log with blockchain proof

5. **Communication**:
   - Pre-written template: "Vault detected irregular activity. Pausing briefly while we verify. No funds at risk."
   - Update every 15 min until resolved

**Escalation**: Notify security team immediately, consider external audit

---

## High: Deposit/Withdrawal Failures (>20%)

**Symptoms**: Monitoring alerts, users report failed transactions

**Possible causes**:

### A. Token Contract Issue
```bash
# Check token balance and allowances
stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --network mainnet \
  -- balance \
  --id $CONTRACT_ID

# Try direct transfer to verify token works
stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --source testuser \
  --network mainnet \
  -- transfer \
  --from testuser \
  --to vault \
  --amount 1000000
```

**If token is down**:
- Notify token team immediately
- Post: "Deposit/Withdrawal temporarily disabled due to token contract issue"
- Monitor for recovery
- Auto-retry failed transactions once token recovers

### B. RPC Node Overload
```bash
# Check RPC response times
time stellar account info --account GABC... --network mainnet
```

**If RPC is slow**:
- Switch to backup RPC node (if configured)
- Scale up RPC connections
- Implement request queue/throttling
- Post: "Experiencing high load. Please retry transactions"

### C. Vault Running Low on Token Balance
```bash
# Check vault balance
stellar contract invoke \
  --id $TOKEN_CONTRACT_ID \
  --network mainnet \
  -- balance \
  --id $CONTRACT_ID
```

**If vault is depleted**:
- **Immediate**: Pause withdrawals
- Notify admins of low balance
- Deploy emergency liquidity from reserve
- Post: "Withdrawal queue enabled due to high demand"

**Recovery steps**:

1. Identify root cause from logs
2. File incident report with timeline
3. Apply fix or workaround
4. Test with staging environment first
5. Monitor for 1 hour after fix

---

## High: Admin Key Compromise (Suspected)

**Symptoms**: Unexpected pause, unauthorized governance vote, or third-party claims

**Steps**:

1. **Secure key immediately** (2 min):
   ```bash
   # Revoke compromised key permissions in governance
   # Requires multi-sig vote - convene governance signers
   
   # Do NOT use compromised key again
   ```

2. **Audit recent actions** (5 min):
   ```bash
   # Check transaction history
   stellar transactions --account GADMIN... --network mainnet --limit 50
   
   # Look for unauthorized invocations
   # Common: pause(), unauthorized withdrawals
   ```

3. **Notify stakeholders** (5 min):
   - Internal: Slack #security-incident
   - Governance: Emergency multi-sig meeting
   - Users: Twitter "Security incident detected. Pausing operations."

4. **Governance response**:
   - Vote to rotate admin key
   - Vote to unpause if operations were halted
   - Requires 3-of-5 signers minimum

5. **Post-incident**:
   - Rotate all admin keys
   - Review access logs
   - Update security procedures
   - File incident report

**Reference**: See GOVERNANCE_IMPLEMENTATION.md for multi-sig voting

---

## Medium: High Latency (RPC Timeouts)

**Symptoms**: Slow transaction processing, users see "waiting" spinner

**Quick check**:
```bash
# Test RPC latency
curl -w "\n%{time_total}\n" -o /dev/null -s https://soroban-mainnet.stellar.org/health
```

**Solutions** (in order):

1. **Check network** → Stellar network status page
2. **Increase timeout** → Update frontend config
3. **Switch RPC** → Use backup Soroban RPC endpoint
4. **Add caching** → Cache view-only results
5. **Scale backend** → Add more server capacity

**Communication**: "Experiencing slower than usual transaction speeds. Please be patient."

---

## Medium: Event Log Overflow

**Symptoms**: Contract history queries become slow

**Prevention**:
- Archive old events monthly
- Implement event retention policy
- Monitor storage growth

**If it happens**:
- Implement pagination on event queries
- Archive events to cold storage
- Optimize query performance

---

## Low: Documentation Outdated

**Symptoms**: Users report guidance doesn't match actual behavior

**Fix**: Update documentation and tag version
- Create PR with corrections
- Review and merge
- Announce in Discord

---

## Communication Templates

### Critical Incident Announcement
```
🚨 INCIDENT: Aura Vault

We're investigating an issue with vault operations.
Details: [technical summary]
Status: [investigating/monitoring/resolved]
Updates: Every 15 minutes

ETA to resolution: [estimate]
```

### All Clear Message
```
✅ RESOLVED: Aura Vault Issue

The vault is operating normally.
Root cause: [what happened]
Impact: [what was affected]
Prevention: [how we'll prevent this]

Thank you for your patience.
```

### Scheduled Maintenance
```
🔧 SCHEDULED MAINTENANCE

Date: [date] [HH:MM UTC]
Duration: ~30 minutes
Impact: Deposits/Withdrawals will be paused

We'll update this thread as we progress.
```

---

## Escalation Path

```
Issue Detected
    ↓
Auto-alert (Grafana)
    ↓
On-call engineer acknowledges (Slack + PagerDuty)
    ↓
[Critical?] → Page second engineer
    ↓
[Not resolved in 30 min?] → Escalate to tech lead
    ↓
[Still critical?] → VP Engineering + Legal
    ↓
[User funds at risk?] → Pause vault, initiate governance vote
```

## Post-Incident Review

For any incident rated High or Critical:

1. **Timeline**: Document exact sequence of events
2. **Root cause**: Why did this happen?
3. **Impact**: What was affected?
4. **Detection gap**: Why wasn't this caught earlier?
5. **Fix verification**: How do we prevent recurrence?
6. **Stakeholder updates**: What did we tell users?
7. **Action items**: What changes are we making?

Example:

```markdown
## Incident Report: Balance Mismatch on 2025-01-15

**Severity**: Critical  
**Duration**: 12 minutes  
**Impact**: Vault paused, ~50 transactions affected

**Root cause**: Direct token transfer to vault address by [external user], triggered balance_mismatch guard

**Detection**: Automated event monitoring caught mismatch within 30 seconds

**Resolution**: Verified transfer was legitimate, resumed operations after review

**Prevention**: 
- [ ] Add warning to docs about direct transfers
- [ ] Implement sender whitelist verification
- [ ] Improve mismatch detection tolerance (small amounts OK)
```

---

## Testing Your Runbook

Quarterly runbook exercises:

```bash
# Simulate vault pause
stellar contract invoke \
  --id $CONTRACT_ID \
  --source admin \
  --network testnet \
  -- pause

# Verify pause worked
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- is_paused
# Expected: true

# Test communication channels
# - Post test alert to Slack
# - Verify PagerDuty triggers
# - Check email delivery

# Resume operations
stellar contract invoke \
  --id $CONTRACT_ID \
  --source admin \
  --network testnet \
  -- unpause
```

Document results and update playbook if any gaps found.

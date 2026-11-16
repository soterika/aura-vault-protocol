# Multi-Signature Governance - Usage Guide

## Quick Start

### Initialization

```bash
# Deploy contract with governance enabled
stellar contract invoke \
  --id <contract-id> \
  --source <deployer-keypair> \
  --network testnet \
  -- initialize \
  --admin <admin-address> \
  --underlying_token <token-contract-id> \
  --signers '[
    "GAAAA...",
    "GBBBB...",
    "GCCCC...",
    "GDDDD...",
    "GEEEE..."
  ]'
```

### Common Governance Operations

#### 1. Propose Admin Change

```bash
stellar contract invoke \
  --id <contract-id> \
  --source <signer1-keypair> \
  --network testnet \
  -- propose_update_admin \
  --proposer <signer1-address> \
  --new_admin <new-admin-address>
```

Returns: `proposal_id = 1`

#### 2. Vote on Proposal

```bash
stellar contract invoke \
  --id <contract-id> \
  --source <signer2-keypair> \
  --network testnet \
  -- vote \
  --voter <signer2-address> \
  --proposal_id 1 \
  --approve true
```

#### 3. Check Proposal Status

```bash
stellar contract invoke \
  --id <contract-id> \
  --source <any-keypair> \
  --network testnet \
  -- proposal_status \
  --proposal_id 1
```

Returns: `"Pending"` or `"Approved"` or `"Executed"`

#### 4. Execute Approved Proposal

```bash
# After 24 hours...
stellar contract invoke \
  --id <contract-id> \
  --source <any-keypair> \
  --network testnet \
  -- execute \
  --executor <any-address> \
  --proposal_id 1
```

---

## Workflow Examples

### Scenario 1: Update Vault Admin (Happy Path)

**Day 1 - Proposal Phase:**
1. Signer Alice calls `propose_update_admin(alice, new_admin_bob)`
   - Status: Pending (1/3 votes)
2. Signer Charlie calls `vote(charlie, 1, true)`
   - Status: Pending (2/3 votes)
3. Signer Dave calls `vote(dave, 1, true)`
   - Status: Approved (3/3 votes) ← AUTO-APPROVED

**Day 1 - Timelock:**
- Anyone queries `proposal_status(1)` → "Approved"
- Execution blocked (timelock not expired)

**Day 2 - Execution:**
4. Eve calls `execute(eve, 1)`
   - Status: Executed
   - Admin now bob_address

**Result:**
- Vault admin changed from original to bob_address
- 5 signers approve documented in proposal
- 24-hour delay prevented accidental or emergency changes

---

### Scenario 2: Propose Parameter Update

```bash
# Signer Alice proposes fee update
propose_parameter_update(
  proposer: alice,
  name: Symbol::short("fee_rate"),
  value: 500  // 5% = 500 basis points
)
```

Returns: `proposal_id = 2`

```bash
# Voting similar to admin change
vote(charlie, 2, true)  # 2/3
vote(dave, 2, true)     # 3/3 - AUTO-APPROVED
```

After 24h:
```bash
execute(anyone, 2)
# Parameter update effective
```

---

### Scenario 3: Emergency Token Update

```bash
# Signer Alice notices compromised token
propose_update_token(alice, new_safe_token_address)
# proposal_id = 3

# Fast voting (all available signers)
vote(alice, 3, true)    # 1/3
vote(charlie, 3, true)  # 2/3
vote(dave, 3, true)     # 3/3 - APPROVED IMMEDIATELY

# Wait 24 hours minimum
# Then execute
execute(anyone, 3)
# New token is now active (protects users)
```

---

### Scenario 4: Rejected Proposal

```bash
# Proposal gets mixed votes
propose_update_admin(alice, bad_actor_addr)
# proposal_id = 4

vote(charlie, 4, false)  # Against (1/5 votes against)
vote(dave, 4, false)     # Against (2/5 votes against)
vote(eve, 4, true)       # For (1/3 needed)

# After 48 hours with only 1 approval, consensus not reached
# Proposal stays "Pending"
# Cannot execute (not Approved)
# Effectively rejected
```

---

## Multi-Signer Coordination

### Key Principles

1. **Sequential Voting** — Signers vote independently; results are cumulative
2. **Auto-Approval** — Third vote auto-promotes to Approved
3. **Immutable Votes** — Once cast, vote cannot be changed
4. **Transparent History** — All voters recorded in proposal

### Best Practices

**For Security:**
- Rotate proposal creation among signers (avoid single point of failure)
- Stagger voting (don't all vote immediately; some time between)
- Document reason for each proposal
- Review timelock period (enough time to detect issues)

**For Operations:**
- Maintain signer list with secure key management
- Track proposal IDs for audit trail
- Use voting coordination (shared docs, calls)
- Test on testnet first before mainnet governance

**For Monitoring:**
- Log all `propose_*` calls
- Monitor `vote()` calls for quorum progress
- Alert when proposal reaches "Approved" status
- Execute after timelock expiry (can be automated)

---

## Error Scenarios

### Trying to Propose as Non-Signer

```bash
# Non-signer address tries to propose
propose_update_admin(non_signer, new_admin)
→ Error: InvalidAddress
```

**Solution:** Only addresses in signers list can propose.

### Voting Twice on Same Proposal

```bash
# Alice votes on proposal 1
vote(alice, 1, true)     # Success

# Alice tries to vote again
vote(alice, 1, false)    # Error: InvalidAddress (AlreadyVoted mapped)
```

**Solution:** Each signer gets one vote per proposal.

### Executing Before Timelock

```bash
propose_update_admin(alice, new_admin)  # Created at time T
# ... votes received, approved...
execute(anyone, 1)  # Tried at time T + 1 hour
→ Error: InvalidAddress (TimelockNotExpired)
```

**Solution:** Wait 24 hours from proposal creation.

### Executing Non-Approved Proposal

```bash
propose_update_admin(alice, new_admin)  # 1 vote only
execute(anyone, 1)  # No approval yet
→ Error: InvalidAddress (NotApproved)
```

**Solution:** Need 3+ approvals (votes_for ≥ 3).

---

## Monitoring and Auditing

### Query All Proposals

Create an off-chain indexer that calls `proposal_status()` for all IDs:

```javascript
// Off-chain indexer (e.g., JavaScript)
for (let i = 1; i <= lastProposalId; i++) {
  const status = await contract.proposal_status(i);
  console.log(`Proposal ${i}: ${status}`);
}
```

### Event Reconstruction

Since Soroban doesn't emit events (yet), reconstruct audit trail:

1. Track `proposal_status()` results over time
2. Log timestamps when you query
3. Infer voting from status transitions:
   - Pending → Approved: 3 votes received at that time
   - Approved → Executed: execution called

### Compliance Reporting

Generate reports:
- ✅ All proposals with proposer, proposal type, and voters
- ✅ Average time from Pending to Approved
- ✅ Average time from Approved to Executed
- ✅ Rejected/non-executed proposals
- ✅ Signer participation rates

---

## Advanced: Integration with Keepers

The `execute()` function is permissionless, enabling automation:

```javascript
// Keeper bot (off-chain automation)
const TIMELOCK = 24 * 60 * 60; // 24 hours in seconds

setInterval(async () => {
  for (let i = 1; i <= lastProposalId; i++) {
    const proposal = await fetchProposalDetails(i);
    
    if (proposal.status === "Approved") {
      const age = now - proposal.createdAt;
      
      if (age >= TIMELOCK) {
        console.log(`Executing proposal ${i}...`);
        await contract.execute(keeperAddress, i);
      }
    }
  }
}, 60000); // Check every minute
```

**Benefits:**
- Automatic execution after timelock
- No manual action required
- Reduces operational overhead
- Enables predictable governance cadence

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Proposal stuck "Pending" | Fewer than 3 votes | More signers need to vote |
| Cannot vote | Not in signers list | Use authorized signer address |
| Execute fails | Not Approved yet | Need 3+ votes first |
| Execute still fails | Less than 24h passed | Wait for timelock expiry |
| Proposal not found | Wrong proposal_id | Check ID matches created proposal |

---

## Security Reminders

1. **Never lose signer keys** — All 5 addresses needed for quorum flexibility
2. **Never share signer keys** — Each signer should have independent hardware
3. **Always test on testnet** — Verify timelock duration and voting flow
4. **Document changes** — Keep audit log of all governance actions
5. **Multi-sig wallet best practices** — Secure storage, key rotation, backup procedures

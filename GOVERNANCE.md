# Multi-Signature Governance for Aura Vault Protocol

## Overview

This module implements a 3-of-5 multi-signature governance system for protocol changes in the Aura Vault. It provides transparent voting, timelock delays, and prevents unilateral changes to critical parameters.

## Architecture

### Core Components

1. **Multi-Sig Wallet** — 5 signers, 3 required for approval
2. **Proposal System** — Three proposal types for different changes
3. **24-Hour Timelock** — Prevents immediate execution after approval
4. **Vote Tracking** — Transparent voting history and signatures
5. **Event Logging** — Full audit trail of governance actions

## Proposal Types

```rust
pub enum ProposalType {
    UpdateAdmin,                           // Change vault admin
    UpdateUnderlyingToken,                 // Change underlying token
    UpdateParameter { name, value },       // Generic parameter updates
}
```

## Proposal Lifecycle

1. **Creation** — Signer proposes change (id increments automatically)
2. **Voting** — Other signers vote approve/reject (no double voting)
3. **Approval** — Auto-approval when 3+ signatures approve
4. **Timelock** — 24-hour delay after approval
5. **Execution** — Any address can execute after timelock expires

### Status Flow

```
Pending → (2 votes accumulate)
       → Approved (3rd vote received)
       → Executed (after 24h + execute call)
       
       → Rejected (if rejected outright or deadline passes)
```

## Storage Model

All governance state stored in instance storage:
- **Signers** — List of 5 authorized signers
- **ProposalCount** — Total proposals created
- **Proposals** — Individual proposal data with votes and status
- **VoteRecord** — Prevents duplicate voting per proposal per signer

## Access Control

- **Proposal Creation** — Only signers can propose changes
- **Voting** — Only signers can vote; one vote per signer per proposal
- **Execution** — Any address can execute after timelock (permissionless)
- **Non-Signers** — Cannot propose or vote (InvalidAddress error)

## Security Properties

1. **No Unilateral Changes** — Requires 3 independent signatures
2. **Vote Immutability** — Once recorded, vote cannot be changed
3. **Timelock Safety** — 24-hour delay prevents flash attacks
4. **Transparent History** — All signers tracked in proposal
5. **Duplicate Protection** — Recording vote blocks second attempt

## Error Handling

| Error | Trigger |
|-------|---------|
| `InvalidAddress` | Non-signer proposes, votes, or proposes invalid address |
| `TimelockNotExpired` | Execute called before 24-hour delay expires |
| `NotApproved` | Execute called on non-approved proposal |
| `AlreadyVoted` | Signer attempts second vote on same proposal |

## Public Interface

```rust
// Proposal creation (signer-only)
fn propose_update_admin(proposer, new_admin) -> proposal_id
fn propose_update_token(proposer, new_token) -> proposal_id
fn propose_parameter_update(proposer, name, value) -> proposal_id

// Voting (signer-only)
fn vote(voter, proposal_id, approve) -> Result<()>

// Execution (permissionless after timelock)
fn execute(executor, proposal_id) -> Result<()>

// Query (public)
fn proposal_status(proposal_id) -> Option<String>
```

## Example Flow

```
1. Signer A calls: propose_update_admin(signer_a, new_admin_addr)
   → Returns proposal_id = 1, status = "Pending"

2. Signer B calls: vote(signer_b, 1, true)
   → Proposal 1 still "Pending" (2/3 votes)

3. Signer C calls: vote(signer_c, 1, true)
   → Proposal 1 becomes "Approved" (3/3 votes, timelock starts)

4. Wait 24 hours...

5. Anyone calls: execute(executor, 1)
   → Proposal 1 becomes "Executed", admin actually updated
```

## Constants

- `REQUIRED_SIGNATURES = 3` — Threshold for approval
- `TIMELOCK_DURATION = 86400` — Seconds (24 hours)

## Testing

The module includes 8 comprehensive tests:

1. `test_governance_init_with_signers` — Validates 5 signers initialized
2. `test_propose_admin_update` — Signer can create proposal
3. `test_non_signer_cannot_propose` — Non-signer rejected
4. `test_vote_on_proposal` — Signer can vote
5. `test_approval_with_three_votes` — Auto-approval at 3 votes
6. `test_timelock_prevents_early_execution` — Cannot execute before 24h
7. `test_parameter_proposal` — Generic parameter updates work
8. `test_cannot_vote_twice` — Duplicate vote rejected

## Integration

The governance module integrates seamlessly with existing vault:
- Initialize includes `signers: Vec<Address>` parameter
- All vault operations already have access control enforced separately
- Governance layer is independent and can be extended

## Future Enhancements

- Emergency timelock bypass (requires all 5 signatures)
- Proposal expiration (auto-reject after 7 days)
- Weighted voting (different signature weights)
- Delegation (signers can delegate votes temporarily)
- Governance token (tie voting power to holdings)

## Indexed Lifecycle Events

The vault emits the following contract events for off-chain governance history:

| Event | Emitted when | Indexed data |
|-------|-------------|--------------|
| `proposal_created` | A signer creates an operation | Proposal ID, proposer, expiry timestamp |
| `vote_cast` | A signer approves an operation | Proposal ID, voter, current signature count |
| `timelock_started` | The signature threshold is reached (or a proposal is immediately ready) | Proposal ID, ready timestamp, expiry timestamp |
| `proposal_executed` | A ready operation executes | Proposal ID and ledger timestamp |
| `proposal_expired` | `expire_proposal` persists an expired operation | Proposal ID and expiry timestamp |

`backend/src/services/horizonEventListener.ts` accepts decoded Soroban events and
upserts the proposal projection and vote rows. Migration
`014_create_governance_proposals.sql` creates `governance_proposals` and
`governance_proposal_votes`. Call `expire_proposal(proposal_id)` after the
operation expiry time to persist expiry and emit its event; it is permissionless
and safe to call more than once.

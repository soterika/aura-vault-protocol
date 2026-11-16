-- Migration 014: governance_proposals table
--
-- Stores on-chain governance proposals for the AuraVault multi-sig timelock
-- system. Each row represents one proposal with its current vote tally,
-- execution state, and metadata.
--
-- Hot-path query shapes this schema is optimised for:
--
--   1. listActive         → WHERE status = 'active' AND expires_at > NOW()
--                           ORDER BY created_at DESC  (LIMIT/OFFSET)
--   2. getById            → WHERE id = $1
--   3. votesByProposal    → vote_intents WHERE proposal_id = $1
--   4. byProposer         → WHERE proposer_address = $x ORDER BY created_at DESC

BEGIN;

-- ── governance_proposals ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_proposals (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- On-chain contract proposal ID (NULL until the contract emits the event)
  contract_proposal_id  BIGINT   NULL,
  -- Stellar address of the proposer
  proposer_address TEXT          NOT NULL,
  -- Short human-readable title
  title            TEXT          NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  -- Full Markdown description
  description      TEXT          NOT NULL DEFAULT '',
  -- Action type: upgrade | parameter_change | pause | unpause | emergency
  action_type      TEXT          NOT NULL
                   CHECK (action_type IN ('upgrade','parameter_change','pause','unpause','emergency')),
  -- Serialised action payload (e.g. new Wasm hash, param key/value)
  payload          JSONB         NOT NULL DEFAULT '{}',
  -- Lifecycle status
  status           TEXT          NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','approved','rejected','executed','expired','cancelled')),
  -- Number of approving votes received so far
  votes_for        INTEGER       NOT NULL DEFAULT 0,
  -- Number of rejecting votes received so far
  votes_against    INTEGER       NOT NULL DEFAULT 0,
  -- Minimum approvals required for execution (from contract config at proposal time)
  threshold        INTEGER       NOT NULL DEFAULT 1,
  -- Timelock: proposal cannot be executed before this timestamp
  executable_after TIMESTAMPTZ   NULL,
  -- Proposal expires (becomes unexecutable) after this timestamp
  expires_at       TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  -- When the proposal was executed on-chain (NULL until then)
  executed_at      TIMESTAMPTZ   NULL,
  -- Transaction hash of the execution tx
  execution_tx_hash TEXT         NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── governance_vote_intents ───────────────────────────────────────────────────
--
-- Records off-chain vote intentions before the signer broadcasts the on-chain
-- transaction. Each signer may cast exactly one intent per proposal.

CREATE TABLE IF NOT EXISTS governance_vote_intents (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id      UUID          NOT NULL
                   REFERENCES governance_proposals(id) ON DELETE CASCADE,
  -- Stellar address of the voter
  voter_address    TEXT          NOT NULL,
  -- true = approve, false = reject
  support          BOOLEAN       NOT NULL,
  -- Optional comment / rationale
  comment          TEXT          NULL CHECK (comment IS NULL OR char_length(comment) <= 500),
  -- On-chain transaction hash once the voter has submitted their on-chain vote
  on_chain_tx_hash TEXT          NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT governance_vote_intents_proposal_voter_uq
    UNIQUE (proposal_id, voter_address)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Hot path 1: active proposals list (governance dashboard default view)
CREATE INDEX IF NOT EXISTS idx_gov_proposals_status_expires
  ON governance_proposals (status, expires_at DESC)
  WHERE status = 'active';

-- Hot path 2: full scan by proposer (admin view)
CREATE INDEX IF NOT EXISTS idx_gov_proposals_proposer
  ON governance_proposals (proposer_address, created_at DESC);

-- Hot path 3: vote lookups per proposal
CREATE INDEX IF NOT EXISTS idx_gov_vote_intents_proposal
  ON governance_vote_intents (proposal_id, created_at ASC);

-- Hot path 4: check if a voter already voted (AlreadyVoted guard)
CREATE INDEX IF NOT EXISTS idx_gov_vote_intents_voter
  ON governance_vote_intents (voter_address, proposal_id);

-- General ordering index
CREATE INDEX IF NOT EXISTS idx_gov_proposals_created_at
  ON governance_proposals (created_at DESC);

-- ── Trigger: auto-update updated_at ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_governance_proposals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_governance_proposals_updated_at
  BEFORE UPDATE ON governance_proposals
  FOR EACH ROW EXECUTE FUNCTION update_governance_proposals_updated_at();

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS governance_vote_intents CASCADE;
DROP TABLE IF EXISTS governance_proposals CASCADE;
DROP FUNCTION IF EXISTS update_governance_proposals_updated_at() CASCADE;
COMMIT;

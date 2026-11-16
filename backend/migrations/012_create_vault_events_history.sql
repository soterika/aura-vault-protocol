BEGIN;

-- vault_events_history — per-address event history for portfolio endpoint
-- Schema: vault_events (id, address, type, amount, shares, tx_hash, timestamp)
-- Indexed on (address, timestamp DESC) for efficient paginated lookups.

CREATE TABLE IF NOT EXISTS vault_events_history (
  id          BIGSERIAL   PRIMARY KEY,
  address     TEXT        NOT NULL,
  type        TEXT        NOT NULL
              CHECK (type IN ('deposit', 'withdraw', 'harvest')),
  amount      NUMERIC(38, 0) NOT NULL DEFAULT 0,
  shares      NUMERIC(38, 0) NOT NULL DEFAULT 0,
  tx_hash     TEXT        NOT NULL DEFAULT '',
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup: all events for an address in reverse-chronological order
CREATE INDEX IF NOT EXISTS idx_vault_events_history_address_ts
  ON vault_events_history (address, timestamp DESC);

-- Filter by event type within an address
CREATE INDEX IF NOT EXISTS idx_vault_events_history_address_type
  ON vault_events_history (address, type, timestamp DESC);

COMMENT ON TABLE vault_events_history IS
  'Per-address vault event history persisted from the Horizon event stream listener.';
COMMENT ON COLUMN vault_events_history.address IS
  'Stellar wallet address of the depositor / withdrawer / harvester.';
COMMENT ON COLUMN vault_events_history.type IS
  'Event type: deposit | withdraw | harvest.';
COMMENT ON COLUMN vault_events_history.amount IS
  'Underlying token amount (stroops / smallest unit) associated with the event.';
COMMENT ON COLUMN vault_events_history.shares IS
  'Vault shares minted (deposit) or burned (withdraw); 0 for harvest.';
COMMENT ON COLUMN vault_events_history.tx_hash IS
  'Stellar transaction hash for on-chain cross-reference.';
COMMENT ON COLUMN vault_events_history.timestamp IS
  'On-chain ledger close time of the event.';

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS vault_events_history CASCADE;
COMMIT;

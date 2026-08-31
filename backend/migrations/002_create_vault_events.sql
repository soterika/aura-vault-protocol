BEGIN;

-- Vault events table — stores all on-chain Soroban contract events
-- optimised for high-volume harvest periods via:
--   1. Composite indexes for batch lookups by type and ledger range
--   2. BRIN index on ledger_sequence for efficient range scans on append-only data
--   3. Partial index for unprocessed events (processed_at IS NULL)

CREATE TABLE IF NOT EXISTS vault_events (
  id                TEXT        PRIMARY KEY,           -- ledger_seq:tx_idx:op_idx:event_idx
  ledger_sequence   BIGINT      NOT NULL,
  ledger_timestamp  TIMESTAMPTZ NOT NULL,              -- on-chain ledger close time
  event_type        TEXT        NOT NULL               -- deposit | withdraw | harvest | pause | unpause | suspicious | upgrade
                    CHECK (event_type IN ('deposit','withdraw','harvest','pause','unpause','suspicious','upgrade')),
  contract_id       TEXT        NOT NULL,
  caller_address    TEXT        NOT NULL,
  amount            NUMERIC(38,0) NOT NULL DEFAULT 0,
  raw_payload       JSONB       NOT NULL DEFAULT '{}',
  indexed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when this row was inserted (for lag calculation)
  processed_at      TIMESTAMPTZ NULL                    -- NULL until downstream consumer marks it done
);

-- Primary lookup: find all events for a given contract in ledger order
CREATE INDEX IF NOT EXISTS idx_vault_events_contract_ledger
  ON vault_events (contract_id, ledger_sequence ASC);

-- Lookup by event type for parallel processing pipelines
CREATE INDEX IF NOT EXISTS idx_vault_events_type_ledger
  ON vault_events (event_type, ledger_sequence ASC);

-- BRIN index for fast range scans on the append-only ledger_sequence column
CREATE INDEX IF NOT EXISTS idx_vault_events_ledger_brin
  ON vault_events USING BRIN (ledger_sequence);

-- Partial index: quickly find unprocessed events
CREATE INDEX IF NOT EXISTS idx_vault_events_unprocessed
  ON vault_events (indexed_at ASC)
  WHERE processed_at IS NULL;

-- Computed column for indexer lag monitoring
-- (indexed_at - ledger_timestamp) can be queried without a stored column
CREATE INDEX IF NOT EXISTS idx_vault_events_lag
  ON vault_events (EXTRACT(EPOCH FROM (indexed_at - ledger_timestamp)))
  WHERE processed_at IS NULL;

COMMENT ON TABLE vault_events IS
  'On-chain Soroban vault events indexed for high-volume harvest periods.';
COMMENT ON COLUMN vault_events.indexed_at IS
  'Wall-clock time when this event was inserted; used to compute indexer lag.';
COMMENT ON COLUMN vault_events.ledger_timestamp IS
  'On-chain ledger close time; lag = indexed_at - ledger_timestamp.';

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS vault_events CASCADE;
COMMIT;

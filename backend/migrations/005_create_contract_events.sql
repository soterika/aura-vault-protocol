BEGIN;

CREATE TABLE IF NOT EXISTS contract_events (
  id BIGSERIAL PRIMARY KEY,
  ledger_sequence BIGINT NOT NULL,
  transaction_hash TEXT NOT NULL,
  event_index TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  topic JSONB NOT NULL DEFAULT '[]'::jsonb,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_events_transaction_hash_event_index_key
    UNIQUE (transaction_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_contract_events_created_at
  ON contract_events (created_at DESC);

COMMIT;

-- Down Migration
-- lint-migrations: allow DROP TABLE   reason: rollback recreates this migration's contract_events table from the up section
BEGIN;
DROP INDEX IF EXISTS idx_contract_events_created_at;
DROP TABLE IF EXISTS contract_events;
COMMIT;

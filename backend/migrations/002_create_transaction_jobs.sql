BEGIN;

CREATE TABLE IF NOT EXISTS transaction_jobs (
  id TEXT PRIMARY KEY,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('deposit', 'withdrawal', 'claim')),
  wallet_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  webhook_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'active', 'completed', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT NULL,
  error TEXT NULL,
  meta JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_jobs_status ON transaction_jobs (status);
CREATE INDEX IF NOT EXISTS idx_tx_jobs_wallet ON transaction_jobs (wallet_address);
CREATE INDEX IF NOT EXISTS idx_tx_jobs_created ON transaction_jobs (created_at DESC);

CREATE OR REPLACE FUNCTION touch_tx_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tx_jobs_updated_at ON transaction_jobs;
CREATE TRIGGER trg_tx_jobs_updated_at
BEFORE UPDATE ON transaction_jobs
FOR EACH ROW EXECUTE FUNCTION touch_tx_jobs_updated_at();

COMMIT;

-- Down Migration
BEGIN;
DROP TRIGGER IF EXISTS trg_tx_jobs_updated_at ON transaction_jobs;
DROP FUNCTION IF EXISTS touch_tx_jobs_updated_at();
DROP TABLE IF EXISTS transaction_jobs CASCADE;
COMMIT;

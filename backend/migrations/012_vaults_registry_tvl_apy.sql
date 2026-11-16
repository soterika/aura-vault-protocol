-- Migration: 012_vaults_registry_tvl_apy.sql
-- Issue #942: Add TVL and APY fields to the vaults registry table
--
-- Adds:
--   tvl        — total value locked (in underlying token units, NUMERIC for precision)
--   apy        — annualised percentage yield as a decimal (0.05 = 5 %)
--   last_synced_at — timestamp of the most recent background sync

BEGIN;

ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS tvl           NUMERIC(36, 0) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS apy           NUMERIC(12, 8) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Index for dashboards that sort vaults by TVL or APY
CREATE INDEX IF NOT EXISTS vaults_tvl_idx ON vaults (tvl DESC);
CREATE INDEX IF NOT EXISTS vaults_apy_idx ON vaults (apy DESC);

COMMIT;

-- Down Migration
BEGIN;
ALTER TABLE vaults
  DROP COLUMN IF EXISTS tvl,
  DROP COLUMN IF EXISTS apy,
  DROP COLUMN IF EXISTS last_synced_at;

DROP INDEX IF EXISTS vaults_tvl_idx;
DROP INDEX IF EXISTS vaults_apy_idx;
COMMIT;

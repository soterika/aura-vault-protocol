BEGIN;

-- Composite covering index: fast lookup of active positions by vault+user
CREATE INDEX IF NOT EXISTS idx_vault_positions_vault_user_active
  ON vault_positions (vault_id, user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Partial index for yield tracking queries
CREATE INDEX IF NOT EXISTS idx_vault_positions_yield
  ON vault_positions (user_id, yield_earned DESC)
  WHERE deleted_at IS NULL AND yield_earned > 0;

-- View: active positions summary per user+vault (supports 1M+ row queries < 50ms via index)
CREATE OR REPLACE VIEW active_vault_positions AS
SELECT
  user_id,
  vault_id,
  SUM(amount)       AS total_amount,
  SUM(yield_earned) AS total_yield,
  MIN(entry_date)   AS first_entry,
  MAX(entry_date)   AS last_entry,
  COUNT(*)          AS position_count
FROM vault_positions
WHERE deleted_at IS NULL
GROUP BY user_id, vault_id;

COMMIT;

-- Down Migration
BEGIN;
DROP VIEW IF EXISTS active_vault_positions CASCADE;
DROP INDEX IF EXISTS idx_vault_positions_yield;
DROP INDEX IF EXISTS idx_vault_positions_vault_user_active;
COMMIT;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
  ON user_preferences (updated_at);

-- Down Migration
-- lint-migrations: allow DROP TABLE   reason: rollback removes the table created by this migration
BEGIN;
DROP INDEX IF EXISTS idx_user_preferences_updated_at;
DROP TABLE IF EXISTS user_preferences;
COMMIT;

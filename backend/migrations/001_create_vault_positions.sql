BEGIN;

CREATE TABLE IF NOT EXISTS vault_positions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  vault_id UUID NOT NULL,
  amount NUMERIC(38, 18) NOT NULL CHECK (amount >= 0),
  entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_price NUMERIC(38, 18) NOT NULL CHECK (entry_price >= 0),
  yield_earned NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (yield_earned >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_positions_user_id
  ON vault_positions (user_id);

CREATE INDEX IF NOT EXISTS idx_vault_positions_vault_id
  ON vault_positions (vault_id);

CREATE INDEX IF NOT EXISTS idx_vault_positions_created_at
  ON vault_positions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vault_positions_user_id_created_at
  ON vault_positions (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vault_positions_vault_id_created_at
  ON vault_positions (vault_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS vault_position_audit_log (
  id BIGSERIAL PRIMARY KEY,
  position_id BIGINT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID NULL,
  before_state JSONB NULL,
  after_state JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_position_audit_log_position_id
  ON vault_position_audit_log (position_id, changed_at DESC);

CREATE OR REPLACE FUNCTION touch_vault_positions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_vault_positions()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO vault_position_audit_log (
      position_id, operation, changed_at, changed_by, before_state, after_state
    ) VALUES (
      NEW.id,
      TG_OP,
      NOW(),
      NULL,
      NULL,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO vault_position_audit_log (
      position_id, operation, changed_at, changed_by, before_state, after_state
    ) VALUES (
      NEW.id,
      TG_OP,
      NOW(),
      NULL,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO vault_position_audit_log (
      position_id, operation, changed_at, changed_by, before_state, after_state
    ) VALUES (
      OLD.id,
      TG_OP,
      NOW(),
      NULL,
      to_jsonb(OLD),
      NULL
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vault_positions_updated_at ON vault_positions;
CREATE TRIGGER trg_vault_positions_updated_at
BEFORE UPDATE ON vault_positions
FOR EACH ROW
EXECUTE FUNCTION touch_vault_positions_updated_at();

DROP TRIGGER IF EXISTS trg_vault_positions_audit ON vault_positions;
CREATE TRIGGER trg_vault_positions_audit
AFTER INSERT OR UPDATE OR DELETE ON vault_positions
FOR EACH ROW
EXECUTE FUNCTION audit_vault_positions();

COMMIT;

-- Down Migration
BEGIN;
DROP TRIGGER IF EXISTS trg_vault_positions_audit ON vault_positions;
DROP TRIGGER IF EXISTS trg_vault_positions_updated_at ON vault_positions;
DROP FUNCTION IF EXISTS audit_vault_positions();
DROP FUNCTION IF EXISTS touch_vault_positions_updated_at();
DROP TABLE IF EXISTS vault_position_audit_log CASCADE;
DROP TABLE IF EXISTS vault_positions CASCADE;
COMMIT;


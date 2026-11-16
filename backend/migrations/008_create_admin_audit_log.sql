-- Admin audit log — records all admin actions for compliance and forensics
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           BIGSERIAL    PRIMARY KEY,
  action       TEXT         NOT NULL,
  performed_by TEXT         NOT NULL,
  ip_address   TEXT,
  payload      JSONB,
  result       TEXT         NOT NULL DEFAULT 'success',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action     ON admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_performer  ON admin_audit_log (performed_by);

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS admin_audit_log CASCADE;
COMMIT;

BEGIN;

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_event_once
  ON webhook_deliveries (webhook_id, event_id)
  WHERE event_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_webhook_deliveries_event_once;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS event_id;

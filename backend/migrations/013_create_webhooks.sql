BEGIN;

-- webhooks — registered webhook endpoints
CREATE TABLE IF NOT EXISTS webhooks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url                  TEXT        NOT NULL,
  secret               TEXT        NOT NULL,
  event_types          TEXT[]      NOT NULL DEFAULT '{}',
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- webhook_deliveries — delivery log per webhook + event
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id       UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type       TEXT        NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'success', 'failed')),
  attempts         INTEGER     NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  last_error       TEXT,
  next_retry_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id
  ON webhook_deliveries (webhook_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON webhook_deliveries (next_retry_at ASC)
  WHERE status = 'pending';

COMMENT ON TABLE webhooks IS 'Registered webhook endpoints for vault event notifications.';
COMMENT ON TABLE webhook_deliveries IS 'Delivery log for every webhook dispatch attempt.';

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS webhook_deliveries CASCADE;
DROP TABLE IF EXISTS webhooks CASCADE;
COMMIT;

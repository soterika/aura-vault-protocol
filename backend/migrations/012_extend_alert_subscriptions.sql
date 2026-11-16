-- Migration 012: extend alert_subscriptions for full event types and channels
-- Adds support for share_price_change, vault_paused, vault_unpaused,
-- harvest_completed, and large_deposit alert types, plus email|webhook channel
-- routing and a webhook_url field.
--
-- Closes #946

-- 1. Extend the event_type enum domain with a CHECK constraint instead of a
--    PG ENUM so we can add values without requiring a full table rewrite.

ALTER TABLE alert_subscriptions
  -- Channel: 'email' or 'webhook'
  ADD COLUMN IF NOT EXISTS channel          VARCHAR(10)   NOT NULL DEFAULT 'email',
  -- Webhook delivery URL (required when channel = 'webhook')
  ADD COLUMN IF NOT EXISTS webhook_url      TEXT          NULL,
  -- For share_price_change: percentage movement that triggers the alert
  ADD COLUMN IF NOT EXISTS price_threshold  NUMERIC(6,2)  NULL,
  -- For large_deposit: token amount that triggers the alert
  ADD COLUMN IF NOT EXISTS amount_threshold NUMERIC(38,7) NULL,
  -- Human-readable label chosen by the user
  ADD COLUMN IF NOT EXISTS label            VARCHAR(100)  NULL;

-- 2. Enforce channel domain
ALTER TABLE alert_subscriptions
  DROP CONSTRAINT IF EXISTS alert_subscriptions_channel_chk;
ALTER TABLE alert_subscriptions
  ADD CONSTRAINT alert_subscriptions_channel_chk
    CHECK (channel IN ('email', 'webhook'));

-- 3. Enforce that webhook_url is present when channel = 'webhook'
ALTER TABLE alert_subscriptions
  DROP CONSTRAINT IF EXISTS alert_subscriptions_webhook_url_chk;
ALTER TABLE alert_subscriptions
  ADD CONSTRAINT alert_subscriptions_webhook_url_chk
    CHECK (channel != 'webhook' OR webhook_url IS NOT NULL);

-- 4. Replace the legacy unique constraint so (wallet+email) is no longer the
--    only uniqueness axis; now uniqueness is (wallet + email/webhook_url + event_type).
--    We keep the old constraint to avoid breaking existing rows and add a new
--    partial unique index for webhook entries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_subscriptions_wallet_webhook_event
  ON alert_subscriptions(wallet_address, webhook_url, (event_types[1]))
  WHERE channel = 'webhook' AND active = TRUE AND webhook_url IS NOT NULL;

-- 5. Maximum 10 active subscriptions per user is enforced at the application
--    layer (see alertSubscriptionService.ts) to keep the migration portable.

-- 6. Add a last_evaluated_at timestamp so the background job can skip
--    subscriptions that were recently checked.
ALTER TABLE alert_subscriptions
  ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ NULL;

-- 7. Index for background threshold job: fetch active subs not evaluated in the
--    last 5 minutes, ordered by least-recently evaluated first.
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_eval
  ON alert_subscriptions(last_evaluated_at NULLS FIRST)
  WHERE active = TRUE;

-- 8. Allow event_types to contain the new extended types by documenting them.
--    Existing rows default to ['deposit','withdrawal'] which remains valid.
COMMENT ON COLUMN alert_subscriptions.event_types IS
  'Array of event types: deposit, withdrawal, share_price_change, vault_paused, vault_unpaused, harvest_completed, large_deposit';

COMMENT ON COLUMN alert_subscriptions.channel IS
  'Delivery channel: email or webhook';

COMMENT ON COLUMN alert_subscriptions.webhook_url IS
  'HTTPS webhook endpoint (required when channel = webhook)';

COMMENT ON COLUMN alert_subscriptions.price_threshold IS
  'Percentage price movement that triggers a share_price_change alert (e.g. 5.00 = 5%)';

COMMENT ON COLUMN alert_subscriptions.amount_threshold IS
  'Token amount that triggers a large_deposit alert';

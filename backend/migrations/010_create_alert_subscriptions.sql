-- Migration 010: email alert subscriptions
-- Users opt in to receive email notifications when a deposit or withdrawal
-- on their wallet address exceeds a configurable threshold.

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(64)   NOT NULL,
  email          VARCHAR(255)  NOT NULL,
  threshold      NUMERIC(38,7) NOT NULL DEFAULT 0,
  event_types    TEXT[]        NOT NULL DEFAULT ARRAY['deposit','withdrawal'],
  active         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT alert_subscriptions_wallet_email_uq UNIQUE (wallet_address, email)
);

-- Fast lookup: find all active subscriptions for a given wallet address.
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_wallet
  ON alert_subscriptions(wallet_address)
  WHERE active = TRUE;

-- Fast lookup: deactivate by email (unsubscribe flow).
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_email
  ON alert_subscriptions(email)
  WHERE active = TRUE;

-- Auto-update updated_at on any row change.
CREATE OR REPLACE FUNCTION update_alert_subscriptions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alert_subscriptions_updated_at
  BEFORE UPDATE ON alert_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_alert_subscriptions_updated_at();

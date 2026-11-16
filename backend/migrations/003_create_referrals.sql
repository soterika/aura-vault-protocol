BEGIN;

-- Referral tracking table
-- Stores referral relationships between Stellar wallet addresses.
-- Each address can only be referred once (referred_address is UNIQUE).
-- Chain depth is enforced at the application layer (max depth = 1).

CREATE TABLE IF NOT EXISTS referrals (
  id                  BIGSERIAL     PRIMARY KEY,
  referrer_address    TEXT          NOT NULL,
  referred_address    TEXT          NOT NULL,
  registered_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Deposit volume and rewards use NUMERIC to avoid floating-point errors
  deposit_volume      NUMERIC(38,8) NOT NULL DEFAULT 0 CHECK (deposit_volume >= 0),
  pending_reward      NUMERIC(38,8) NOT NULL DEFAULT 0 CHECK (pending_reward >= 0),
  claimed_reward      NUMERIC(38,8) NOT NULL DEFAULT 0 CHECK (claimed_reward >= 0),

  -- Each address can only be referred once
  CONSTRAINT uq_referred_address UNIQUE (referred_address),

  -- An address cannot refer itself (belt-and-suspenders: enforced in code too)
  CONSTRAINT chk_no_self_referral CHECK (referrer_address <> referred_address)
);

-- Index: look up all referrals made by a given referrer
CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals (referrer_address);

-- Index: look up a specific referred address quickly
CREATE INDEX IF NOT EXISTS idx_referrals_referred
  ON referrals (referred_address);

-- Partial index: claimable rewards (registered more than 30 days ago)
CREATE INDEX IF NOT EXISTS idx_referrals_claimable
  ON referrals (referrer_address, pending_reward)
  WHERE pending_reward > 0
    AND registered_at <= NOW() - INTERVAL '30 days';

-- Updated_at trigger
CREATE OR REPLACE FUNCTION touch_referrals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.registered_at = OLD.registered_at; -- preserve original registration date
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE referrals IS
  'Referral relationships between Stellar wallet addresses. Depth limited to 1.';
COMMENT ON COLUMN referrals.deposit_volume IS
  'Running total of deposits made by the referred address.';
COMMENT ON COLUMN referrals.pending_reward IS
  '0.1% of deposit_volume, accumulated and claimable after 30-day lock period.';
COMMENT ON COLUMN referrals.claimed_reward IS
  'Total rewards that have been claimed by the referrer.';

COMMIT;

-- Down Migration
BEGIN;
DROP TRIGGER IF EXISTS trg_referrals_updated_at ON referrals;
DROP FUNCTION IF EXISTS touch_referrals_updated_at();
DROP TABLE IF EXISTS referrals CASCADE;
COMMIT;

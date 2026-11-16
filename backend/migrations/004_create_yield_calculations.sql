BEGIN;

CREATE TABLE IF NOT EXISTS yield_sources (
  id          BIGSERIAL PRIMARY KEY,
  vault_id    UUID        NOT NULL,
  source_type TEXT        NOT NULL CHECK (source_type IN ('staking', 'fees', 'incentives')),
  apy         NUMERIC(10, 8) NOT NULL CHECK (apy >= 0),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yield_sources_vault_id
  ON yield_sources (vault_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS yield_calculations (
  id              BIGSERIAL   PRIMARY KEY,
  position_id     TEXT        NOT NULL,
  calc_date       TIMESTAMPTZ NOT NULL,
  daily_yield     NUMERIC(38, 18) NOT NULL CHECK (daily_yield >= 0),
  total_yield     NUMERIC(38, 18) NOT NULL CHECK (total_yield >= 0),
  effective_apy   NUMERIC(10, 8)  NOT NULL CHECK (effective_apy >= 0),
  sources_detail  JSONB       NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yield_calculations_position_id
  ON yield_calculations (position_id, calc_date DESC);

CREATE INDEX IF NOT EXISTS idx_yield_calculations_calc_date
  ON yield_calculations (calc_date DESC);

CREATE TABLE IF NOT EXISTS yield_worker_runs (
  id            BIGSERIAL   PRIMARY KEY,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed     INTEGER     NOT NULL DEFAULT 0,
  failed        INTEGER     NOT NULL DEFAULT 0,
  duration_ms   INTEGER     NOT NULL DEFAULT 0,
  error_summary JSONB       NULL
);

CREATE INDEX IF NOT EXISTS idx_yield_worker_runs_run_at
  ON yield_worker_runs (run_at DESC);

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS yield_worker_runs CASCADE;
DROP TABLE IF EXISTS yield_calculations CASCADE;
DROP TABLE IF EXISTS yield_sources CASCADE;
COMMIT;

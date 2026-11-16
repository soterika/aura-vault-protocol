BEGIN;

CREATE TABLE IF NOT EXISTS leaderboard_rank_snapshots (
  snapshot_at TIMESTAMPTZ NOT NULL,
  user_id UUID NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  share_balance NUMERIC(38, 18) NOT NULL CHECK (share_balance >= 0),
  PRIMARY KEY (snapshot_at, user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank_snapshots_lookup
  ON leaderboard_rank_snapshots (snapshot_at DESC, user_id);

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS leaderboard_rank_snapshots;
COMMIT;

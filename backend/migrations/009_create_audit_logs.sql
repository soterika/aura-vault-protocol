-- Migration 009: audit_logs table
--
-- Replaces the previous in-memory store (O(n) full-table scan) with a
-- durable, indexed PostgreSQL table.
--
-- Hot-path query shapes this schema is optimised for:
--
--   1. findUnanchored   → WHERE anchor_hash IS NULL ORDER BY created_at ASC
--   2. findAllInRange   → WHERE created_at BETWEEN $from AND $to ORDER BY created_at ASC
--   3. query (flexible) → WHERE actor  = $x   ORDER BY created_at DESC   (LIMIT/OFFSET)
--                          WHERE entity_type = $x   ORDER BY created_at DESC
--                          WHERE entity_id   = $x   ORDER BY created_at DESC
--                          Any combination of the above

BEGIN;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL    PRIMARY KEY,
  -- Who performed the action (wallet address, user id, service name, etc.)
  actor        TEXT         NOT NULL,
  -- The kind of resource being audited, e.g. 'vault', 'position', 'user'
  entity_type  TEXT         NOT NULL,
  -- The concrete identifier of the resource
  entity_id    TEXT         NOT NULL,
  -- Verb describing what happened, e.g. 'deposit', 'withdraw', 'pause'
  action       TEXT         NOT NULL,
  -- Arbitrary structured payload (before/after state, amounts, etc.)
  metadata     JSONB        NOT NULL DEFAULT '{}',
  -- Tamper-evidence: SHA-256 chain hash set by the anchoring scheduler.
  -- NULL while the record is queued but not yet anchored.
  anchor_hash  TEXT         NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Hot path 1 (findUnanchored): scheduler polls for NULL anchor_hash ordered
-- by insertion time.  Partial index keeps it tiny — only unanchored rows.
CREATE INDEX IF NOT EXISTS idx_audit_logs_unanchored
  ON audit_logs (created_at ASC)
  WHERE anchor_hash IS NULL;

-- Hot path 2 (findAllInRange): time-range queries for export/compliance.
-- BRIN is space-efficient for append-only tables and handles range scans well;
-- fall back to a B-tree if range selectivity is low.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at ASC);

-- Hot path 3a (query by actor): all activity for a single actor, paginated.
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON audit_logs (actor, created_at DESC);

-- Hot path 3b (query by entity_type): list all events for a resource class.
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type_created
  ON audit_logs (entity_type, created_at DESC);

-- Hot path 3c (query by entity_id): full history for a specific resource.
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id_created
  ON audit_logs (entity_id, created_at DESC);

-- Composite covering index for the most selective combined query shape
-- (actor + entity_type + entity_id).  Filters and sorts without a heap fetch
-- when only these columns plus created_at are needed.
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_entity
  ON audit_logs (actor, entity_type, entity_id, created_at DESC);

COMMIT;

-- Down Migration
BEGIN;
DROP TABLE IF EXISTS audit_logs CASCADE;
COMMIT;

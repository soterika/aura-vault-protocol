-- Run only against a disposable CI database after migrations.
-- Uses deterministic valid-looking IDs and idempotent upserts.
INSERT INTO vault_positions (user_id, vault_id, amount, entry_price, created_at, updated_at)
SELECT
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-000000000001'::uuid,
  (i * 100)::numeric,
  1,
  now(),
  now()
FROM generate_series(1, 10000) AS i;

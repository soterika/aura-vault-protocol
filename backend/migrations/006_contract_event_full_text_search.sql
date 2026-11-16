BEGIN;

ALTER TABLE contract_events
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE OR REPLACE FUNCTION update_contract_events_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.event_type, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.contract_id, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.transaction_hash, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.topic::text, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.value::text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contract_events_search_vector ON contract_events;
CREATE TRIGGER trg_contract_events_search_vector
BEFORE INSERT OR UPDATE OF event_type, contract_id, transaction_hash, topic, value
ON contract_events
FOR EACH ROW
EXECUTE FUNCTION update_contract_events_search_vector();

UPDATE contract_events
   SET search_vector =
     setweight(to_tsvector('simple', coalesce(event_type, '')), 'A') ||
     setweight(to_tsvector('simple', coalesce(contract_id, '')), 'B') ||
     setweight(to_tsvector('simple', coalesce(transaction_hash, '')), 'B') ||
     setweight(to_tsvector('simple', coalesce(topic::text, '')), 'C') ||
     setweight(to_tsvector('simple', coalesce(value::text, '')), 'C')
 WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_events_search_vector
  ON contract_events USING GIN (search_vector);

COMMIT;

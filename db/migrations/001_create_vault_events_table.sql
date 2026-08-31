-- Vault Events Table
CREATE TABLE IF NOT EXISTS vault_events (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) UNIQUE NOT NULL,
    contract_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    tx_hash VARCHAR(255) NOT NULL,
    ledger INTEGER NOT NULL,
    occurred_at TIMESTAMP NOT NULL,
    data JSONB NOT NULL,
    parsed_data JSONB,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient querying
CREATE INDEX idx_vault_events_contract_id ON vault_events(contract_id);
CREATE INDEX idx_vault_events_event_type ON vault_events(event_type);
CREATE INDEX idx_vault_events_ledger ON vault_events(ledger);
CREATE INDEX idx_vault_events_processed ON vault_events(processed);
CREATE INDEX idx_vault_events_occurred_at ON vault_events(occurred_at);

-- Dead letter queue for failed parses
CREATE TABLE IF NOT EXISTS dead_letter_events (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL,
    contract_id VARCHAR(255) NOT NULL,
    raw_event JSONB NOT NULL,
    error_message TEXT,
    error_stack TEXT,
    attempt_count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cursor table for tracking last processed event
CREATE TABLE IF NOT EXISTS event_cursor (
    id INTEGER PRIMARY KEY DEFAULT 1,
    contract_id VARCHAR(255) NOT NULL,
    last_event_id VARCHAR(255),
    last_ledger INTEGER,
    last_processed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial cursor record
INSERT INTO event_cursor (id, contract_id, last_event_id, last_ledger)
VALUES (1, '', NULL, 0)
ON CONFLICT (id) DO NOTHING;

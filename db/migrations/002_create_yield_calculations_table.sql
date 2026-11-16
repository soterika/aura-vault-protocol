-- Yield Calculations Table
CREATE TABLE IF NOT EXISTS yield_calculations (
    id SERIAL PRIMARY KEY,
    contract_id VARCHAR(255) NOT NULL,
    calculation_type VARCHAR(20) NOT NULL, -- '7d' or '30d'
    apy DECIMAL(20, 10) NOT NULL,
    total_yield DECIMAL(30, 10) NOT NULL,
    total_assets DECIMAL(30, 10) NOT NULL,
    days INTEGER NOT NULL,
    harvest_count INTEGER NOT NULL,
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(contract_id, calculation_type, window_end)
);

-- Create indexes for efficient querying
CREATE INDEX idx_yield_calculations_contract ON yield_calculations(contract_id);
CREATE INDEX idx_yield_calculations_type ON yield_calculations(calculation_type);
CREATE INDEX idx_yield_calculations_calculated_at ON yield_calculations(calculated_at);
CREATE INDEX idx_yield_calculations_window_end ON yield_calculations(window_end);

-- Historical APY snapshots for charting
CREATE TABLE IF NOT EXISTS yield_snapshots (
    id SERIAL PRIMARY KEY,
    contract_id VARCHAR(255) NOT NULL,
    apy_7d DECIMAL(20, 10),
    apy_30d DECIMAL(20, 10),
    total_yield DECIMAL(30, 10),
    total_assets DECIMAL(30, 10),
    snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_yield_snapshots_contract ON yield_snapshots(contract_id);
CREATE INDEX idx_yield_snapshots_snapshot_at ON yield_snapshots(snapshot_at);

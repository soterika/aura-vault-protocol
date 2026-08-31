export interface HarvestEvent {
    id: string;
    contract_id: string;
    amount: string;
    yield: string;
    timestamp: Date;
}

export interface YieldCalculation {
    contract_id: string;
    calculation_type: '7d' | '30d';
    apy: number;
    total_yield: number;
    total_assets: number;
    days: number;
    harvest_count: number;
    window_start: Date;
    window_end: Date;
    calculated_at: Date;
}

export interface YieldSnapshot {
    contract_id: string;
    apy_7d: number | null;
    apy_30d: number | null;
    total_yield: number;
    total_assets: number;
    snapshot_at: Date;
}

export interface APYConfig {
    contract_id: string;
    windows: {
        '7d': number;
        '30d': number;
    };
}

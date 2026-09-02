export interface VaultEvent {
    id: string;
    type: 'deposit' | 'withdraw' | 'harvest' | 'pause' | 'suspicious';
    contract_id: string;
    tx_hash: string;
    ledger: number;
    occurred_at: Date;
    data: any;
    parsed_data?: any;
}

export interface ParsedDepositEvent {
    user: string;
    amount: string;
    asset: string;
}

export interface ParsedWithdrawEvent {
    user: string;
    amount: string;
    asset: string;
}

export interface ParsedHarvestEvent {
    amount: string;
    yield: string;
}

export interface ParsedPauseEvent {
    paused: boolean;
}

export interface ParsedSuspiciousEvent {
    user: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
}

export interface EventCursor {
    contract_id: string;
    last_event_id: string | null;
    last_ledger: number | null;
    last_processed_at: Date | null;
}

export type EventParser<T = any> = (data: any) => T;

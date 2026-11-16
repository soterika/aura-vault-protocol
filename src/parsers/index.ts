import {
    ParsedDepositEvent,
    ParsedWithdrawEvent,
    ParsedHarvestEvent,
    ParsedPauseEvent,
    ParsedSuspiciousEvent,
    ParsedSharePriceSnapshotEvent,
} from '../types/events';

export class EventParser {
    static parseDeposit(data: any): ParsedDepositEvent {
        return {
            user: data.user || data.from || '',
            amount: data.amount || data.value || '0',
            asset: data.asset || data.token || 'XLM',
        };
    }

    static parseWithdraw(data: any): ParsedWithdrawEvent {
        return {
            user: data.user || data.to || '',
            amount: data.amount || data.value || '0',
            asset: data.asset || data.token || 'XLM',
        };
    }

    static parseHarvest(data: any): ParsedHarvestEvent {
        return {
            amount: data.amount || data.value || '0',
            yield: data.yield || data.return || '0',
        };
    }

    static parseSharePriceSnapshot(data: any): ParsedSharePriceSnapshotEvent {
        return {
            new_rate: data.new_rate ? String(data.new_rate) : '0',
            total_assets: data.total_assets ? String(data.total_assets) : '0',
            total_shares: data.total_shares ? String(data.total_shares) : '0',
            yield_injected: data.yield_injected ? String(data.yield_injected) : '0',
            ledger_timestamp: data.ledger_timestamp ? Number(data.ledger_timestamp) : 0,
        };
    }

    static parsePause(data: any): ParsedPauseEvent {
        return {
            paused: data.paused || data.pause || false,
        };
    }

    static parseSuspicious(data: any): ParsedSuspiciousEvent {
        return {
            user: data.user || '',
            reason: data.reason || 'Suspicious activity detected',
            severity: data.severity || 'medium',
        };
    }

    static parseEvent(type: string, data: any): any {
        switch (type) {
            case 'deposit':
                return this.parseDeposit(data);
            case 'withdraw':
                return this.parseWithdraw(data);
            case 'harvest':
                return this.parseHarvest(data);
            case 'share_price_snapshot':
                return this.parseSharePriceSnapshot(data);
            case 'pause':
                return this.parsePause(data);
            case 'suspicious':
                return this.parseSuspicious(data);
            default:
                return data;
        }
    }
}

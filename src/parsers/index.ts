import {
    ParsedDepositEvent,
    ParsedWithdrawEvent,
    ParsedHarvestEvent,
    ParsedPauseEvent,
    ParsedSuspiciousEvent,
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
            case 'pause':
                return this.parsePause(data);
            case 'suspicious':
                return this.parseSuspicious(data);
            default:
                return data;
        }
    }
}

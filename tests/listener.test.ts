import { HorizonListener } from '../src/listeners/horizonListener';
import { EventParser } from '../src/parsers';
import { EventRepository } from '../src/repositories/eventRepository';

describe('HorizonEventListener', () => {
    const contractId = 'CA1234567890';
    const horizonUrl = 'https://horizon-testnet.stellar.org';

    test('should create listener instance', () => {
        const listener = new HorizonListener(contractId, horizonUrl);
        expect(listener).toBeDefined();
    });

    test('should parse deposit events', () => {
        const data = {
            user: 'GABC123',
            amount: '1000',
            asset: 'XLM',
        };
        const parsed = EventParser.parseDeposit(data);
        expect(parsed.user).toBe('GABC123');
        expect(parsed.amount).toBe('1000');
        expect(parsed.asset).toBe('XLM');
    });

    test('should parse withdraw events', () => {
        const data = {
            user: 'GABC123',
            amount: '500',
            asset: 'USDC',
        };
        const parsed = EventParser.parseWithdraw(data);
        expect(parsed.user).toBe('GABC123');
        expect(parsed.amount).toBe('500');
        expect(parsed.asset).toBe('USDC');
    });

    test('should parse harvest events', () => {
        const data = {
            amount: '1000',
            yield: '50',
        };
        const parsed = EventParser.parseHarvest(data);
        expect(parsed.amount).toBe('1000');
        expect(parsed.yield).toBe('50');
    });

    test('should parse pause events', () => {
        const data = {
            paused: true,
        };
        const parsed = EventParser.parsePause(data);
        expect(parsed.paused).toBe(true);
    });

    test('should parse suspicious events', () => {
        const data = {
            user: 'GABC123',
            reason: 'Unusual activity',
            severity: 'high',
        };
        const parsed = EventParser.parseSuspicious(data);
        expect(parsed.user).toBe('GABC123');
        expect(parsed.reason).toBe('Unusual activity');
        expect(parsed.severity).toBe('high');
    });

    test('should parse share_price_snapshot events', () => {
        const data = {
            new_rate: '13000000',
            total_assets: '1300000',
            total_shares: '1000000',
            yield_injected: '300000',
            ledger_timestamp: 1700000000,
        };
        const parsed = EventParser.parseSharePriceSnapshot(data);
        expect(parsed.new_rate).toBe('13000000');
        expect(parsed.total_assets).toBe('1300000');
        expect(parsed.total_shares).toBe('1000000');
        expect(parsed.yield_injected).toBe('300000');
        expect(parsed.ledger_timestamp).toBe(1700000000);
    });
});

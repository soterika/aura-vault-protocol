import { APYCalculator } from '../src/services/apyCalculator';
import { HarvestEvent } from '../src/types/apy';

describe('APYCalculator', () => {
    describe('calculateAPY', () => {
        test('should calculate correct APY with positive yield', () => {
            const totalYield = 10;
            const totalAssets = 100;
            const days = 30;

            const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);
            
            // Expected: (1 + 10/100)^(365/30) - 1 = 1.1^12.1667 - 1 ≈ 2.14
            expect(apy).toBeGreaterThan(2.0);
            expect(apy).toBeLessThan(2.5);
        });

        test('should return 0 when yield is 0', () => {
            const totalYield = 0;
            const totalAssets = 100;
            const days = 30;

            const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);
            expect(apy).toBe(0);
        });

        test('should return 0 when assets is 0', () => {
            const totalYield = 10;
            const totalAssets = 0;
            const days = 30;

            const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);
            expect(apy).toBe(0);
        });

        test('should return 0 when days is 0', () => {
            const totalYield = 10;
            const totalAssets = 100;
            const days = 0;

            const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);
            expect(apy).toBe(0);
        });

        test('should handle small yield values', () => {
            const totalYield = 0.001;
            const totalAssets = 1000;
            const days = 7;

            const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);
            expect(apy).toBeGreaterThan(0);
            expect(apy).toBeLessThan(0.1);
        });

        test('should handle large yield values', () => {
            const totalYield = 1000;
            const totalAssets = 100;
            const days = 7;

            const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);
            expect(apy).toBeGreaterThan(0);
            // APY should be capped or handled gracefully
            expect(isFinite(apy)).toBe(true);
        });
    });

    describe('calculateAPYFromHarvests', () => {
        const mockHarvests: HarvestEvent[] = [
            {
                id: '1',
                contract_id: 'CA123',
                amount: '1000',
                yield: '10',
                timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
            },
            {
                id: '2',
                contract_id: 'CA123',
                amount: '2000',
                yield: '20',
                timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 days ago
            },
            {
                id: '3',
                contract_id: 'CA123',
                amount: '3000',
                yield: '30',
                timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000), // 3 days ago
            },
        ];

        test('should calculate 7-day APY from harvests', () => {
            const result = APYCalculator.calculateAPYFromHarvests(
                mockHarvests,
                10000,
                7
            );

            expect(result.harvest_count).toBe(3);
            expect(result.total_yield).toBe(60);
            expect(result.apy).toBeGreaterThan(0);
        });

        test('should return 0 when no harvests in window', () => {
            const oldHarvests: HarvestEvent[] = [
                {
                    id: '1',
                    contract_id: 'CA123',
                    amount: '1000',
                    yield: '10',
                    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
                },
            ];

            const result = APYCalculator.calculateAPYFromHarvests(
                oldHarvests,
                10000,
                7
            );

            expect(result.harvest_count).toBe(0);
            expect(result.total_yield).toBe(0);
            expect(result.apy).toBe(0);
        });
    });

    describe('calculateAllAPY', () => {
        const mockHarvests: HarvestEvent[] = [
            {
                id: '1',
                contract_id: 'CA123',
                amount: '1000',
                yield: '10',
                timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
            {
                id: '2',
                contract_id: 'CA123',
                amount: '2000',
                yield: '20',
                timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000),
            },
        ];

        test('should calculate both 7-day and 30-day APY', () => {
            const { apy7d, apy30d } = APYCalculator.calculateAllAPY(
                mockHarvests,
                10000
            );

            expect(apy7d.calculation_type).toBe('7d');
            expect(apy30d.calculation_type).toBe('30d');
            expect(apy7d.harvest_count).toBe(2);
            expect(apy30d.harvest_count).toBe(2);
        });
    });

    describe('calculateAPYForRange', () => {
        const mockHarvests: HarvestEvent[] = [
            {
                id: '1',
                contract_id: 'CA123',
                amount: '1000',
                yield: '10',
                timestamp: new Date('2024-01-15'),
            },
            {
                id: '2',
                contract_id: 'CA123',
                amount: '2000',
                yield: '20',
                timestamp: new Date('2024-01-20'),
            },
            {
                id: '3',
                contract_id: 'CA123',
                amount: '3000',
                yield: '30',
                timestamp: new Date('2024-01-25'),
            },
        ];

        test('should calculate APY for a date range', () => {
            const startDate = new Date('2024-01-15');
            const endDate = new Date('2024-01-25');

            const result = APYCalculator.calculateAPYForRange(
                mockHarvests,
                10000,
                startDate,
                endDate
            );

            expect(result.harvestCount).toBe(3);
            expect(result.totalYield).toBe(60);
            expect(result.days).toBe(10);
            expect(result.apy).toBeGreaterThan(0);
        });
    });
});

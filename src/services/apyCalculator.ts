import { HarvestEvent, YieldCalculation } from '../types/apy';

export class APYCalculator {
    /**
     * Calculate APY using the formula:
     * APY = (1 + totalYield/totalAssets)^(365/days) - 1
     */
    static calculateAPY(
        totalYield: number,
        totalAssets: number,
        days: number
    ): number {
        // Edge case: no yield or no assets
        if (totalYield === 0 || totalAssets === 0 || days === 0) {
            return 0;
        }

        // If yield is greater than assets (shouldn't happen, but handle gracefully)
        if (totalYield > totalAssets) {
            // Still calculate but cap at reasonable value
        }

        const yieldRatio = totalYield / totalAssets;
        const exponent = 365 / days;
        
        // Calculate APY with high precision
        try {
            const apy = Math.pow(1 + yieldRatio, exponent) - 1;
            // Guard against NaN or Infinity
            if (!isFinite(apy) || isNaN(apy)) {
                return 0;
            }
            return Math.max(0, apy); // Ensure non-negative
        } catch (error) {
            console.error('APY calculation error:', error);
            return 0;
        }
    }

    /**
     * Calculate 7-day and 30-day APY from harvest events
     */
    static calculateAPYFromHarvests(
        harvests: HarvestEvent[],
        totalAssets: number,
        windowDays: 7 | 30
    ): Omit<YieldCalculation, 'contract_id' | 'calculated_at'> {
        // Filter harvests within the window
        const now = new Date();
        const windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() - windowDays);

        const harvestsInWindow = harvests.filter(
            h => h.timestamp >= windowStart && h.timestamp <= now
        );

        // Edge case: no harvests in window
        if (harvestsInWindow.length === 0) {
            return {
                calculation_type: `${windowDays}d` as '7d' | '30d',
                apy: 0,
                total_yield: 0,
                total_assets: totalAssets,
                days: windowDays,
                harvest_count: 0,
                window_start: windowStart,
                window_end: now,
            };
        }

        // Calculate total yield from harvests in window
        const totalYield = harvestsInWindow.reduce(
            (sum, h) => sum + parseFloat(h.yield),
            0
        );

        // Calculate APY
        const apy = APYCalculator.calculateAPY(
            totalYield,
            totalAssets,
            windowDays
        );

        return {
            calculation_type: `${windowDays}d` as '7d' | '30d',
            apy,
            total_yield: totalYield,
            total_assets: totalAssets,
            days: windowDays,
            harvest_count: harvestsInWindow.length,
            window_start: windowStart,
            window_end: now,
        };
    }

    /**
     * Calculate both 7-day and 30-day APY
     */
    static calculateAllAPY(
        harvests: HarvestEvent[],
        totalAssets: number
    ): {
        apy7d: Omit<YieldCalculation, 'contract_id' | 'calculated_at'>;
        apy30d: Omit<YieldCalculation, 'contract_id' | 'calculated_at'>;
    } {
        const apy7d = APYCalculator.calculateAPYFromHarvests(
            harvests,
            totalAssets,
            7
        );

        const apy30d = APYCalculator.calculateAPYFromHarvests(
            harvests,
            totalAssets,
            30
        );

        return { apy7d, apy30d };
    }

    /**
     * Calculate APY for a specific date range
     */
    static calculateAPYForRange(
        harvests: HarvestEvent[],
        totalAssets: number,
        startDate: Date,
        endDate: Date
    ): {
        apy: number;
        totalYield: number;
        harvestCount: number;
        days: number;
    } {
        const harvestsInRange = harvests.filter(
            h => h.timestamp >= startDate && h.timestamp <= endDate
        );

        if (harvestsInRange.length === 0 || totalAssets === 0) {
            return {
                apy: 0,
                totalYield: 0,
                harvestCount: 0,
                days: 0,
            };
        }

        const totalYield = harvestsInRange.reduce(
            (sum, h) => sum + parseFloat(h.yield),
            0
        );

        const days = Math.max(
            1,
            Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        );

        const apy = APYCalculator.calculateAPY(totalYield, totalAssets, days);

        return {
            apy,
            totalYield,
            harvestCount: harvestsInRange.length,
            days,
        };
    }
}

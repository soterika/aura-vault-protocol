import { APYCalculator } from './apyCalculator';
import { YieldRepository } from '../repositories/yieldRepository';
import { HarvestEvent, YieldCalculation, YieldSnapshot } from '../types/apy';

export class APYService {
    private contractId: string;
    private totalAssets: number;

    constructor(contractId: string, totalAssets: number = 0) {
        this.contractId = contractId;
        this.totalAssets = totalAssets;
    }

    /**
     * Update APY calculations when a harvest event is indexed
     */
    async updateOnHarvest(harvestEvent: HarvestEvent): Promise<void> {
        console.log(`📊 Updating APY calculations for harvest ${harvestEvent.id}`);

        // Get all harvests for the contract
        const harvests = await this.getHarvestsForContract();

        // Update total assets
        this.totalAssets += parseFloat(harvestEvent.amount);

        // Calculate both APYs
        const { apy7d, apy30d } = APYCalculator.calculateAllAPY(
            harvests,
            this.totalAssets
        );

        // Save calculations
        const calculations: YieldCalculation[] = [
            {
                contract_id: this.contractId,
                ...apy7d,
                calculated_at: new Date(),
            },
            {
                contract_id: this.contractId,
                ...apy30d,
                calculated_at: new Date(),
            },
        ];

        for (const calc of calculations) {
            await YieldRepository.saveYieldCalculation(calc);
        }

        // Save snapshot
        await this.takeSnapshot(apy7d.apy, apy30d.apy);

        console.log(`✅ APY calculations updated: 7d=${(apy7d.apy * 100).toFixed(2)}%, 30d=${(apy30d.apy * 100).toFixed(2)}%`);
    }

    /**
     * Take a snapshot of current APY values
     */
    async takeSnapshot(apy7d: number, apy30d: number): Promise<void> {
        const snapshot: YieldSnapshot = {
            contract_id: this.contractId,
            apy_7d: apy7d,
            apy_30d: apy30d,
            total_yield: await this.getTotalYield(),
            total_assets: this.totalAssets,
            snapshot_at: new Date(),
        };

        await YieldRepository.saveYieldSnapshot(snapshot);
    }

    /**
     * Get current APY values
     */
    async getCurrentAPY(): Promise<{
        apy7d: number;
        apy30d: number;
        totalYield: number;
        totalAssets: number;
    }> {
        const harvests = await this.getHarvestsForContract();

        const { apy7d, apy30d } = APYCalculator.calculateAllAPY(
            harvests,
            this.totalAssets
        );

        return {
            apy7d: apy7d.apy,
            apy30d: apy30d.apy,
            totalYield: await this.getTotalYield(),
            totalAssets: this.totalAssets,
        };
    }

    /**
     * Get historical APY data for charting
     */
    async getHistoricalAPY(days: number = 30): Promise<any[]> {
        return YieldRepository.getHistoricalAPY(this.contractId, days);
    }

    /**
     * Get latest APY calculations
     */
    async getLatestCalculations(): Promise<any[]> {
        return YieldRepository.getLatestCalculations(this.contractId);
    }

    /**
     * Update APY calculations periodically (for cron job)
     */
    async updatePeriodic(): Promise<void> {
        console.log(`🔄 Running periodic APY update for ${this.contractId}`);

        const harvests = await this.getHarvestsForContract();

        if (harvests.length === 0) {
            console.log('ℹ️ No harvests found, skipping update');
            return;
        }

        const { apy7d, apy30d } = APYCalculator.calculateAllAPY(
            harvests,
            this.totalAssets
        );

        const calculations: YieldCalculation[] = [
            {
                contract_id: this.contractId,
                ...apy7d,
                calculated_at: new Date(),
            },
            {
                contract_id: this.contractId,
                ...apy30d,
                calculated_at: new Date(),
            },
        ];

        for (const calc of calculations) {
            await YieldRepository.saveYieldCalculation(calc);
        }

        await this.takeSnapshot(apy7d.apy, apy30d.apy);

        console.log(`✅ Periodic APY update complete`);
    }

    // Helper methods
    private async getHarvestsForContract(): Promise<HarvestEvent[]> {
        // In a real implementation, this would fetch from the database
        // For now, return mock data
        return [];
    }

    private async getTotalYield(): Promise<number> {
        // In a real implementation, this would sum all harvest yields
        return 0;
    }
}

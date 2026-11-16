import { query, transaction } from '../db';
import { YieldCalculation, YieldSnapshot } from '../types/apy';

export class YieldRepository {
    static async saveYieldCalculation(
        calculation: YieldCalculation
    ): Promise<void> {
        const sql = `
            INSERT INTO yield_calculations (
                contract_id,
                calculation_type,
                apy,
                total_yield,
                total_assets,
                days,
                harvest_count,
                window_start,
                window_end
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (contract_id, calculation_type, window_end)
            DO UPDATE SET
                apy = EXCLUDED.apy,
                total_yield = EXCLUDED.total_yield,
                total_assets = EXCLUDED.total_assets,
                harvest_count = EXCLUDED.harvest_count,
                window_start = EXCLUDED.window_start
        `;

        await query(sql, [
            calculation.contract_id,
            calculation.calculation_type,
            calculation.apy,
            calculation.total_yield,
            calculation.total_assets,
            calculation.days,
            calculation.harvest_count,
            calculation.window_start,
            calculation.window_end,
        ]);
    }

    static async saveYieldSnapshot(
        snapshot: YieldSnapshot
    ): Promise<void> {
        const sql = `
            INSERT INTO yield_snapshots (
                contract_id,
                apy_7d,
                apy_30d,
                total_yield,
                total_assets,
                snapshot_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `;

        await query(sql, [
            snapshot.contract_id,
            snapshot.apy_7d,
            snapshot.apy_30d,
            snapshot.total_yield,
            snapshot.total_assets,
            snapshot.snapshot_at,
        ]);
    }

    static async getLatestCalculations(
        contractId: string
    ): Promise<YieldCalculation[]> {
        const sql = `
            SELECT * FROM yield_calculations
            WHERE contract_id = $1
            ORDER BY calculated_at DESC
            LIMIT 10
        `;
        return query(sql, [contractId]);
    }

    static async getSnapshots(
        contractId: string,
        days: number = 30
    ): Promise<YieldSnapshot[]> {
        const sql = `
            SELECT * FROM yield_snapshots
            WHERE contract_id = $1
              AND snapshot_at >= CURRENT_TIMESTAMP - INTERVAL '$2 days'
            ORDER BY snapshot_at ASC
        `;
        return query(sql, [contractId, days]);
    }

    static async getHistoricalAPY(
        contractId: string,
        days: number = 7
    ): Promise<Array<{ snapshot_at: Date; apy_7d: number; apy_30d: number }>> {
        const sql = `
            SELECT
                snapshot_at,
                apy_7d,
                apy_30d
            FROM yield_snapshots
            WHERE contract_id = $1
              AND snapshot_at >= CURRENT_TIMESTAMP - INTERVAL '$2 days'
            ORDER BY snapshot_at ASC
        `;
        return query(sql, [contractId, days]);
    }
}

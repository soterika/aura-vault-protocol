import { getReadPool } from "../db.js";

export interface KeeperStats {
  keeper: string;
  harvestCount: number;
  totalYieldHarvested: string;
  lastHarvest: string | null;
}

/** Aggregate indexed harvest events for the backend keeper leaderboard. */
export async function getKeeperStats(limit = 20): Promise<KeeperStats[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const result = await getReadPool().query<{
    keeper: string;
    harvest_count: string;
    total_yield_harvested: string;
    last_harvest: Date | null;
  }>(
    `SELECT caller_address AS keeper,
            COUNT(*)::TEXT AS harvest_count,
            COALESCE(SUM(amount), 0)::TEXT AS total_yield_harvested,
            MAX(ledger_timestamp) AS last_harvest
       FROM vault_events
      WHERE event_type = 'harvest'
      GROUP BY caller_address
      ORDER BY SUM(amount) DESC, COUNT(*) DESC, caller_address ASC
      LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map((row) => ({
    keeper: row.keeper,
    harvestCount: Number(row.harvest_count),
    totalYieldHarvested: row.total_yield_harvested,
    lastHarvest: row.last_harvest?.toISOString() ?? null,
  }));
}

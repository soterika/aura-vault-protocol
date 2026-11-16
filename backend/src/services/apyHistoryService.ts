import { getReadPool } from "../db.js";

export type ApyPeriod = "7d" | "30d" | "90d" | "1y";

export interface ApyHistoryPoint {
  timestamp: Date;
  apy_7d: string | null;
  apy_30d: string | null;
  total_yield: string | null;
  total_assets: string | null;
}

const PERIOD_DAYS: Record<ApyPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

export function isValidPeriod(period: unknown): period is ApyPeriod {
  return typeof period === "string" && period in PERIOD_DAYS;
}

export async function getApyHistory(
  contractId: string,
  period: ApyPeriod
): Promise<ApyHistoryPoint[]> {
  const { rows } = await getReadPool().query<ApyHistoryPoint>(
    `SELECT snapshot_at AS timestamp, apy_7d, apy_30d,
            total_yield, total_assets
       FROM yield_snapshots
      WHERE contract_id = $1
        AND snapshot_at >= NOW() - ($2::integer * INTERVAL '1 day')
      ORDER BY snapshot_at ASC`,
    [contractId, PERIOD_DAYS[period]]
  );
  return rows;
}
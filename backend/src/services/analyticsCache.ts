import {
  cacheHashDel,
  cacheHashFieldDel,
  cacheHashGet,
  cacheHashGetAll,
  cacheHashSet,
  cacheHashSetMany,
  cacheSortedSetGet,
  cacheSortedSetSet,
  cacheDel,
  NS,
  type SortedCacheEntry,
} from "../cache.js";
import { getReadPool, getWritePool } from "../db.js";
import { logger } from "../logger.js";

const LEADERBOARD_KEY = "current";
const LEADERBOARD_TTL_SECONDS = 60;
const ANALYTICS_TTL_SECONDS = 300;

export interface LeaderboardEntry {
  userId: string;
  shareBalance: string;
}

export type LeaderboardPeriod = "all" | "30d" | "7d" | "24h";

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
  rankChange: number | null;
}

async function refreshLeaderboard(): Promise<LeaderboardEntry[]> {
  const { rows } = await getReadPool().query<{
    user_id: string;
    share_balance: string;
  }>(
    `SELECT user_id::text AS user_id, SUM(amount)::text AS share_balance
       FROM vault_positions
      WHERE deleted_at IS NULL
      GROUP BY user_id
      ORDER BY SUM(amount) DESC
      LIMIT 100`
  );
  const entries: LeaderboardEntry[] = rows.map((row) => ({
    userId: row.user_id,
    shareBalance: row.share_balance,
  }));

  // Keep one baseline per hour for period-over-period rank movement. The
  // primary key makes concurrent cache warmers safe, and old snapshots are
  // pruned in the same statement to bound storage growth.
  try {
    await getWritePool().query(
      `WITH snapshot_time AS (
         SELECT date_trunc('hour', NOW()) AS at
       ), inserted AS (
         INSERT INTO leaderboard_rank_snapshots (snapshot_at, user_id, rank, share_balance)
         SELECT snapshot_time.at, ranked.user_id, ranked.rank, ranked.share_balance
           FROM snapshot_time
           CROSS JOIN LATERAL (
             SELECT user_id, share_balance, ROW_NUMBER() OVER (ORDER BY share_balance DESC, user_id)::integer AS rank
               FROM (
                 SELECT user_id, SUM(amount) AS share_balance
                   FROM vault_positions
                  WHERE deleted_at IS NULL
                  GROUP BY user_id
               ) balances
              ORDER BY share_balance DESC, user_id
              LIMIT 100
           ) ranked
          WHERE NOT EXISTS (
            SELECT 1 FROM leaderboard_rank_snapshots existing
             WHERE existing.snapshot_at = snapshot_time.at
          )
         ON CONFLICT (snapshot_at, user_id) DO NOTHING
         RETURNING 1
       )
       DELETE FROM leaderboard_rank_snapshots
        WHERE snapshot_at < NOW() - INTERVAL '31 days'`
    );
  } catch (err) {
    // Historical rank tracking must not take down the public live leaderboard
    // when a deployment has not yet applied the optional snapshot migration.
    logger.warn({ err }, "Leaderboard rank snapshot could not be stored");
  }
  const sorted: SortedCacheEntry[] = entries.map((entry) => ({
    member: JSON.stringify([entry.userId, entry.shareBalance]),
    score: Number(entry.shareBalance),
  }));
  await cacheSortedSetSet(
    NS.ANALYTICS_LEADERBOARD,
    LEADERBOARD_KEY,
    sorted,
    LEADERBOARD_TTL_SECONDS
  );
  return entries;
}

export async function getRankedLeaderboard(
  period: LeaderboardPeriod
): Promise<RankedLeaderboardEntry[]> {
  const entries = await getCachedLeaderboard();
  const current = entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    rankChange: null as number | null,
  }));
  if (period === "all" || current.length === 0) return current;

  const hours = period === "24h" ? 24 : period === "7d" ? 24 * 7 : 24 * 30;
  const { rows } = await getReadPool().query<{ user_id: string; rank: number }>(
    `SELECT user_id::text AS user_id, rank
       FROM leaderboard_rank_snapshots
      WHERE snapshot_at = (
        SELECT MAX(snapshot_at)
          FROM leaderboard_rank_snapshots
         WHERE snapshot_at <= NOW() - ($1::integer * INTERVAL '1 hour')
      )`,
    [hours]
  );
  const previousRanks = new Map(rows.map((row) => [row.user_id, row.rank]));
  return current.map((entry) => {
    const previousRank = previousRanks.get(entry.userId);
    return {
      ...entry,
      rankChange: previousRank === undefined ? null : previousRank - entry.rank,
    };
  });
}

export async function getCachedLeaderboard(): Promise<LeaderboardEntry[]> {
  const cached = await cacheSortedSetGet(
    NS.ANALYTICS_LEADERBOARD,
    LEADERBOARD_KEY
  );
  if (cached !== null) {
    return cached.map(({ member }) => {
      const [userId, shareBalance] = JSON.parse(member) as [string, string];
      return { userId, shareBalance };
    });
  }
  return refreshLeaderboard();
}

export async function getCachedApyHistory<T>(
  contractId: string,
  period: string,
  load: () => Promise<T[]>
): Promise<T[]> {
  const cached = await cacheHashGetAll<T>(NS.ANALYTICS_APY, contractId);
  const prefix = `${period}:`;
  if (cached !== null) {
    const matching = Object.entries(cached)
      .filter(([field]) => field.startsWith(prefix))
      .filter(([field]) => !field.endsWith(":__empty__"))
      .map(([, value]) => value);
    if (matching.length > 0 || cached[`${prefix}__empty__`] !== undefined) {
      return matching;
    }
  }

  const history = await load();
  const fields: Record<string, T | null> = {};
  for (const [index, point] of history.entries()) {
    const value = point as unknown as Record<string, unknown>;
    const timestamp =
      value.snapshot_at ?? value.snapshotAt ?? value.timestamp ?? value.date;
    fields[`${prefix}${timestamp ?? index}`] = point;
  }
  if (history.length === 0) fields[`${prefix}__empty__`] = null;
  await cacheHashSetMany(
    NS.ANALYTICS_APY,
    contractId,
    fields,
    ANALYTICS_TTL_SECONDS
  );
  return history;
}

export interface UserVolume {
  walletAddress: string;
  depositVolume: string;
  completedDeposits: number;
}

export async function getCachedUserVolume(
  walletAddress: string
): Promise<UserVolume> {
  const cacheKey = "wallets";
  const cached = await cacheHashGet<UserVolume>(
    NS.ANALYTICS_USER_VOLUME,
    cacheKey,
    walletAddress
  );
  if (cached !== null) return cached;

  const { rows } = await getReadPool().query<{
    deposit_volume: string;
    completed_deposits: string;
  }>(
    `SELECT COALESCE(SUM(amount::numeric), 0)::text AS deposit_volume,
            COUNT(*)::text AS completed_deposits
       FROM transaction_jobs
      WHERE wallet_address = $1
        AND tx_type = 'deposit'
        AND status = 'completed'
        AND amount ~ '^[0-9]+(\\.[0-9]+)?$'`,
    [walletAddress]
  );
  const result: UserVolume = {
    walletAddress,
    depositVolume: rows[0]?.deposit_volume ?? "0",
    completedDeposits: Number(rows[0]?.completed_deposits ?? 0),
  };
  await cacheHashSet(
    NS.ANALYTICS_USER_VOLUME,
    cacheKey,
    walletAddress,
    result,
    ANALYTICS_TTL_SECONDS
  );
  return result;
}

export async function invalidateAnalyticsCaches(
  walletAddress?: string,
  contractId?: string
): Promise<void> {
  const invalidations: Promise<void>[] = [
    cacheDel(NS.ANALYTICS_LEADERBOARD, LEADERBOARD_KEY),
  ];
  if (contractId) {
    invalidations.push(cacheHashDel(NS.ANALYTICS_APY, contractId));
  }
  if (walletAddress) {
    invalidations.push(
      cacheHashFieldDel(NS.ANALYTICS_USER_VOLUME, "wallets", walletAddress)
    );
  }
  await Promise.all(invalidations);
}

let leaderboardWarmup: ReturnType<typeof setInterval> | null = null;

export function startAnalyticsCacheWarmer(): void {
  if (leaderboardWarmup !== null) return;
  const warm = () => {
    void refreshLeaderboard().catch((err) => {
      logger.warn({ err }, "Leaderboard cache warm-up failed");
    });
  };
  warm();
  leaderboardWarmup = setInterval(warm, LEADERBOARD_TTL_SECONDS * 1000);
}

export function stopAnalyticsCacheWarmer(): void {
  if (leaderboardWarmup !== null) {
    clearInterval(leaderboardWarmup);
    leaderboardWarmup = null;
  }
}

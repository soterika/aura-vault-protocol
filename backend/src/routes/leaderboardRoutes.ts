import { Router } from "express";
import {
  getRankedLeaderboard,
  type LeaderboardPeriod,
} from "../services/analyticsCache.js";
import { logger } from "../logger.js";
import { getVaultStats } from "../services/vaultStatsServiceV2.js";

export const leaderboardRouter = Router();

const periods = new Set<LeaderboardPeriod>(["all", "30d", "7d", "24h"]);

leaderboardRouter.get("/", async (req, res): Promise<void> => {
  try {
    const requestedPeriod = req.query.period;
    const period = typeof requestedPeriod === "string" && periods.has(requestedPeriod as LeaderboardPeriod)
      ? requestedPeriod as LeaderboardPeriod
      : "all";
    if (requestedPeriod !== undefined && (typeof requestedPeriod !== "string" || !periods.has(requestedPeriod as LeaderboardPeriod))) {
      res.status(400).json({ error: "period must be one of all, 30d, 7d, or 24h" });
      return;
    }
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const currentAddress = typeof req.query.address === "string" ? req.query.address : undefined;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20 ||
        (currentAddress !== undefined && !/^G[A-Z2-7]{55}$/.test(currentAddress))) {
      res.status(400).json({ error: "page must be positive, pageSize must be 1–20, and address must be a valid Stellar account" });
      return;
    }
    const [entries, vaultStats] = await Promise.all([
      getRankedLeaderboard(period),
      getVaultStats().catch(() => null),
    ]);
    const sharePrice = Number(vaultStats?.stats.sharePrice ?? 1);
    const start = (page - 1) * pageSize;
    const pageEntries = entries.slice(start, start + pageSize);
    res.json({
      leaderboard: pageEntries.map(({ userId, shareBalance, rank, rankChange }) => ({
        userId,
        shareBalance,
        usdValue: (Number(shareBalance) * sharePrice).toString(),
        isCurrentUser: currentAddress === userId,
        rank,
        rankChange,
      })),
      total: entries.length,
      page,
      pageSize,
      totalPages: Math.ceil(entries.length / pageSize),
      period,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to retrieve leaderboard");
    res.status(500).json({ error: "Failed to retrieve leaderboard" });
  }
});

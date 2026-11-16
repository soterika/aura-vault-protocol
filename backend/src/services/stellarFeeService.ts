/**
 * Stellar Fee Stats Service — Issue #249
 *
 * Fetches fee statistics from the Horizon /fee_stats endpoint and exposes
 * a cached summary with XLM fee estimates for pre-sign transaction breakdowns.
 *
 * Horizon /fee_stats reference:
 *   https://developers.stellar.org/api/horizon/resources/fee-stats
 */

import { horizonFetch } from "./horizonClient.js";
import { cacheGet, cacheSet } from "../cache.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_NS = "stellar:fee-stats";
const CACHE_KEY = "latest";

/** Cache TTL in seconds. Fee stats change slowly; 30 s is a good balance. */
const CACHE_TTL_SECS = 30;

/** Stellar base reserve in XLM stroops (1 XLM = 10_000_000 stroops). */
const STROOPS_PER_XLM = 10_000_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by Horizon /fee_stats */
interface HorizonFeeStats {
  last_ledger: string;
  last_ledger_base_fee: string;
  ledger_capacity_usage: string;
  fee_charged: {
    max: string;
    min: string;
    mode: string;
    p10: string;
    p20: string;
    p30: string;
    p40: string;
    p50: string;
    p60: string;
    p70: string;
    p80: string;
    p90: string;
    p95: string;
    p99: string;
  };
  max_fee: {
    max: string;
    min: string;
    mode: string;
    p10: string;
    p20: string;
    p30: string;
    p40: string;
    p50: string;
    p60: string;
    p70: string;
    p80: string;
    p90: string;
    p95: string;
    p99: string;
  };
}

/** Normalized fee tier in human-readable XLM values. */
export interface FeeTier {
  /** Fee in stroops (raw Stellar unit). */
  stroops: number;
  /** Fee in XLM (human-readable). */
  xlm: string;
}

/** Public shape returned by the API endpoint. */
export interface StellarFeeStats {
  lastLedger: number;
  lastLedgerBaseFee: number;
  ledgerCapacityUsage: number;
  /** Network congestion: true when capacity usage is above 50%. */
  congested: boolean;
  fee: {
    /** Conservative estimate — p50 of charged fees. */
    low: FeeTier;
    /** Standard estimate — p70 of charged fees. */
    standard: FeeTier;
    /** Priority estimate — p95 of charged fees. */
    high: FeeTier;
    /** Minimum base fee from the last ledger. */
    base: FeeTier;
  };
  fetchedAt: string;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stroopsToXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7);
}

function parseStroops(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildFeeTier(stroops: number): FeeTier {
  return { stroops, xlm: stroopsToXlm(stroops) };
}

function normalize(raw: HorizonFeeStats, cached: boolean): StellarFeeStats {
  const baseFee = parseStroops(raw.last_ledger_base_fee, 100);
  const capacityUsage = parseFloat(raw.ledger_capacity_usage ?? "0");

  return {
    lastLedger: parseInt(raw.last_ledger, 10),
    lastLedgerBaseFee: baseFee,
    ledgerCapacityUsage: capacityUsage,
    congested: capacityUsage > 0.5,
    fee: {
      base: buildFeeTier(baseFee),
      low: buildFeeTier(parseStroops(raw.fee_charged?.p50, baseFee)),
      standard: buildFeeTier(parseStroops(raw.fee_charged?.p70, baseFee * 2)),
      high: buildFeeTier(parseStroops(raw.fee_charged?.p95, baseFee * 5)),
    },
    fetchedAt: new Date().toISOString(),
    cached,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Stellar fee statistics from Horizon, with Redis caching.
 *
 * Falls back to a reasonable default when Horizon is unreachable.
 */
export async function getStellarFeeStats(): Promise<StellarFeeStats> {
  // 1. Try Redis cache
  try {
    const cached = await cacheGet<StellarFeeStats>(CACHE_NS, CACHE_KEY);
    if (cached) return { ...cached, cached: true };
  } catch {
    // Redis unavailable — proceed to live fetch
  }

  // 2. Live fetch from Horizon
  try {
    const raw = await horizonFetch<HorizonFeeStats>(
      "/fee_stats",
      "fee_stats:latest"
    );
    const stats = normalize(raw, false);

    // Populate cache (best-effort)
    try {
      await cacheSet(CACHE_NS, CACHE_KEY, stats, CACHE_TTL_SECS);
    } catch {
      // Redis unavailable — serve without caching
    }

    return stats;
  } catch (err) {
    logger.error("[stellar-fee-stats] Horizon fetch failed, using fallback", err);

    // 3. Graceful fallback: return sensible defaults when Horizon is down
    const BASE_FEE_FALLBACK = 100; // 100 stroops = Stellar minimum
    return {
      lastLedger: 0,
      lastLedgerBaseFee: BASE_FEE_FALLBACK,
      ledgerCapacityUsage: 0,
      congested: false,
      fee: {
        base: buildFeeTier(BASE_FEE_FALLBACK),
        low: buildFeeTier(BASE_FEE_FALLBACK),
        standard: buildFeeTier(BASE_FEE_FALLBACK * 2),
        high: buildFeeTier(BASE_FEE_FALLBACK * 5),
      },
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
  }
}

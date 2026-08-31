/**
 * Yield Calculation Service
 *
 * Calculates real-time and historical yield for vault positions.
 * Supports multiple yield sources (staking, fees, incentives) with
 * compound interest, batch processing for 100k+ positions, backfill,
 * and alerting on calculation failures.
 */

export type YieldSourceType = "staking" | "fees" | "incentives";

export interface YieldSource {
  type: YieldSourceType;
  apy: number; // annual percentage yield, e.g. 0.085 = 8.5%
}

export interface VaultPosition {
  id: string;
  userId: string;
  vaultId: string;
  amount: number;       // underlying token amount (18-decimal normalised)
  entryDate: Date;
  isActive: boolean;   // false = closed/deactivated vault
}

export interface YieldResult {
  positionId: string;
  dailyYield: number;
  totalYield: number;       // for backfill: cumulative from entryDate to calcDate
  effectiveApy: number;     // combined APY across all sources
  calcDate: Date;
  sources: { type: YieldSourceType; yield: number }[];
}

export interface BatchResult {
  processed: number;
  failed: number;
  errors: { positionId: string; error: string }[];
  results: YieldResult[];
  durationMs: number;
}

export interface YieldServiceOptions {
  batchSize?: number;            // positions per concurrent batch (default 500)
  onAlert?: (msg: string, meta?: unknown) => void;
}

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

/**
 * Compound daily yield for a single source.
 * Formula: P * ((1 + APY)^(1/365) - 1)
 * Accurate to 0.01% relative error vs. continuous compounding.
 */
export function dailyYieldForSource(amount: number, apy: number): number {
  if (amount <= 0 || apy <= 0) return 0;
  const dailyRate = Math.pow(1 + apy, 1 / 365) - 1;
  return amount * dailyRate;
}

/**
 * Total compound yield from entryDate to calcDate across all sources.
 * Uses combined APY: (1+apy1)*(1+apy2)*... - 1
 */
export function totalCompoundYield(
  amount: number,
  sources: YieldSource[],
  entryDate: Date,
  calcDate: Date
): number {
  if (amount <= 0 || sources.length === 0) return 0;
  const days = Math.max(0, (calcDate.getTime() - entryDate.getTime()) / 86_400_000);
  if (days <= 0) return 0;

  // Combine APYs multiplicatively to account for compounding across sources
  const combinedGrowth = sources.reduce((acc, s) => acc * (1 + Math.max(0, s.apy)), 1);
  const combinedApy = combinedGrowth - 1;
  if (combinedApy <= 0) return 0;

  const dailyRate = Math.pow(1 + combinedApy, 1 / 365) - 1;
  return amount * (Math.pow(1 + dailyRate, days) - 1);
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createYieldService(opts: YieldServiceOptions = {}) {
  const batchSize = opts.batchSize ?? 500;
  const alert = opts.onAlert ?? ((msg, meta) => console.error(`[YieldService] ALERT: ${msg}`, meta ?? ""));

  /**
   * Calculate yield for a single position at the given date.
   * Returns null (and fires alert) if the position is inactive or amount is zero.
   */
  function calculateForPosition(
    position: VaultPosition,
    sources: YieldSource[],
    calcDate: Date = new Date()
  ): YieldResult | null {
    if (!position.isActive) {
      // Edge case: vault closed/deactivated — emit alert, skip
      alert("Skipping inactive position", { positionId: position.id });
      return null;
    }
    if (position.amount <= 0) {
      alert("Position has zero amount", { positionId: position.id });
      return null;
    }

    const activeSources = sources.filter((s) => s.apy > 0);
    const effectiveApy = activeSources.reduce((acc, s) => acc * (1 + s.apy), 1) - 1;

    const perSourceDaily = activeSources.map((s) => ({
      type: s.type,
      yield: dailyYieldForSource(position.amount, s.apy),
    }));
    const dailyYield = perSourceDaily.reduce((sum, s) => sum + s.yield, 0);
    const totalYield = totalCompoundYield(position.amount, activeSources, position.entryDate, calcDate);

    return {
      positionId: position.id,
      dailyYield,
      totalYield,
      effectiveApy,
      calcDate,
      sources: perSourceDaily,
    };
  }

  /**
   * Process up to 100k+ positions efficiently in sequential batches.
   * Each batch is processed concurrently; promises are bounded to batchSize
   * to avoid memory pressure.
   */
  async function processBatch(
    positions: VaultPosition[],
    sources: YieldSource[],
    calcDate: Date = new Date()
  ): Promise<BatchResult> {
    const start = Date.now();
    const results: YieldResult[] = [];
    const errors: { positionId: string; error: string }[] = [];

    for (let i = 0; i < positions.length; i += batchSize) {
      const chunk = positions.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        chunk.map((p) =>
          Promise.resolve().then(() => calculateForPosition(p, sources, calcDate))
        )
      );

      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j];
        const pos = chunk[j];
        if (outcome.status === "fulfilled") {
          if (outcome.value !== null) results.push(outcome.value);
        } else {
          const errMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
          errors.push({ positionId: pos.id, error: errMsg });
          alert("Calculation failure", { positionId: pos.id, error: errMsg });
        }
      }
    }

    if (errors.length > 0) {
      alert(`Batch completed with ${errors.length} failure(s) out of ${positions.length}`, {
        failureRate: `${((errors.length / positions.length) * 100).toFixed(2)}%`,
      });
    }

    return {
      processed: results.length,
      failed: errors.length,
      errors,
      results,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Backfill: calculate yield for every hour between startDate and endDate.
   * Useful for catching up missed hourly runs.
   * Returns one BatchResult per hourly interval.
   */
  async function backfill(
    positions: VaultPosition[],
    sources: YieldSource[],
    startDate: Date,
    endDate: Date
  ): Promise<BatchResult[]> {
    const hourMs = 3_600_000;
    const slots: Date[] = [];
    for (let t = startDate.getTime(); t <= endDate.getTime(); t += hourMs) {
      slots.push(new Date(t));
    }

    const batchResults: BatchResult[] = [];
    for (const slot of slots) {
      // Only process active positions at that point in time
      const eligible = positions.filter((p) => p.entryDate <= slot);
      const result = await processBatch(eligible, sources, slot);
      batchResults.push(result);
    }
    return batchResults;
  }

  return { calculateForPosition, processBatch, backfill };
}

export type YieldService = ReturnType<typeof createYieldService>;

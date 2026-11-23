/**
 * Portfolio Analytics Service — Issue #320
 *
 * Pre-computes and caches per-address analytics:
 *   totalDeposited, totalWithdrawn, netPnL, averageEntryPrice
 *
 * Strategy:
 *   - Computed on first request, stored in Redis with a configurable TTL
 *   - Invalidated (and recomputed async) on harvest events via triggerHarvestRecalculation()
 *   - FIFO cost-basis accounting for P&L
 *   - Handles thousands of transactions via O(n) single-pass FIFO sweep
 */

import { getRedis } from "../redis.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxEventType = "deposit" | "withdrawal" | "harvest";

export interface TxEvent {
  type: TxEventType;
  amount: string;       // string bigint, stroops or smallest unit
  timestamp: number;    // Unix ms
  pricePerUnit?: string; // optional price at time of event (string float)
}

export interface PortfolioAnalytics {
  address: string;
  totalDeposited: string;
  totalWithdrawn: string;
  netPnL: string;
  averageEntryPrice: string;
  computedAt: string;
  transactionCount: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 300;      // 5 minutes
const CACHE_NS = "analytics:v1:";   // namespace prefix in Redis

// ---------------------------------------------------------------------------
// P&L engine (FIFO)
// ---------------------------------------------------------------------------

interface FifoLot {
  units: bigint;
  costBasis: bigint; // total cost for this lot in price units (×10^6 for precision)
}

/**
 * Compute analytics from a raw event list.
 *
 * FIFO P&L algorithm:
 *   - Each deposit creates a "lot" at the deposit price (default 1.0 if unknown)
 *   - Each withdrawal consumes lots from the front of the queue; the difference
 *     between the withdrawal proceeds and the lot cost basis is realised P&L
 *   - averageEntryPrice = sum(cost basis of remaining open lots) / sum(remaining units)
 *
 * All bigint arithmetic uses 1e6 scale for price fractions.
 */
export function computeAnalytics(address: string, events: TxEvent[]): PortfolioAnalytics {
  const PRICE_SCALE = 1_000_000n; // 6 decimal places for price

  let totalDeposited = 0n;
  let totalWithdrawn = 0n;
  let realisedPnL = 0n;

  const lots: FifoLot[] = [];

  // Sort by timestamp ascending so FIFO ordering is deterministic
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (const ev of sorted) {
    const amount = BigInt(ev.amount);

    if (ev.type === "deposit") {
      totalDeposited += amount;
      // Convert price to scaled bigint (default 1.0 = 1_000_000n)
      const priceScaled = ev.pricePerUnit
        ? BigInt(Math.round(parseFloat(ev.pricePerUnit) * 1_000_000))
        : PRICE_SCALE;
      lots.push({ units: amount, costBasis: (amount * priceScaled) / PRICE_SCALE });

    } else if (ev.type === "withdrawal") {
      totalWithdrawn += amount;

      // Consume lots FIFO
      let remaining = amount;
      while (remaining > 0n && lots.length > 0) {
        const lot = lots[0];
        if (lot.units <= remaining) {
          // Consume this entire lot
          const proceeds = (remaining <= lot.units ? remaining : lot.units);
          const priceScaled = ev.pricePerUnit
            ? BigInt(Math.round(parseFloat(ev.pricePerUnit) * 1_000_000))
            : PRICE_SCALE;
          const saleValue = (proceeds * priceScaled) / PRICE_SCALE;
          realisedPnL += saleValue - lot.costBasis;
          remaining -= lot.units;
          lots.shift();
        } else {
          // Partial lot consumption
          const fraction = (remaining * PRICE_SCALE) / lot.units;
          const partialCost = (lot.costBasis * fraction) / PRICE_SCALE;
          const priceScaled = ev.pricePerUnit
            ? BigInt(Math.round(parseFloat(ev.pricePerUnit) * 1_000_000))
            : PRICE_SCALE;
          const saleValue = (remaining * priceScaled) / PRICE_SCALE;
          realisedPnL += saleValue - partialCost;
          lot.units -= remaining;
          lot.costBasis -= partialCost;
          remaining = 0n;
        }
      }
    }
    // harvest events don't change deposit/withdrawal counters or lots
  }

  // Unrealised P&L for still-held lots (current price = last deposit price or 1.0)
  // We add unrealised to realised for a total net P&L
  const unrealisedPnL = 0n; // no current price feed — callers can extend this

  const totalPnL = realisedPnL + unrealisedPnL;

  // Average entry price = sum of remaining lot cost bases / total remaining units
  const remainingUnits = lots.reduce((s, l) => s + l.units, 0n);
  const remainingCost = lots.reduce((s, l) => s + l.costBasis, 0n);
  const averageEntryPriceScaled =
    remainingUnits > 0n ? (remainingCost * PRICE_SCALE) / remainingUnits : 0n;

  // Convert scaled price back to decimal string with 6 dp
  const aepWhole = averageEntryPriceScaled / PRICE_SCALE;
  const aepFrac = averageEntryPriceScaled % PRICE_SCALE;
  const averageEntryPrice = `${aepWhole}.${aepFrac.toString().padStart(6, "0")}`;

  return {
    address,
    totalDeposited: totalDeposited.toString(),
    totalWithdrawn: totalWithdrawn.toString(),
    netPnL: totalPnL.toString(),
    averageEntryPrice,
    computedAt: new Date().toISOString(),
    transactionCount: sorted.length,
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function getCached(address: string): Promise<PortfolioAnalytics | null> {
  try {
    const raw = await getRedis().get(CACHE_NS + address);
    if (!raw) return null;
    return JSON.parse(raw) as PortfolioAnalytics;
  } catch {
    return null;
  }
}

async function setCached(analytics: PortfolioAnalytics): Promise<void> {
  try {
    await getRedis().set(
      CACHE_NS + analytics.address,
      JSON.stringify(analytics),
      "EX",
      CACHE_TTL_SECONDS
    );
  } catch {
    // best-effort cache write
  }
}

async function invalidateCache(address: string): Promise<void> {
  try {
    await getRedis().del(CACHE_NS + address);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch analytics for an address.
 *
 * On cache miss, `fetchEvents` is called to load the full event history.
 * The result is cached for CACHE_TTL_SECONDS.
 *
 * @param address  Stellar/Soroban wallet address
 * @param fetchEvents  Async loader that returns all TxEvents for the address.
 *                     Replace with a real DB query in production.
 */
export async function getPortfolioAnalytics(
  address: string,
  fetchEvents: (address: string) => Promise<TxEvent[]>
): Promise<PortfolioAnalytics> {
  const cached = await getCached(address);
  if (cached) return cached;

  const events = await fetchEvents(address);
  const analytics = computeAnalytics(address, events);
  await setCached(analytics);
  return analytics;
}

/**
 * Trigger a background recalculation for all affected addresses after a
 * harvest event is recorded.
 *
 * We invalidate the cache so the next request recomputes fresh stats.
 * For wallets with active positions, recalculation happens on the next read.
 *
 * @param addresses  List of addresses holding shares in the vault at harvest time.
 * @param fetchEvents  Same loader used by getPortfolioAnalytics.
 */
export async function triggerHarvestRecalculation(
  addresses: string[],
  fetchEvents: (address: string) => Promise<TxEvent[]>
): Promise<void> {
  // Invalidate caches first (fast) then compute in background
  await Promise.all(addresses.map((addr) => invalidateCache(addr)));

  // Fire-and-forget background recalculation — errors are logged but not thrown
  void Promise.allSettled(
    addresses.map(async (addr) => {
      const events = await fetchEvents(addr);
      const analytics = computeAnalytics(addr, events);
      await setCached(analytics);
    })
  ).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[analytics] background recalculation error:", r.reason);
      }
    }
  });
}

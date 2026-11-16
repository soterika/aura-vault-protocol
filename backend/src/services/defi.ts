import { cacheGet, cacheSet, NS } from "../cache.js";
import { logger } from "../logger.js";

const PRICE_TTL = parseInt(process.env.CACHE_DEFI_PRICE_TTL || "30", 10);
const POOL_TTL = parseInt(process.env.CACHE_DEFI_POOL_TTL || "60", 10);

export interface AssetPrice {
  asset: string;
  price: number;
  change24h: number;
  volume24h: number;
  updatedAt: string;
}

export interface PoolData {
  id: string;
  asset0: string;
  asset1: string;
  tvl: number;
  apy: number;
  volume24h: number;
  updatedAt: string;
}

// Replace these stubs with real feed integrations (Horizon, Pyth, CoinGecko)
async function fetchPrice(asset: string): Promise<AssetPrice> {
  const prices: Record<string, { price: number; change24h: number; volume24h: number }> = {
    XLM:  { price: 0.12,    change24h: 2.3,  volume24h: 45_000_000 },
    USDC: { price: 1.0,     change24h: 0.01, volume24h: 120_000_000 },
    BTC:  { price: 68_500,  change24h: -1.2, volume24h: 2_100_000_000 },
    ETH:  { price: 3_800,   change24h: 1.8,  volume24h: 890_000_000 },
  };
  const data = prices[asset.toUpperCase()];
  if (!data) throw new Error(`Unknown asset: ${asset}`);
  return { asset: asset.toUpperCase(), ...data, updatedAt: new Date().toISOString() };
}

async function fetchPools(): Promise<PoolData[]> {
  return [
    { id: "pool-xlm-usdc", asset0: "XLM",  asset1: "USDC", tvl: 5_200_000, apy: 12.4, volume24h: 380_000, updatedAt: new Date().toISOString() },
    { id: "pool-btc-xlm",  asset0: "BTC",  asset1: "XLM",  tvl: 2_100_000, apy: 8.7,  volume24h: 95_000,  updatedAt: new Date().toISOString() },
    { id: "pool-eth-usdc", asset0: "ETH",  asset1: "USDC", tvl: 8_900_000, apy: 9.2,  volume24h: 510_000, updatedAt: new Date().toISOString() },
  ];
}

export async function getAssetPrice(asset: string): Promise<AssetPrice> {
  const k = asset.toUpperCase();
  const cached = await cacheGet<AssetPrice>(NS.DEFI_PRICE, k);
  if (cached) return cached;
  const price = await fetchPrice(asset);
  await cacheSet(NS.DEFI_PRICE, k, price, PRICE_TTL);
  return price;
}

export async function getPools(): Promise<PoolData[]> {
  const cached = await cacheGet<PoolData[]>(NS.DEFI_POOLS, "all");
  if (cached) return cached;
  const pools = await fetchPools();
  await cacheSet(NS.DEFI_POOLS, "all", pools, POOL_TTL);
  return pools;
}

export async function warmCache(): Promise<void> {
  logger.info("[Cache] Warming DeFi data...");
  try {
    await Promise.all([
      getPools(),
      getAssetPrice("XLM"),
      getAssetPrice("USDC"),
      getAssetPrice("BTC"),
      getAssetPrice("ETH"),
    ]);
    logger.info("[Cache] Warm-up complete");
  } catch (err) {
    logger.error("[Cache] Warm-up failed:", err);
  }
}

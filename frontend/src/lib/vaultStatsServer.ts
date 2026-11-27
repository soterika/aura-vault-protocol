export interface PublicVaultStats {
  vaultName: string;
  tvl: string;
  totalAssets: string;
  totalShares: string;
  apy: string;
  apyPercent: number;
  sharePrice: string;
  totalDepositors: number;
  updatedAt: string;
}

const DEFAULT_VAULT_NAME = "Aura Vault";

function getApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    "http://localhost:3001"
  );
}

/**
 * Formats APY from either basis points (e.g. 850 -> 8.50%) or percentage (e.g. 8.5 -> 8.50%).
 */
function normalizeApy(rawApy: unknown): { apy: string; apyPercent: number } {
  if (typeof rawApy === "number" && Number.isFinite(rawApy)) {
    const percent = rawApy > 100 ? rawApy / 100 : rawApy;
    return { apy: `${percent.toFixed(2)}%`, apyPercent: Number(percent.toFixed(2)) };
  }
  if (typeof rawApy === "string") {
    const parsed = parseFloat(rawApy.replace("%", ""));
    if (Number.isFinite(parsed)) {
      const percent = parsed > 100 ? parsed / 100 : parsed;
      return { apy: `${percent.toFixed(2)}%`, apyPercent: Number(percent.toFixed(2)) };
    }
  }
  return { apy: "0.00%", apyPercent: 0 };
}

function computeSharePrice(totalAssets: string, totalShares: string, rawPrice?: unknown): string {
  if (typeof rawPrice === "string" && rawPrice.trim().length > 0) {
    const n = parseFloat(rawPrice);
    if (Number.isFinite(n) && n > 0) return n.toFixed(4);
  }
  if (typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0) {
    return rawPrice.toFixed(4);
  }

  try {
    const a = BigInt(totalAssets);
    const s = BigInt(totalShares);
    if (s > 0n) {
      const priceBps = (a * 10_000n) / s;
      return (Number(priceBps) / 10_000).toFixed(4);
    }
  } catch {
    const a = parseFloat(totalAssets);
    const s = parseFloat(totalShares);
    if (s > 0 && Number.isFinite(a)) {
      return (a / s).toFixed(4);
    }
  }
  return "1.0000";
}

export function normalizeVaultStats(payload: Record<string, unknown>): PublicVaultStats {
  const data = (payload.data && typeof payload.data === "object"
    ? payload.data
    : payload) as Record<string, unknown>;

  const totalAssets = String(data.totalAssets ?? data.total_assets ?? data.tvl ?? "0");
  const totalShares = String(data.totalShares ?? data.total_shares ?? "0");
  const { apy, apyPercent } = normalizeApy(data.apy7d ?? data.apy ?? 0);
  const sharePrice = computeSharePrice(
    totalAssets,
    totalShares,
    data.sharePrice ?? data.pricePerShare
  );

  return {
    vaultName: String(data.vaultName ?? data.name ?? DEFAULT_VAULT_NAME),
    tvl: String(data.tvl ?? totalAssets),
    totalAssets,
    totalShares,
    apy,
    apyPercent,
    sharePrice,
    totalDepositors: Number(data.totalDepositors ?? data.depositors ?? 0) || 0,
    updatedAt: String(data.updatedAt ?? data.timestamp ?? ""),
  };
}

export const FALLBACK_VAULT_STATS: PublicVaultStats = {
  vaultName: DEFAULT_VAULT_NAME,
  tvl: "0",
  totalAssets: "0",
  totalShares: "0",
  apy: "0.00%",
  apyPercent: 0,
  sharePrice: "1.0000",
  totalDepositors: 0,
  updatedAt: "",
};

/**
 * Fetches public vault stats with Next.js ISR (60s revalidation, matching Redis TTL).
 */
export async function fetchPublicVaultStats(): Promise<PublicVaultStats> {
  const apiBase = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/api/v1/vault/stats`, {
      next: { revalidate: 60 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return FALLBACK_VAULT_STATS;
    }
    const json = (await res.json()) as Record<string, unknown>;
    return normalizeVaultStats(json);
  } catch {
    return FALLBACK_VAULT_STATS;
  }
}

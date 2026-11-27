import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fetchPublicVaultStats,
  normalizeVaultStats,
  FALLBACK_VAULT_STATS,
} from "@/lib/vaultStatsServer";
import { generateMetadata, revalidate } from "@/app/vault/stats/page";

describe("Vault Stats ISR Page (#1259)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("configures ISR revalidation to 60 seconds (matching Redis TTL)", () => {
    expect(revalidate).toBe(60);
  });

  it("normalizes basis-point APY and computes share price deterministically", () => {
    const stats = normalizeVaultStats({
      data: {
        vaultName: "Aura USDC Vault",
        totalAssets: "1050000",
        totalShares: "1000000",
        apy7d: 850,
        totalDepositors: 42,
      },
    });

    expect(stats.vaultName).toBe("Aura USDC Vault");
    expect(stats.apy).toBe("8.50%");
    expect(stats.sharePrice).toBe("1.0500");
    expect(stats.totalDepositors).toBe(42);
  });

  it("populates og:description with vault name and current APY in generateMetadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            vaultName: "Aura USDC Vault",
            totalAssets: "2000000",
            totalShares: "1000000",
            apy7d: 1240,
            totalDepositors: 99,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const metadata = await generateMetadata();
    expect(metadata.openGraph?.description).toContain("Aura USDC Vault");
    expect(metadata.openGraph?.description).toContain("12.40%");
    expect(metadata.description).toContain("12.40%");
  });

  it("falls back gracefully when /api/v1/vault/stats is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const stats = await fetchPublicVaultStats();
    expect(stats).toEqual(FALLBACK_VAULT_STATS);
  });
});

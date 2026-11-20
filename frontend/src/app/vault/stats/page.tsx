import type { Metadata } from "next";
import { Suspense } from "react";
import { VaultStatsCard } from "@/components/VaultStatsCard";
import { fetchPublicVaultStats } from "@/lib/vaultStatsServer";

/**
 * ISR revalidation interval: 60 seconds (matches backend Redis TTL).
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const stats = await fetchPublicVaultStats();
  const title = `${stats.vaultName} Stats — ${stats.apy} APY`;
  const description = `${stats.vaultName} currently yields ${stats.apy} APY with TVL ${stats.tvl} and share price ${stats.sharePrice}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

function VaultStatsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading vault statistics"
      className="animate-pulse rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-6 h-7 w-56 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="h-24 rounded-xl bg-zinc-100 dark:bg-zinc-800"
          />
        ))}
      </div>
    </div>
  );
}

export default async function VaultStatsPage() {
  const initialStats = await fetchPublicVaultStats();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {initialStats.vaultName} Live Stats
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Pre-rendered with Next.js ISR (60s revalidation) and hydrated with real-time SSE updates.
        </p>
      </header>

      <Suspense fallback={<VaultStatsSkeleton />}>
        <VaultStatsCard initialStats={initialStats} />
      </Suspense>
    </main>
  );
}

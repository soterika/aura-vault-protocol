import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "Aura Vault",
  description: "Aura Vault Protocol dashboard",
};

// Code-split route with dynamic import to satisfy bundle budget (<200KB initial JS)
const VaultDashboard = dynamic(() => import("@/components/VaultDashboard"), {
  loading: () => (
    <div className="mx-auto max-w-4xl px-4 py-8 animate-pulse">
      <div className="h-8 w-48 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 h-28 bg-zinc-100 dark:bg-zinc-900 rounded-xl" />
    </div>
  ),
  ssr: true,
});

export default function Home() {
  return <VaultDashboard />;
}

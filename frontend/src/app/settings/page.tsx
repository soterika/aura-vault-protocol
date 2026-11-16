import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "Settings — Aura Vault Protocol",
  description: "Configure user settings, notification preferences, and themes.",
};

// Code-split Settings route with dynamic import to reduce initial JS bundle size
const SettingsContent = dynamic(() => import("@/components/SettingsContent"), {
  loading: () => (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-12 animate-pulse">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="h-8 w-40 bg-zinc-200 dark:bg-zinc-800 rounded" />
        <div className="h-32 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800" />
        <div className="h-32 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800" />
      </div>
    </div>
  ),
  ssr: true,
});

export default function SettingsPage() {
  return <SettingsContent />;
}

"use client";

/**
 * /governance — Governance Dashboard page
 *
 * Issue #1267: Auth-protected page that renders the GovernanceDashboard.
 * Visible only to authenticated (wallet-connected) users.
 *
 * Token handling:
 *   We read the JWT access token from localStorage (key: "aura_access_token")
 *   which is set by the WalletConnect / stellarAuth flow. If no token is
 *   present the dashboard shows a "connect wallet" empty state.
 */

import { useEffect, useState } from "react";
import { GovernanceDashboard } from "@/components/GovernanceDashboard";

export default function GovernancePage() {
  const [token, setToken] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Read token from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("aura_access_token");
      setToken(stored);
    } catch {
      // localStorage unavailable (e.g. private browsing in some browsers)
    }
  }, []);

  // Avoid flash of unauthenticated content before hydration
  if (!mounted) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <GovernanceDashboard token={token} />
    </main>
  );
}

"use client";

/**
 * DeepLinkHandler — Issue #262
 *
 * Thin client wrapper that:
 *  1. Reads and validates ?action / ?amount query params via useDeepLink()
 *  2. Passes them as props to VaultDashboard (which forwards to VaultActions)
 *  3. Removes the params from the canonical URL after the modal is dismissed
 *     (replaceState — no history entry added, no server round-trip)
 *
 * Must be wrapped in <Suspense> by the caller because useSearchParams()
 * opts the component into client-side rendering and suspends during SSR
 * prerendering in Next.js App Router.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDeepLink } from "@/lib/useDeepLink";
import VaultDashboard from "@/components/VaultDashboard";

export default function DeepLinkHandler() {
  const router = useRouter();
  const { action, amount } = useDeepLink();

  /**
   * Called by VaultActions once the deep-link modal has been closed.
   * Strips `action` and `amount` from the URL so the canonical URL
   * no longer exposes the pre-filled values.
   *
   * Uses router.replace() — Next.js App Router equivalent of
   * history.replaceState — so no new history entry is created.
   */
  const handleDeepLinkHandled = useCallback(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    url.searchParams.delete("amount");

    // router.replace keeps the existing scroll position and avoids a
    // server fetch since we're just dropping params from the same path.
    router.replace(url.pathname + (url.search || ""), { scroll: false });
  }, [router]);

  return (
    <VaultDashboard
      initialAction={action}
      initialAmount={amount}
      onDeepLinkHandled={handleDeepLinkHandled}
    />
  );
}

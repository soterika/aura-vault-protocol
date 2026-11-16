"use client";

/**
 * useSentryUser — sets the connected wallet address as Sentry user context.
 *
 * Call this hook once after a wallet connects (e.g. in WalletConnect.tsx or a
 * layout component). The wallet address is treated as a non-PII identifier
 * (Stellar addresses are public by design).
 *
 * Usage:
 *   useSentryUser(walletAddress);
 *
 * Pass `null` or `undefined` to clear the user context on disconnect.
 */
import { useEffect } from "react";

// Lazily import Sentry so this hook is a no-op when @sentry/nextjs is absent
// (e.g. in test environments or before the package is installed).
let sentrySetUser: ((user: { id: string } | null) => void) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");
  sentrySetUser = (user) => {
    if (user) {
      Sentry.setUser({ id: user.id });
    } else {
      Sentry.setUser(null);
    }
  };
} catch {
  // @sentry/nextjs not installed — gracefully skip
}

export function useSentryUser(walletAddress: string | null | undefined): void {
  useEffect(() => {
    if (!sentrySetUser) return;

    if (walletAddress) {
      sentrySetUser({ id: walletAddress });
    } else {
      sentrySetUser(null);
    }

    return () => {
      // Clear on unmount / disconnect
      sentrySetUser?.(null);
    };
  }, [walletAddress]);
}

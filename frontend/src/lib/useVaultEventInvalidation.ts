"use client";

/**
 * useVaultEventInvalidation — Issue #1266
 *
 * Subscribes to the backend SSE event stream (/api/v1/events/stream) and
 * invalidates the relevant React Query cache entries when vault state changes.
 *
 * This complements useContractEvents.ts (which handles UI toasts/state) by
 * ensuring React Query's cache is refreshed after any on-chain event so all
 * components that read vault data automatically re-render with fresh data.
 *
 * Usage:
 *   // Mount once, near the app root (e.g. inside a layout component)
 *   useVaultEventInvalidation({ walletAddress });
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "./useVaultQueries";

export interface UseVaultEventInvalidationOptions {
  walletAddress?: string | null;
  apiBaseUrl?: string;
}

export function useVaultEventInvalidation({
  walletAddress,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
}: UseVaultEventInvalidationOptions = {}) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    let isCancelled = false;

    function connect() {
      if (isCancelled) return;

      const es = new EventSource(`${apiBaseUrl}/api/v1/events/stream`);
      esRef.current = es;

      const invalidateVault = () => {
        void qc.invalidateQueries({ queryKey: QUERY_KEYS.vaultStats });
        if (walletAddress) {
          void qc.invalidateQueries({
            queryKey: QUERY_KEYS.vaultBalance(walletAddress),
          });
        }
      };

      const invalidateAll = () => {
        invalidateVault();
        void qc.invalidateQueries({
          queryKey: QUERY_KEYS.transactions(walletAddress ?? undefined),
        });
      };

      // Deposit / Withdraw / Harvest all update vault stats and balances
      es.addEventListener("deposit", invalidateAll);
      es.addEventListener("withdraw", invalidateAll);
      es.addEventListener("harvest", invalidateVault);
      es.addEventListener("pause", invalidateVault);
      es.addEventListener("unpause", invalidateVault);

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!isCancelled) {
          reconnectTimerRef.current = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      isCancelled = true;
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [apiBaseUrl, walletAddress, qc]);
}

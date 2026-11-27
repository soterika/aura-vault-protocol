"use client";

/**
 * useVaultEventInvalidation — Issues #1266 & #1463
 *
 * Subscribes to the backend SSE event stream (/api/v1/events/stream) and
 * invalidates the relevant React Query cache entries when vault state changes.
 *
 * Issue #1463: Coalesces burst contract events per vault within a short window
 * so repeated events for the same vault trigger a single cache refresh while
 * retaining whether transaction history invalidation is needed.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "./useVaultQueries";

export const DEFAULT_COALESCE_WINDOW_MS = 250;

export interface UseVaultEventInvalidationOptions {
  walletAddress?: string | null;
  apiBaseUrl?: string;
  coalesceWindowMs?: number;
}

export interface VaultInvalidationCoalescer {
  schedule: (vaultId: string, includeTransactions: boolean) => void;
  flush: () => void;
  cancel: () => void;
  pendingCount: () => number;
}

/**
 * Extracts a vault identifier from an SSE MessageEvent payload, falling back
 * to "default" when the payload is absent or not JSON.
 */
export function extractVaultIdFromEvent(event: Pick<MessageEvent, "data">): string {
  if (typeof event.data === "string" && event.data.trim() !== "") {
    try {
      const parsed = JSON.parse(event.data) as { vaultId?: unknown; vault?: unknown };
      if (typeof parsed.vaultId === "string" && parsed.vaultId.trim() !== "") {
        return parsed.vaultId;
      }
      if (typeof parsed.vault === "string" && parsed.vault.trim() !== "") {
        return parsed.vault;
      }
    } catch {
      // Non-JSON payload — fall through to default vault key
    }
  }
  return "default";
}

/**
 * Coalesces repeated invalidations per vault within `windowMs`.
 * If multiple events arrive for the same vault before the timer fires, only
 * one invalidation executes, and `includeTransactions` is OR-merged so
 * deposit/withdraw refreshes are never lost behind a harvest/pause event.
 */
export function createVaultInvalidationCoalescer(
  onInvalidate: (vaultId: string, includeTransactions: boolean) => void,
  windowMs: number = DEFAULT_COALESCE_WINDOW_MS
): VaultInvalidationCoalescer {
  const pending = new Map<
    string,
    { includeTransactions: boolean; timer: ReturnType<typeof setTimeout> }
  >();

  function schedule(vaultId: string, includeTransactions: boolean) {
    const key = vaultId || "default";
    const existing = pending.get(key);
    if (existing) {
      existing.includeTransactions = existing.includeTransactions || includeTransactions;
      return;
    }

    const timer = setTimeout(() => {
      const entry = pending.get(key);
      pending.delete(key);
      if (entry) {
        onInvalidate(key, entry.includeTransactions);
      }
    }, Math.max(0, windowMs));

    pending.set(key, { includeTransactions, timer });
  }

  function flush() {
    const entries = Array.from(pending.entries());
    pending.clear();
    for (const [key, entry] of entries) {
      clearTimeout(entry.timer);
      onInvalidate(key, entry.includeTransactions);
    }
  }

  function cancel() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
    }
    pending.clear();
  }

  return {
    schedule,
    flush,
    cancel,
    pendingCount: () => pending.size,
  };
}

export function useVaultEventInvalidation({
  walletAddress,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  coalesceWindowMs = DEFAULT_COALESCE_WINDOW_MS,
}: UseVaultEventInvalidationOptions = {}) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    let isCancelled = false;

    const coalescer = createVaultInvalidationCoalescer((_vaultId, includeTransactions) => {
      void qc.invalidateQueries({ queryKey: QUERY_KEYS.vaultStats });
      if (walletAddress) {
        void qc.invalidateQueries({
          queryKey: QUERY_KEYS.vaultBalance(walletAddress),
        });
      }
      if (includeTransactions) {
        void qc.invalidateQueries({
          queryKey: QUERY_KEYS.transactions(walletAddress ?? undefined),
        });
      }
    }, coalesceWindowMs);

    function connect() {
      if (isCancelled) return;

      const es = new EventSource(`${apiBaseUrl}/api/v1/events/stream`);
      esRef.current = es;

      const onVaultOnly = (event: MessageEvent) => {
        coalescer.schedule(extractVaultIdFromEvent(event), false);
      };

      const onWithTransactions = (event: MessageEvent) => {
        coalescer.schedule(extractVaultIdFromEvent(event), true);
      };

      // Deposit / Withdraw / Harvest all update vault stats and balances
      es.addEventListener("deposit", onWithTransactions as EventListener);
      es.addEventListener("withdraw", onWithTransactions as EventListener);
      es.addEventListener("harvest", onVaultOnly as EventListener);
      es.addEventListener("pause", onVaultOnly as EventListener);
      es.addEventListener("unpause", onVaultOnly as EventListener);

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
      coalescer.cancel();
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [apiBaseUrl, walletAddress, coalesceWindowMs, qc]);
}

/**
 * useContractEvents — Issue #285
 *
 * React hook that subscribes to the backend SSE event stream
 * (`/api/v1/events/stream`) and exposes the latest vault state with
 * automatic reconnection and a 30-second polling fallback.
 *
 * Usage:
 *   const { totalAssets, sharePrice, isPaused, lastEvent, connectionState } =
 *     useContractEvents({ walletAddress: '...' });
 */

"use client";

import { useEffect, useRef, useCallback, useReducer } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "polling"
  | "error";

export interface VaultEventData {
  type: "deposit" | "withdraw" | "harvest" | "pause" | "unpause" | string;
  txHash?: string;
  ledger?: number;
  data?: Record<string, unknown>;
  occurredAt?: string;
}

export interface ContractEventsState {
  /** Total underlying tokens in the vault (raw i128 as string). */
  totalAssets: string | null;
  /** Current share price in micro-units (totalAssets / totalShares × 1e6). */
  sharePrice: string | null;
  /** User balance for the connected wallet address. */
  userBalance: string | null;
  /** True when the vault is paused. */
  isPaused: boolean;
  /** Most recently received event. */
  lastEvent: VaultEventData | null;
  /** SSE connection state. */
  connectionState: ConnectionState;
  /** Toast message for harvest / pause events. */
  toastMessage: string | null;
}

type Action =
  | { type: "SET_CONNECTION"; state: ConnectionState }
  | { type: "DEPOSIT_EVENT"; data: Record<string, unknown> }
  | { type: "WITHDRAW_EVENT"; data: Record<string, unknown> }
  | { type: "HARVEST_EVENT"; data: Record<string, unknown> }
  | { type: "PAUSE_EVENT" }
  | { type: "UNPAUSE_EVENT" }
  | { type: "VAULT_STATS"; totalAssets: string; sharePrice: string; userBalance: string }
  | { type: "CLEAR_TOAST" };

const initialState: ContractEventsState = {
  totalAssets: null,
  sharePrice: null,
  userBalance: null,
  isPaused: false,
  lastEvent: null,
  connectionState: "connecting",
  toastMessage: null,
};

function reducer(state: ContractEventsState, action: Action): ContractEventsState {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connectionState: action.state };

    case "DEPOSIT_EVENT": {
      const totalAssets = (action.data.total_assets as string) ?? state.totalAssets;
      const userBalance = (action.data.user_balance as string) ?? state.userBalance;
      return {
        ...state,
        totalAssets,
        userBalance,
        lastEvent: { type: "deposit", data: action.data },
      };
    }

    case "WITHDRAW_EVENT": {
      const totalAssets = (action.data.total_assets as string) ?? state.totalAssets;
      const userBalance = (action.data.user_balance as string) ?? state.userBalance;
      return {
        ...state,
        totalAssets,
        userBalance,
        lastEvent: { type: "withdraw", data: action.data },
      };
    }

    case "HARVEST_EVENT": {
      const sharePrice = (action.data.share_price as string) ?? state.sharePrice;
      const totalAssets = (action.data.total_assets as string) ?? state.totalAssets;
      return {
        ...state,
        totalAssets,
        sharePrice,
        lastEvent: { type: "harvest", data: action.data },
        toastMessage: `Yield harvested — share price updated to ${sharePrice ?? "N/A"}`,
      };
    }

    case "PAUSE_EVENT":
      return {
        ...state,
        isPaused: true,
        lastEvent: { type: "pause" },
        toastMessage: "⚠️ Vault is paused — deposits and harvests are suspended",
      };

    case "UNPAUSE_EVENT":
      return {
        ...state,
        isPaused: false,
        lastEvent: { type: "unpause" },
        toastMessage: "✅ Vault has been unpaused",
      };

    case "VAULT_STATS":
      return {
        ...state,
        totalAssets: action.totalAssets,
        sharePrice: action.sharePrice,
        userBalance: action.userBalance,
      };

    case "CLEAR_TOAST":
      return { ...state, toastMessage: null };

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseContractEventsOptions {
  /** Stellar wallet address to track balance for. */
  walletAddress?: string;
  /** Base URL of the backend API. Defaults to the NEXT_PUBLIC_API_URL env var. */
  apiBaseUrl?: string;
  /** How long (ms) a toast stays visible before auto-dismissing. */
  toastDurationMs?: number;
  /** Polling interval (ms) when SSE is unavailable. */
  pollIntervalMs?: number;
}

export function useContractEvents({
  walletAddress,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  toastDurationMs = 5_000,
  pollIntervalMs = 30_000,
}: UseContractEventsOptions = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Polling fallback ────────────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return; // already polling

    dispatch({ type: "SET_CONNECTION", state: "polling" });

    const fetchStats = async () => {
      try {
        const url = walletAddress
          ? `${apiBaseUrl}/api/v1/vault/stats?address=${walletAddress}`
          : `${apiBaseUrl}/api/v1/vault/stats`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        dispatch({
          type: "VAULT_STATS",
          totalAssets: String(json.data?.totalAssets ?? json.totalAssets ?? ""),
          sharePrice: String(json.data?.sharePrice ?? json.sharePrice ?? ""),
          userBalance: String(json.data?.userBalance ?? json.userBalance ?? ""),
        });
      } catch {
        // silently ignore — next tick will retry
      }
    };

    void fetchStats();
    pollTimerRef.current = setInterval(() => { void fetchStats(); }, pollIntervalMs);
  }, [apiBaseUrl, walletAddress, pollIntervalMs]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // ── SSE connection ──────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const streamUrl = `${apiBaseUrl}/api/v1/events/stream`;
    dispatch({ type: "SET_CONNECTION", state: "connecting" });

    const es = new EventSource(streamUrl);
    esRef.current = es;

    es.onopen = () => {
      dispatch({ type: "SET_CONNECTION", state: "connected" });
      stopPolling();
    };

    es.onerror = () => {
      dispatch({ type: "SET_CONNECTION", state: "reconnecting" });
      es.close();
      esRef.current = null;
      // EventSource reconnects automatically, but we also start polling
      // so the UI doesn't go stale while reconnecting.
      startPolling();
    };

    // Vault-specific named events
    es.addEventListener("deposit", (e) => {
      try {
        dispatch({ type: "DEPOSIT_EVENT", data: JSON.parse(e.data) });
      } catch { /* ignore malformed */ }
    });

    es.addEventListener("withdraw", (e) => {
      try {
        dispatch({ type: "WITHDRAW_EVENT", data: JSON.parse(e.data) });
      } catch { /* ignore malformed */ }
    });

    es.addEventListener("harvest", (e) => {
      try {
        dispatch({ type: "HARVEST_EVENT", data: JSON.parse(e.data) });
      } catch { /* ignore malformed */ }
    });

    es.addEventListener("pause", () => {
      dispatch({ type: "PAUSE_EVENT" });
    });

    es.addEventListener("unpause", () => {
      dispatch({ type: "UNPAUSE_EVENT" });
    });

    // Server says Horizon stream is down → switch to polling
    es.addEventListener("polling-fallback", () => {
      es.close();
      esRef.current = null;
      startPolling();
    });

    // Server keepalive comment — no action needed
    // (EventSource handles re-subscription automatically)
  }, [apiBaseUrl, startPolling, stopPolling]);

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    // SSE requires a browser environment
    if (typeof EventSource === "undefined") {
      startPolling();
      return;
    }

    connect();

    return () => {
      esRef.current?.close();
      stopPolling();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect, startPolling, stopPolling]);

  // ── Auto-dismiss toasts ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!state.toastMessage) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(
      () => dispatch({ type: "CLEAR_TOAST" }),
      toastDurationMs
    );
  }, [state.toastMessage, toastDurationMs]);

  return {
    ...state,
    clearToast: () => dispatch({ type: "CLEAR_TOAST" }),
  };
}

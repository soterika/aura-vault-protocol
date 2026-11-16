"use client";

/**
 * useVaultPause
 *
 * Tracks the vault's paused state by:
 *  1. Polling GET /api/vault/is_paused every 60 seconds.
 *  2. Reacting immediately to `vault_paused` and `vault_unpaused` WebSocket
 *     events pushed by the backend, eliminating the polling lag for admin
 *     actions.
 *
 * Returns:
 *  - isPaused   — current pause state (undefined while the first fetch is in flight)
 *  - isLoading  — true only during the very first fetch
 *  - error      — last fetch error message, or null
 *  - refresh    — manually re-fetch the pause state
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseVaultPauseResult {
  isPaused: boolean | undefined;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/** How often (ms) to poll the pause state. */
export const POLL_INTERVAL_MS = 60_000;

/** WebSocket message types emitted by the backend for pause transitions. */
export const WS_PAUSE_EVENTS = ["vault_paused", "vault_unpaused"] as const;
type WsPauseEvent = (typeof WS_PAUSE_EVENTS)[number];

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing without React)
// ---------------------------------------------------------------------------

/**
 * Parse the raw API response body into a boolean pause state.
 *
 * Accepts any of:
 *  - `{ paused: true }`
 *  - `{ is_paused: false }`
 *  - `{ data: { paused: true } }`   (standard ApiResponse envelope)
 *  - `{ data: { is_paused: false } }`
 *
 * Returns `undefined` if the response cannot be parsed.
 */
export function parsePauseResponse(body: unknown): boolean | undefined {
  if (body === null || typeof body !== "object") return undefined;

  const obj = body as Record<string, unknown>;

  // Standard ApiResponse envelope: { success: true, data: { paused: ... } }
  if (obj.data !== null && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.paused === "boolean") return data.paused;
    if (typeof data.is_paused === "boolean") return data.is_paused;
  }

  // Flat response: { paused: ... } or { is_paused: ... }
  if (typeof obj.paused === "boolean") return obj.paused;
  if (typeof obj.is_paused === "boolean") return obj.is_paused;

  return undefined;
}

/**
 * Derive the next pause state from a WebSocket message type.
 *
 * Returns `true` for `vault_paused`, `false` for `vault_unpaused`, and
 * `undefined` for unrelated message types (caller should ignore the update).
 */
export function pauseStateFromWsEvent(type: string): boolean | undefined {
  if (type === "vault_paused") return true;
  if (type === "vault_unpaused") return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVaultPause(): UseVaultPauseResult {
  const [isPaused, setIsPaused] = useState<boolean | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable ref to avoid stale closures in the interval / WS callbacks.
  const isPausedRef = useRef<boolean | undefined>(undefined);
  isPausedRef.current = isPaused;

  // ── Polling ──────────────────────────────────────────────────────────────
  const fetchPauseState = useCallback(async () => {
    try {
      const apiBase =
        typeof process !== "undefined"
          ? process.env.NEXT_PUBLIC_API_URL ?? ""
          : "";
      const res = await fetch(`${apiBase}/api/vault/is_paused`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body: unknown = await res.json();
      const paused = parsePauseResponse(body);

      if (paused !== undefined) {
        setIsPaused(paused);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pause state");
      // Do not clear isPaused on polling error — keep showing the last known state.
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch + 60-second polling interval.
  useEffect(() => {
    void fetchPauseState();
    const timer = setInterval(() => void fetchPauseState(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchPauseState]);

  // ── WebSocket event-driven updates ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ??
      `ws://${window.location.host}/api/ws/vault`;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            type: string;
            [key: string]: unknown;
          };

          const nextState = pauseStateFromWsEvent(msg.type);
          if (nextState !== undefined && nextState !== isPausedRef.current) {
            setIsPaused(nextState);
            setError(null);
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      ws.onclose = () => {
        // Reconnect after 5 s, matching the pattern used elsewhere in the app.
        reconnectTimer = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  return {
    isPaused,
    isLoading,
    error,
    refresh: useCallback(() => void fetchPauseState(), [fetchPauseState]),
  };
}

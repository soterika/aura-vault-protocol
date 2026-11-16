/**
 * PauseBanner — Issue #285
 *
 * Displays a prominent warning banner when the vault pause event is received
 * via the SSE contract event stream.  Hides automatically on unpause.
 */

"use client";

import React from "react";

interface PauseBannerProps {
  isPaused: boolean;
}

export function PauseBanner({ isPaused }: PauseBannerProps) {
  if (!isPaused) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full bg-amber-500 px-4 py-3 text-center text-sm font-semibold text-amber-950"
    >
      ⚠️ Vault operations are currently paused. Withdrawals remain available.
      Deposits and harvests are suspended until the admin resumes the vault.
    </div>
  );
}

interface EventToastProps {
  message: string | null;
  onDismiss: () => void;
}

/**
 * EventToast — transient notification for harvest / pause / unpause events.
 */
export function EventToast({ message, onDismiss }: EventToastProps) {
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
    >
      <span className="flex-1">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-2 shrink-0 text-zinc-400 hover:text-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-900"
      >
        ✕
      </button>
    </div>
  );
}

interface ConnectionIndicatorProps {
  state: "connecting" | "connected" | "reconnecting" | "polling" | "error";
}

/**
 * ConnectionIndicator — small badge showing the real-time connection state.
 */
export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  const label: Record<ConnectionIndicatorProps["state"], string> = {
    connecting: "Connecting…",
    connected: "Live",
    reconnecting: "Reconnecting…",
    polling: "Polling (30s)",
    error: "Connection error",
  };

  const color: Record<ConnectionIndicatorProps["state"], string> = {
    connecting: "bg-yellow-400",
    connected: "bg-green-500",
    reconnecting: "bg-orange-400",
    polling: "bg-blue-400",
    error: "bg-red-500",
  };

  return (
    <span
      title={`Data feed: ${label[state]}`}
      className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <span
        className={`h-2 w-2 rounded-full ${color[state]} ${
          state === "connected" ? "animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      {label[state]}
    </span>
  );
}

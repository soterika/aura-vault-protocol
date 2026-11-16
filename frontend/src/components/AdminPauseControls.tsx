"use client";

/**
 * AdminPauseControls
 *
 * Renders a Pause / Unpause button visible only to the vault admin.
 *
 * Admin gating:
 *  The connected wallet address is compared against the
 *  `NEXT_PUBLIC_ADMIN_ADDRESS` env var (set at build time). If they don't
 *  match, the component renders nothing, so it is safe to include
 *  unconditionally in any layout.
 *
 * API contract (backend):
 *  POST /api/vault/pause   — halts all vault mutations
 *  POST /api/vault/unpause — resumes vault operations
 *  Both endpoints must be authenticated; the component forwards the stored
 *  access token from localStorage (key: "accessToken").
 *
 * Props:
 *  - isPaused         current pause state (drives button label / colour)
 *  - connectedAddress the currently connected wallet address (from WalletConnect)
 *  - onToggle         optional callback after a successful toggle
 */

import { useCallback, useState } from "react";

export interface AdminPauseControlsProps {
  /** Current vault pause state. `undefined` = loading; controls disabled. */
  isPaused: boolean | undefined;
  /**
   * The wallet address currently connected in the browser.
   * Pass `null` / `undefined` when no wallet is connected.
   */
  connectedAddress: string | null | undefined;
  /** Called after a successful pause or unpause API response. */
  onToggle?: (newPausedState: boolean) => void;
}

// Pure helper — exported so it can be unit-tested without React.
export function isAdminAddress(
  connected: string | null | undefined,
  adminEnv: string | null | undefined
): boolean {
  if (!connected || !adminEnv) return false;
  return connected.trim().toLowerCase() === adminEnv.trim().toLowerCase();
}

export default function AdminPauseControls({
  isPaused,
  connectedAddress,
  onToggle,
}: AdminPauseControlsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const adminAddress = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;

  // Only render for the admin.
  if (!isAdminAddress(connectedAddress, adminAddress)) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleToggle = useCallback(async () => {
    if (isPaused === undefined || pending) return;

    const action = isPaused ? "unpause" : "pause";
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
    const endpoint = `${apiBase}/api/vault/${action}`;

    // Retrieve the access token stored by the auth flow (JWT login).
    const token =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("accessToken")
        : null;

    setPending(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json() as { error?: { message?: string } };
          if (body?.error?.message) msg = body.error.message;
        } catch {
          // Use the status message fallback.
        }
        throw new Error(msg);
      }

      const newState = !isPaused;
      setSuccessMsg(newState ? "Vault paused." : "Vault unpaused.");
      setTimeout(() => setSuccessMsg(null), 4_000);
      onToggle?.(newState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }, [isPaused, pending, onToggle]);

  const isUnpausing = isPaused === true;
  const label = isUnpausing ? "Unpause Vault" : "Pause Vault";

  const buttonColour = isUnpausing
    ? // Unpause — green / positive action
      "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
    : // Pause — amber / warning action
      "bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-400";

  return (
    <section
      aria-label="Admin vault controls"
      data-testid="admin-pause-controls"
      className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Admin Controls
      </h2>

      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={isPaused === undefined || pending}
        aria-busy={pending}
        aria-label={label}
        className={[
          "w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          buttonColour,
        ].join(" ")}
      >
        {pending ? (
          <span className="flex items-center justify-center gap-2">
            {/* Inline spinner */}
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            {isUnpausing ? "Unpausing…" : "Pausing…"}
          </span>
        ) : (
          label
        )}
      </button>

      {/* Status messages */}
      {error && (
        <p
          role="alert"
          className="mt-2 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      {successMsg && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        >
          {successMsg}
        </p>
      )}

      <p className="mt-3 text-xs text-zinc-400">
        Only visible to the configured admin address.
      </p>
    </section>
  );
}

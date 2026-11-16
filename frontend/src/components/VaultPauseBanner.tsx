"use client";

/**
 * VaultPauseBanner
 *
 * Displays a prominent red banner when the vault is paused.
 * Renders nothing when the vault is not paused or the pause state is still
 * loading, so it is safe to place at the top of any page or section without
 * layout shift during initial load.
 *
 * Accessibility:
 *  - `role="alert"` so screen readers announce it immediately on mount.
 *  - `aria-live="assertive"` for subsequent updates (e.g. unpausing).
 *  - Meets WCAG AA contrast: white text on red-700 background.
 */

import type { FC } from "react";

export interface VaultPauseBannerProps {
  /** Current vault pause state. `undefined` = still loading, banner hidden. */
  isPaused: boolean | undefined;
  /** Optional extra className for the outer element. */
  className?: string;
}

const VaultPauseBanner: FC<VaultPauseBannerProps> = ({
  isPaused,
  className = "",
}) => {
  // Hide during initial load and when the vault is running normally.
  if (!isPaused) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="vault-pause-banner"
      className={[
        // Layout
        "flex items-center gap-3 w-full px-4 py-3 rounded-lg",
        // Colour — red-700 background with white text (WCAG AA)
        "bg-red-700 text-white",
        // Typography
        "text-sm font-semibold",
        // Smooth entrance / exit via CSS transition on the parent's conditional
        // render; no JS animation needed.
        className,
      ]
        .join(" ")
        .trim()}
    >
      {/* Warning icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-5 w-5 shrink-0"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>

      <span>
        Vault is currently paused — deposits and withdrawals disabled
      </span>
    </div>
  );
};

export default VaultPauseBanner;

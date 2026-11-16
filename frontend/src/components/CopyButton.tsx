"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  /** The full string to copy to clipboard */
  text: string;
  /** Accessible label prefix, e.g. "Copy address" or "Copy transaction hash" */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * One-click copy-to-clipboard button.
 *
 * - Uses navigator.clipboard.writeText with a textarea fallback for older browsers.
 * - Shows a checkmark for 2 seconds after a successful copy.
 * - Displays a "Copied!" tooltip on success.
 * - Fully accessible: aria-label dynamically reflects state.
 */
export default function CopyButton({
  text,
  label = "Copy",
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (copied) return; // debounce while showing checkmark

    try {
      if (navigator.clipboard?.writeText) {
        // Modern API
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / non-HTTPS contexts
        fallbackCopy(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail – user can still copy manually
    }
  }, [text, copied]);

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied!" : label}
        title={copied ? "Copied!" : label}
        className={[
          "inline-flex items-center justify-center rounded p-1 text-zinc-400 transition-colors",
          "hover:bg-zinc-100 hover:text-zinc-700",
          "dark:hover:bg-zinc-700 dark:hover:text-zinc-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
          copied ? "text-emerald-500 dark:text-emerald-400" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        data-cy="copy-btn"
        data-copied={copied}
      >
        {copied ? (
          <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
        )}
      </button>

      {/* "Copied!" tooltip — appears above the button */}
      {copied && (
        <span
          role="status"
          aria-live="polite"
          className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-white dark:bg-zinc-200 dark:text-zinc-900 pointer-events-none"
          data-cy="copy-tooltip"
        >
          Copied!
        </span>
      )}
    </div>
  );
}

/**
 * Fallback copy using a temporary textarea element.
 * Works on older browsers and HTTP pages where navigator.clipboard is unavailable.
 */
function fallbackCopy(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.setAttribute("aria-hidden", "true");
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

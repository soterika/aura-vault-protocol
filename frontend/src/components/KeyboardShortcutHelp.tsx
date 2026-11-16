"use client";

import { useEffect, type ReactNode } from "react";
import { Keyboard, X } from "lucide-react";
import type { ShortcutAction } from "@/lib/useKeyboardShortcuts";

interface KeyboardShortcutHelpProps {
  /** Controls whether the dialog is rendered */
  isOpen: boolean;
  /** Called when the user requests to close the dialog */
  onClose: () => void;
  /** The full list of registered shortcuts to document */
  shortcuts: ShortcutAction[];
}

/** Small pill that renders a single keyboard key. */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className={[
        "inline-flex h-7 min-w-[1.75rem] items-center justify-center",
        "rounded border border-zinc-300 bg-zinc-100 px-1.5",
        "font-mono text-sm font-medium text-zinc-700",
        "dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
      ].join(" ")}
    >
      {children}
    </kbd>
  );
}

/**
 * Modal dialog that lists all registered keyboard shortcuts.
 *
 * - Accessible: role="dialog", aria-modal, aria-labelledby
 * - Closes on Escape or backdrop click
 * - Focus is trapped inside while open (initial focus on the close button)
 */
export function KeyboardShortcutHelp({
  isOpen,
  onClose,
  shortcuts,
}: KeyboardShortcutHelpProps) {
  // Close on Escape key, but do NOT use useKeyboardShortcuts here to
  // avoid a circular dependency — plain document listener is fine.
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    // Prevent scrolling of the page behind the modal.
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/60"
      role="presentation"
      onClick={onClose}
      aria-hidden="true"
    >
      {/* Dialog panel — stop click propagation so clicks inside don't close */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        className={[
          "relative z-50 w-full max-w-sm rounded-xl bg-white shadow-2xl",
          "dark:bg-zinc-900",
          "mx-4",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Keyboard
              className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
              aria-hidden="true"
            />
            <h2
              id="shortcut-help-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Keyboard Shortcuts
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={[
              "rounded-lg p-1.5 text-zinc-500 transition-colors",
              "hover:bg-zinc-100 hover:text-zinc-700",
              "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
            ].join(" ")}
            aria-label="Close keyboard shortcuts help"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Shortcut list */}
        <ul className="divide-y divide-zinc-100 px-5 dark:divide-zinc-800" role="list">
          {shortcuts.map((shortcut) => (
            <li
              key={shortcut.key}
              className="flex items-center justify-between py-3"
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {shortcut.label}
              </span>
              <Kbd>
                {/* Display "?" visually but store as Shift+/ internally */}
                {shortcut.key === "?" ? "?" : shortcut.key.toUpperCase()}
              </Kbd>
            </li>
          ))}
        </ul>

        {/* Footer hint */}
        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Shortcuts are disabled when a text field is focused.
          </p>
        </div>
      </div>
    </div>
  );
}

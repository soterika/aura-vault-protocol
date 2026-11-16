"use client";

import { useEffect, useCallback } from "react";

export interface ShortcutAction {
  /** Single character key (case-insensitive) or special key like "/" */
  key: string;
  /** Human-readable description shown in the help dialog */
  label: string;
  /** Callback to invoke when the shortcut fires */
  handler: () => void;
}

export interface UseKeyboardShortcutsOptions {
  /** When true, all shortcuts are suppressed */
  disabled?: boolean;
}

/**
 * Returns true when the keyboard event originates from an interactive
 * element where the user is likely typing (input, textarea, select,
 * contenteditable).  Shortcuts are skipped in those contexts.
 */
function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;

  return false;
}

/**
 * Registers a set of keyboard shortcuts at the document level.
 *
 * Shortcuts are automatically disabled when the user's focus is inside
 * an input, textarea, select, or contenteditable element so that normal
 * typing is never intercepted.
 *
 * @param shortcuts - Array of shortcut definitions.
 * @param options   - Optional configuration.
 *
 * @example
 * useKeyboardShortcuts([
 *   { key: "d", label: "Open Deposit",  handler: openDeposit  },
 *   { key: "w", label: "Open Withdraw", handler: openWithdraw },
 *   { key: "h", label: "Harvest",       handler: triggerHarvest },
 *   { key: "/", label: "Focus Search",  handler: focusSearch  },
 *   { key: "?", label: "Show Help",     handler: openHelp     },
 * ]);
 */
export function useKeyboardShortcuts(
  shortcuts: ShortcutAction[],
  options: UseKeyboardShortcutsOptions = {},
): void {
  const { disabled = false } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (disabled) return;

      // Skip if the user is typing in a form field.
      if (isTypingTarget(event)) return;

      // Skip modified key combinations (Ctrl/Cmd/Alt) to avoid
      // conflicting with browser and OS shortcuts.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const pressedKey = event.key;

      for (const shortcut of shortcuts) {
        const matches =
          pressedKey === shortcut.key ||
          pressedKey.toLowerCase() === shortcut.key.toLowerCase();

        if (matches) {
          // Prevent the browser's default behaviour (e.g. "/" opening
          // Quick Find in Firefox) before calling the handler.
          event.preventDefault();
          shortcut.handler();
          // Stop after the first matching shortcut.
          return;
        }
      }
    },
    [shortcuts, disabled],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}

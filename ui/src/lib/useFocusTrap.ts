/**
 * useFocusTrap — Issue #1004
 *
 * React hook that traps keyboard focus inside a container element while active.
 * Satisfies WCAG 2.1 criteria 2.1.1 and 2.1.2 for modal dialogs.
 *
 * Behaviour:
 * - Tab cycles forward through focusable descendants
 * - Shift+Tab cycles backward
 * - Focus never escapes the container while `active` is true
 * - Restores focus to the previously focused element on deactivation
 * - Focuses the first focusable element (or the container itself) on activation
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useFocusTrap(containerRef, isOpen);
 */

import { useEffect, useRef } from "react";

/** Selectors for all natively focusable elements */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "details > summary",
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest("[hidden]") && getComputedStyle(el).display !== "none"
  );
}

/**
 * Trap focus within `containerRef` when `active` is true.
 *
 * @param containerRef - ref to the element that should receive the focus trap
 * @param active       - when true the trap is engaged; when false it is released
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean
): void {
  // Track the element that had focus before the trap was activated
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    // Save the currently focused element so we can restore it on close
    previouslyFocused.current = document.activeElement as HTMLElement;

    // Move focus into the trap — prefer the first focusable child, else the container
    const focusables = getFocusableElements(container);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      container.focus();
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Tab") return;

      const focusables = getFocusableElements(container!);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab: if on first, wrap to last
        if (active === first || !container!.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last, wrap to first
        if (active === last || !container!.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the element that was focused before the trap
      previouslyFocused.current?.focus();
    };
  }, [active, containerRef]);
}

export default useFocusTrap;

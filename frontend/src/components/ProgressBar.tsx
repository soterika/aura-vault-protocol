"use client";

/**
 * ProgressBar
 *
 * Thin top-of-viewport progress bar that fires on:
 *  1. Next.js App Router page transitions (via pathname / searchParams changes)
 *  2. Manual API calls via the exported `startProgress` / `doneProgress` helpers
 *
 * Acceptance criteria (issue #266):
 *  ✓ Uses nprogress
 *  ✓ Starts on route change, completes on page load
 *  ✓ Manually triggerable for long API calls (>500 ms)
 *  ✓ Colour matches brand primary (indigo-600 / #4f46e5)
 *  ✓ z-index above the sticky header (9999)
 *  ✓ Respects prefers-reduced-motion (bar shown, animation suppressed via CSS)
 */

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";

// ── NProgress global configuration ──────────────────────────────────────────
NProgress.configure({
  showSpinner: false,   // bar only, no spinner knob
  minimum: 0.08,
  easing: "ease",
  speed: 200,
  trickleSpeed: 200,
});

// ── Public helpers for manual triggering from API utilities ─────────────────

/**
 * Start the progress bar. Call before a fetch that may take >500 ms.
 * Multiple concurrent callers are safe — NProgress deduplicates starts.
 */
export function startProgress(): void {
  NProgress.start();
}

/**
 * Complete the progress bar. Call when the fetch resolves or rejects.
 */
export function doneProgress(): void {
  NProgress.done();
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * NavigationProgressBar — must be rendered inside a <Suspense> boundary
 * because it uses `useSearchParams` which requires Suspense in App Router.
 */
export default function ProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Track the "previous" location so we can detect actual navigation.
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    const currentUrl = pathname + searchParams.toString();

    if (prevUrl.current === null) {
      // First render — record starting location, no bar needed.
      prevUrl.current = currentUrl;
      return;
    }

    if (prevUrl.current !== currentUrl) {
      // Location changed → complete any running bar (navigation finished).
      NProgress.done();
      prevUrl.current = currentUrl;
    }
  }, [pathname, searchParams]);

  // Intercept anchor clicks and Next.js router pushes to start the bar.
  useEffect(() => {
    // Patch history.pushState / replaceState so programmatic navigation
    // (router.push, router.replace, <Link>) all trigger the bar.
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);

    function patchedPush(
      ...args: Parameters<typeof history.pushState>
    ): void {
      NProgress.start();
      originalPush(...args);
    }

    function patchedReplace(
      ...args: Parameters<typeof history.replaceState>
    ): void {
      NProgress.start();
      originalReplace(...args);
    }

    history.pushState = patchedPush;
    history.replaceState = patchedReplace;

    // Also handle browser back/forward (popstate)
    const handlePopState = () => NProgress.start();
    window.addEventListener("popstate", handlePopState);

    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener("popstate", handlePopState);
      // Ensure bar is cleared on unmount
      NProgress.done();
    };
  }, []); // run once on mount

  return null; // NProgress manages its own DOM node (#nprogress)
}

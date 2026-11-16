"use client";

import React from "react";

/**
 * PrintPortfolioButton
 *
 * A lightweight button that triggers the browser's native print dialog,
 * scoped to render a clean portfolio snapshot via the @media print styles
 * defined in print.css.
 *
 * The button stamps the current ISO-8601 date on the portfolio root element
 * so the CSS `content: attr(data-print-date)` rule can display it in the
 * printed footer without JavaScript having to inject DOM nodes.
 *
 * The button itself is hidden in print via `data-print-trigger` and the
 * corresponding rule in print.css.
 */
export function PrintPortfolioButton() {
  const handlePrint = () => {
    // Stamp the generation date on the portfolio root so the CSS footer can
    // read it via attr(data-print-date) without extra DOM manipulation.
    const root = document.querySelector<HTMLElement>('[data-print="portfolio-root"]');
    if (root) {
      root.dataset.printDate = new Date().toLocaleString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
    }
    window.print();
  };

  return (
    <button
      type="button"
      data-print-trigger
      onClick={handlePrint}
      aria-label="Print portfolio summary"
      className={[
        // Layout
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5",
        // Typography
        "text-xs font-medium",
        // Light theme
        "border border-zinc-200 bg-white text-zinc-700",
        // Dark theme
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
        // Hover / focus
        "hover:bg-zinc-50 dark:hover:bg-zinc-800",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500",
        // Transition
        "transition-colors duration-150",
      ].join(" ")}
    >
      {/* Printer icon — inline SVG to avoid an icon-library dependency */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      Print Portfolio
    </button>
  );
}

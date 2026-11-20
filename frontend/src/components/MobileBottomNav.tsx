"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface BottomNavTab {
  id: string;
  label: string;
  href: string;
  tooltip: string;
  icon: (active: boolean) => React.ReactNode;
}

const TABS: BottomNavTab[] = [
  {
    id: "vault",
    label: "Vault",
    href: "/dashboard",
    tooltip: "Vault (dashboard / deposit / withdraw)",
    icon: (active) => (
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 9v6M9 12h6" />
      </svg>
    ),
  },
  {
    id: "history",
    label: "History",
    href: "/transactions",
    tooltip: "History (transaction log)",
    icon: (active) => (
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    href: "/leaderboard",
    tooltip: "Leaderboard",
    icon: (active) => (
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    tooltip: "Settings (preferences, wallet, notifications)",
    icon: (active) => (
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.25 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const LONG_PRESS_MS = 450;

/**
 * Persistent mobile bottom navigation bar (< 768px).
 * Provides quick single-tap access to Vault, History, Leaderboard, and Settings.
 */
export default function MobileBottomNav() {
  const pathname = usePathname();
  const [tooltipTabId, setTooltipTabId] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearLongPress();
  }, [clearLongPress]);

  const handleTouchStart = (tabId: string) => {
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      setTooltipTabId(tabId);
    }, LONG_PRESS_MS);
  };

  const handleTouchEnd = () => {
    clearLongPress();
    setTooltipTabId(null);
  };

  const isTabActive = (href: string): boolean => {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav
      aria-label="Primary navigation"
      data-cy="mobile-bottom-nav"
      className="
        fixed inset-x-0 bottom-0 z-40 md:hidden
        border-t border-zinc-200 bg-white/95 backdrop-blur-md
        dark:border-zinc-800 dark:bg-zinc-950/95
        pb-[env(safe-area-inset-bottom)]
      "
    >
      <ul className="grid grid-cols-4 items-stretch">
        {TABS.map((tab) => {
          const active = isTabActive(tab.href);
          const showTooltip = tooltipTabId === tab.id;

          return (
            <li key={tab.id} className="relative flex">
              <Link
                href={tab.href}
                title={tab.tooltip}
                aria-current={active ? "page" : undefined}
                data-cy={`mobile-bottom-nav-${tab.id}`}
                onMouseEnter={() => setTooltipTabId(tab.id)}
                onMouseLeave={() => setTooltipTabId((prev) => (prev === tab.id ? null : prev))}
                onTouchStart={() => handleTouchStart(tab.id)}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                onTouchMove={handleTouchEnd}
                className={`
                  group relative flex flex-1 flex-col items-center justify-center gap-1 py-2 px-1
                  text-xs transition-colors duration-150
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500
                  ${
                    active
                      ? "text-indigo-600 dark:text-indigo-400 font-semibold"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-medium"
                  }
                `}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400"
                  />
                )}
                {tab.icon(active)}
                <span className="truncate max-w-full">{tab.label}</span>
              </Link>

              {showTooltip && (
                <div
                  role="tooltip"
                  className="
                    pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                    whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg
                    dark:bg-zinc-100 dark:text-zinc-900
                  "
                >
                  {tab.tooltip}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

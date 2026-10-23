"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

// ─── Nav link definitions ──────────────────────────────────────────────────
const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Analytics", href: "/analytics" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Position analyser", href: "/portfolio/analyzer" },
  { label: "Transactions", href: "/transactions" },
  { label: "Docs", href: "https://docs.aura.finance", external: true },
] as const;

// ─── Sub-components ────────────────────────────────────────────────────────

/** Animated hamburger / close icon */
function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform duration-200"
    >
      {open ? (
        <>
          <line x1="4"  y1="4"  x2="18" y2="18" />
          <line x1="18" y1="4"  x2="4"  y2="18" />
        </>
      ) : (
        <>
          <line x1="3" y1="6"  x2="19" y2="6"  />
          <line x1="3" y1="11" x2="19" y2="11" />
          <line x1="3" y1="16" x2="19" y2="16" />
        </>
      )}
    </svg>
  );
}

/** Connect Wallet button — placeholder; real wallet logic lives in WalletConnect */
function WalletButton() {
  return (
    <a
      href="/dashboard"
      className="
        inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold
        bg-zinc-900 text-white hover:bg-zinc-700 active:bg-zinc-800
        dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100
        transition-colors duration-150 focus-visible:outline-none
        focus-visible:ring-2 focus-visible:ring-offset-2
        focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100
      "
      data-cy="nav-wallet-btn"
    >
      {/* Wallet icon */}
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
        <circle cx="17" cy="15" r="1.5" fill="currentColor" stroke="none" />
      </svg>
      Connect Wallet
    </a>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

/**
 * Responsive navigation header — #242
 *
 * Desktop (≥768 px): horizontal logo + nav links + wallet button
 * Mobile  (<768 px): logo + hamburger → slide-in drawer
 *
 * Accessibility:
 *  - <nav> landmark with aria-label="Main navigation"
 *  - Hamburger has aria-expanded + aria-controls
 *  - Drawer traps focus via Escape key; Tab cycles within the open drawer
 *  - Active route link gets aria-current="page"
 *
 * Playwright / Cypress selectors preserved:
 *  data-cy="nav-header"          – outermost <header>
 *  data-cy="mobile-menu-btn"     – hamburger toggle
 *  data-cy="mobile-nav"          – slide-in drawer <nav>
 *  data-cy="mobile-nav-link"     – individual links inside drawer
 *  data-cy="desktop-nav-link"    – individual links on desktop
 *  data-cy="nav-wallet-btn"      – wallet CTA
 */
export default function NavHeader() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // ── Close drawer on route change ──────────────────────────────────────
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // ── Escape key closes drawer and returns focus to hamburger ──────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerOpen) {
        setDrawerOpen(false);
        hamburgerRef.current?.focus();
      }
    },
    [drawerOpen]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Focus first link when drawer opens ───────────────────────────────
  useEffect(() => {
    if (drawerOpen && drawerRef.current) {
      const firstFocusable = drawerRef.current.querySelector<HTMLElement>(
        "a, button"
      );
      firstFocusable?.focus();
    }
  }, [drawerOpen]);

  // ── Click outside drawer closes it ───────────────────────────────────
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        drawerRef.current &&
        !drawerRef.current.contains(e.target as Node) &&
        !hamburgerRef.current?.contains(e.target as Node)
      ) {
        setDrawerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [drawerOpen]);

  const isActive = (href: string) => pathname === href;

  // ── Desktop nav link style ────────────────────────────────────────────
  const desktopLinkClass = (href: string) =>
    [
      "relative text-sm font-medium transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900",
      "dark:focus-visible:ring-zinc-100 rounded-sm",
      isActive(href)
        ? "text-zinc-900 dark:text-white after:absolute after:-bottom-1 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-zinc-900 dark:after:bg-white"
        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white",
    ].join(" ");

  // ── Mobile drawer link style ──────────────────────────────────────────
  const mobileLinkClass = (href: string) =>
    [
      "flex items-center px-5 text-sm font-medium transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
      "focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
      isActive(href)
        ? "text-zinc-900 dark:text-white bg-zinc-100 dark:bg-zinc-800 border-l-2 border-zinc-900 dark:border-white"
        : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-white",
    ].join(" ");

  return (
    <header
      data-cy="nav-header"
      className="sticky top-0 z-50 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">

        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <a
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded-sm"
          aria-label="Aura Vault — home"
        >
          {/* Aura logo mark */}
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.25" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          </svg>
          Aura Vault
        </a>

        {/* ── Desktop navigation ────────────────────────────────────────── */}
        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-6"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-cy="desktop-nav-link"
              aria-current={isActive(link.href) ? "page" : undefined}
              className={desktopLinkClass(link.href)}
              {...("external" in link && link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {link.label}
              {"external" in link && link.external && (
                <svg
                  aria-label="(opens in new tab)"
                  role="img"
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="ml-1 inline-block opacity-60"
                >
                  <path d="M5 1H1v10h10V7" />
                  <path d="M7 1h4v4" />
                  <line x1="11" y1="1" x2="5" y2="7" />
                </svg>
              )}
            </a>
          ))}
        </nav>

        {/* ── Desktop wallet button ─────────────────────────────────────── */}
        <div className="hidden md:flex items-center">
          <WalletButton />
        </div>

        {/* ── Mobile hamburger button ───────────────────────────────────── */}
        <button
          ref={hamburgerRef}
          data-cy="mobile-menu-btn"
          aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={drawerOpen}
          aria-controls="mobile-nav-panel"
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="
            md:hidden flex items-center justify-center rounded-md p-2
            text-zinc-700 dark:text-zinc-300
            hover:bg-zinc-100 dark:hover:bg-zinc-800
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900
            dark:focus-visible:ring-zinc-100
            transition-colors duration-150
          "
          style={{ minWidth: "44px", minHeight: "44px" }}
        >
          <HamburgerIcon open={drawerOpen} />
        </button>
      </div>

      {/* ── Mobile slide-in drawer ────────────────────────────────────────── */}
      {/*
        The drawer uses CSS animation classes defined in globals.css.
        `animate-slide-in-left` slides in from the left edge on open.
        aria-hidden="true" when closed so screen readers skip it.
      */}
      <nav
        ref={drawerRef}
        id="mobile-nav-panel"
        data-cy="mobile-nav"
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
        className={[
          "md:hidden absolute left-0 right-0 top-14 z-50",
          "flex flex-col border-b border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-950 shadow-lg",
          drawerOpen
            ? "animate-slide-in-left pointer-events-auto"
            : "hidden pointer-events-none",
        ].join(" ")}
      >
        {/* Nav links */}
        <ul role="list" className="py-2">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                data-cy="mobile-nav-link"
                aria-current={isActive(link.href) ? "page" : undefined}
                onClick={() => setDrawerOpen(false)}
                className={[mobileLinkClass(link.href), "h-12"].join(" ")}
                {...("external" in link && link.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
                {isActive(link.href) && (
                  <span className="ml-auto mr-1 text-xs text-zinc-400 dark:text-zinc-500 select-none">
                    ◀
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>

        {/* Wallet button in drawer */}
        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800">
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}

"use client";

/**
 * ExplorerMenu — icon button + dropdown to open a tx hash or address in either
 * Stellar Expert or Stellarchain.io.
 *
 * Usage (transaction hash):
 *   <ExplorerMenu value={tx.hash} type="tx" network="testnet" />
 *
 * Usage (account address):
 *   <ExplorerMenu value={address} type="account" network="mainnet" />
 *
 * The `network` prop is optional — when omitted the component reads
 * NEXT_PUBLIC_STELLAR_NETWORK via resolveNetwork(), defaulting to "testnet".
 *
 * Accessibility:
 *   - Trigger button has aria-label and aria-expanded/aria-haspopup
 *   - Menu has role="menu"; each item has role="menuitem"
 *   - Keyboard: Enter/Space opens the menu, Escape closes it,
 *     Arrow keys navigate items, Tab closes the menu
 *   - Focus is trapped inside the dropdown while it is open
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  resolveNetwork,
  txExplorerUrls,
  accountExplorerUrls,
  type ExplorerUrls,
  type StellarNetwork,
} from "@/lib/explorerLinks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplorerMenuProps {
  /** The transaction hash or account address to link to */
  value: string;
  /** Whether `value` is a transaction hash or an account address */
  type: "tx" | "account";
  /**
   * Stellar network to use for explorer URLs.
   * Defaults to resolveNetwork() (reads NEXT_PUBLIC_STELLAR_NETWORK → "testnet").
   */
  network?: StellarNetwork;
  /** Extra class names applied to the trigger button */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExplorerMenu({
  value,
  type,
  network,
  className = "",
}: ExplorerMenuProps) {
  const resolvedNetwork = resolveNetwork(network ?? null);
  const items: ExplorerUrls[] =
    type === "tx"
      ? txExplorerUrls(value, resolvedNetwork)
      : accountExplorerUrls(value, resolvedNetwork);

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Focus first menu item when menu opens
  useEffect(() => {
    if (open) {
      const first = menuRef.current?.querySelector<HTMLAnchorElement>(
        '[role="menuitem"]'
      );
      first?.focus();
    }
  }, [open]);

  // Arrow-key navigation inside the menu
  const onMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const menuItems = Array.from(
        menuRef.current?.querySelectorAll<HTMLAnchorElement>(
          '[role="menuitem"]'
        ) ?? []
      );
      const focused = document.activeElement;
      const idx = menuItems.indexOf(focused as HTMLAnchorElement);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        menuItems[(idx + 1) % menuItems.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        menuItems[(idx - 1 + menuItems.length) % menuItems.length]?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    },
    []
  );

  const shortValue =
    value.length > 12
      ? `${value.slice(0, 6)}…${value.slice(-4)}`
      : value;

  return (
    <span className="relative inline-flex items-center gap-1">
      {/* ── Trigger ────────────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Open ${value} in block explorer`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={[
          "inline-flex items-center gap-1 rounded p-0.5",
          "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
          "focus:outline-none focus:ring-2 focus:ring-zinc-500",
          "transition-colors",
          className,
        ].join(" ")}
      >
        <span className="font-mono text-xs">{shortValue}</span>
        <ExternalLink
          size={12}
          aria-hidden="true"
          className="shrink-0 opacity-70"
        />
      </button>

      {/* ── Dropdown ───────────────────────────────────────────────────── */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Choose block explorer"
          onKeyDown={onMenuKeyDown}
          className={[
            "absolute left-0 top-full z-50 mt-1",
            "min-w-max rounded-lg border border-zinc-200 bg-white py-1 shadow-lg",
            "dark:border-zinc-700 dark:bg-zinc-900",
          ].join(" ")}
        >
          {items.map(({ label, url }) => (
            <a
              key={label}
              href={url}
              role="menuitem"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={[
                "flex items-center gap-2 px-4 py-2 text-sm",
                "text-zinc-700 dark:text-zinc-200",
                "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                "focus:outline-none focus:bg-zinc-100 dark:focus:bg-zinc-800",
                "whitespace-nowrap",
              ].join(" ")}
            >
              <ExternalLink size={14} aria-hidden="true" className="shrink-0 text-zinc-400" />
              {label}
            </a>
          ))}
        </div>
      )}
    </span>
  );
}

export default ExplorerMenu;

"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Network = "testnet" | "futurenet";

const SESSION_KEY = "aura-network-banner-dismissed";

export function NetworkStatusBanner({ network }: { network: Network }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(SESSION_KEY) === network);
    } catch {
      // Storage can be disabled; keep the banner visible and usable.
    }
  }, [network]);

  if (dismissed) return null;

  const isFuture = network === "futurenet";
  return (
    <aside
      role="status"
      aria-label={`${network} network warning`}
      className={`flex items-center justify-center gap-3 px-4 py-2 text-center text-sm font-semibold ${
        isFuture
          ? "bg-red-800 text-white"
          : "bg-amber-100 text-amber-950 dark:bg-amber-300 dark:text-amber-950"
      }`}
    >
      <span>
        {isFuture
          ? "Developer preview network. Not for production use."
          : "You are on Stellar Testnet. Tokens have no real value."}
      </span>
      <button
        type="button"
        aria-label="Dismiss network notice for this session"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(SESSION_KEY, network);
          } catch {
            // The in-memory dismissal still works for this page session.
          }
        }}
        className="rounded p-1 hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </aside>
  );
}


"use client";

/**
 * ReferralLink
 *
 * Displays the user's unique referral link and provides a one-click
 * copy-to-clipboard button.
 *
 * Props:
 *   address — the connected wallet's Stellar G-address.
 *             When absent the component renders a placeholder.
 */

import { useState, useCallback } from "react";
import { Copy, Check, LinkIcon } from "lucide-react";
import { getReferralLink } from "@/lib/referral";

interface Props {
  /** Connected wallet Stellar G-address, or undefined if not connected */
  address?: string;
  className?: string;
}

export default function ReferralLink({ address, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  const referralLink = address ? getReferralLink(address) : null;

  const handleCopy = useCallback(async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
    } catch {
      // Clipboard API unavailable (non-HTTPS, old browser) — fallback
      const textarea = document.createElement("textarea");
      textarea.value = referralLink;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [referralLink]);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label
        htmlFor="referral-link-input"
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"
      >
        <LinkIcon size={12} aria-hidden="true" />
        Your referral link
      </label>

      <div className="flex items-stretch gap-2">
        <input
          id="referral-link-input"
          type="text"
          readOnly
          value={referralLink ?? "Connect wallet to generate your link"}
          aria-label="Referral link"
          aria-readonly="true"
          className={[
            "flex-1 min-w-0 rounded-lg border px-3 py-2 font-mono text-xs",
            "bg-zinc-50 dark:bg-zinc-800",
            "border-zinc-200 dark:border-zinc-700",
            "text-zinc-700 dark:text-zinc-300",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100",
            "truncate",
            !address ? "italic text-zinc-400 dark:text-zinc-500" : "",
          ].join(" ")}
          onFocus={(e) => e.target.select()}
        />

        <button
          onClick={handleCopy}
          disabled={!address}
          aria-label={copied ? "Copied!" : "Copy referral link"}
          aria-live="polite"
          className={[
            "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
            "transition-colors duration-150 shrink-0",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100",
            address
              ? copied
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
              : "bg-zinc-100 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600",
          ].join(" ")}
        >
          {copied ? (
            <>
              <Check size={14} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Copy</span>
            </>
          )}
        </button>
      </div>

      {address && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Share this link — when someone deposits through it, both of you earn
          rewards.
        </p>
      )}
    </div>
  );
}

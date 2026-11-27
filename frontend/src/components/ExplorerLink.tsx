"use client";

import React from "react";
import {
  resolveNetwork,
  stellarExpertUrl,
  type StellarExplorerType,
  type StellarNetwork,
} from "@/lib/explorerLinks";

export interface ExplorerLinkProps {
  /** Entity type in Stellar Expert */
  type: StellarExplorerType;
  /** Transaction hash, contract ID, account address, or ledger number */
  id: string | number;
  /** Optional network override; defaults to NEXT_PUBLIC_STELLAR_NETWORK */
  network?: StellarNetwork;
  /** Optional custom link content; defaults to truncated or full id */
  children?: React.ReactNode;
  /** Optional CSS class names */
  className?: string;
  /** Optional accessible label */
  ariaLabel?: string;
  /** Truncate long identifiers (e.g. hashes/addresses) when no children are provided */
  truncate?: boolean;
}

function formatIdentifier(id: string | number, truncate: boolean): string {
  const str = String(id);
  if (!truncate || str.length <= 16) {
    return str;
  }
  return `${str.slice(0, 8)}…${str.slice(-6)}`;
}

/**
 * Reusable network-aware Stellar Expert block explorer link.
 * Always opens in a new tab with `rel="noopener noreferrer"`.
 */
export function ExplorerLink({
  type,
  id,
  network,
  children,
  className = "text-blue-700 underline hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200",
  ariaLabel,
  truncate = true,
}: ExplorerLinkProps) {
  const resolvedNetwork = resolveNetwork(network);
  const href = stellarExpertUrl(type, id, resolvedNetwork);
  const label = ariaLabel ?? `View ${type} ${id} on Stellar Expert`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={label}
    >
      {children ?? formatIdentifier(id, truncate)}
    </a>
  );
}

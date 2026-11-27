"use client";

import { Wallet as WalletIcon } from "lucide-react";

export interface WalletLogoProps {
  walletId?: string | null;
  size?: number;
  className?: string;
}

export function WalletLogo({ walletId, size = 16, className = "" }: WalletLogoProps) {
  if (walletId === "freighter") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Freighter logo"
        data-testid="wallet-logo-freighter"
        className={className}
      >
        <rect width="24" height="24" rx="6" fill="#3E1BDB" />
        <path d="M7 8h10v2.5H10v2h5.5V15H10v3H7V8z" fill="#FFFFFF" />
      </svg>
    );
  }

  if (walletId === "metamask") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-label="MetaMask logo"
        data-testid="wallet-logo-metamask"
        className={className}
      >
        <rect width="24" height="24" rx="6" fill="#F6851B" />
        <path d="M18.5 5.5L13.2 9.4l1-2.3 4.3-1.6zM5.5 5.5l5.2 3.9-1-2.3-4.2-1.6z" fill="#E2761B" stroke="#FFFFFF" strokeWidth="0.6" />
        <path d="M16.5 15.2l-1.4 2.2 3 .8.9-3h-2.5zM5 15.2l.9 3 3-.8-1.4-2.2H5z" fill="#FFFFFF" />
      </svg>
    );
  }

  if (walletId === "coinbase") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Coinbase Wallet logo"
        data-testid="wallet-logo-coinbase"
        className={className}
      >
        <rect width="24" height="24" rx="6" fill="#0052FF" />
        <circle cx="12" cy="12" r="6" fill="#FFFFFF" />
        <rect x="10" y="10" width="4" height="4" rx="0.8" fill="#0052FF" />
      </svg>
    );
  }

  return <WalletIcon size={size} aria-hidden="true" className={className} />;
}

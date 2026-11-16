"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";

export function truncateWalletAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function WalletAliasDisplay({ address, className = "" }: { address: string; className?: string }) {
  const [label, setLabel] = useState(() => truncateWalletAddress(address));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLabel(truncateWalletAddress(address));
    const handleAliasUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ address: string; alias: string | null }>).detail;
      if (detail?.address === address && detail.alias) setLabel(detail.alias);
      else if (detail?.address === address) setLabel(truncateWalletAddress(address));
    };
    window.addEventListener("wallet-alias-updated", handleAliasUpdate);
    async function resolve() {
      let nickname: string | undefined;
      const token = localStorage.getItem("aura_access_token");
      if (token) {
        try {
          const response = await fetch(`${apiBase}/api/users/preferences`, { headers: { Authorization: `Bearer ${token}` } });
          if (response.ok) {
            const payload = await response.json();
            const preferences = payload.preferences ?? payload.data?.preferences ?? {};
            nickname = preferences.addressAliases?.[address];
          }
        } catch { /* Federation or truncated address remains available offline. */ }
      }
      if (!nickname) {
        try {
          const response = await fetch(`${apiBase}/api/federation/resolve?address=${encodeURIComponent(address)}`);
          if (response.ok) nickname = (await response.json()).alias ?? undefined;
        } catch { /* Fall back to the truncated public key. */ }
      }
      if (active && nickname) setLabel(nickname);
    }
    void resolve();
    return () => { active = false; window.removeEventListener("wallet-alias-updated", handleAliasUpdate); };
  }, [address]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* Clipboard permission can be unavailable; the full key remains in the tooltip. */ }
  }

  return (
    <button type="button" className={`cursor-pointer ${className}`} title={address} aria-label={`${copied ? "Copied" : "Copy"} full wallet address ${address}`} onClick={() => void copyAddress()}>
      {label}
    </button>
  );
}

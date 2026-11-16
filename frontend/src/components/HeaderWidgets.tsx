"use client";

import { useState, useEffect } from "react";
import { SharePriceTicker } from "@/components/SharePriceTicker";
import { WalletBalanceDisplay } from "@/components/WalletBalanceDisplay";

const WALLET_STORAGE_KEY = "aura_wallet_state";

interface StoredWallet {
  address: string | null;
  connected?: boolean;
  type?: string;
}

function loadWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWallet;
    const isConnected = parsed.connected ?? (parsed.type != null);
    return isConnected ? (parsed.address ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * HeaderWidgets — client component that renders the share price ticker
 * and (when a wallet is connected) the underlying token balance.
 */
export function HeaderWidgets() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    setWalletAddress(loadWalletAddress());
    function onStorage(e: StorageEvent) {
      if (e.key === WALLET_STORAGE_KEY) {
        setWalletAddress(loadWalletAddress());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleOpenPortfolio() {
    const el = document.querySelector("[data-cy='portfolio-section'], [data-testid='portfolio-section']");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="flex items-center gap-4 flex-1 justify-center px-4">
      <SharePriceTicker />
      <WalletBalanceDisplay
        address={walletAddress}
        onOpenPortfolio={handleOpenPortfolio}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Live Stellar base fee and XLM/USD estimate shared by confirmation dialogs. */
export default function StellarBaseFee() {
  const [fee, setFee] = useState({ xlm: "0.0000100", usd: null as number | null });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [feeResult, priceResult] = await Promise.allSettled([
        fetch(`${API}/api/v1/stellar/fee-stats`, { cache: "no-store" }),
        fetch(`${API}/api/v1/gas/usd-price?asset=XLM`, { cache: "no-store" }),
      ]);
      let xlm = "0.0000100";
      let usd: number | null = null;
      if (feeResult.status === "fulfilled" && feeResult.value.ok) {
        try {
          const body = await feeResult.value.json();
          const value = Number(body.data?.fee?.base?.stroops ?? body.fee?.base?.stroops ?? body.data?.lastLedgerBaseFee ?? body.lastLedgerBaseFee ?? 100);
          if (Number.isFinite(value) && value >= 0) xlm = (value / 10_000_000).toFixed(7);
        } catch { /* keep the canonical 100-stroop estimate */ }
      }
      if (priceResult.status === "fulfilled" && priceResult.value.ok) {
        try {
          const body = await priceResult.value.json();
          const value = Number(body.data?.priceUSD);
          if (Number.isFinite(value) && value > 0) usd = Number(xlm) * value;
        } catch { /* show the unavailable fallback below */ }
      }
      if (!cancelled) setFee({ xlm, usd });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">Fee: {fee.xlm} XLM ({fee.usd === null ? "USD price unavailable" : `~$${fee.usd.toFixed(6)}`})</p>;
}

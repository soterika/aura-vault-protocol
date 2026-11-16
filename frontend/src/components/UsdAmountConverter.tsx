"use client";

import { useEffect, useRef, useState } from "react";

type PriceResponse = { success?: boolean; data?: { priceUSD?: number; fetchedAt?: string } };

interface Props {
  tokenAmount: string;
  shareAmount: string;
  tokenSymbol?: string;
}

function formatAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

export function UsdAmountConverter({ tokenAmount, shareAmount, tokenSymbol = "USDC" }: Props) {
  const [price, setPrice] = useState<number | null>(null);
  const [priceAt, setPriceAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    const media = window.matchMedia("(min-width: 640px)");
    const updateOpen = () => { if (details) details.open = media.matches; };
    updateOpen();
    media.addEventListener("change", updateOpen);
    return () => media.removeEventListener("change", updateOpen);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/v1/gas/usd-price?asset=${encodeURIComponent(tokenSymbol)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Price unavailable");
        const body = await response.json() as PriceResponse;
        const value = Number(body.data?.priceUSD);
        const timestamp = body.data?.fetchedAt ? Date.parse(body.data.fetchedAt) : Date.now();
        if (active && body.success && Number.isFinite(value) && value > 0) {
          setPrice(value);
          setPriceAt(Number.isFinite(timestamp) ? timestamp : Date.now());
          setNow(Date.now());
        }
      } catch {
        // Keep the most recent successful quote visible during transient outages.
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
      setNow(Date.now());
    }, 30_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [tokenSymbol]);

  const tokenValue = Number(tokenAmount);
  const sharesValue = Number(shareAmount);
  const usd = price !== null && Number.isFinite(tokenValue) && tokenValue > 0 ? tokenValue * price : null;

  return (
    <details ref={detailsRef} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
      <summary className="cursor-pointer select-none font-medium">USD estimate <span className="font-normal text-zinc-500">(reference only)</span></summary>
      <div className="mt-3 grid gap-1 text-zinc-600 dark:text-zinc-300" aria-live="polite">
        <p>{usd !== null ? `≈ $${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : "USD quote unavailable"}</p>
        <p>{Number.isFinite(tokenValue) && tokenValue > 0 ? `${tokenValue.toLocaleString()} ${tokenSymbol}` : "Enter an amount to see the token estimate"} → {Number.isFinite(sharesValue) && sharesValue > 0 ? `${sharesValue.toLocaleString()} shares` : "shares shown when available"}</p>
        <p className="text-xs text-zinc-500">{priceAt !== null ? `Price as of ${formatAge(priceAt, now)}` : "Waiting for a price quote"}. Estimates are for reference only.</p>
      </div>
    </details>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const APP_STORE_URL = "https://apps.apple.com/app/aura-vault/id0000000000";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.auravault.app";
const APP_FALLBACK_TIMEOUT_MS = 1500;

function isValidPositiveAmount(raw: string | null): boolean {
  if (!raw || raw.trim() === "") return false;
  const num = Number(raw.trim());
  return Number.isFinite(num) && num > 0;
}

export default function DepositDeepLinkFallbackPage() {
  const searchParams = useSearchParams();
  const rawAmount = searchParams.get("amount");
  const rawToken = searchParams.get("token");

  const validAmount = isValidPositiveAmount(rawAmount) ? rawAmount!.trim() : null;
  const token = (rawToken || "USDC").trim().toUpperCase();

  const deepLinkUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (validAmount) params.set("amount", validAmount);
    if (token) params.set("token", token);
    const qs = params.toString();
    return qs ? `aura://deposit?${qs}` : "aura://deposit";
  }, [validAmount, token]);

  const [storeUrl, setStoreUrl] = useState<string>(APP_STORE_URL);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const targetStore = isAndroid ? PLAY_STORE_URL : APP_STORE_URL;
    setStoreUrl(targetStore);

    if (!isAndroid && !isIOS) {
      return;
    }

    // Attempt to open the native app via custom scheme
    window.location.href = deepLinkUrl;

    // If the app is not installed, redirect to the platform's app store
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.location.href = targetStore;
      }
    }, APP_FALLBACK_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [deepLinkUrl]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white p-6">
      <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <h1 className="text-xl font-bold">Open in Aura Vault</h1>
        <p className="text-sm text-zinc-400">
          {validAmount
            ? `Deposit ${validAmount} ${token} into Aura Vault.`
            : `Deposit ${token} into Aura Vault.`}
        </p>

        <div className="flex flex-col gap-3 pt-2">
          <a
            href={deepLinkUrl}
            data-testid="open-app-link"
            className="w-full text-center rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 px-4 font-semibold text-white"
          >
            Open Aura Vault App
          </a>
          <a
            href={storeUrl}
            data-testid="app-store-fallback-link"
            className="w-full text-center rounded-xl bg-zinc-800 hover:bg-zinc-700 py-3 px-4 font-medium text-zinc-200"
          >
            Download App
          </a>
        </div>
      </div>
    </main>
  );
}

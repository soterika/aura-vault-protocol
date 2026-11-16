"use client";

import { useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const LAST_SHOWN_KEY = "aura-pwa-install-last-shown";
const DAY_MS = 24 * 60 * 60 * 1000;

function wasShownToday(): boolean {
  try {
    const shownAt = Number(window.localStorage.getItem(LAST_SHOWN_KEY));
    return Number.isFinite(shownAt) && shownAt > 0 && Date.now() - shownAt < DAY_MS;
  } catch {
    return false;
  }
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if (!isMobile || isStandalone || wasShownToday()) return;

    function onBeforeInstall(event: Event) {
      event.preventDefault();
      const installPrompt = event as BeforeInstallPromptEvent;
      setInstallEvent(installPrompt);
      if (!shownRef.current && !wasShownToday()) {
        shownRef.current = true;
        setVisible(true);
        try {
          window.localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
        } catch {
          // Keep the prompt usable when storage is disabled.
        }
      }
    }

    function onInstalled() {
      setVisible(false);
      setInstallEvent(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible || !installEvent) return null;

  async function install() {
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setVisible(false);
    if (choice.outcome === "accepted") setInstallEvent(null);
  }

  return (
    <aside
      aria-label="Install Aura Vault"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <img src="/logo.svg" alt="" width="40" height="40" className="shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Install Aura Vault</p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Add the vault to your home screen for quick access.</p>
      </div>
      <button type="button" onClick={() => void install()} className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        Install
      </button>
      <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss install prompt" className="shrink-0 rounded p-2 text-zinc-500 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:hover:bg-zinc-800">
        <span aria-hidden="true">×</span>
      </button>
    </aside>
  );
}

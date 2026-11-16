/**
 * ServiceWorkerRegistration — Issue #284 (PWA)
 *
 * Client-side component that registers the service worker and handles the
 * browser's beforeinstallprompt event to show a custom install button.
 *
 * Rendered once inside the root layout so it fires on every page.
 */

"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function ServiceWorkerRegistration() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Register the service worker
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          console.debug("[PWA] Service worker registered", registration.scope);
        })
        .catch((err) => {
          console.error("[PWA] Service worker registration failed", err);
        });
    }

    // Capture the install prompt so we can show our own button
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Detect when the app was successfully installed
    window.addEventListener("appinstalled", () => {
      setInstalled(true);
      setInstallPrompt(null);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
    }
    setInstallPrompt(null);
  };

  // Don't render anything if there's no prompt or the app is already installed
  if (!installPrompt || installed) return null;

  return (
    <div
      role="complementary"
      aria-label="Install app"
      className="fixed bottom-4 left-4 z-40 flex max-w-xs items-start gap-3 rounded-xl border border-indigo-500/30 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-xl dark:bg-zinc-800"
    >
      <div className="flex-1">
        <p className="font-semibold">Install Aura Vault</p>
        <p className="mt-0.5 text-xs text-zinc-400">
          Add to your home screen for offline access.
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button
          onClick={handleInstall}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold hover:bg-indigo-500"
        >
          Install
        </button>
        <button
          onClick={() => setInstallPrompt(null)}
          aria-label="Dismiss install prompt"
          className="rounded-md px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

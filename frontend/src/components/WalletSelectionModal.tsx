"use client";

import React, { useState } from "react";
import { X, ExternalLink, CheckCircle2, AlertCircle, Info, ChevronRight } from "lucide-react";

export type SupportedWalletId = "freighter" | "lobstr" | "xbull";

export interface WalletInfo {
  id: SupportedWalletId;
  name: string;
  description: string;
  installUrl: string;
  installInstructions: string;
  isInstalled: boolean;
}

export interface WalletSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallets: WalletInfo[];
  onSelectWallet: (walletId: SupportedWalletId) => Promise<void>;
  isConnecting: boolean;
  connectingWalletId: SupportedWalletId | null;
  errorMessage: string | null;
  kitFallbackActive?: boolean;
}

export function WalletSelectionModal({
  isOpen,
  onClose,
  wallets,
  onSelectWallet,
  isConnecting,
  connectingWalletId,
  errorMessage,
  kitFallbackActive = false,
}: WalletSelectionModalProps) {
  const [selectedUninstalled, setSelectedUninstalled] = useState<WalletInfo | null>(null);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
        role="document"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 id="wallet-modal-title" className="text-lg font-semibold tracking-tight">
              Connect a Wallet
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Select a supported Stellar wallet to connect to Aura Vault
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Graceful fallback banner if kit is in fallback mode */}
        {kitFallbackActive && (
          <div
            role="status"
            className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <Info size={15} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium">Direct Extension Fallback</p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                Stellar Wallets Kit is running in direct extension fallback mode. Installed browser extensions can connect directly.
              </p>
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
          >
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium">Connection Error</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Wallet list */}
        <div className="mt-4 flex flex-col gap-2.5" data-testid="wallet-list">
          {wallets.map((w) => {
            const isTargetConnecting = isConnecting && connectingWalletId === w.id;
            return (
              <div key={w.id} className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <button
                  type="button"
                  data-testid={`wallet-option-${w.id}`}
                  disabled={isConnecting}
                  onClick={() => {
                    if (w.isInstalled) {
                      setSelectedUninstalled(null);
                      onSelectWallet(w.id);
                    } else {
                      setSelectedUninstalled(selectedUninstalled?.id === w.id ? null : w);
                    }
                  }}
                  className={`flex items-center justify-between p-3.5 text-left transition-all ${
                    w.isInstalled
                      ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer"
                      : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                  } ${isTargetConnecting ? "opacity-75" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                      {w.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {w.name}
                        </span>
                        {w.isInstalled ? (
                          <span
                            data-testid={`badge-${w.id}-available`}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          >
                            <CheckCircle2 size={10} />
                            Available
                          </span>
                        ) : (
                          <span
                            data-testid={`badge-${w.id}-uninstalled`}
                            className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            Not Installed
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{w.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-zinc-400">
                    {isTargetConnecting ? (
                      <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Connecting…</span>
                    ) : w.isInstalled ? (
                      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Connect</span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-xs text-zinc-500">
                        Install <ChevronRight size={14} />
                      </span>
                    )}
                  </div>
                </button>

                {/* Per-wallet connection instructions for uninstalled wallets */}
                {selectedUninstalled?.id === w.id && !w.isInstalled && (
                  <div
                    data-testid={`instructions-${w.id}`}
                    className="border-t border-zinc-100 bg-zinc-50 p-3.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300 space-y-2.5 animate-in slide-in-from-top-1"
                  >
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      How to connect with {w.name}:
                    </p>
                    <p className="leading-relaxed">{w.installInstructions}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={w.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
                      >
                        Install {w.name}
                        <ExternalLink size={12} />
                      </a>
                      <button
                        type="button"
                        onClick={() => onSelectWallet(w.id)}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                      >
                        Try Connecting Anyway
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="mt-5 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Supported: Freighter, Lobstr, xBull</span>
          <span>Stellar Wallets Kit</span>
        </div>
      </div>
    </div>
  );
}

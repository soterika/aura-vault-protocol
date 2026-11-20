"use client";

import { X, AlertCircle } from "lucide-react";
import type { WalletAdapter, WalletAdapterId } from "@/lib/wallets";
import { WalletLogo } from "./WalletLogo";

export interface ChooseWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  installedWallets: WalletAdapter[];
  onSelectWallet: (id: WalletAdapterId) => Promise<void>;
  isConnecting?: boolean;
  errorMessage?: string | null;
}

export function ChooseWalletModal({
  isOpen,
  onClose,
  installedWallets,
  onSelectWallet,
  isConnecting = false,
  errorMessage = null,
}: ChooseWalletModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="choose-wallet-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4 dark:border-zinc-800">
          <div>
            <h2 id="choose-wallet-title" className="text-lg font-semibold tracking-tight">
              Choose Wallet
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Select an installed wallet to connect
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            <AlertCircle size={15} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {installedWallets.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No supported wallets detected. Install Freighter, MetaMask, or Coinbase Wallet to continue.
            </p>
          ) : (
            installedWallets.map((adapter) => (
              <button
                key={adapter.id}
                type="button"
                disabled={isConnecting}
                onClick={() => void onSelectWallet(adapter.id)}
                data-testid={`choose-wallet-${adapter.id}`}
                className="flex w-full items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 text-left transition-colors hover:border-indigo-500 hover:bg-indigo-50/40 disabled:opacity-50 dark:border-zinc-800 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/30"
              >
                <div className="flex items-center gap-3">
                  <WalletLogo walletId={adapter.id} size={24} />
                  <span className="text-sm font-medium">{adapter.name}</span>
                </div>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Installed
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

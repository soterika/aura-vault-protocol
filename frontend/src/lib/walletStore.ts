"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface WalletState {
  address: string | null;
  network: string | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
}

interface WalletActions {
  setConnected: (address: string, network: string) => void;
  setDisconnected: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useWalletStore = create<WalletState & WalletActions>()(
  persist(
    (set) => ({
      address: null,
      network: null,
      connected: false,
      loading: false,
      error: null,

      setConnected: (address, network) =>
        set({ address, network, connected: true, loading: false, error: null }),

      setDisconnected: () =>
        set({ address: null, network: null, connected: false, loading: false, error: null }),

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error, loading: false }),
    }),
    {
      name: "aura_wallet",
      storage: createJSONStorage(() => localStorage),
      // Only persist address/network/connected — not ephemeral UI state
      partialize: (state) => ({
        address: state.address,
        network: state.network,
        connected: state.connected,
      }),
    }
  )
);

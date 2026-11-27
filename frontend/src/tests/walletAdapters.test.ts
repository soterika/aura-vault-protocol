import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FreighterAdapter,
  MetaMaskAdapter,
  CoinbaseAdapter,
  getInstalledWallets,
  getWalletAdapter,
} from "../lib/wallets";

describe("WalletAdapter implementations (Issue #1258)", () => {
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = {};
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it("getInstalledWallets returns only installed adapters", () => {
    expect(getInstalledWallets()).toEqual([]);

    (globalThis as any).window.freighterApi = { requestAccess: vi.fn() };
    (globalThis as any).window.ethereum = { isMetaMask: true, request: vi.fn() };

    const installedIds = getInstalledWallets().map((a) => a.id);
    expect(installedIds).toEqual(["freighter", "metamask"]);
    expect(installedIds).not.toContain("coinbase");
  });

  it("getWalletAdapter returns the matching adapter instance", () => {
    expect(getWalletAdapter("freighter")).toBeInstanceOf(FreighterAdapter);
    expect(getWalletAdapter("metamask")).toBeInstanceOf(MetaMaskAdapter);
    expect(getWalletAdapter("coinbase")).toBeInstanceOf(CoinbaseAdapter);
  });

  describe("FreighterAdapter", () => {
    it("connects, gets address, signs transaction, and disconnects", async () => {
      const adapter = new FreighterAdapter();
      expect(adapter.isInstalled()).toBe(false);

      (globalThis as any).window.freighterApi = {
        requestAccess: vi.fn().mockResolvedValue({ address: "GFREIGHTER123" }),
        getAddress: vi.fn().mockResolvedValue({ address: "GFREIGHTER123" }),
        getNetwork: vi.fn().mockResolvedValue({ network: "TESTNET" }),
        signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "SIGNED_XDR" }),
      };

      expect(adapter.isInstalled()).toBe(true);
      await expect(adapter.connect()).resolves.toEqual({
        address: "GFREIGHTER123",
        network: "TESTNET",
      });
      await expect(adapter.getAddress()).resolves.toBe("GFREIGHTER123");
      await expect(adapter.signTransaction("RAW_XDR")).resolves.toBe("SIGNED_XDR");
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("MetaMaskAdapter", () => {
    it("connects via EIP-1193 + Stellar Snap bridge, gets address, signs, and disconnects", async () => {
      const adapter = new MetaMaskAdapter();
      expect(adapter.isInstalled()).toBe(false);

      const request = vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return ["0xMetaMask123"];
        if (method === "eth_accounts") return ["0xMetaMask123"];
        if (method === "wallet_invokeSnap") return "GMETAMASKSTELLAR123";
        if (method === "personal_sign") return "0xSIGNED";
        return null;
      });

      (globalThis as any).window.ethereum = { isMetaMask: true, request };

      expect(adapter.isInstalled()).toBe(true);
      await expect(adapter.connect()).resolves.toEqual({
        address: "GMETAMASKSTELLAR123",
        network: "TESTNET",
      });
      await expect(adapter.getAddress()).resolves.toBe("0xMetaMask123");
      await expect(adapter.signTransaction("RAW_XDR")).resolves.toBe("GMETAMASKSTELLAR123");
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("CoinbaseAdapter", () => {
    it("connects, gets address, signs transaction, and disconnects", async () => {
      const adapter = new CoinbaseAdapter();
      expect(adapter.isInstalled()).toBe(false);

      const disconnect = vi.fn().mockResolvedValue(undefined);
      const request = vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return ["0xCoinbase123"];
        if (method === "eth_accounts") return ["0xCoinbase123"];
        if (method === "personal_sign") return "0xCBSIGNED";
        return null;
      });

      (globalThis as any).window.coinbaseWalletExtension = {
        isCoinbaseWallet: true,
        request,
        disconnect,
      };

      expect(adapter.isInstalled()).toBe(true);
      await expect(adapter.connect()).resolves.toEqual({
        address: "0xCoinbase123",
        network: "TESTNET",
      });
      await expect(adapter.getAddress()).resolves.toBe("0xCoinbase123");
      await expect(adapter.signTransaction("RAW_XDR")).resolves.toBe("0xCBSIGNED");
      await adapter.disconnect();
      expect(disconnect).toHaveBeenCalledOnce();
    });
  });
});

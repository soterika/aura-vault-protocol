import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectInstalledWallets,
  truncate,
  connectViaStellarWalletsKit,
  SUPPORTED_WALLETS_METADATA,
} from "../components/WalletConnect";

describe("WalletConnect and Stellar Wallets Kit support (Issue #272)", () => {
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = {};
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it("includes all required supported wallets: Freighter, Lobstr, xBull", () => {
    expect(SUPPORTED_WALLETS_METADATA).toHaveProperty("freighter");
    expect(SUPPORTED_WALLETS_METADATA).toHaveProperty("lobstr");
    expect(SUPPORTED_WALLETS_METADATA).toHaveProperty("xbull");

    expect(SUPPORTED_WALLETS_METADATA.freighter.name).toBe("Freighter");
    expect(SUPPORTED_WALLETS_METADATA.lobstr.name).toBe("Lobstr");
    expect(SUPPORTED_WALLETS_METADATA.xbull.name).toBe("xBull");
  });

  it("provides install instructions and URLs for uninstalled wallets", () => {
    const wallets = ["freighter", "lobstr", "xbull"] as const;
    for (const w of wallets) {
      const meta = SUPPORTED_WALLETS_METADATA[w];
      expect(meta.installUrl).toMatch(/^https:\/\//);
      expect(meta.installInstructions).toContain(meta.name);
    }
  });

  it("correctly detects installed wallets in window environment", () => {
    // When no wallet is installed
    expect(detectInstalledWallets()).toEqual({
      freighter: false,
      lobstr: false,
      xbull: false,
    });

    // When Freighter is installed
    (globalThis as any).window.freighterApi = { getPublicKey: vi.fn() };
    expect(detectInstalledWallets().freighter).toBe(true);
    expect(detectInstalledWallets().lobstr).toBe(false);

    // When Lobstr is installed
    (globalThis as any).window.lobstr = { getPublicKey: vi.fn() };
    expect(detectInstalledWallets().lobstr).toBe(true);

    // When xBull is installed
    (globalThis as any).window.xBullSDK = { getPublicKey: vi.fn() };
    expect(detectInstalledWallets().xbull).toBe(true);
  });

  it("truncates address properly for display", () => {
    expect(truncate("GABCA123456789XYZW")).toBe("GABCA1...XYZW");
    expect(truncate("short")).toBe("short");
    expect(truncate("")).toBe("");
  });

  it("falls back gracefully when kit is unavailable or throws", async () => {
    (globalThis as any).window.freighterApi = {
      getPublicKey: vi.fn().mockResolvedValue("GCEXAMPLEFREIGHTERADDRESS1234567890"),
    };

    const result = await connectViaStellarWalletsKit("freighter");
    expect(result.address).toBe("GCEXAMPLEFREIGHTERADDRESS1234567890");
    expect(result.network).toBe("TESTNET");
  });

  it("connects to Lobstr via fallback when kit throws or is in fallback mode", async () => {
    (globalThis as any).window.lobstr = {
      getPublicKey: vi.fn().mockResolvedValue("GCLOBSTRADDRESS1234567890"),
    };

    const result = await connectViaStellarWalletsKit("lobstr");
    expect(result.address).toBe("GCLOBSTRADDRESS1234567890");
    expect(result.network).toBe("TESTNET");
  });

  it("connects to xBull via fallback when kit throws or is in fallback mode", async () => {
    (globalThis as any).window.xBullSDK = {
      getPublicKey: vi.fn().mockResolvedValue("GCXBULLADDRESS1234567890"),
    };

    const result = await connectViaStellarWalletsKit("xbull");
    expect(result.address).toBe("GCXBULLADDRESS1234567890");
    expect(result.network).toBe("TESTNET");
  });

  it("throws clear installation error when uninstalled wallet is requested without extension", async () => {
    await expect(connectViaStellarWalletsKit("lobstr")).rejects.toThrow(
      /Lobstr is not installed/
    );
    await expect(connectViaStellarWalletsKit("xbull")).rejects.toThrow(
      /xBull is not installed/
    );
  });
});

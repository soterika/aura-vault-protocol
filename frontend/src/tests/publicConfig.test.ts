/**
 * Regression tests for public frontend configuration validation (Issue #1468).
 */

import { describe, it, expect } from "vitest";
import {
  validatePublicConfig,
  assertPublicConfig,
} from "@/lib/publicConfig";

describe("validatePublicConfig", () => {
  it("accepts valid public network, API, WS, explorer, and admin settings", () => {
    const result = validatePublicConfig(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: "mainnet",
        NEXT_PUBLIC_API_URL: "https://api.auravault.xyz",
        NEXT_PUBLIC_WS_URL: "wss://api.auravault.xyz/ws",
        NEXT_PUBLIC_STELLAR_EXPLORER_URL: "https://stellar.expert/explorer/public/tx",
        NEXT_PUBLIC_ADMIN_ADDRESS: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      },
      { requireApiUrl: true }
    );

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.resolved).toEqual({
      network: "mainnet",
      apiUrl: "https://api.auravault.xyz",
      wsUrl: "wss://api.auravault.xyz/ws",
      explorerUrl: "https://stellar.expert/explorer/public/tx",
      adminAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });
  });

  it("reports missing required NEXT_PUBLIC_API_URL and defaults network with a warning", () => {
    const result = validatePublicConfig({}, { requireApiUrl: true });

    expect(result.valid).toBe(false);
    expect(result.resolved.network).toBe("testnet");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "NEXT_PUBLIC_STELLAR_NETWORK",
          level: "warning",
        }),
        expect.objectContaining({
          variable: "NEXT_PUBLIC_API_URL",
          level: "error",
        }),
      ])
    );
  });

  it("rejects malformed values and never echoes embedded credentials", () => {
    const secret = "super-secret-token-999";
    const result = validatePublicConfig({
      NEXT_PUBLIC_STELLAR_NETWORK: "invalid-net",
      NEXT_PUBLIC_API_URL: `https://admin:${secret}@api.auravault.xyz`,
      NEXT_PUBLIC_WS_URL: "http://not-a-ws-scheme.local",
      NEXT_PUBLIC_ADMIN_ADDRESS: "not-a-stellar-key",
    });

    expect(result.valid).toBe(false);
    const joinedMessages = result.diagnostics.map((d) => d.message).join("\n");
    expect(joinedMessages).not.toContain(secret);
    expect(joinedMessages).not.toContain("admin:");
    expect(result.diagnostics.map((d) => d.variable)).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_STELLAR_NETWORK",
        "NEXT_PUBLIC_API_URL",
        "NEXT_PUBLIC_WS_URL",
        "NEXT_PUBLIC_ADMIN_ADDRESS",
      ])
    );
  });

  it("assertPublicConfig throws with variable names when invalid", () => {
    expect(() =>
      assertPublicConfig({ NEXT_PUBLIC_API_URL: "not a url" })
    ).toThrow(/NEXT_PUBLIC_API_URL/);
  });
});

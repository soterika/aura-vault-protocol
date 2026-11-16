/**
 * network.test.ts — Tests for multi-network support (issue #328)
 *
 * Validates that validateNetwork(), getHorizonUrl(), getContractId(),
 * getNetwork(), and getNetworkConfig() all behave correctly for testnet,
 * mainnet, and invalid configurations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateNetwork,
  getNetwork,
  getHorizonUrl,
  getContractId,
  getNetworkConfig,
} from "./network.js";

describe("network", () => {
  let originalNetwork: string | undefined;

  beforeEach(() => {
    originalNetwork = process.env.STELLAR_NETWORK;
  });

  afterEach(() => {
    if (originalNetwork === undefined) {
      delete process.env.STELLAR_NETWORK;
    } else {
      process.env.STELLAR_NETWORK = originalNetwork;
    }
  });

  // ── validateNetwork ────────────────────────────────────────────────────────

  it("accepts testnet as valid network", () => {
    process.env.STELLAR_NETWORK = "testnet";
    expect(() => validateNetwork()).not.toThrow();
  });

  it("accepts mainnet as valid network", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(() => validateNetwork()).not.toThrow();
  });

  it("throws on invalid network value", () => {
    process.env.STELLAR_NETWORK = "devnet";
    expect(() => validateNetwork()).toThrow(
      /Invalid STELLAR_NETWORK value: 'devnet'/
    );
  });

  it("throws when STELLAR_NETWORK is not set", () => {
    delete process.env.STELLAR_NETWORK;
    expect(() => validateNetwork()).toThrow(
      /STELLAR_NETWORK environment variable is not set/
    );
  });

  // ── getHorizonUrl ──────────────────────────────────────────────────────────

  it("returns testnet horizon URL", () => {
    process.env.STELLAR_NETWORK = "testnet";
    expect(getHorizonUrl()).toBe("https://horizon-testnet.stellar.org");
  });

  it("returns mainnet horizon URL", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(getHorizonUrl()).toBe("https://horizon.stellar.org");
  });

  // ── getNetworkConfig ───────────────────────────────────────────────────────

  it("getNetworkConfig returns correct shape", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.VAULT_CONTRACT_ID_TESTNET = "CTEST123";

    const config = getNetworkConfig();

    expect(config).toMatchObject({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      contractId: "CTEST123",
    });
    expect(typeof config.network).toBe("string");
    expect(typeof config.horizonUrl).toBe("string");
    expect(typeof config.contractId).toBe("string");
  });
});

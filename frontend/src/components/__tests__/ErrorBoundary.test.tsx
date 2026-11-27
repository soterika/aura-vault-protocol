import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import * as Sentry from "@sentry/nextjs";
import {
  ErrorBoundary,
  categorizeError,
  truncateWalletAddress,
} from "../ErrorBoundary";
import { useWalletStore } from "@/lib/walletStore";

const mockScope = {
  setTag: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
};

vi.mock("@sentry/nextjs", () => ({
  withScope: vi.fn((cb: (scope: typeof mockScope) => void) => cb(mockScope)),
  captureException: vi.fn(),
}));

vi.mock("../notifications", () => ({
  useNotifications: () => ({ toast: vi.fn() }),
}));

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWalletStore.setState({
      address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ23456789012345678901234567890",
      network: "testnet",
      connected: true,
      loading: false,
      error: null,
    });
  });

  it("truncates wallet addresses to avoid PII in Sentry payloads", () => {
    const full = "GABCDEFGHIJKLMNOPQRSTUVWXYZ23456789012345678901234567890";
    const truncated = truncateWalletAddress(full);
    expect(truncated).toBe("GABC...7890");
    expect(truncated).not.toBe(full);
    expect(truncateWalletAddress(null)).toBeUndefined();
    expect(truncateWalletAddress("short")).toBe("[REDACTED]");
  });

  it("categorizes errors into wallet_error, api_error, and render_error", () => {
    expect(categorizeError(new Error("Freighter signing rejected by user"))).toBe(
      "wallet_error"
    );
    expect(categorizeError(new Error("Failed to fetch vault stats"))).toBe(
      "api_error"
    );
    expect(categorizeError(new Error("Cannot read properties of undefined"))).toBe(
      "render_error"
    );
    expect(
      categorizeError(new Error("Anything"), "wallet_error")
    ).toBe("wallet_error");
  });

  it("catches errors and reports them to Sentry with tags and truncated wallet", () => {
    const boundary = new ErrorBoundary({
      section: "deposit_form",
      lastAction: "submit_deposit",
      children: null,
    });

    const error = new Error("Freighter wallet disconnected");
    boundary.componentDidCatch(error, { componentStack: "<DepositForm />" });

    expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("error_category", "wallet_error");
    expect(mockScope.setTag).toHaveBeenCalledWith("section", "deposit_form");
    expect(mockScope.setUser).toHaveBeenCalledWith({ id: "GABC...7890" });
    expect(mockScope.setContext).toHaveBeenCalledWith("react", {
      componentStack: "<DepositForm />",
    });
    expect(mockScope.setContext).toHaveBeenCalledWith(
      "vault",
      expect.objectContaining({
        section: "deposit_form",
        lastAction: "submit_deposit",
      })
    );
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("resets error state when reset() is called", () => {
    const onReset = vi.fn();
    const boundary = new ErrorBoundary({
      section: "vault_stats",
      onReset,
      children: null,
    });
    boundary.setState = vi.fn();

    boundary.reset();

    expect(boundary.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null,
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

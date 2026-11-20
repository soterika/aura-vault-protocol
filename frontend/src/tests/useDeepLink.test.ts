/**
 * Unit tests for useDeepLink localization and destination resolution helpers
 * (Issues #262 & #1465).
 */

import { describe, it, expect } from "vitest";
import {
  extractLocaleFromPath,
  resolveLocalizedDestination,
} from "@/lib/useDeepLink";

describe("extractLocaleFromPath", () => {
  it("extracts supported locale prefixes", () => {
    expect(extractLocaleFromPath("/es/dashboard")).toBe("es");
    expect(extractLocaleFromPath("/fr/tx/abc123")).toBe("fr");
    expect(extractLocaleFromPath("/ar/ref/CODE")).toBe("ar");
    expect(extractLocaleFromPath("/en")).toBe("en");
  });

  it("normalizes uppercase locale segments", () => {
    expect(extractLocaleFromPath("/ES/dashboard")).toBe("es");
  });

  it("strips query strings and hashes before matching", () => {
    expect(extractLocaleFromPath("/de?action=deposit")).toBe("de");
    expect(extractLocaleFromPath("/zh#vault")).toBe("zh");
  });

  it("returns null for unsupported locales, root, or empty paths", () => {
    expect(extractLocaleFromPath("/")).toBeNull();
    expect(extractLocaleFromPath("")).toBeNull();
    expect(extractLocaleFromPath("/dashboard")).toBeNull();
    expect(extractLocaleFromPath("/ja/dashboard")).toBeNull();
  });
});

describe("resolveLocalizedDestination", () => {
  it("prepends targetLocale when targetPath has no locale", () => {
    expect(resolveLocalizedDestination("/dashboard", undefined, "es")).toBe(
      "/es/dashboard"
    );
    expect(resolveLocalizedDestination("dashboard", undefined, "fr")).toBe(
      "/fr/dashboard"
    );
    expect(resolveLocalizedDestination("/", undefined, "ar")).toBe("/ar");
  });

  it("replaces an existing locale when targetLocale is specified", () => {
    expect(resolveLocalizedDestination("/en/dashboard", undefined, "es")).toBe(
      "/es/dashboard"
    );
  });

  it("preserves existing locale when targetLocale is omitted or unsupported", () => {
    expect(resolveLocalizedDestination("/es/dashboard")).toBe("/es/dashboard");
    expect(resolveLocalizedDestination("/es/dashboard", undefined, "xx")).toBe(
      "/es/dashboard"
    );
  });

  it("carries over URLSearchParams, query strings, and record params", () => {
    expect(
      resolveLocalizedDestination(
        "/dashboard",
        new URLSearchParams("action=deposit&amount=100&ref=abc"),
        "es"
      )
    ).toBe("/es/dashboard?action=deposit&amount=100&ref=abc");

    expect(
      resolveLocalizedDestination("/dashboard", "?tab=overview&network=testnet", "de")
    ).toBe("/de/dashboard?tab=overview&network=testnet");

    expect(
      resolveLocalizedDestination("/dashboard", { ref: "xyz", tab: "stats" }, "zh")
    ).toBe("/zh/dashboard?ref=xyz&tab=stats");
  });

  it("merges inline query parameters and preserves hash fragments", () => {
    expect(
      resolveLocalizedDestination(
        "/dashboard?tab=overview#actions",
        "action=deposit&tab=history",
        "es"
      )
    ).toBe("/es/dashboard?tab=history&action=deposit#actions");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDomainsFromEnv } from "../services/sslCertService.js";
import {
  updateSslMetric,
  getSslMetrics,
  renderSslMetricsText,
} from "../services/sslMetrics.js";

/**
 * Unit tests for the SSL certificate check service.
 *
 * The TLS-dependent checkCertExpiry() function requires a live network;
 * those tests are covered by integration/E2E testing.  Here we test:
 *   - Domain parsing from environment variable
 *   - Prometheus metric recording and text rendering
 */

describe("parseDomainsFromEnv", () => {
  it("returns empty array when env value is undefined", () => {
    expect(parseDomainsFromEnv(undefined)).toEqual([]);
  });

  it("returns empty array when env value is empty string", () => {
    expect(parseDomainsFromEnv("")).toEqual([]);
  });

  it("parses a single domain with default port 443", () => {
    expect(parseDomainsFromEnv("example.com")).toEqual([
      { domain: "example.com", port: 443 },
    ]);
  });

  it("parses a domain with explicit port", () => {
    expect(parseDomainsFromEnv("api.example.com:8443")).toEqual([
      { domain: "api.example.com", port: 8443 },
    ]);
  });

  it("parses multiple domains separated by commas", () => {
    expect(
      parseDomainsFromEnv("example.com,api.example.com:8443,www.example.com")
    ).toEqual([
      { domain: "example.com", port: 443 },
      { domain: "api.example.com", port: 8443 },
      { domain: "www.example.com", port: 443 },
    ]);
  });

  it("trims whitespace around domain entries", () => {
    expect(parseDomainsFromEnv(" example.com , api.example.com ")).toEqual([
      { domain: "example.com", port: 443 },
      { domain: "api.example.com", port: 443 },
    ]);
  });

  it("falls back to port 443 for invalid port numbers", () => {
    expect(parseDomainsFromEnv("example.com:notaport")).toEqual([
      { domain: "example.com", port: 443 },
    ]);
  });

  it("ignores empty entries caused by trailing commas", () => {
    const result = parseDomainsFromEnv("example.com,");
    expect(result).toEqual([{ domain: "example.com", port: 443 }]);
  });
});

describe("SSL Prometheus metrics", () => {
  beforeEach(() => {
    // Clear metric state between tests by calling getSslMetrics and deleting entries
    const metrics = getSslMetrics() as Map<string, number>;
    metrics.clear();
  });

  it("updateSslMetric records the expiry days for a domain", () => {
    updateSslMetric("example.com", 42);
    expect(getSslMetrics().get("example.com")).toBe(42);
  });

  it("updateSslMetric overwrites a previous value", () => {
    updateSslMetric("example.com", 42);
    updateSslMetric("example.com", 15);
    expect(getSslMetrics().get("example.com")).toBe(15);
  });

  it("records -1 for failed checks", () => {
    updateSslMetric("unreachable.example.com", -1);
    expect(getSslMetrics().get("unreachable.example.com")).toBe(-1);
  });

  it("renderSslMetricsText returns empty string when no metrics recorded", () => {
    expect(renderSslMetricsText()).toBe("");
  });

  it("renderSslMetricsText includes HELP and TYPE headers", () => {
    updateSslMetric("example.com", 30);
    const output = renderSslMetricsText();
    expect(output).toContain("# HELP ssl_cert_expiry_days");
    expect(output).toContain("# TYPE ssl_cert_expiry_days gauge");
  });

  it("renderSslMetricsText contains a line per domain", () => {
    updateSslMetric("example.com", 30);
    updateSslMetric("api.example.com", 5);
    const output = renderSslMetricsText();
    expect(output).toContain('ssl_cert_expiry_days{domain="example.com"} 30');
    expect(output).toContain('ssl_cert_expiry_days{domain="api.example.com"} 5');
  });

  it("renderSslMetricsText escapes special characters in domain names", () => {
    updateSslMetric('evil"domain', 10);
    const output = renderSslMetricsText();
    expect(output).toContain('domain="evil\\"domain"');
  });
});

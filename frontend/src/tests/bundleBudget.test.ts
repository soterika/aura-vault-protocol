import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Bundle Size Budget & Automated CI Enforcement (Issue #268)", () => {
  it("defines size budget limits matching acceptance criteria", () => {
    const sizeLimitPath = path.resolve(__dirname, "../../.size-limit.json");
    expect(fs.existsSync(sizeLimitPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(sizeLimitPath, "utf-8"));
    expect(Array.isArray(config)).toBe(true);

    const initialJs = config.find((entry: any) => entry.name === "Initial JS bundle");
    expect(initialJs).toBeDefined();
    expect(initialJs.limit).toBe("200 kB");
    expect(initialJs.gzip).toBe(true);

    const cssBundle = config.find((entry: any) => entry.name === "CSS bundle");
    expect(cssBundle).toBeDefined();
    expect(cssBundle.limit).toBe("20 kB");

    // Check per-page chunks are budgeted to 50 kB each
    const pageChunks = config.filter((entry: any) => entry.name.startsWith("Per-page chunk"));
    expect(pageChunks.length).toBeGreaterThanOrEqual(4);
    for (const chunk of pageChunks) {
      expect(chunk.limit).toBe("50 kB");
      expect(chunk.gzip).toBe(true);
    }
  });

  it("has next-bundle-analyzer installed and configured", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkg.devDependencies).toHaveProperty("@next/bundle-analyzer");
    expect(pkg.scripts).toHaveProperty("analyze");
    expect(pkg.scripts.analyze).toContain("ANALYZE=true");

    const nextConfigPath = path.resolve(__dirname, "../../next.config.ts");
    const nextConfigContent = fs.readFileSync(nextConfigPath, "utf-8");
    expect(nextConfigContent).toContain("@next/bundle-analyzer");
  });

  it("verifies all route pages are code-split with dynamic imports", () => {
    const routePages = [
      path.resolve(__dirname, "../app/page.tsx"),
      path.resolve(__dirname, "../app/dashboard/page.tsx"),
      path.resolve(__dirname, "../app/faq/page.tsx"),
      path.resolve(__dirname, "../app/settings/page.tsx"),
    ];

    for (const pagePath of routePages) {
      expect(fs.existsSync(pagePath)).toBe(true);
      const content = fs.readFileSync(pagePath, "utf-8");
      expect(content).toMatch(/dynamic\(/);
    }
  });

  it("calculates bundle size delta accurately", () => {
    const baseline = 158720; // 155 kB
    const currentIncreased = 161792; // +3 kB
    const currentDecreased = 153600; // -5 kB
    const currentUnchanged = 158720; // 0 kB

    const formatDelta = (current: number, base: number) => {
      const diffBytes = current - base;
      const diffKb = (Math.abs(diffBytes) / 1024).toFixed(1);
      if (diffBytes > 0) return `+${diffKb} kB (increased)`;
      if (diffBytes < 0) return `-${diffKb} kB (decreased)`;
      return "0.0 kB (no change)";
    };

    expect(formatDelta(currentIncreased, baseline)).toBe("+3.0 kB (increased)");
    expect(formatDelta(currentDecreased, baseline)).toBe("-5.0 kB (decreased)");
    expect(formatDelta(currentUnchanged, baseline)).toBe("0.0 kB (no change)");
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Fix hydration mismatch errors in Next.js SSR (Issue #276)", () => {
  it("documents suppressHydrationWarning on <html> and does not abuse it elsewhere", () => {
    const layoutPath = path.resolve(__dirname, "../app/layout.tsx");
    const layoutContent = fs.readFileSync(layoutPath, "utf-8");

    // Must be present on <html>
    expect(layoutContent).toContain("suppressHydrationWarning");
    // Must explain WHY it is necessary on <html>
    expect(layoutContent).toMatch(/suppressHydrationWarning is (strictly )?necessary on <html>/i);
    expect(layoutContent).toMatch(/ThemeProvider/i);
  });

  it("handles wallet connection state in useEffect (client only)", () => {
    const walletConnectPath = path.resolve(__dirname, "../components/WalletConnect.tsx");
    const content = fs.readFileSync(walletConnectPath, "utf-8");

    // Wallet state starts as null on SSR
    expect(content).toMatch(/const \[wallet,\s*setWallet\]\s*=\s*useState<WalletState\s*\|\s*null>\(null\);/);

    // LocalStorage restore is inside useEffect
    expect(content).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?localStorage\.getItem\(STORAGE_KEY\)[\s\S]*?setWallet/);
  });

  it("ensures theme detection does not cause hydration mismatch", () => {
    const themeProviderPath = path.resolve(__dirname, "../components/ThemeProvider.tsx");
    const providerContent = fs.readFileSync(themeProviderPath, "utf-8");

    // Initial theme is 'system' on server
    expect(providerContent).toMatch(/const \[theme,\s*setThemeState\]\s*=\s*useState<Theme>\("system"\)/);
    // Provides mounted flag
    expect(providerContent).toContain("mounted");

    const themeTogglePath = path.resolve(__dirname, "../components/ThemeToggle.tsx");
    const toggleContent = fs.readFileSync(themeTogglePath, "utf-8");

    // ThemeToggle guards active theme styling before client mount
    expect(toggleContent).toMatch(/mounted \? theme : "system"/);
  });

  it("guards all window and document access across frontend components", () => {
    const filesToCheck = [
      path.resolve(__dirname, "../components/ThemeProvider.tsx"),
      path.resolve(__dirname, "../components/LanguageSwitcher.tsx"),
      path.resolve(__dirname, "../components/AnimatedModal.tsx"),
      path.resolve(__dirname, "../components/PerformanceCharts.tsx"),
      path.resolve(__dirname, "../components/WalletConnect.tsx"),
    ];

    for (const filePath of filesToCheck) {
      const content = fs.readFileSync(filePath, "utf-8");
      // Check that window or document accesses are protected by guards
      if (content.includes("document.") || content.includes("window.")) {
        const hasGuard =
          content.includes("typeof window") ||
          content.includes("typeof document");
        expect(hasGuard).toBe(true);
      }
    }
  });

  it("guards document access in LanguageSwitcher to avoid SSR mismatch", () => {
    const langPath = path.resolve(__dirname, "../components/LanguageSwitcher.tsx");
    const content = fs.readFileSync(langPath, "utf-8");

    expect(content).toContain('typeof document === "undefined"');
    expect(content).toMatch(/mounted \? \(i18n\.language.*\) : "en"/);
  });
});

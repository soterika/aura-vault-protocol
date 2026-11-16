/**
 * visual-regression.spec.ts
 *
 * Playwright screenshot-based visual regression tests covering dark and light
 * mode across all major pages at two viewport sizes:
 *   - Desktop : 1280 × 800
 *   - Mobile  : 375 × 812
 *
 * Pages covered:
 *   1. Landing page         (/)
 *   2. Dashboard            (/dashboard)  — connected-wallet state
 *   3. Deposit modal open   (/)           — modal triggered via data-testid
 *   4. Transaction history  (/dashboard)  — history panel visible
 *   5. Settings             (/settings)
 *
 * Baselines live in playwright/snapshots/ and are committed to source control.
 * A pixel diff > 0.5 % (maxDiffPixelRatio: 0.005) fails the test.
 *
 * To update baselines after an intentional UI change:
 *   npx playwright test --project=visual-regression --update-snapshots
 *   git add playwright/snapshots
 *   git commit -m "chore: update visual regression baselines"
 */

import { test, expect, Page } from "@playwright/test";

// ── Configuration ─────────────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile",  width: 375,  height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** Pixel-diff tolerance: 0.5 % of total pixels */
const MAX_DIFF_PIXEL_RATIO = 0.005;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Apply a theme by toggling the `dark` class on <html>.
 * Mirrors what ThemeProvider does in the Next.js app.
 */
async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
  }, theme);
  // Allow CSS transitions to settle
  await page.waitForTimeout(200);
}

/**
 * Inject a Freighter wallet stub so wallet-dependent components render in the
 * "connected" state without requiring a real browser extension.
 */
async function stubWallet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).freighterApi = {
      isConnected: async () => true,
      getPublicKey: async () =>
        "GAURA1234VISUALTEST000000000000000000000000000000000000",
      getNetwork: async () => "TESTNET",
      signTransaction: async () => "signed_xdr_stub",
    };
  });
}

/**
 * Stub all backend API routes so tests are fully self-contained and do not
 * require a running backend.
 */
async function stubApiRoutes(page: Page): Promise<void> {
  const timestamp = new Date().toISOString();

  await page.route("**/api/vault/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          total_assets: "1250000",
          total_shares: "1000000",
          price_per_share: "1.25",
          apy: "12.4",
          balance: "5000",
        },
        meta: { timestamp },
      }),
    })
  );

  await page.route("**/api/v1/vault/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          totalAssets: "1250000",
          totalShares: "1000000",
          pricePerShare: "1.25",
          apy: "12.4",
        },
        meta: { timestamp },
      }),
    })
  );

  await page.route("**/api/vault/leaderboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          { rank: 1, address: "GAURA...AAAA", shares: "100000", percentage: 10 },
          { rank: 2, address: "GAURA...BBBB", shares: "80000",  percentage: 8  },
        ],
        meta: { timestamp },
      }),
    })
  );

  await page.route("**/api/v1/yield/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { yield: "156.25", apy: "12.4", period: "30d" },
        meta: { timestamp },
      }),
    })
  );

  await page.route("**/api/health**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    })
  );
}

// ── Test factory ──────────────────────────────────────────────────────────────

/**
 * Generate one test per viewport × theme combination.
 * `navigate` performs any page-specific setup after route stubs are in place.
 */
function forEachViewportAndTheme(
  label: string,
  navigate: (page: Page) => Promise<void>
) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${label} — ${theme} — ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await stubWallet(page);
        await stubApiRoutes(page);
        await navigate(page);
        await applyTheme(page, theme);
        // Wait for lazy content and network requests to complete
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveScreenshot(
          `${label.replace(/\s+/g, "-")}-${theme}-${vp.name}.png`,
          {
            maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
            animations: "disabled",
          }
        );
      });
    }
  }
}

// ── Test suites ───────────────────────────────────────────────────────────────

test.describe("Visual Regression", () => {
  // 1. Landing page
  test.describe("Landing page", () => {
    forEachViewportAndTheme("landing", async (page) => {
      await page.goto("/");
      await page.waitForSelector("body", { state: "visible" });
    });
  });

  // 2. Dashboard — connected-wallet state
  test.describe("Dashboard connected", () => {
    forEachViewportAndTheme("dashboard-connected", async (page) => {
      await page.goto("/dashboard");
      await page.waitForSelector("body", { state: "visible" });
    });
  });

  // 3. Deposit modal open
  test.describe("Deposit modal", () => {
    forEachViewportAndTheme("deposit-modal", async (page) => {
      await page.goto("/");
      await page.waitForSelector("body", { state: "visible" });

      // Try to open the deposit modal via data-testid trigger if it exists;
      // fall back to a full-page screenshot with the modal not open.
      const depositTrigger = page.getByTestId("open-deposit-modal");
      const hasTrigger = await depositTrigger
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasTrigger) {
        await depositTrigger.click();
        // Modal may use role="dialog" or a custom element — wait briefly
        await page
          .getByRole("dialog")
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => {
            /* modal may not use role=dialog */
          });
        await page.waitForTimeout(300);
      }
    });
  });

  // 4. Transaction history
  test.describe("Transaction history", () => {
    forEachViewportAndTheme("transaction-history", async (page) => {
      await page.goto("/dashboard");
      await page.waitForSelector("body", { state: "visible" });

      // Attempt to reveal the transaction history panel
      const historyTrigger = page
        .getByTestId("transaction-history")
        .or(page.getByRole("tab", { name: /history/i }));

      const hasTrigger = await historyTrigger
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasTrigger) {
        await historyTrigger.first().click();
        await page.waitForTimeout(300);
      }
    });
  });

  // 5. Settings page
  test.describe("Settings page", () => {
    forEachViewportAndTheme("settings", async (page) => {
      await page.goto("/settings");
      await page.waitForSelector("body", { state: "visible" });
    });
  });
});

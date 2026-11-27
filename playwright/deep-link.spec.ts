import { test, expect } from "@playwright/test";

/**
 * End-to-end Playwright tests for mobile deep link & web fallback (#1264)
 *
 * Acceptance Criteria:
 *   [✓] Deep link opens deposit form with pre-filled amount if provided
 *   [✓] Amount validated before form population (positive number)
 *   [✓] Web fallback redirects to app store if app not installed
 */

test.describe("Mobile Deep Link & Web Fallback", () => {
  test("valid deposit deep link populates app link with amount and token", async ({
    page,
  }) => {
    await page.goto("/deposit?amount=100&token=USDC");

    const openAppLink = page.getByTestId("open-app-link");
    await expect(openAppLink).toBeVisible();
    await expect(openAppLink).toHaveAttribute(
      "href",
      "aura://deposit?amount=100&token=USDC"
    );
  });

  test("invalid negative amount is stripped from deep link", async ({ page }) => {
    await page.goto("/deposit?amount=-50&token=USDC");

    const openAppLink = page.getByTestId("open-app-link");
    await expect(openAppLink).toBeVisible();
    await expect(openAppLink).toHaveAttribute("href", "aura://deposit?token=USDC");
  });

  test("web fallback redirects to App Store on iOS when app is not installed", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();

    await page.goto("/deposit?amount=100&token=USDC");

    const storeLink = page.getByTestId("app-store-fallback-link");
    await expect(storeLink).toHaveAttribute("href", /apps\.apple\.com/);

    await context.close();
  });

  test("web fallback redirects to Play Store on Android when app is not installed", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto("/deposit?amount=100&token=USDC");

    const storeLink = page.getByTestId("app-store-fallback-link");
    await expect(storeLink).toHaveAttribute("href", /play\.google\.com/);

    await context.close();
  });
});

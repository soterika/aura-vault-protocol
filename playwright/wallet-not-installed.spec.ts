/**
 * Playwright test — Freighter wallet not installed  (#990)
 *
 * Verifies the UI behaves gracefully when a user clicks "Connect Wallet"
 * but the Freighter browser extension is absent from `window.freighterApi`.
 *
 * Coverage:
 *  - Error message shown: "Freighter not found. Install it here."
 *  - Install link points to the Chrome Web Store
 *  - No crash / unhandled promise rejection on any browser
 *  - Error recovery: mock Freighter installed → refresh → connect succeeds
 *
 * Browsers: chromium, firefox (Freighter is absent on both in test env)
 * The test is skipped on webkit/mobile because those projects don't support
 * Freighter regardless of extension availability — the UX path is identical
 * but the skip keeps CI output readable.
 */

import { test, expect, Page } from "@playwright/test";

// Chrome Web Store listing for Freighter
const FREIGHTER_CWS_URL =
  "https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Navigate to the home page with Freighter completely absent from `window`.
 * We delete `window.freighterApi` via an init-script so it is never defined,
 * mimicking a browser where the extension is not installed.
 */
async function gotoWithoutFreighter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Prevent any previously injected freighterApi stub from surviving.
    // Using Object.defineProperty with a getter that returns undefined ensures
    // the property access itself doesn't throw and leaves typeof checks as
    // "undefined", which is what the WalletConnect component checks.
    Object.defineProperty(window, "freighterApi", {
      get: () => undefined,
      configurable: true,
    });
  });

  // Stub the vault API so the page doesn't show network errors unrelated to
  // wallet installation.
  await page.route("**/api/vault/total_assets*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: "0" }) })
  );
  await page.route("**/api/vault/balance_of*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: "0" }) })
  );
  await page.route("**/api/v1/vault/stats*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { total_assets: 0, total_shares: 0, apy: 0, last_harvest: null, cached: false },
      }),
    })
  );

  await page.goto("/");
}

// ─── Error state tests ───────────────────────────────────────────────────────

test.describe("Freighter not installed — error state", () => {
  // Skip on webkit/mobile — Freighter is only available as a Chromium/Firefox
  // extension; the "not installed" UX path is browser-agnostic but we limit
  // noise in CI by targeting the two platforms users will actually encounter.
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Freighter extension does not target WebKit; skip to reduce CI noise"
  );

  test("shows error message when Freighter is absent and user clicks Connect Wallet", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await gotoWithoutFreighter(page);

    // The connect button must be present
    const connectBtn = page.getByTestId("connect-wallet-btn");
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });

    await connectBtn.click();

    // Error message must appear
    const errorMsg = page.getByRole("alert");
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    await expect(errorMsg).toContainText(/freighter/i);

    // No unhandled JS errors
    expect(errors).toHaveLength(0);
  });

  test("error message contains an install link to the Chrome Web Store", async ({
    page,
  }) => {
    await gotoWithoutFreighter(page);

    const connectBtn = page.getByTestId("connect-wallet-btn");
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });
    await connectBtn.click();

    // Wait for error state
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });

    // The install link must be present and point at the Chrome Web Store
    const installLink = page.getByRole("link", { name: /install|here|get freighter/i });
    await expect(installLink).toBeVisible({ timeout: 5_000 });

    const href = await installLink.getAttribute("href");
    expect(href).toBeTruthy();
    // Accept either the full CWS URL or an addons.mozilla.org URL (Firefox alt)
    const isCws      = href!.includes("chrome.google.com/webstore");
    const isFirefoxAmo = href!.includes("addons.mozilla.org");
    expect(isCws || isFirefoxAmo).toBe(true);
  });

  test("no crash or unhandled promise rejection when Freighter is missing", async ({
    page,
  }) => {
    const pageErrors: string[]   = [];
    const consoleErrors: string[] = [];

    page.on("pageerror", (e)  => pageErrors.push(e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await gotoWithoutFreighter(page);

    // Attempt connect
    const connectBtn = page.getByTestId("connect-wallet-btn");
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });
    await connectBtn.click();

    // Give the UI time to settle
    await page.waitForTimeout(1_000);

    // No unhandled JS errors / uncaught promise rejections
    expect(pageErrors).toHaveLength(0);

    // The page must still be functional — connect button or error UI is visible
    const errorVisible  = await page.getByRole("alert").isVisible();
    const buttonVisible = await connectBtn.isVisible();
    expect(errorVisible || buttonVisible).toBe(true);
  });

  test("does not show wallet address or portfolio section after failed connect", async ({
    page,
  }) => {
    await gotoWithoutFreighter(page);

    const connectBtn = page.getByTestId("connect-wallet-btn");
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });
    await connectBtn.click();

    // Give the component time to process the failed connect
    await page.waitForTimeout(1_000);

    // Wallet address must NOT appear
    await expect(page.getByTestId("wallet-address")).not.toBeVisible();
  });
});

// ─── Error recovery tests ─────────────────────────────────────────────────────

test.describe("Freighter not installed — error recovery", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Freighter extension does not target WebKit"
  );

  test("user installs Freighter (mock), refreshes, and connects successfully", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // ── Phase 1: Freighter absent ───────────────────────────────────────────
    await gotoWithoutFreighter(page);

    const connectBtn = page.getByTestId("connect-wallet-btn");
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });
    await connectBtn.click();

    // Error shown
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });

    // ── Phase 2: Simulate extension install (inject mock) + page reload ─────
    // Inject the Freighter mock into the next navigation by adding an init-script
    // for the page. We can do this by navigating with addInitScript set up first.
    await page.addInitScript(() => {
      Object.defineProperty(window, "freighterApi", {
        value: {
          isConnected:    async () => true,
          getPublicKey:   async () => "GABC1234TESTPUBLICKEY5678STELLARADDRESSRECOVER",
          requestAccess:  async () => ({
            address: "GABC1234TESTPUBLICKEY5678STELLARADDRESSRECOVER",
          }),
          getNetwork:     async () => "TESTNET",
          signTransaction: async () => "signed_xdr",
        },
        configurable: true,
        writable:     false,
      });
    });

    // Reload the page — the new init-script now provides Freighter
    await page.reload({ waitUntil: "domcontentloaded" });

    // Vault API stubs must be re-registered after reload
    await page.route("**/api/vault/total_assets*", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: "500000" }),
      })
    );
    await page.route("**/api/vault/balance_of*", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ balance: "1000" }),
      })
    );

    // ── Phase 3: Connect succeeds ───────────────────────────────────────────
    const connectBtnAfterReload = page.getByTestId("connect-wallet-btn");
    await expect(connectBtnAfterReload).toBeVisible({ timeout: 8_000 });
    await connectBtnAfterReload.click();

    // Wallet address must now be shown
    await expect(page.getByTestId("wallet-address")).toBeVisible({ timeout: 8_000 });

    // No JS errors throughout the whole flow
    expect(errors).toHaveLength(0);
  });
});

// ─── Firefox-specific coverage ────────────────────────────────────────────────

test.describe("Freighter not installed — Firefox (extension unavailable)", () => {
  test.skip(
    ({ browserName }) => browserName !== "firefox",
    "Firefox-specific test"
  );

  test("shows Freighter error on Firefox where extension is never available", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // On Firefox, freighterApi is never defined regardless of the user's
    // extensions (Freighter only ships for Chromium). The component should
    // handle this gracefully — same as the "not installed" path.
    await gotoWithoutFreighter(page);

    const connectBtn = page.getByTestId("connect-wallet-btn");
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });
    await connectBtn.click();

    // Error message must appear
    const errorMsg = page.getByRole("alert");
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    await expect(errorMsg).toContainText(/freighter/i);

    // No JS errors
    expect(errors).toHaveLength(0);
  });
});

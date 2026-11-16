import { test, expect } from "@playwright/test";

// Inject a Freighter stub before every test
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Stable provider fixtures let Firefox and WebKit exercise the same
    // connect/disconnect UI without requiring Chromium-only extensions.
    (window as any).freighterApi = {
      isConnected: async () => false,
      getPublicKey: async () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      getNetwork: async () => ({ network: "TESTNET" }),
      signTransaction: async (xdr: string) => xdr,
    };
    (window as any).ethereum = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) =>
        method === "eth_accounts" || method === "eth_requestAccounts"
          ? ["0x0000000000000000000000000000000000000001"]
          : null,
      on: () => undefined,
      removeListener: () => undefined,
    };
    (window as any).coinbaseWalletExtension = {
      isCoinbaseWallet: true,
      request: async ({ method }: { method: string }) =>
        method === "eth_accounts" || method === "eth_requestAccounts"
          ? ["0x0000000000000000000000000000000000000002"]
          : null,
      on: () => undefined,
      removeListener: () => undefined,
    };
  });
  // Stub vault API calls
  await page.route("**/api/vault/total_assets*", (r) =>
    r.fulfill({ status: 200, json: { total: "500000" } })
  );
  await page.route("**/api/vault/balance_of*", (r) =>
    r.fulfill({ status: 200, json: { balance: "1000" } })
  );
});

test.describe("Core page load", () => {
  test("renders without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page).toHaveTitle(/Aura/i);
    expect(errors).toHaveLength(0);
  });

  test("connect wallet button is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("connect-wallet-btn")).toBeVisible();
  });
});

test.describe("Wallet connection", () => {
  test("connects wallet and shows address + network badge", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-wallet-btn").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("network-badge")).toContainText("TESTNET");
  });

  test("disconnects wallet and returns to initial state", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-wallet-btn").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("disconnect-wallet-btn").click();
    await expect(page.getByTestId("connect-wallet-btn")).toBeVisible();
    await expect(page.getByTestId("portfolio-section")).not.toBeVisible();
  });
});

test.describe("Portfolio section", () => {
  test("shows portfolio after connection", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-wallet-btn").click();
    await expect(page.getByTestId("portfolio-section")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("total-assets")).not.toBeEmpty();
    await expect(page.getByTestId("share-balance")).not.toBeEmpty();
    await expect(page.getByTestId("price-per-share")).not.toBeEmpty();
  });

  test("refresh button reloads data", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-wallet-btn").click();
    await expect(page.getByTestId("portfolio-section")).toBeVisible({ timeout: 8000 });
    await page.getByTestId("refresh-btn").click();
    await expect(page.getByTestId("total-assets")).not.toBeEmpty();
  });
});

test.describe("Navigation & FAQ", () => {
  test("FAQ page loads", async ({ page }) => {
    await page.goto("/faq");
    await expect(page).toHaveURL(/faq/);
    // Should render without crash
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Slow network (3G)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "3G test: chromium only");

  test("page loads within 10s on 3G", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (150 * 1024) / 8,
    });
    const start = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(Date.now() - start).toBeLessThan(10_000);
  });
});

import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end Playwright tests for deposit flow (#282)
 *
 * Acceptance Criteria:
 *   [✓] Test: connect Freighter mock → enter amount → confirm → success screen
 *   [✓] Test: validation errors shown for invalid amounts
 *   [✓] Test: vault paused state disables deposit button
 *   [✓] Runs in CI on every PR
 *   [✓] Screenshots on failure
 *   [✓] Tests pass on Chrome, Firefox, and WebKit
 */

interface SetupOptions {
  paused?: boolean;
  balance?: string;
}

async function setupPageRoutes(page: Page, options: SetupOptions = {}) {
  const { paused = false, balance = "1000" } = options;

  // Inject Freighter mock before any navigation
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).freighterApi = {
      isConnected: async () => true,
      getPublicKey: async () => "GAURA1TESTWALLETADDRESS000000000000000000000000000000AURA",
      getNetwork: async () => "TESTNET",
      signTransaction: async () => "mock_signed_xdr",
    };
  });

  // Mock API endpoints
  await page.route("**/api/vault/total_assets*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ total: "500000" }),
    })
  );

  await page.route("**/api/vault/balance_of*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance }),
    })
  );

  await page.route("**/api/vault/apy*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apy: "8.50" }),
    })
  );

  await page.route("**/api/vault/status*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ paused, is_paused: paused }),
    })
  );

  await page.route("**/api/vault/is_paused*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ paused, is_paused: paused }),
    })
  );

  await page.route("**/api/vault/estimate-gas*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        baseFee: "0.001",
        priorityFee: "0.0005",
        totalGas: "0.0015",
      }),
    })
  );

  await page.route("**/api/vault/transactions/submit*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hash: "mock_tx_deposit_a1b2c3d4e5f67890",
      }),
    })
  );

  // Suppress WebSocket upgrades
  await page.route("**/api/ws/**", (route) => route.abort());
}

async function connectWallet(page: Page) {
  const connectBtn = page.locator('[data-testid="connect-wallet-btn"], [data-cy="connect-wallet-btn"]').first();
  await expect(connectBtn).toBeVisible({ timeout: 10_000 });
  await connectBtn.click();

  // If a dropdown or option appears, click Freighter
  const freighterOption = page.locator('[data-cy="wallet-option-freighter"]');
  if (await freighterOption.isVisible({ timeout: 1000 }).catch(() => false)) {
    await freighterOption.click();
  }

  // Address confirms connection
  const addressBadge = page.locator('[data-testid="wallet-address"], [data-cy="wallet-address"]').first();
  await expect(addressBadge).toBeVisible({ timeout: 8_000 });
}

test.describe("Deposit Flow E2E Tests", () => {
  test("happy path: connect Freighter mock → enter amount → confirm → success screen", async ({ page }) => {
    await setupPageRoutes(page);
    await page.goto("/");

    // 1. Connect Freighter mock wallet
    await connectWallet(page);

    // 2. Select deposit tab & open deposit modal
    const depositTab = page.locator('[data-cy="deposit-tab"]');
    if (await depositTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await depositTab.click();
    }

    const openDepositBtn = page.locator('[data-cy="open-deposit-modal"]');
    await expect(openDepositBtn).toBeVisible({ timeout: 5_000 });
    await openDepositBtn.click();

    // 3. Modal opens
    const modal = page.locator('[data-cy="tx-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Step 1: Enter deposit amount
    const amountInput = page.locator('[data-cy="modal-amount-input"]');
    await expect(amountInput).toBeVisible({ timeout: 5_000 });
    await amountInput.fill("100");

    // Proceed to Step 2 (Review)
    const nextBtn = page.locator('[data-cy="modal-next-btn"]');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Step 2: Review screen shows entered amount
    const reviewAmount = page.locator('[data-cy="modal-review-amount"]');
    await expect(reviewAmount).toBeVisible({ timeout: 5_000 });
    await expect(reviewAmount).toContainText("100");

    // Confirm transaction
    const confirmBtn = page.locator('[data-cy="modal-next-btn"]');
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
    await confirmBtn.click();

    // Step 3/4: Success screen appears
    const successScreen = page.locator('[data-cy="modal-success"]');
    await expect(successScreen).toBeVisible({ timeout: 10_000 });
    await expect(successScreen).toContainText("Deposit successful!");

    const txHash = page.locator('[data-cy="modal-tx-hash"]');
    await expect(txHash).toBeVisible();
    await expect(txHash).toContainText("mock_tx_deposit");
  });

  test("validation errors shown for invalid amounts", async ({ page }) => {
    await setupPageRoutes(page, { balance: "500" });
    await page.goto("/");

    await connectWallet(page);

    const openDepositBtn = page.locator('[data-cy="open-deposit-modal"]');
    await expect(openDepositBtn).toBeVisible({ timeout: 5_000 });
    await openDepositBtn.click();

    const amountInput = page.locator('[data-cy="modal-amount-input"]');
    const nextBtn = page.locator('[data-cy="modal-next-btn"]');
    const errorMsg = page.locator('[data-cy="modal-amount-error"]');

    // Case 1: Empty input submitted
    await nextBtn.click();
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText("Enter an amount greater than 0");

    // Case 2: Zero amount entered
    await amountInput.fill("0");
    await nextBtn.click();
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText("Enter an amount greater than 0");

    // Case 3: Negative amount entered
    await amountInput.fill("-25");
    await nextBtn.click();
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText("Enter an amount greater than 0");

    // Case 4: Amount exceeds available balance (500)
    await amountInput.fill("9999");
    await nextBtn.click();
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText("Amount exceeds your balance");

    // Case 5: Valid amount clears error and advances to review
    await amountInput.fill("200");
    await nextBtn.click();
    await expect(page.locator('[data-cy="modal-step-2"]')).toBeVisible({ timeout: 5_000 });
  });

  test("vault paused state disables deposit button", async ({ page }) => {
    // Configure vault in paused state
    await setupPageRoutes(page, { paused: true });
    await page.goto("/");

    await connectWallet(page);

    const openDepositBtn = page.locator('[data-cy="open-deposit-modal"]');
    await expect(openDepositBtn).toBeVisible({ timeout: 5_000 });
    await expect(openDepositBtn).toBeDisabled();

    // Verify button text conveys paused status
    await expect(openDepositBtn).toHaveText(/Vault Paused/i);

    // Clicking disabled button must not open modal
    await openDepositBtn.click({ force: true });
    await expect(page.locator('[data-cy="tx-modal"]')).not.toBeVisible();
  });
});

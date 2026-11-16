import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/dashboard",
  "/faq",
  "/settings",
];

for (const route of routes) {
  test(`has no critical or serious accessibility violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.locator("body").waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const severe = results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    );

    expect(
      severe.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
    ).toEqual([]);
  });
}

test("keeps a keyboard reachable skip link at the start of the page", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /skip to main content/i })).toBeFocused();
});

for (const label of ["Open Deposit modal", "Open Withdraw modal"]) {
  test(`checks the ${label.replace("Open ", "")} for serious accessibility violations`, async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: label }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const severe = results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    );
    expect(severe.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
  });
}

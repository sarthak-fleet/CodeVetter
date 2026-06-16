import { expect, test } from "@playwright/test";

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from "./helpers";

test.describe("Fleet page", () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test("/fleet renders the cross-project dashboard", async ({ page }) => {
    await navigateTo(page, "/fleet");
    await waitForNoSpinners(page);

    await expect(page.locator("h1", { hasText: "Fleet" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Linked projects/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Weekly fleet report" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate/ })).toBeVisible();
  });
});

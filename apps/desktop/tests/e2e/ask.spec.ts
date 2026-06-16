import { expect, test } from "@playwright/test";

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from "./helpers";

test.describe("Ask CodeVetter page", () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test("/ask renders the chat surface", async ({ page }) => {
    await navigateTo(page, "/ask");
    await waitForNoSpinners(page);

    await expect(
      page.locator("h1", { hasText: "Ask CodeVetter" }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("Which project shipped the most last week?"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask" })).toBeVisible();
  });

  test("clicking an example question fills the input", async ({ page }) => {
    await navigateTo(page, "/ask");
    await waitForNoSpinners(page);

    const example = page.getByText("Which project shipped the most last week?").last();
    await example.click();
    const input = page.getByPlaceholder("Which project shipped the most last week?");
    await expect(input).toHaveValue("Which project shipped the most last week?");
  });
});

import { expect, test } from "@playwright/test";

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from "./helpers";

test.describe("Intel page", () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test("/intel renders the Repo Attribution card", async ({ page }) => {
    await navigateTo(page, "/intel");
    await waitForNoSpinners(page);

    await expect(
      page.locator("h1", { hasText: "Engineering Intelligence" }),
    ).toBeVisible();
    await expect(page.getByText("Repo Attribution")).toBeVisible();

    // Per-Tool LLM card was removed in v1.1.77.
    await expect(page.getByText("Per-Tool LLM Usage")).toHaveCount(0);

    // Run button is disabled until a path is entered.
    const runButton = page.getByRole("button", { name: "Run" });
    await expect(runButton).toBeDisabled();
  });

  test("typing a repo path enables Run", async ({ page }) => {
    await navigateTo(page, "/intel");
    await waitForNoSpinners(page);

    const input = page.getByPlaceholder("/Users/me/code/my-repo");
    await input.fill("/tmp/some-repo");

    await expect(page.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  test("tool window picker is gone", async ({ page }) => {
    await navigateTo(page, "/intel");
    await waitForNoSpinners(page);

    // v1.1.77 removed the per-tool LLM card and its window-range picker.
    await expect(page.getByText("Tool window")).toHaveCount(0);
  });
});

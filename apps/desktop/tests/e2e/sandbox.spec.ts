import { expect, test } from "@playwright/test";

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from "./helpers";

// Sandbox/T-Rex panel lives inside /review's verdict column, which only
// renders after a review result exists. In the browser-fallback path the
// page renders an empty create-mode shell instead. Since we run the e2e
// suite outside Tauri (no IPC backend), this smoke test only asserts the
// page itself loads cleanly — the runner panel is exercised in the unit
// + Rust tests, not here.

test.describe("Sandbox panel", () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  test("/review still loads cleanly after the T-Rex bolt-on", async ({
    page,
  }) => {
    await navigateTo(page, "/review");
    await waitForNoSpinners(page);
    await expect(page.locator("h1", { hasText: "Review" })).toBeVisible();
  });
});

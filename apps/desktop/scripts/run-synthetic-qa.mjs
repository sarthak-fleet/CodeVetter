#!/usr/bin/env node
/**
 * Minimal synthetic-user QA runner (Playwright Chromium).
 *
 * Usage:
 *   node scripts/run-synthetic-qa.mjs <baseUrl> <loopId> <artifactDir>
 *
 * Prints one JSON line to stdout (SyntheticQaRunResult shape).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const LOOPS = {
  "codevetter-review-shell": {
    route: "/review",
    goal:
      "Open the Review page in a real browser, confirm the shell renders, and collect console errors.",
    async assert(page) {
      await page.waitForSelector("main", { timeout: 10_000 });
      const heading = page.locator("h1", { hasText: "Review" });
      await heading.waitFor({ state: "visible", timeout: 10_000 });
    },
  },
};

const IGNORED_CONSOLE = [
  "TAURI_NOT_AVAILABLE",
  "__TAURI__",
  "ipc://localhost",
  "tauri://localhost",
  "[vite]",
  "Failed to fetch",
  "NetworkError",
  "net::ERR_",
  "ResizeObserver loop",
];

function parseArgs() {
  const baseUrl = (process.argv[2] ?? "http://localhost:1420").replace(/\/$/, "");
  const loopId = process.argv[3] ?? "codevetter-review-shell";
  const artifactDir =
    process.argv[4] ?? path.join(process.cwd(), "synthetic-qa-artifacts", String(Date.now()));
  return { baseUrl, loopId, artifactDir };
}

async function main() {
  const { baseUrl, loopId, artifactDir } = parseArgs();
  const loop = LOOPS[loopId];
  if (!loop) {
    const err = { error: `Unknown loop id: ${loopId}` };
    console.log(JSON.stringify(err));
    process.exit(1);
  }

  fs.mkdirSync(artifactDir, { recursive: true });

  const started = Date.now();
  const consoleErrors = [];
  let browser;
  const targetUrl = `${baseUrl}${loop.route}`;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      colorScheme: "dark",
    });

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((p) => text.includes(p))) return;
      consoleErrors.push(text);
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await loop.assert(page);

    const pass = consoleErrors.length === 0;
    const notes = pass
      ? `Loaded ${targetUrl}. Heading "Review" visible. No unexpected console errors.`
      : `Loaded ${targetUrl}. UI checks passed but ${consoleErrors.length} console error(s) recorded.`;

    const result = {
      loop_id: loopId,
      route: loop.route,
      goal: loop.goal,
      pass,
      notes,
      screenshot_path: null,
      duration_ms: Date.now() - started,
      trace: {
        final_url: page.url(),
        page_title: await page.title(),
        console_errors: consoleErrors,
      },
      error: null,
    };

    if (!pass) {
      const shot = path.join(artifactDir, "failure.png");
      await page.screenshot({ path: shot, fullPage: true });
      result.screenshot_path = shot;
    }

    console.log(JSON.stringify(result));
    process.exit(pass ? 0 : 2);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    let screenshotPath = null;
    try {
      const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : [];
      const page = pages[0];
      if (page) {
        const shot = path.join(artifactDir, "failure.png");
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        screenshotPath = shot;
      }
    } catch {
      /* ignore screenshot errors */
    }

    const result = {
      loop_id: loopId,
      route: loop.route,
      goal: loop.goal,
      pass: false,
      notes: `Synthetic QA could not complete: ${message}`,
      screenshot_path: screenshotPath,
      duration_ms: Date.now() - started,
      trace: {
        final_url: targetUrl,
        page_title: "",
        console_errors: consoleErrors,
      },
      error: message,
    };
    console.log(JSON.stringify(result));
    process.exit(2);
  } finally {
    if (browser) await browser.close();
  }
}

main();
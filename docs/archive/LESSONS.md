# Lessons Learned — CodeVetter

Honest, specific findings from building this. Surprises, debugging gotchas, and things that didn't work as expected.
For architectural decisions, see [DECISIONS.md](./DECISIONS.md).

---

## Rust / Tauri

### GUI-launched apps don't inherit shell PATH

Tauri on macOS is launched via Finder or Spotlight, not a terminal. `StdCommand::new("claude")` returns ENOENT even when `claude` is on the user's `$PATH` in a terminal session. Required `resolve_cli_path()` in `commands/review.rs` that manually walks `~/.asdf/shims`, `~/.bun/bin`, `/opt/homebrew/bin`, and other common install locations before falling back to the bare name.

**Gotcha:** The fix only helps if `claude` is installed in one of the known locations. Custom install paths still fail silently.

### rusqlite `bundled` feature is the right call for desktop

Using the `bundled` feature in `rusqlite = { version = "0.31", features = ["bundled"] }` compiles SQLite into the binary. This avoids the "SQLite version mismatch" errors that appear on older macOS system SQLite, but it adds ~2 MB to the binary and increases Rust compile time noticeably on cold builds.

### Rust warnings in unused code slow CI noise

`history.rs` had unused `line_number` warnings that surfaced in the Tauri dev build output (noted in memory context, May 2026). Rust warnings don't fail the build but clutter the output enough to obscure real errors.

---

## LLM / Review Pipeline

### CLI agent output format is less structured than API JSON

The CLI-agent review path (`claude -p`) returns natural-language text, not guaranteed JSON. Parsing requires heuristics (the `parseReviewResponse` path in `packages/review-core/src/prompt.ts`). Real-world failure mode: the agent describes the fix in prose instead of making the file change, producing a "Fix with AI" result with no git diff. The Review page handles this with a fallback that shows agent text output when no files changed — but it's a worse UX.

### Provider-free review via plan subscriptions has a reliability ceiling

Using `claude -p` / `gemini -p` means review latency and availability depend on the user's CLI agent version, plan quota, and rate limits. Claude's 5-hour and 7-day utilization windows are parsed from rate-limit response headers and displayed on the Dashboard. The real-time stats display was broken until v1.1.3 (frozen until app restart) — the fix shipped 2026-04-25.

### OpenAI-compatible endpoint lags on Anthropic-specific features

The gateway client targets the OpenAI-compatible chat completions shape. This works for all three providers but foregoes Anthropic-specific capabilities (extended thinking, prompt caching headers, tool-use format). If a future review pass needs structured tool output, the gateway abstraction will need a provider-native escape hatch.

---

## Frontend / React

### `isTauriAvailable()` guard is load-bearing for dev workflow

All Tauri IPC calls are wrapped in `isTauriAvailable()` checks so the React code can run in a plain browser during `npm run dev`. Without this, the Vite dev server breaks on any `invoke()` call. The pattern is worth preserving as new IPC commands are added.

### Token stats real-time update needed event-driven architecture

Dashboard token stats were frozen until app restart (v1.1.2 and earlier). The fix required the Tauri backend to emit Tauri events on indexing updates rather than relying on the frontend polling at mount time. Lesson: any stat that the Rust backend updates asynchronously needs a corresponding `emit()` call, not just a query-on-mount.

### Tailwind v4 on the landing page vs v3 on the desktop app

The desktop app uses Tailwind CSS v3 + shadcn/ui. The landing page was rebuilt with Tailwind v4 (`bd19bc1`). These are not interchangeable — v4 drops the `tailwind.config.js` format and changes how custom tokens are declared. Keep them in separate workspaces and don't try to share a single Tailwind config.

---

## CI / Release Pipeline

### Cloudflare Pages root directory config is fragile

CF Pages `root_dir` was set to `apps/desktop` (the Tauri app), but CF Pages was supposed to build `apps/landing-page`. When the landing page was added, the deployment silently built the wrong target. Fixed by changing CF Pages `root_dir` to `apps/landing-page` (2026-05-02). The Vite output directory is `out/` (not the CF Pages default `dist/`) — the destination dir config must match.

### pnpm-lock.yaml and npm workspaces don't mix

The monorepo uses npm workspaces (`package-lock.json`), but a `pnpm-lock.yaml` also exists at the root. CF Pages was picking up `pnpm-lock.yaml` and failing because it was out of sync with `package.json`. Root cause: the `@saas-maker/eslint-config` dependency was absent from the lockfile. Always regenerate both lockfiles when adding workspace dependencies.

### Tauri release action needs explicit `.sig` + `latest.json` upload

The `release.yml` workflow needed a force-upload step for `.sig` files and the `latest.json` updater manifest after `tauri-action` — without it, `tauri-plugin-updater` cannot verify or find the latest release (fixed 2026-04-26).

### ESLint pre-commit hook can become a blocking bottleneck

The pre-commit hook runs lint-staged on staged `.ts`/`.tsx` files. When the ESLint config is mis-configured (e.g., after an ESLint version bump), the hook fails on every commit. This happened during the ESLint downgrade investigation (Apr 2026, memory context S78/S83). Keep the hook failure message descriptive enough to distinguish a lint error from a hook misconfiguration.

---

## Architecture / Design

### `packages/` dead references cause silent build failures

When `packages/` workspace packages were removed, the desktop app's `package.json` still referenced them via `file:` protocol. TypeScript type-checks pass until build time, then fail with "Cannot find module @code-reviewer/*". The fix was mechanical (remove from `package.json`) but the silent failure mode is worth noting: npm workspaces resolve `file:` references at install time, not at build time.

### The cloud workers path is built but is not the active product

`workers/review` and `workers/api` are fully scaffolded with D1, queue processing, and GitHub App webhook handling. They are not being actively developed. Before investing in them, verify that the Cloudflare D1 integration still works — the codebase has diverged toward the CLI-agent desktop path and cloud worker code may have stale type assumptions.

### Gemini CLI transcript limitation blocks History parity

Claude Code and Codex write session JSONL transcripts that the history indexer can parse. Gemini CLI does not write transcripts at the time of writing. This blocks Gemini History tab, Gemini QA replay, and any Gemini-specific session intelligence. Tracked in `PROJECT-LOG.md §5 UI Polish`.

---

## Stubs (fill in as the project progresses)

- **Benchmark fixture quality:** The catch-rate benchmark (`benchmarks/`) needs real agent-generated PRs with confirmed bugs. Synthetic fixtures may not surface the same failure modes.
- **Multi-session reconstruction:** Cross-transcript context reconstruction (when one session can't explain the agent's full path) is flagged as a remaining gap in multiple PRDs — capture lessons once implemented.
- **Hunk-level revert edge cases:** `git apply -R --recount` on complex diffs (binary files, merge conflicts, renames) — document failure modes as they appear.

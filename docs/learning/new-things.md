# New things to learn — CodeVetter

Desktop Tauri 2 / Rust app that reviews agent-generated code diffs using pluggable LLM providers, running fully offline as a macOS binary.

---

## Tauri 2
- What: Rust-backed desktop app framework that renders a native webview instead of bundling Chromium.
- Why here: TBD
- Gotcha (from code): GUI-launched Tauri apps on macOS don't inherit shell `$PATH` — `claude` and `gemini` binaries are found via a custom `resolve_cli_path()` that walks known install locations. (`apps/desktop/src-tauri/src/commands/review.rs:20`)
- Source: https://v2.tauri.app/

## Tauri IPC (invoke / commands)
- What: The bridge that lets TypeScript call Rust functions via `invoke("command_name", args)`.
- Why here: TBD
- Gotcha (from code): All `invoke()` calls must be wrapped in `isTauriAvailable()` so the React app still renders in a plain browser during `npm run dev`. (`apps/desktop/src/lib/tauri-ipc.ts:40`)
- Source: https://v2.tauri.app/develop/calling-rust/

## CLI-agent subprocess execution (`claude -p` / `gemini -p`)
- What: Shelling out to an installed CLI agent instead of calling a provider API directly.
- Why here: TBD
- Gotcha (from code): CLI output is prose, not guaranteed JSON — `run_agent_json` uses `extract_json_from_output` to find the JSON block; if none is found the review errors out. (`apps/desktop/src-tauri/src/commands/review.rs:721–740`)
- Source: https://code.claude.com/docs/en/overview

## ast-grep (`sg`) structural code scanner
- What: A fast AST-pattern search tool (external binary `sg`) that matches code structure, not just text.
- Why here: TBD
- Gotcha (from code): `sg` is optional — `resolve_sg_path()` returns `None` if the binary isn't installed and the evidence step silently skips; patterns are defined as inline `AstGrepRule` structs, not YAML rule files. (`apps/desktop/src-tauri/src/commands/evidence_pattern.rs:134–154`)
- Source: https://ast-grep.github.io/

## Agent Talks protocol (inter-session handoff)
- What: A structured JSON field (`talk`) that review agents embed in their output, persisted to the `agent_talks` SQLite table and injected as context into the next agent's prompt.
- Why here: TBD
- Gotcha (from code): The `talk` key is stripped from `output_structured` before storage to avoid double-persistence; staleness threshold is 1 hour (`STALENESS_SECS`). (`apps/desktop/src-tauri/src/talk.rs:5–10`, `db/schema.rs:589`)
- Source: TBD

## Rust trait-based adapter pattern
- What: A `trait` defines a shared contract (like a TypeScript interface); concrete structs implement it.
- Why here: TBD
- Gotcha (from code): `SessionSourceAdapter` is implemented by `ClaudeCodeAdapter`, `CodexAdapter`, and `CursorAdapter` — each parses a different agent's JSONL/JSON session format. (`apps/desktop/src-tauri/src/commands/session_adapters.rs:43–542`)
- Source: https://doc.rust-lang.org/book/ch10-02-traits.html

## rusqlite / SQLite in Rust
- What: Rust bindings to SQLite; the `bundled` feature compiles SQLite into the binary.
- Why here: TBD
- Gotcha (from code): `bundled` feature adds ~2 MB and noticeably slows cold Rust builds; avoids macOS system-SQLite version mismatch errors. (`apps/desktop/src-tauri/Cargo.toml:15`)
- Source: https://docs.rs/rusqlite/latest/rusqlite/

## OpenAI-compatible chat completions API
- What: The `/v1/chat/completions` HTTP shape that Anthropic, OpenAI, and OpenRouter all expose.
- Why here: TBD
- Gotcha (from code): Provider presets all use a `/v1` base URL — `PROVIDER_PRESETS` maps provider names to `baseUrl` + `model`; the Anthropic preset points at `api.anthropic.com/v1`, which accepts the OpenAI shape. (`apps/desktop/src/lib/review-service.ts:112–128`)
- Source: https://platform.openai.com/docs/api-reference/chat

## Tauri auto-updater (`tauri-plugin-updater`)
- What: Plugin that checks GitHub Releases for a `latest.json` manifest and applies delta updates.
- Why here: TBD
- Gotcha (from code): `tauri-action` repackages the `.app` tarball after signing, making the bundled `.sig` stale — the release workflow re-signs the final tarball and uploads `.sig` + `latest.json` explicitly. (`.github/workflows/release.yml:78–103`)
- Source: https://v2.tauri.app/plugin/updater/

## PostHog analytics from a desktop binary
- What: Product analytics via direct HTTP POST to PostHog's ingestion endpoint, with no server intermediary.
- Why here: TBD
- Gotcha (from code): The hardcoded `POSTHOG_KEY` and `POSTHOG_HOST` sit in a client-side TS file — the key is public by design (PostHog's browser SDK model), but the project slug is visible in source. (`apps/desktop/src/lib/analytics.ts:25–61`)
- Source: https://posthog.com/docs/libraries/js

## npm workspaces (monorepo)
- What: Node's built-in multi-package monorepo support via `workspaces` in `package.json`.
- Why here: TBD
- Gotcha (from code): A stale `pnpm-lock.yaml` coexisted with `package-lock.json`; Cloudflare Pages picked up the pnpm lockfile and failed because it was out of sync. (`pnpm-lock.yaml` still exists at repo root alongside `package-lock.json`)
- Source: https://docs.npmjs.com/cli/using-npm/workspaces

## Cloudflare Pages deployment
- What: Static-site and SSR hosting on Cloudflare's edge network, triggered by git push.
- Why here: TBD
- Gotcha (from code): `root_dir` was set to `apps/desktop` instead of `apps/landing-page` — CF Pages silently built the wrong target; Vite outputs to `out/` not `dist/`, so the destination dir config must match. (`apps/landing-page-astro/wrangler.toml`)
- Source: https://developers.cloudflare.com/pages/

## Rust (systems language basics)
- What: Memory-safe compiled language without a GC; used here for the Tauri backend.
- Why here: TBD
- Source: https://doc.rust-lang.org/book/

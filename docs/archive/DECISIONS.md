# Architecture Decision Records — CodeVetter

Canonical home for key architectural choices. Each entry answers: what was decided, why, and what was traded away.

---

## ADR-001 — Tauri 2 (Rust) over Electron

**Date:** 2025-11-30 (project init)

**Context:** The product is a desktop code review workbench. Target users already have large codebases on their machines. The app must shell out to CLI agents (`claude -p`, `gemini -p`), read local git history, run Playwright, and stay offline. Binary size and memory footprint matter because the app sits alongside heavy tools like VS Code.

**Decision:** Tauri 2 with a Rust backend and React/Vite webview frontend.

**Rationale:**
- Rust backend can shell out to `git`, `claude`, `gemini`, `playwright` with process-level control unavailable in a browser renderer.
- Tauri 2 ships a native macOS binary (~7–15 MB) vs Electron's ~100 MB+ bundled Chromium.
- Rust `rusqlite` (bundled feature) gives direct SQLite without IPC overhead for DB-heavy operations.
- Auto-updater (`tauri-plugin-updater`) integrates with GitHub Releases — fits the solo-dev release cadence.

**Alternatives considered:** Electron (rejected: binary size, memory), pure web app (rejected: needs local FS + process spawning), native Swift (rejected: TypeScript/React skill set).

**Tradeoffs:** Rust changes require a full rebuild (no hot-reload for backend); macOS-only initially; Tauri's macOS GUI launch does not inherit the user's shell `PATH` — worked around by `resolve_cli_path()` in `commands/review.rs` that walks known install locations.

---

## ADR-002 — Local-first SQLite, no server for the core product

**Date:** 2026-02-21 (v1 architecture lock)

**Context:** Review history, session indexes, QA run results, and findings need to persist across app restarts. The primary user is a solo developer reviewing their own agent output — no team sync is needed for the MVP.

**Decision:** All desktop-app state persists to a local SQLite database via `@tauri-apps/plugin-sql` and `rusqlite`. No cloud DB for the core review flow.

**Rationale:**
- Zero latency for queries; works fully offline.
- No auth layer needed for local data — the LLM API keys stored in user settings are already the only external credential.
- Sensitive diffs and findings never leave the machine.
- Cloudflare D1 + Workers exist in the codebase for a future GitHub App webhook path, but those are explicitly "not the active focus" (see `PROJECT-LOG.md §4`).

**Alternatives considered:** Cloudflare D1 everywhere (rejected: requires a backend for every review; adds auth complexity and network dependency); PGlite in the browser (rejected: harder to query from Rust commands; no process-level access).

**Tradeoffs:** No cross-device sync; team features blocked until a sync layer is added; migrations must be managed carefully since users hold the only copy of their data.

---

## ADR-003 — Multi-LLM provider abstraction: OpenAI-compatible HTTP + standards packs

**Date:** 2026-02-15 (v0 gateway review)

**Context:** The review prompt must be sent to Anthropic, OpenAI, or OpenRouter. Each has slightly different APIs. The user supplies their own keys (BYOK) — there is no CodeVetter-managed inference.

**Decision:** `AIGatewayClient` (`packages/ai-gateway-client`) is a thin wrapper around the OpenAI-compatible chat completions endpoint. All three supported providers (Anthropic via the OpenAI-compat layer, OpenAI, OpenRouter) are targeted through this single HTTP shape. Review rules are expressed as "standards packs" — named collections of checks injected into the prompt — rather than as provider-specific tooling.

**Rationale:**
- OpenAI-compatible `/v1/chat/completions` is the de-facto standard; Anthropic exposes it via OpenRouter and their own SDK proxy.
- A single HTTP client means swapping providers is a config change, not a code change.
- Standards packs (`product-safety`, `security-boundary`, `agent-handoff`) compose into specialist reviewer passes without requiring separate model calls per provider.

**Alternatives considered:** Provider-native SDKs per vendor (rejected: fan-out code duplication; harder to add new providers); self-hosted model via Ollama (TBD: on the roadmap as a free-ai path, not yet implemented).

**Tradeoffs:** Loses provider-specific features (e.g., Anthropic extended thinking, function-calling tooling); the OpenAI compat layer for Anthropic sometimes lags behind native SDK features.

---

## ADR-004 — CLI-agent review execution (plan-subscription BYOK)

**Date:** 2026-02-22 (post-v0)

**Context:** The original v0 called LLM APIs directly (BYOK with paid API keys). Most target users are on Claude Max, Gemini Advanced, or Cursor Pro — they already pay for plan-level subscriptions and want those to cover review, not an additional API bill.

**Decision:** The active review path shells out to `claude -p` or `gemini -p` (the user's installed CLI agents) rather than calling provider APIs directly. The API-based path still exists in `packages/ai-gateway-client` but is secondary.

**Rationale:**
- Zero additional API cost for users on plan subscriptions.
- CLI agents have richer context injection than a raw API call — they can read files, use tools, and apply CLAUDE.md conventions.
- Matches where the user's code already is: local machine, local agent.

**Alternatives considered:** Keeping only the API-based path (rejected: cost objection from target users); embedding a model locally via Ollama (deferred — noted in `IDEA-DUMP.md` as a future free-ai path).

**Tradeoffs:** Review quality depends on the user's CLI agent version and plan tier; output format is less structured than a JSON-returning API call — requires robust parsing; `resolve_cli_path()` in Rust is needed because GUI-launched Tauri apps don't inherit shell `PATH`.

---

## ADR-005 — Agent session replay: normalized adapter model

**Date:** 2026-06-12 (unified production adapters)

**Context:** Users run Claude Code, Codex, and Cursor locally. Their session transcripts (JSONL files in `~/.claude/`, `~/.codex/`, `~/.cursor/`) are the ground truth for what an agent actually did. CodeVetter's History feature and the Review intent-timeline both need to surface commands, tool calls, and outputs from these heterogeneous formats.

**Decision:** A `SessionSourceAdapter` trait (`session_adapters.rs`) defines a single `parse_raw(source_ref, raw) -> RawSessionAdapterSummary` contract. Concrete adapters (`ClaudeCodeAdapter`, `CodexAdapter`, `CursorAdapter`) each normalize their JSONL format into the shared struct. The history indexer (`history.rs`) is the only consumer; it drives all adapters through the same loop and writes to the same SQLite tables.

**Rationale:**
- A single normalized schema (`RawSessionArchiveMessage`) lets the Review timeline query across all agent sources uniformly.
- New agent sources (e.g., Gemini CLI, when transcript support lands) only require a new adapter, not changes to history indexing or the UI.
- Keeping adapters pure parsers (no I/O, no DB calls) makes them testable in isolation via fixture JSONL files.

**Alternatives considered:** Per-adapter DB tables (rejected: makes cross-source queries expensive); parsing at query time (rejected: too slow for search across thousands of sessions).

**Tradeoffs:** Normalized schema loses fidelity for provider-specific fields; the `parse_warnings` field on `RawSessionAdapterSummary` surfaces cases where a format has drifted from what the adapter expects — currently logged but not surfaced to users.

---

## ADR-006 — Synthetic QA strategy: orchestration + evidence normalization, not a new browser testing framework

**Date:** 2026-06-12 (synthetic QA v1)

**Context:** Static diff review asks "does this look suspicious?" — it can't answer "did the change break a real user workflow?" CodeVetter needs a runtime proof layer that attaches artifacts to findings.

**Decision:** CodeVetter orchestrates existing runners (built-in Playwright loops, repo-local Playwright specs, future Claude skill runner) and normalizes their output into a shared `SyntheticQaRunResult` contract (`synthetic_qa.rs`). CodeVetter owns the run record and artifact paths; it does not own the browser execution engine.

**Rationale:**
- Most reviewed repos already have Playwright specs — `repo_playwright` runner runs them and maps pass/fail + artifacts into the common contract.
- A single result shape means the Review panel can attach QA evidence to any finding regardless of which runner produced it.
- Keeps CodeVetter's surface area small: add a new runner type, not a new testing framework.

**Alternatives considered:** Building a first-party browser automation engine (rejected: Playwright and Stagehand already exist; CodeVetter's value is the evidence layer on top); requiring repo-specific spec annotations (rejected: too much onboarding friction).

**Tradeoffs:** QA pass/fail is only as reliable as the runner and spec — flaky tests produce misleading evidence; Gemini CLI sessions produce no transcripts yet, so Gemini-driven QA steps can't be replayed.

---

## ADR-007 — Monorepo layout: `packages/` boundary enforces deployment-target isolation

**Date:** 2026-02-21 (v1 scaffold)

**Context:** The codebase serves three deployment targets: Tauri desktop (macOS binary), Cloudflare Workers (edge, no Node), and a landing page (static Next.js). Shared logic must work in all three.

**Decision:** `packages/` contains only pure TypeScript with no runtime assumptions (`review-core`, `ai-gateway-client`, `shared-types`, `db`). `apps/desktop` is the only workspace allowed to import Tauri APIs; `workers/` is the only workspace allowed to import Cloudflare primitives. The workspace package manager is npm workspaces (not Turborepo/Nx).

**Rationale:** Prevents accidental coupling between desktop-only (`invoke()`, `fs`) and edge-only (`D1`, `KV`) APIs at the TypeScript level. Stated explicitly in `ARCHITECTURE.md §Directory Structure Rationale`.

**Alternatives considered:** Turborepo (TBD: adds complexity not justified for the current team size); Nx (rejected: heavy).

**Tradeoffs:** No incremental build caching — `npm run build:packages` always rebuilds all four packages in order; dead `@code-reviewer/*` workspace references needed manual cleanup when `packages/` diverged from the architecture doc (fixed per `agents.md`).

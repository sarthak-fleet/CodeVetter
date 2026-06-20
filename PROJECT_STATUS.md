# CodeVetter — PROJECT STATUS
Last updated: 2026-06-20

## Why / What

**CodeVetter** is a local-first desktop workbench for verifying agent-generated code. Product thesis: evidence-backed loops that answer "what changed, why, what could break, can we reproduce it, did the fix work?" — not generic IDE replacement.

**Users:** Developers reviewing agent-written diffs; fleet operators curating catch-rate benchmarks; solo builders needing synthetic QA and session intelligence.

**Constraints:** Near-term focus is benchmark curation (20–30 real public agent PRs) and closing evidence gaps before external catch-rate claims. macOS desktop not Developer ID signed/notarized — recommend app archive over DMG.

**IN scope:** Tauri 2 desktop (`apps/desktop/`), Astro landing (`apps/landing-page-astro/`), catch-rate harness (`benchmarks/agent-prs/`).

**OUT of scope:** Marketplace, hosted multi-tenant collaboration, CI enforcement, generic browser testing for every app type, broad IDE replacement.

## Dependencies

### External

- **AI providers:** Anthropic, OpenAI, OpenRouter — user-supplied keys stored in desktop Settings.
- **GitHub:** PR creation/merge, CI checks, T-Rex PR watcher.
- **Linear:** auth integration in Settings.
- **Cloudflare Pages:** landing deploy via `CLOUDFLARE_API_TOKEN`.
- **Tauri updater:** GitHub Releases `latest.json`, signing via `TAURI_SIGNING_PRIVATE_KEY`.
- **Optional:** `ast-grep` (PATH detection), `chromiumoxide` (`browser-agent` feature for live browser agent).

### Internal (fleet)

- **SaaS Maker:** sign-in polling, task list/update, finding push, fleet project linking; fleet rollup, weekly markdown, changelog push.
- **Fleet repos:** cross-fleet rollup via linked repos (`/fleet` route).

### Stack & commands

**Stack:** Tauri 2 + React 19 + Vite + Tailwind/shadcn (desktop); Rust backend with optional `chromiumoxide` (`browser-agent` feature); local SQLite (`@tauri-apps/plugin-sql`); Astro 5 landing (Cloudflare Pages). npm workspaces.

| Command | Location | Purpose |
|---------|----------|---------|
| `npm install` | root | Workspace install |
| `npm run tauri:dev` | `apps/desktop` | Desktop dev (port 1420) |
| `npm run tauri:build` | `apps/desktop` | Production desktop binary |
| `npm test` | `apps/desktop` | Playwright e2e |
| `npm run test:unit` | `apps/desktop` | Node unit tests |
| `npm run test:review-proof` | `apps/desktop` | Review proof tests |
| `npm run test:synthetic-qa` | `apps/desktop` | Synthetic QA tests |
| `npm run test:intent-debugger` | `apps/desktop` | Intent debugger tests |
| `npm run bench:catch-rate` | root | Catch-rate benchmark harness |
| `npm run bench:curation` | root | Benchmark curation report |
| `npm run bench:new-case` | root | Scaffold benchmark case |
| `npm run build` | `apps/landing-page-astro` | Static landing build |

## Timeline

- **2026-06-20** — PRD batch shipped: Evidence Pattern Search, Agent Verification Timeline, Review Memory Graph, Codebase History Explainer, Synthetic User QA, AI Session Intelligence.
- **2026-06-20** — Rust/Tauri backend cleanup: feature-gated `chromiumoxide`; pruned dead crates/deps; parallelized review paths.
- **Earlier** — Landing migrated to Astro (`apps/landing-page-astro/`); legacy Next.js landing superseded (not deployed).
- **Ongoing** — `weekly.yml` Mondays 09:00 UTC best-effort lint/typecheck/test/build; `auto-release.yml` + `release.yml` macOS aarch64 builds with signed updater.

## Products

- **Desktop app:** GitHub Releases — Tauri 2 macOS aarch64 binary with auto-updater (`latest.json`); dev port 1420.
- **Landing (Pages):** https://codevetter.com — Cloudflare Pages project `codevetter`; routes `/`, `/download`, `/privacy`, `/terms`, `/benchmark`.
- **Benchmark harness:** `benchmarks/agent-prs/` + `scripts/run-catch-rate-benchmark.mjs` (root workspace).
- **Legacy (not deployed):** `apps/landing-page/` (Next.js) superseded by Astro.

## Features (shipped)

### Desktop routes (`apps/desktop/src/App.tsx`, React Router v7)

- `/` Home — usage dashboard (Today/Week/Month/Year token stats, provider accounts, agent breakdown, session adapter health, AI session scorecard panels).
- `/review` QuickReview — primary workbench: diff review, CLI agents, findings, evidence, timeline, fix worktrees, synthetic QA, blast radius, sandbox, hunk nav `[`/`]`, revert files/hunks, proof export.
- `/roadmap` — Verification Workbench launcher, AI Session Intelligence panels, SaaS Maker tasks.
- `/rubrics` — review standards packs.
- `/unpack` RepoUnpacked — repo inventory scan, system brief, `repo_graph`, history brief, QA readiness, graph JSON import/export.
- `/intel` — commit attribution, DORA metrics, AI acceleration, tool breakdown, pricing table.
- `/fleet` — cross-fleet rollup, linked repos, weekly markdown, changelog push.
- `/trex` — T-Rex v2 PR watcher (start/stop, poll, PR run history, APPROVE/NEEDS_REVIEW/BLOCK).
- `/ops` — billing config, agent observability, webhook notifications.
- `/agent-memories` — browse local agent memory sources (AGENTS.md, rules).
- `/intent-debugger` — commit intent analysis (real commits or fixtures).
- `/qa-replay` — synthetic QA fixture replay + live agent runner.
- `/settings` — AI providers, GitHub/Linear auth, SaaS Maker, review preferences.
- Cmd+K command palette; `g`+key nav; onboarding gate; tray monitor; auto-updater.

### Tauri commands (107 registered in `main.rs`)

- Review: `get_local_diff`, `save_review`, `get_review`, `list_reviews`, `run_cli_review`, `fix_findings`, `merge_fix`, `discard_fix`, `revert_files`, `revert_diff_hunk`.
- Evidence: `record_review_procedure_event`, `list_review_procedure_events`, `suggest_review_verification_commands`, `run_review_verification_command`, `cancel_review_verification_command`, `analyze_blast_radius`.
- Sessions: `list_sessions`, `list_session_message_archive`, `search_session_message_archive`, `get_ai_session_scorecard`, `list_ai_session_adapter_runs`.
- Repo Unpacked: `scan_repo_inventory`, `generate_unpack_report`, `list/get/delete/export_repo_unpack_report`, `import_repo_graph_json`.
- Synthetic QA: `run_synthetic_qa`, `discover_playwright_specs`, `record_synthetic_qa_run`, `list_synthetic_qa_runs`.
- Intent/history: `list_commit_intents`, `get_repo_history_context`, `read_raw_session_context`, `list_git_branches`, `get_git_remote_info`.
- GitHub PR/CI: `create_pull_request`, `list/get/merge_pull_request`, `list_ci_checks`, `rerun_failed_checks`.
- SaaS Maker: sign-in polling, task list/update, finding push, fleet project linking.
- Fleet: `list_linked_repos`, `get_fleet_rollup`, `generate_weekly_fleet_markdown`, `push_changelog_entry`.
- T-Rex: `start/stop_trex_watcher`, `list_trex_watchers`, `list_trex_pr_runs`, `force_poll_trex_watcher`.
- Providers: account CRUD, usage checks, ledger.
- `agent_run_task` — live browser agent (feature-gated `browser-agent`).

### Code review & bug finding

- Risk-tiered specialist review: trivial single pass, lite product/agent passes, full sensitive reviews (security/product/agent + coordinator dedupe).
- Findings with severity, code viewer, re-review loop.
- Verification summary handoff proof: fixed/reproduced/unchecked tallies, copyable reviewer handoff template.
- Unchecked-finding risk summary grouped by severity.
- Revalidation checklist after fixes (derived from evidence fields, persists per finding).
- Agent Verification Environment: isolated git worktrees, structured fix packets, status timeline.

### Evidence Pattern Search (PRD shipped 2026-06-20)

- Deterministic `generate_evidence_candidates` from changed files, sensitive paths, blast/history, optional `ast-grep`.
- Ranked packets injected into CLI review prompts.
- Procedure gates + verification command suggestions; cancelable timeout-bounded execution with log artifacts.
- Sidebar panel + copied proof; benchmark `--evidence-comparison=with:without` mode.

### Agent Verification Timeline (PRD shipped 2026-06-20)

- Normalized spine: task, review, QA, evidence, fix, worktree via `buildVerificationTimeline`.
- Review sidebar timeline with jump targets; claim-check row (failed/stale commands, scope drift).
- Command anchors + replay packets from raw session context.
- Segment-scoped fix packets; post-fix QA before/after deltas.

### Review Memory Graph (PRD shipped 2026-06-20)

- `repo_graph` artifact in Repo Unpacked (files, routes, Tauri commands, DB tables, tests, decisions).
- Review-scoped `review_memory_graph` in CLI results + prompt neighborhood section.
- Sidebar graph panel + proof export; Hunk-style agent-context notes; `[`/`]` hunk navigation.
- Explicit JSON import via Repo Unpacked.

### Codebase History Explainer (PRD shipped 2026-06-20)

- `history_brief` in Repo Unpacked (commits, `WHY:`/`DECISION:`/`TRADEOFF:` markers, test hints).
- File-level cited explanations in Review sidebar + copied proof.
- `queryCodebaseHistoryExplanationForFile` hook; deterministic `buildCodebaseHistoryExplanations`.
- Command evidence rows: `passed`/`failed`/`stale`/`unknown`.

### Synthetic User QA (PRD shipped 2026-06-20)

- Runners: built-in Playwright, repo-local Playwright specs, external skill command (shared evidence JSON).
- Repo-scoped named workflows, route/goal matrices, Playwright storage-state auth, remote opt-in.
- `synthetic_qa_runs` SQLite records; `qa_evidence` in review prompts.
- Auto same-flow QA rerun after successful fix + comparison (fixed/still broken/regressed/still passing).
- Repo Unpacked `qa_readiness` score; `/qa-replay` fixture loops.

### AI Session Intelligence (PRD shipped 2026-06-20)

- Six-dimension scorecard: session_hygiene, verification_quality, scope_control, repo_guidance, testability, evidence_quality.
- Adapters: Claude Code, Codex, Cursor (+ Grok indexing).
- FTS5 `session_message_archive`; 10s transcript tail watcher re-indexing active JSONL.
- Roadmap dashboard panels (scorecard, adapter health, archive search).

### Intent debugging

- `/intent-debugger` + CLI `intent-debugger` over real recent commits — intent, risks, verification gaps, agent-vs-human authorship.
- Review sidebar shows intent-level verification gaps + compact timeline.

### Benchmarks & OSS evaluation

- Catch-rate harness: `benchmarks/agent-prs/` + `scripts/run-catch-rate-benchmark.mjs`.
- Per-case fixtures, strict validation, comparator slots (codevetter, codevetter_no_evidence, baseline).
- Metrics: catch rate, precision, F1, false positives, severity gates, evidence-comparison mode.
- Sample placeholder cases only; curation helpers `bench:new-case`, `bench:curation`.
- OSS repo-analysis evaluation documented; optional `ast-grep` behind PATH detection.

### SQLite schema (28 tables + FTS5)

- Core: `cc_projects`, `cc_sessions`, `cc_session_days`, `session_adapter_runs`, `session_message_archive`, `session_message_archive_fts`.
- Reviews: `local_reviews`, `local_review_findings`, `review_procedure_events`, `synthetic_qa_runs`.
- Mission control: `agent_processes`, `agent_tasks`, `activity_log`, `agent_messages`, `agent_cost_log`, `agent_presets`.
- Providers: `provider_accounts`, `provider_usage_ledger`.
- Fleet: `saas_maker_sync`, `repo_project_mapping`, `repo_unpacked_reports`.
- T-Rex: `trex_watchers`, `trex_pr_runs`.
- App: `preferences`, `workspaces`, `chat_tabs`, `diff_comments`, `agent_talks`.

### Landing page (`apps/landing-page-astro/`)

- Routes: `/`, `/download`, `/privacy`, `/terms`, `/benchmark`.
- Deployed to Cloudflare Pages project `codevetter` via `deploy-landing.yml`.
- Sections: Hero, CatchStrip, Stats, Bento, HowItWorks, Providers, Pricing, CTA.

### CI/CD

- `ci.yml`: ESLint + tsc + unit tests on push/PR.
- `auto-release.yml` + `release.yml`: version bump → GitHub Release → macOS aarch64 Tauri build with `browser-agent`, signed updater.
- `deploy-landing.yml`: Astro build + CF Pages deploy + smoke curl.
- `weekly.yml`: best-effort lint/typecheck/test/build.

### Tests

- TS unit: 9 files (review-proof, agent-fix-packet, synthetic-qa, intent-debugger, etc.).
- Playwright e2e: 11 spec files (smoke, review, evidence, settings, intel, fleet, ops, sandbox).
- Rust: ~217 `#[test]` fns across git, history, saas_maker, unpack, evidence_pattern, etc.
- Root: `test:benchmark` for harness self-tests.

## Todo / Planned / Deferred / Blocked

### Planned

1. Curate 20–30 real public agent-generated PR benchmark cases in `benchmarks/agent-prs/cases/` with hand-labeled ground truth.
2. Add benchmark fields for unverified-fix count and time/cost impact in `scripts/run-catch-rate-benchmark.mjs`.
3. Full non-command conversation reconstruction around raw command events (`read_raw_session_context` expansion).
4. Curate CodeRabbit free-tier and Claude Code `/review` outputs into named comparator slots.
5. Turn persisted `history_brief` into queryable local history graph API (`apps/desktop/src/lib/review-proof.ts`).
6. Richer screenshot/report previews once local preview security model is explicit.
7. Continue AI Session Intelligence phases: usage/stats JSON contracts, repo readiness report, team packaging research.
8. Add Playwright e2e to `ci.yml`; remove stale `/personas` and `/ask` e2e specs.

### Deferred

- Broad IDE replacement — stay focused on verification and review.
- Generic synthetic browser testing for every app type — deferred until supported local-app matrix is explicit.
- Marketplace, hosted multi-tenant collaboration, CI enforcement — deferred behind stronger local evidence loop.
- PRD deferred slices: full conversation reconstruction; queryable history graph API; flaky-step labeling; team packaging.

### Blocked

- Catch-rate claims blocked on real fixture curation (currently 3 placeholder cases in `sample.json`).
- Screenshot/report inline previews limited to bounded text previews for log/json/html artifacts.
- macOS desktop bundle not Developer ID signed/notarized.
- Playwright e2e and Rust tests not in `ci.yml` (unit tests only).

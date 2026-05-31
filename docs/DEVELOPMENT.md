<!-- generated-by: gsd-doc-writer -->
# Development Guide

## Local Setup

### Prerequisites

- **Node.js 22** (matches CI) — managed via `asdf` or direct install
- **Rust + Cargo** (stable) — required for the Tauri desktop app; see [Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)
- **npm** — used as the workspace package manager (not pnpm/yarn)

### Clone and install

```bash
git clone https://github.com/sarthak-fleet/CodeVetter.git
cd CodeVetter
npm install
```

### Copy environment files

```bash
# Root — Cloudflare Workers secrets and AI gateway config
cp .env.example .env

# Dashboard app
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

Fill in at minimum `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_API_KEY` if you plan to run reviews locally. All other variables have safe defaults or degrade gracefully when absent. See [docs/CONFIGURATION.md](./CONFIGURATION.md) for the full reference.

### Build shared packages before starting any dev server

Workspace packages compile to `dist/` and must be built before any app or worker can import them:

```bash
npm run build:packages
```

This runs `build:types` → `build:db` → `build:gateway` → `build:review-core` in order (dependencies respected).

### Start the desktop app in dev mode

```bash
cd apps/desktop
npm run tauri:dev
```

Tauri opens a native window backed by the Vite dev server on port `1420`. Hot-reload works for the React frontend; Rust changes require a full rebuild.

### Start web apps in dev mode

```bash
# Landing page (Next.js, default port)
cd apps/landing-page && npm run dev

# Dashboard (Next.js, port 4174)
cd apps/dashboard && npm run dev
```

### Start Cloudflare Workers locally

```bash
cd workers/api   && npm run dev   # wrangler dev
cd workers/review && npm run dev  # wrangler dev
```

---

## Build Commands

### Root workspace

| Command | Description |
|---|---|
| `npm run build:types` | Compile `packages/shared-types` to `dist/` |
| `npm run build:db` | Compile `packages/db` to `dist/` |
| `npm run build:gateway` | Compile `packages/ai-gateway-client` to `dist/` |
| `npm run build:review-core` | Compile `packages/review-core` to `dist/` |
| `npm run build:packages` | Run all four package builds in dependency order |
| `npm run deploy:api` | Deploy `workers/api` to Cloudflare via Wrangler |
| `npm run deploy:review` | Deploy `workers/review` to Cloudflare via Wrangler |
| `npm run prepare` | Install Husky git hooks (runs automatically after `npm install`) |

### `apps/desktop`

| Command | Description |
|---|---|
| `npm run dev` | Kill any process on port 1420, then start Vite dev server |
| `npm run build` | Build shared types, then compile the Vite frontend to `out/` |
| `npm run preview` | Preview the Vite production build |
| `npm run tauri` | Run Tauri CLI directly |
| `npm run tauri:dev` | Start Tauri in dev mode (Rust + Vite hot-reload) |
| `npm run tauri:build` | Build the signed Tauri desktop bundle for distribution |
| `npm run test` / `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run test:e2e:ui` | Run Playwright tests with the interactive UI |
| `npm run test:e2e:tauri` | Run the Tauri-specific e2e spec via tsx |
| `npm run lint` | ESLint over `src/` (`.ts`, `.tsx`), quiet mode |

### `apps/dashboard`

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server on port 4174 |
| `npm run build` | Build shared types, then run `next build` |
| `npm run start` | Start the Next.js production server on port 4174 |

### `apps/landing-page`

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server (default port 3000) |
| `npm run build` | Run `next build` |
| `npm run start` | Start the Next.js production server |

### `packages/*` (shared libraries)

| Command | Scope | Description |
|---|---|---|
| `npm run build` | All packages | Compile TypeScript to `dist/` via `tsc` |
| `npm run test` | `ai-gateway-client`, `db` | Run unit tests with Node's built-in test runner + tsx |

### `workers/api` and `workers/review`

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` via `tsc` |
| `npm run dev` | Run worker locally with `wrangler dev` |
| `npm run deploy` | Deploy worker to Cloudflare with `wrangler deploy` |

---

## Code Style

### ESLint

- **Tool:** ESLint 10 with `@typescript-eslint` plugin and parser
- **Config file:** `/eslint.config.js` (flat config format)
- **Applies to:** All `*.ts` and `*.tsx` files across the monorepo; ignores `node_modules/`, `dist/`, `out/`, `.next/`, `target/`, and all pre-compiled `.js`/`.mjs` files
- **Notable rules:** `no-unused-vars` (warn, args prefixed with `_` are exempt), `no-explicit-any` (warn), `no-console` (off)
- **Run command:** `npx eslint src/ --ext .ts,.tsx --quiet` (from any workspace, e.g. `apps/desktop`)

ESLint runs automatically on staged files via Husky + lint-staged before every commit (see [Git Hooks](#git-hooks) below).

### Prettier

No Prettier configuration is present in this repository. Formatting is not enforced by tooling.

### TypeScript

- **Baseline config:** `/tsconfig.json` — `target: es2020`, `strict: true`; covers `packages/` only
- Each workspace defines its own `tsconfig.json` that extends the root or sets independent compiler options

---

## Branch Conventions

No branch naming convention is formally documented in this repository (no `CONTRIBUTING.md` or PR template found).

The default and only long-lived branch is `main`. CI runs on pushes and pull requests targeting `main`.

Suggested patterns (informal):
- Feature work: `feature/<short-description>`
- Bug fixes: `fix/<short-description>`
- Hotfixes: `hotfix/<short-description>`

---

## PR Process

No `.github/PULL_REQUEST_TEMPLATE.md` is present. The following reflects the CI checks that every PR must pass:

- All TypeScript in `apps/desktop` must type-check cleanly (`tsc --noEmit`)
- ESLint must report no more than 50 warnings across `apps/desktop/src/`
- The Vite frontend build must succeed (`vite build`)
- Cargo check must pass on the Rust backend (`cargo check` in `apps/desktop/src-tauri`)
- Playwright tests must pass (Chromium)

Additionally, the pre-push hook (see below) runs `build:types`, ESLint, the Vite build, and the package unit tests locally before the push reaches CI.

---

## Monorepo Tooling

### Package manager and workspaces

The monorepo uses **npm workspaces** (no Turborepo or Nx). The workspace roots are declared in the root `package.json`:

```json
"workspaces": ["apps/*", "packages/*", "workers/*"]
```

All packages are installed into the root `node_modules/` with a single `npm install` at the repo root. Local packages are linked via `file:` protocol references in each workspace's `package.json` (e.g. `"@code-reviewer/shared-types": "file:../../packages/shared-types"`).

### Running a command in a specific workspace

```bash
npm run -w <workspace-name> <script>

# Examples
npm run -w packages/shared-types build
npm run -w apps/desktop lint
npm run -w workers/api dev
```

### Build order

Packages have a hard dependency order. Always build in this sequence when doing a clean build:

1. `packages/shared-types` — no internal deps
2. `packages/db` — depends on `shared-types`
3. `packages/ai-gateway-client` — depends on `shared-types`
4. `packages/review-core` — depends on `shared-types`

`npm run build:packages` at the root handles this automatically.

### Git Hooks

Husky is configured with two hooks:

- **pre-commit** (`/.husky/pre-commit`): Runs `lint-staged`, which applies ESLint to any staged `.ts`/`.tsx` files in `apps/desktop/src/`, `packages/*/src/`, and `workers/*/src/`.
- **pre-push** (`/.husky/pre-push`): Builds `shared-types`, runs ESLint on `apps/desktop/src/`, builds the Vite frontend, and runs unit tests in `packages/db` and `packages/ai-gateway-client`.

Hooks are installed automatically via the `prepare` script when you run `npm install`.

---

## Common Setup Issues

### 1. Rust/Tauri compilation fails on first `tauri:dev`

**Symptom:** `cargo build` errors mentioning missing system libraries, linker errors, or Xcode toolchain issues.

**Solution:** Make sure Xcode Command Line Tools are installed and up to date:

```bash
xcode-select --install
# If already installed, reset the path
sudo xcode-select --reset
```

Then verify Tauri prerequisites at [https://tauri.app/start/prerequisites/](https://tauri.app/start/prerequisites/). For Apple Silicon Macs the sidecar binary bundled in `apps/desktop/src-tauri/binaries/` is `aarch64-apple-darwin` — no additional steps are needed.

### 2. `npm run build:packages` fails with "Cannot find module"

**Symptom:** TypeScript errors referencing types from sibling packages during `build:packages`.

**Solution:** The packages must build in order (`shared-types` first, then `db` and `ai-gateway-client`, then `review-core`). The root `build:packages` script enforces this order. If you ran individual package build commands out of order, reset with:

```bash
npm run build:packages
```

If the error persists, delete compiled output and rebuild:

```bash
find packages -name dist -type d -exec rm -rf {} + 2>/dev/null; npm run build:packages
```

### 3. Missing environment variables cause worker startup failures

**Symptom:** `wrangler dev` throws validation errors such as `AI_GATEWAY_MODEL must not be empty` or `Invalid REVIEW_WORKER_POLL_MS`.

**Solution:** Copy `.env.example` to `.env` and populate required values. For local worker development the minimum required secrets are:

- `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_API_KEY` — without these, review jobs are skipped.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` — without these, OAuth routes throw at invocation.

Non-secret defaults (e.g. `AI_GATEWAY_MODEL`) are already set in each worker's `wrangler.toml` `[vars]` block and do not need to be in `.env`.

### 4. Port `1420` already in use

**Symptom:** Vite fails to bind with `EADDRINUSE: address already in use :::1420`.

**Solution:** The desktop `dev` script already kills any process on port `1420` before starting (`lsof -ti:1420 | xargs kill -9`). If the error persists, kill the process manually:

```bash
lsof -ti:1420 | xargs kill -9
```

Or override the port in `apps/desktop/vite.config.ts` (`server.strictPort` is `false`, so Vite will auto-increment to the next available port if the kill fails).

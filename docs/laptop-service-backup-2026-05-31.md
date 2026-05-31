# Laptop Service Backup - 2026-05-31

Branch: `backup/laptop-service-20260531`

Purpose: preserve local CodeVetter desktop work before the laptop goes in for service.

Included changes:

- `apps/desktop/src-tauri/src/commands/unpack.rs`
- `apps/desktop/src/lib/tauri-ipc.ts`
- `apps/desktop/src/pages/RepoUnpacked.tsx`

Observed scope:

- Repo unpacking flow changes in the Tauri command layer.
- IPC surface update for unpack-related desktop calls.
- `RepoUnpacked` page changes for the unpacked repository view.

Not included:

- No secrets or environment files.
- No deployment or release action.


# Releasing CodeVetter Desktop

## Prerequisites

1. Generate signing keys (one-time setup):
   ```bash
   tauri signer generate -w ~/.tauri/codevetter.key
   ```
   This creates `~/.tauri/codevetter.key` (private) and `~/.tauri/codevetter.key.pub` (public).

2. Add the **public key** to `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

3. Set environment variables before building:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/codevetter.key)
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"
   ```

## Steps

1. Bump the version in `src-tauri/tauri.conf.json` (the `version` field).

2. Build:
   ```bash
   npm run tauri:build
   ```

3. The build produces (in `src-tauri/target/release/bundle/`):
   - `CodeVetter_x.y.z_aarch64.dmg` — installer for manual download
   - `CodeVetter.app.tar.gz` — compressed app bundle for auto-update
   - `CodeVetter.app.tar.gz.sig` — signature file
   - `latest.json` — update manifest (contains version, download URL, signature)

4. Create a GitHub release at `sarthak-fleet/CodeVetter`:
   - Tag: `v{x.y.z}`
   - Upload all build artifacts including `latest.json`

5. Users with the desktop app installed receive an in-app notification automatically.

## How Auto-Update Works

- On launch (after 5s delay) and every 30 minutes, the app checks the `latest.json` endpoint.
- If a newer version is found, a banner appears: "Update available: vX.Y.Z [Install now] [Later]".
- "Install now" downloads the update, installs it, and relaunches the app.
- "Later" dismisses the banner for the current session.

## Notes

- The `pubkey` in `tauri.conf.json` must match the key pair used to sign builds. Without it, update verification will fail.
- The `TAURI_SIGNING_PRIVATE_KEY` env var is only needed at build time, never at runtime.
- Auto-update checks fail silently if the endpoint is unreachable or no update is available.

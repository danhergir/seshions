# Seshions

Terminal session orchestrator for running multiple coding agents in parallel.

## What It Does

- Launch and track multiple AI coding sessions in one dashboard
- Attach/detach quickly with keyboard-first controls
- Group sessions by workflow
- Optional git worktree isolation per session
- Persist session state across restarts via tmux
- Auto-import external tmux sessions (best-effort detection for Codex, Claude, and Gemini)

## Keyboard UX

- Footer is contextual: it always shows core keys (`Enter`, `r`, `q`, `Ctrl+K`) and adapts extra hints based on what is selected.
- `Ctrl+K` opens the Action Hub (command palette) for advanced actions.
- Pressing `d` opens a confirmation dialog before deleting a session or group.

## Updates

- `seshions` checks npm once per day and shows an upgrade hint when a newer version is available.
- Upgrade command: `npm install -g seshions@latest`
- Disable update checks with `SESHIONS_DISABLE_UPDATE_CHECK=1`

## Requirements

- Node.js 18+
- tmux
- At least one coding tool installed (`claude`, `codex`, `gemini`, `opencode`, or custom shell command)

## Install (One Command)

Run immediately (no global install):

```bash
npx seshions@latest
```

Install globally:

```bash
npm install -g seshions
seshions
```

The npm launcher downloads the matching native runtime automatically and caches it in `~/.seshions/runtime`.

## Auto-Wrap External Tool Launches

Enable one-time wrappers so running `codex`, `claude`, or `gemini` from your shell automatically creates a managed tmux session in Seshions:

```bash
seshions enable
```

Check status:

```bash
seshions status
```

Disable wrappers:

```bash
seshions disable
```

Wrappers are installed in `~/.local/bin` and call `seshions __wrap ...` internally.

## Local Development

```bash
bun install
bun run build
bun run typecheck
bun test
```

## Run

```bash
bun run dist/index.js
```

## Build Binary

```bash
bun run compile
```

## Install Script

Alternative manual installer:

```bash
export SESHIONS_REPO="danhergir/seshions"
curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/install.sh" | bash
```

## Uninstall

If installed with npm:

```bash
npm uninstall -g seshions
```

Remove cached runtime + state data:

```bash
rm -rf ~/.seshions
```

If installed with the manual installer:

```bash
export SESHIONS_REPO="danhergir/seshions"
curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/uninstall.sh" | bash
```

Optional full cleanup (manual installer):

```bash
curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/uninstall.sh" | bash -s -- --purge-data
```

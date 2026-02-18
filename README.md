# Seshions

Terminal session orchestrator for running multiple coding agents in parallel.

## What It Does

- Launch and track multiple AI coding sessions in one dashboard
- Attach/detach quickly with keyboard-first controls
- Group sessions by workflow
- Optional git worktree isolation per session
- Persist session state across restarts via tmux

## Requirements

- Bun
- tmux
- At least one coding tool installed (`claude`, `codex`, `gemini`, `opencode`, or custom shell command)

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

Set your repo first, then run installer:

```bash
export AGENT_VIEW_REPO="your-org/seshions"
curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/install.sh" | bash
```

## Uninstall

```bash
export AGENT_VIEW_REPO="your-org/seshions"
curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/uninstall.sh" | bash
```

Optional full cleanup:

```bash
curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/uninstall.sh" | bash -s -- --purge-data --purge-legacy-data
```

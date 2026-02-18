# Seshions

Terminal session orchestrator for running multiple coding agents in parallel.

## What It Does

- Launch and track multiple AI coding sessions in one dashboard
- Attach/detach quickly with keyboard-first controls
- Group sessions by workflow
- Optional git worktree isolation per session
- Persist session state across restarts via tmux

## Requirements

- tmux
- At least one coding tool installed (`claude`, `codex`, `gemini`, `opencode`, or custom shell command)

For local development:
- Node.js 20+
- npm

## Local Development

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Run

```bash
npm start
```

## Build Binary

```bash
npm run compile
```

## Install Script

```bash
curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/install.sh" | bash
```

## Homebrew (Recommended)

```bash
brew tap danhergir/tap
brew install --build-from-source danhergir/tap/seshions
```

Upgrade:

```bash
brew upgrade danhergir/tap/seshions
```

## Uninstall

```bash
curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/uninstall.sh" | bash
```

Optional full cleanup:

```bash
curl -fsSL "https://raw.githubusercontent.com/danhergir/seshions/main/uninstall.sh" | bash -s -- --purge-data
```

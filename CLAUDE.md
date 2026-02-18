# Seshions

Terminal interface for managing and monitoring AI coding agent sessions.

## Tech Stack

- **Runtime:** Node.js
- **UI:** Built-in terminal dashboard (readline)
- **Storage:** JSON file persistence
- **Session Management:** tmux

## Project Structure

```
src/
├── cli/           # CLI entry point
├── core/          # Core business logic
│   ├── git.ts     # Git/worktree utilities
│   ├── history.ts # History manager for autocomplete
│   ├── session.ts # Session lifecycle management
│   ├── storage.ts # JSON storage layer
│   ├── tmux.ts    # tmux session control
│   └── types.ts   # TypeScript types
└── ui/            # Interactive Node dashboard
    └── dashboard.ts
```

## Key Features

- **Session Management:** Create, stop, restart, delete AI agent sessions
- **Multiple Tools:** Claude Code, OpenCode, Gemini, Codex, Custom commands
- **Git Worktrees:** Create sessions in isolated git worktrees
- **Auto-suggestions:** Fuzzy search for previously used paths and branch names
- **Status Monitoring:** Real-time session status (running, waiting, idle, error)

## Installation

### Quick Install (Recommended)

```bash
export SESHIONS_REPO="danhergir/seshions"
curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/install.sh" | bash
```

This will:
- Download the latest release binary for your platform
- Install commands into `~/.seshions/bin`
- Create the `seshions` command

### Manual Install

```bash
git clone https://github.com/danhergir/seshions.git
cd seshions
npm install
npm run build
```

### Compile to Standalone Binary

```bash
npm run compile        # Package current platform
npm run compile:all    # Alias for compile (current platform only)
```

Binaries are output to the `bin/` directory.

### Uninstall

```bash
export SESHIONS_REPO="danhergir/seshions"
curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/uninstall.sh" | bash
```

To remove state/config/log data too:

```bash
curl -fsSL "https://raw.githubusercontent.com/${SESHIONS_REPO}/main/uninstall.sh" | bash -s -- --purge-data
```

## Compatibility Notes

- Primary command is `seshions`.

## Development

```bash
npm install      # Install dependencies
npm run dev      # Build and run locally
npm run build    # Build for production
npm run compile  # Package runtime bundle
npm test         # Run tests
```

## Important Files

- `src/ui/dashboard.ts` - Interactive terminal dashboard and command loop
- `src/core/session.ts` - Session creation and lifecycle
- `src/core/git.ts` - Git worktree operations

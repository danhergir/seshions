# Agent View

OpenTUI-based terminal interface for managing and monitoring AI coding agent sessions.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Solid.js
- **UI:** OpenTUI (terminal UI framework)
- **Storage:** SQLite (via bun:sqlite)
- **Session Management:** tmux

## Project Structure

```
src/
├── cli/           # CLI entry point
├── core/          # Core business logic
│   ├── git.ts     # Git/worktree utilities
│   ├── history.ts # History manager for autocomplete
│   ├── session.ts # Session lifecycle management
│   ├── storage.ts # SQLite storage layer
│   ├── tmux.ts    # tmux session control
│   └── types.ts   # TypeScript types
└── tui/           # Terminal UI
    ├── component/ # Reusable components (dialogs)
    ├── context/   # Solid.js contexts (theme, sync, routes)
    ├── routes/    # Page components (home, session)
    └── ui/        # Base UI components (dialog, toast, autocomplete)
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
export AGENT_VIEW_REPO="your-org/agent-view"
curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/install.sh" | bash
```

This will:
- Download the latest release binary for your platform
- Install commands into `~/.agent-view/bin`
- Create `agent-view` and `av` commands
- Create deprecated compatibility aliases (`agent-orchestrator`, `ao`) for one release

### Manual Install

```bash
git clone https://github.com/your-org/agent-view.git
cd agent-view
bun install
bun run build
```

### Compile to Standalone Binary

```bash
bun run compile        # Compile for current platform
bun run compile:all    # Compile for all platforms (darwin/linux, x64/arm64)
```

Binaries are output to the `bin/` directory.

### Uninstall

```bash
export AGENT_VIEW_REPO="your-org/agent-view"
curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/uninstall.sh" | bash
```

To remove state/config/log data too:

```bash
curl -fsSL "https://raw.githubusercontent.com/${AGENT_VIEW_REPO}/main/uninstall.sh" | bash -s -- --purge-data --purge-legacy-data
```

## Compatibility Notes

- Primary commands are `agent-view` and `av`.
- Legacy commands `agent-orchestrator` and `ao` are supported for one release.
- Legacy state in `~/.agent-orchestrator` is migrated to `~/.agent-view` on startup when possible.

## Development

```bash
bun install      # Install dependencies
bun run dev      # Run in development mode
bun run build    # Build for production
bun run compile  # Compile standalone binary
bun test         # Run tests
```

## Important Files

- `src/tui/component/dialog-new.tsx` - New session dialog with tool selection
- `src/tui/routes/home.tsx` - Main home screen with session list
- `src/core/session.ts` - Session creation and lifecycle
- `src/core/git.ts` - Git worktree operations

# Seshions

Open-source multi-agent orchestration for terminal coding workflows.

When you run multiple agents at once (Claude Code teams, Codex sessions, or mixed tools), tmux quickly becomes pane chaos. `seshions` gives you one control dashboard to launch, route, and supervise parallel agents without losing context.

## Demo

![Seshions demo](./assets/SeshionsDemo.gif)

## What It Does

- Run multiple coding agents in parallel from one dashboard
- Launch reusable blueprints to spin up role-based agent teams in one action
- Dispatch prompts to a single role or broadcast to a full group
- Track agent state (`running`, `waiting`, `idle`, `error`) at a glance
- Move through active panes quickly while attached (`Ctrl+G` next pane, `Ctrl+C` detach)
- Organize work by groups/workstreams
- Optional git worktree isolation per session
- Persist everything through tmux so sessions survive restarts

## Why People Use It

- You are coordinating 3+ agents and want one control loop instead of tab/pane hunting.
- You want reproducible multi-agent setups (blueprints) instead of manually spawning sessions.
- You need to route instructions by role/group fast while staying in terminal.

## Keyboard UX

- Footer is contextual: it always shows core keys (`Enter`, `r`, `q`, `/`) and adapts extra hints based on what is selected.
- `/` opens the Action Hub (command palette) for advanced actions.
- Action Hub includes orchestration commands: `Dispatch to role` and `Broadcast to group`.
- Pressing `d` opens a confirmation dialog before deleting a session or group.
- Press `b` to open Launch Blueprints.
- Inside attached tmux sessions: `Ctrl+G` moves to next pane, `Ctrl+C` detaches back to `seshions`.

## Updates

- `seshions` checks npm once per day for a newer version.
- If outdated, startup is blocked until updated (Codex-style behavior).
- You get a startup prompt: `Install now? (yes/no)`.
- If you answer `yes`, it runs: `npm install -g seshions@latest` and exits so you can relaunch.
- If you answer `no` (or update fails), the app exits.
- Upgrade command: `npm install -g seshions@latest`
- Disable update checks only if needed with `SESHIONS_DISABLE_UPDATE_CHECK=1`

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

## Launch Blueprints (Multi-Agent Spawn)

Create and launch a reusable multi-session template:

1. Open `seshions`
2. Press `b` (or `/` -> `Launch blueprints`)
3. Create blueprint:
   - Name
   - Group path
   - Worktree root path
   - Roles list (`planner,builder,debugger,reviewer,explorer`)
   - Tool + command template (`codex "You are the ${role} agent for this workspace. Stay in this role."`)
   - Note for Codex: `--agent` is not supported by Codex CLI
4. Select blueprint and launch all sessions at once

## Orchestration (From One Controller Session)

1. Open Action Hub with `/`
2. Choose `Dispatch to role` to send one prompt to a single target session
3. Or choose `Broadcast to group` to send one prompt to every active session in that group
4. Composer supports multi-line prompts (`Enter` adds newline, `Ctrl+Enter` sends)
5. Broadcast requires an explicit second `Ctrl+Enter` confirmation before sending

## Claude Code + Codex Workflows

`seshions` is designed for mixed-agent workflows and works well when you run Claude Code and Codex side-by-side in tmux-managed sessions. You can launch teams from blueprints and orchestrate them from one dashboard instead of manually managing each pane/session.

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

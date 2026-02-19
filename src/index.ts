/**
 * Seshions
 * OpenTUI-based multi-agent management
 */

import { getSessionManager } from "./core/session"
import { attachSessionSync } from "./core/tmux"
import type { Tool } from "./core/types"
import { disableAutoWrap, enableAutoWrap, getAutoWrapStatus } from "./core/autowrap"
import packageJson from "../package.json"

const WRAPPABLE_TOOLS = new Set<Tool>(["codex", "claude", "gemini"])

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

async function runWrapMode(args: string[]): Promise<void> {
  const toolArg = args[0]
  if (!toolArg || !WRAPPABLE_TOOLS.has(toolArg as Tool)) {
    console.error("Usage: seshions __wrap <codex|claude|gemini> -- [args...]")
    process.exit(1)
  }

  const separator = args.indexOf("--")
  const toolArgs = separator >= 0 ? args.slice(separator + 1) : args.slice(1)
  const commandParts = [toolArg, ...toolArgs]
  const command = commandParts.map(shellEscape).join(" ")

  const cwd = process.cwd()
  const baseName = cwd.split("/").filter(Boolean).at(-1) || "session"
  const title = `${toolArg}-${baseName}`.slice(0, 48)

  const sessionManager = getSessionManager()
  const session = await sessionManager.create({
    title,
    projectPath: cwd,
    groupPath: "my-sessions",
    tool: toolArg as Tool,
    command,
    wrapper: "autowrap"
  })

  if (!session.tmuxSession) {
    throw new Error("Failed to create tmux session")
  }

  attachSessionSync(session.tmuxSession)
}

async function runAutoWrapCommand(command: string, args: string[]): Promise<boolean> {
  if (command === "status") {
    const status = await getAutoWrapStatus()
    console.log(`Auto-wrap: ${status.enabled ? "enabled" : "disabled"}`)
    console.log(`PATH includes ~/.local/bin: ${status.pathConfigured ? "yes" : "no"}`)

    for (const tool of status.tools) {
      const mode = tool.activeManaged
        ? "active"
        : tool.managed
          ? "installed-not-active"
          : tool.wrapperExists
            ? "custom"
            : "missing"
      const target = tool.targetPath ? ` -> ${tool.targetPath}` : ""
      const activePath = tool.activePath ? ` (which: ${tool.activePath})` : ""
      console.log(`- ${tool.tool}: ${mode}${target}${activePath}`)
    }
    return true
  }

  if (command === "enable") {
    const attemptPathFix = !args.includes("--no-path-fix")
    const result = await enableAutoWrap({ attemptPathFix, markPromptSeen: true })

    if (result.installed.length > 0) {
      console.log(`Enabled: ${result.installed.join(", ")}`)
    } else {
      console.log("Enabled: none")
    }

    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.join(", ")}`)
    }

    for (const err of result.errors) {
      console.log(`Error: ${err}`)
    }

    if (result.pathFix.updated) {
      console.log(`PATH updated in: ${result.pathFix.profilePaths.join(", ")}`)
      console.log("Restart your shell before testing wrappers.")
    } else if (!result.pathFix.supported) {
      console.log(`Could not auto-update PATH for shell '${result.pathFix.shell}'. Add ~/.local/bin manually.`)
    }

    if (result.notActive.length > 0) {
      console.log(`Not active yet (PATH order): ${result.notActive.join(", ")}`)
      console.log("Run `which codex` / `which claude` / `which gemini` and ensure they resolve to ~/.local/bin.")
    }

    return true
  }

  if (command === "disable") {
    const result = await disableAutoWrap()
    if (result.removed.length > 0) {
      console.log(`Removed wrappers: ${result.removed.join(", ")}`)
    } else {
      console.log("Removed wrappers: none")
    }

    if (result.restored.length > 0) {
      console.log(`Restored previous commands: ${result.restored.join(", ")}`)
    }

    for (const err of result.errors) {
      console.log(`Error: ${err}`)
    }

    return true
  }

  return false
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || ""

  if (command === "__wrap") {
    await runWrapMode(args.slice(1))
    return
  }

  if (await runAutoWrapCommand(command, args.slice(1))) {
    return
  }

  // Simple CLI argument handling
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Seshions - Terminal Agent Management

Usage:
  seshions [options]
  seshions enable [--no-path-fix]
  seshions disable
  seshions status

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --light        Use light mode theme

Commands:
  enable         Install wrappers for codex/claude/gemini
  disable        Remove wrappers and restore previous commands
  status         Show auto-wrap status

Keyboard Shortcuts (in TUI):
  Enter          Attach selected session
  r              Rename selected session/group
  d              Delete selected (with confirmation)
  q              Detach / Back
  Ctrl+K         Action Hub
  n              Launch session
  g              Create group
  m              Move session to group
  p              Workspace profiles

Attached session:
  Ctrl+C         Detach from tmux session
`)
    process.exit(0)
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(packageJson.version)
    process.exit(0)
  }

  const mode = args.includes("--light") ? "light" : "dark"

  try {
    const { tui } = await import("./tui/app")
    await tui({
      mode,
      onExit: async () => {
        console.log("Goodbye!")
      }
    })
  } catch (error) {
    console.error("Fatal error:", error)
    process.exit(1)
  }
}

main()

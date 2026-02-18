/**
 * Seshions CLI entrypoint (Node runtime)
 */

import packageJson from "../package.json"
import { getSessionManager } from "./core/session"
import { getStorage } from "./core/storage"
import { attachSessionSync, isTmuxAvailable } from "./core/tmux"
import type { Session, Tool } from "./core/types"
import { runDashboard } from "./ui/dashboard"

const TOOL_VALUES: Tool[] = ["claude", "codex", "gemini", "opencode", "shell", "custom"]

function printHelp(): void {
  console.log(`
Seshions - Terminal Session Orchestrator

Usage:
  seshions [command] [options]

Commands:
  dashboard                    Open interactive dashboard (default)
  list                         List sessions
  new [--path DIR] [--tool TOOL] [--title TEXT] [--command CMD]
  attach <id|index>            Attach to a session
  stop <id|index>              Stop a session
  restart <id|index>           Restart a session
  delete <id|index>            Delete a session
  logs <id|index> [--lines N]  Show recent output

Options:
  --help, -h                   Show help
  --version, -v                Show version
`) 
}

function parseFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function sortedSessions(manager: ReturnType<typeof getSessionManager>): Session[] {
  return manager.list().sort((a, b) => a.order - b.order)
}

function resolveSession(manager: ReturnType<typeof getSessionManager>, token: string): Session | null {
  const sessions = sortedSessions(manager)
  const byId = sessions.find((session) => session.id === token)
  if (byId) return byId

  const index = Number.parseInt(token, 10)
  if (Number.isFinite(index) && index >= 1 && index <= sessions.length) {
    return sessions[index - 1] ?? null
  }

  return null
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

async function ensureTmux(): Promise<void> {
  const available = await isTmuxAvailable()
  if (!available) {
    throw new Error("tmux is not available. Install tmux first.")
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    printHelp()
    return
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(packageJson.version)
    return
  }

  await ensureTmux()

  const manager = getSessionManager()
  const command = args[0] ?? "dashboard"

  if (command === "dashboard") {
    await runDashboard()
    return
  }

  if (command === "list") {
    const sessions = sortedSessions(manager)
    if (sessions.length === 0) {
      console.log("No sessions")
      return
    }

    console.log("#  ID        STATUS    TOOL      TITLE")
    for (const [i, session] of sessions.entries()) {
      console.log(
        `${String(i + 1).padEnd(2, " ")} ${shortId(session.id).padEnd(8, " ")} ${session.status.padEnd(8, " ")} ${session.tool.padEnd(9, " ")} ${session.title}`
      )
    }
    return
  }

  if (command === "new") {
    const title = parseFlag(args, "--title")
    const projectPath = parseFlag(args, "--path") ?? process.cwd()
    const toolArg = (parseFlag(args, "--tool") ?? "claude").toLowerCase()
    const customCommand = parseFlag(args, "--command")

    if (!TOOL_VALUES.includes(toolArg as Tool)) {
      throw new Error(`Unsupported tool '${toolArg}'. Valid: ${TOOL_VALUES.join(", ")}`)
    }

    const session = await manager.create({
      title,
      projectPath,
      tool: toolArg as Tool,
      command: customCommand,
    })

    console.log(`Created session ${session.title} (${shortId(session.id)})`)
    return
  }

  if (command === "attach") {
    const token = args[1]
    if (!token) throw new Error("Usage: seshions attach <id|index>")

    const session = resolveSession(manager, token)
    if (!session?.tmuxSession) throw new Error("Session not found")

    attachSessionSync(session.tmuxSession)
    return
  }

  if (command === "stop") {
    const token = args[1]
    if (!token) throw new Error("Usage: seshions stop <id|index>")

    const session = resolveSession(manager, token)
    if (!session) throw new Error("Session not found")

    await manager.stop(session.id)
    console.log(`Stopped ${session.title}`)
    return
  }

  if (command === "restart") {
    const token = args[1]
    if (!token) throw new Error("Usage: seshions restart <id|index>")

    const session = resolveSession(manager, token)
    if (!session) throw new Error("Session not found")

    await manager.restart(session.id)
    console.log(`Restarted ${session.title}`)
    return
  }

  if (command === "delete") {
    const token = args[1]
    if (!token) throw new Error("Usage: seshions delete <id|index>")

    const session = resolveSession(manager, token)
    if (!session) throw new Error("Session not found")

    await manager.delete(session.id)
    console.log(`Deleted ${session.title}`)
    return
  }

  if (command === "logs") {
    const token = args[1]
    if (!token) throw new Error("Usage: seshions logs <id|index> [--lines N]")

    const session = resolveSession(manager, token)
    if (!session) throw new Error("Session not found")

    const linesRaw = parseFlag(args, "--lines")
    const lines = linesRaw ? Number.parseInt(linesRaw, 10) : 80
    const output = await manager.getOutput(session.id, Number.isFinite(lines) ? lines : 80)
    console.log(output)
    return
  }

  printHelp()
  throw new Error(`Unknown command '${command}'`)
}

main()
  .catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      getStorage().close()
    } catch {
      // Ignore shutdown errors.
    }
  })

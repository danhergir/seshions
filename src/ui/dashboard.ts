import readline from "readline/promises"
import { stdin as input, stdout as output } from "process"
import { getSessionManager } from "../core/session"
import { attachSessionSync } from "../core/tmux"
import type { Session, Tool } from "../core/types"
import { getStorage } from "../core/storage"

const TOOL_CHOICES: Tool[] = ["claude", "codex", "gemini", "opencode", "shell", "custom"]

function clearScreen(): void {
  output.write("\x1b[2J\x1b[H")
}

function resolveSession(manager: ReturnType<typeof getSessionManager>, token: string): Session | null {
  const sessions = manager.list().sort((a, b) => a.order - b.order)
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

function printTable(sessions: Session[]): void {
  if (sessions.length === 0) {
    console.log("No sessions yet.")
    return
  }

  console.log("#  ID        STATUS    TOOL      TITLE")
  for (const [i, session] of sessions.entries()) {
    const index = String(i + 1).padEnd(2, " ")
    const id = shortId(session.id).padEnd(8, " ")
    const status = session.status.padEnd(8, " ")
    const tool = session.tool.padEnd(9, " ")
    console.log(`${index} ${id} ${status} ${tool} ${session.title}`)
  }
}

async function promptTool(rl: readline.Interface): Promise<Tool> {
  const toolInput = (await rl.question(`Tool [${TOOL_CHOICES.join("/")}] (default: claude): `)).trim().toLowerCase()
  if (!toolInput) return "claude"
  if (TOOL_CHOICES.includes(toolInput as Tool)) return toolInput as Tool
  throw new Error(`Unsupported tool '${toolInput}'`)
}

export async function runDashboard(): Promise<void> {
  const manager = getSessionManager()
  const rl = readline.createInterface({ input, output })

  const cleanup = () => {
    manager.stopRefreshLoop()
    rl.close()
    try {
      getStorage().close()
    } catch {
      // Ignore close errors on exit.
    }
  }

  manager.startRefreshLoop(1000)

  while (true) {
    await manager.refreshStatuses()
    const sessions = manager.list().sort((a, b) => a.order - b.order)

    clearScreen()
    console.log("Seshions (Node runtime)")
    console.log("")
    printTable(sessions)
    console.log("")
    console.log("Commands:")
    console.log("  n               new session")
    console.log("  a <id|#>        attach")
    console.log("  s <id|#>        stop")
    console.log("  r <id|#>        restart")
    console.log("  d <id|#>        delete")
    console.log("  l <id|#> [n]    logs")
    console.log("  m <id|#>        send message")
    console.log("  q               quit")
    console.log("")

    const line = (await rl.question("> ")).trim()
    if (!line) continue

    const [command, ...rest] = line.split(/\s+/)

    try {
      if (command === "q") {
        cleanup()
        return
      }

      if (command === "n") {
        const title = (await rl.question("Title (optional): ")).trim()
        const projectPath = (await rl.question("Project path (default: .): ")).trim() || process.cwd()
        const tool = await promptTool(rl)
        const customCommand = (await rl.question("Custom command (optional): ")).trim()

        await manager.create({
          title: title || undefined,
          projectPath,
          tool,
          command: customCommand || undefined,
        })
        continue
      }

      if (command === "a") {
        const token = rest[0]
        if (!token) throw new Error("Usage: a <id|#>")

        const session = resolveSession(manager, token)
        if (!session?.tmuxSession) throw new Error("Session not found or has no tmux session")

        attachSessionSync(session.tmuxSession)
        continue
      }

      if (command === "s") {
        const token = rest[0]
        if (!token) throw new Error("Usage: s <id|#>")

        const session = resolveSession(manager, token)
        if (!session) throw new Error("Session not found")

        await manager.stop(session.id)
        continue
      }

      if (command === "r") {
        const token = rest[0]
        if (!token) throw new Error("Usage: r <id|#>")

        const session = resolveSession(manager, token)
        if (!session) throw new Error("Session not found")

        await manager.restart(session.id)
        continue
      }

      if (command === "d") {
        const token = rest[0]
        if (!token) throw new Error("Usage: d <id|#>")

        const session = resolveSession(manager, token)
        if (!session) throw new Error("Session not found")

        await manager.delete(session.id)
        continue
      }

      if (command === "l") {
        const token = rest[0]
        if (!token) throw new Error("Usage: l <id|#> [lines]")

        const lines = Number.parseInt(rest[1] ?? "80", 10)
        const session = resolveSession(manager, token)
        if (!session) throw new Error("Session not found")

        const outputText = await manager.getOutput(session.id, Number.isFinite(lines) ? lines : 80)
        console.log("\n--- output ---")
        console.log(outputText || "<no output>")
        await rl.question("\nPress Enter to continue...")
        continue
      }

      if (command === "m") {
        const token = rest[0]
        if (!token) throw new Error("Usage: m <id|#>")

        const session = resolveSession(manager, token)
        if (!session) throw new Error("Session not found")

        const message = (await rl.question("Message: ")).trim()
        if (!message) throw new Error("Message cannot be empty")

        await manager.sendMessage(session.id, message)
        continue
      }

      throw new Error(`Unknown command '${command}'`)
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`)
      await rl.question("Press Enter to continue...")
    }
  }
}

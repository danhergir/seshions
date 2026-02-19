/**
 * Minimal new session dialog: choose a tool and launch.
 */

import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useConfig } from "@tui/context/config"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { attachSessionSync } from "@/core/tmux"
import type { Tool, ClaudeSessionMode } from "@/core/types"
import { getToolCommand } from "@/core/types"
import { exec } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import path from "path"

const execAsync = promisify(exec)

async function commandExists(cmd: string, cwd?: string): Promise<boolean> {
  if (cmd.startsWith("./") || cmd.startsWith("../")) {
    if (!cwd) return false
    const fullPath = path.join(cwd, cmd)
    return existsSync(fullPath)
  }
  if (cmd.startsWith("/")) {
    return existsSync(cmd)
  }
  try {
    await execAsync(`which ${cmd}`)
    return true
  } catch {
    return false
  }
}

const TOOLS: { value: Tool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic CLI" },
  { value: "opencode", label: "OpenCode", description: "OpenCode CLI" },
  { value: "gemini", label: "Gemini", description: "Google CLI" },
  { value: "codex", label: "Codex", description: "OpenAI CLI" },
  { value: "shell", label: "Shell", description: "Plain terminal session" }
]

export function DialogNew() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const { config } = useConfig()

  const configuredTool = config().defaultTool
  const defaultTool: Tool =
    configuredTool && TOOLS.some((tool) => tool.value === configuredTool)
      ? configuredTool
      : "claude"

  const [selectedTool, setSelectedTool] = createSignal<Tool>(defaultTool)
  const [creating, setCreating] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal("")
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const [errorMessage, setErrorMessage] = createSignal("")

  const spinnerFrames = ["-", "\\", "|", "/"]

  createEffect(() => {
    if (creating()) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % spinnerFrames.length)
      }, 100)
      onCleanup(() => clearInterval(interval))
    }
  })

  function cycleTool(direction: 1 | -1) {
    const currentIndex = TOOLS.findIndex((tool) => tool.value === selectedTool())
    const start = currentIndex === -1 ? 0 : currentIndex
    const next = (start + direction + TOOLS.length) % TOOLS.length
    const nextTool = TOOLS[next]
    if (nextTool) {
      setSelectedTool(nextTool.value)
      setErrorMessage("")
    }
  }

  async function handleCreate() {
    if (creating()) return

    setCreating(true)
    setErrorMessage("")
    setStatusMessage("Checking tool...")

    try {
      const sessionTool = selectedTool()
      const sessionProjectPath = process.cwd()
      const toolCmd = getToolCommand(sessionTool)
      const cmdToCheck = toolCmd.split(" ")[0] || toolCmd

      const exists = await commandExists(cmdToCheck, sessionProjectPath)
      if (!exists) {
        throw new Error(`Command '${cmdToCheck}' not found`)
      }

      setStatusMessage("Starting session...")
      const claudeOptions = sessionTool === "claude"
        ? { sessionMode: "new" as ClaudeSessionMode }
        : undefined

      const session = await sync.session.create({
        tool: sessionTool,
        projectPath: sessionProjectPath,
        claudeOptions
      })

      toast.show({ message: `Created ${session.title}`, variant: "success", duration: 2000 })

      if (session.tmuxSession) {
        renderer.suspend()
        attachSessionSync(session.tmuxSession)
        renderer.resume()
      }

      dialog.clear()
      sync.refresh()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setErrorMessage(errorMsg)
      toast.error(err as Error)
    } finally {
      setCreating(false)
      setStatusMessage("")
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleCreate()
      return
    }

    if (evt.name === "up" || evt.name === "k" || evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      cycleTool(-1)
      return
    }

    if (evt.name === "down" || evt.name === "j" || evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      cycleTool(1)
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            New Session
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4}>
        <text fg={theme.textMuted}>Select tool and press Enter.</text>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.primary}>Tool</text>
        <box gap={0}>
          <For each={TOOLS}>
            {(tool) => (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                backgroundColor={selectedTool() === tool.value ? theme.backgroundElement : undefined}
              >
                <text fg={selectedTool() === tool.value ? theme.primary : theme.textMuted}>
                  {selectedTool() === tool.value ? ">" : " "}
                </text>
                <text fg={theme.text}>{tool.label}</text>
                <text fg={theme.textMuted}>- {tool.description}</text>
              </box>
            )}
          </For>
        </box>
      </box>

      <Show when={errorMessage()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <box backgroundColor={theme.error} padding={1}>
            <text fg={theme.selectedListItemText} wrapMode="word">
              {errorMessage()}
            </text>
          </box>
        </box>
      </Show>

      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={creating() ? theme.backgroundElement : theme.primary}
          padding={1}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {creating() ? `${spinnerFrames[spinnerFrame()]} ${statusMessage()}` : "Launch Session"}
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          {creating() ? statusMessage() : "Arrows: choose tool | Enter: launch"}
        </text>
      </box>
    </box>
  )
}

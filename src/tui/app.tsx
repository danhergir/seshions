/**
 * Main TUI application
 * Provider hierarchy and routing
 */

import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import fs from "fs"
import {
  ensureAppDirSync,
  getDebugLogPath
} from "@/core/app-paths"

// File logger for debugging
ensureAppDirSync()
const logFile = getDebugLogPath()
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  fs.appendFileSync(logFile, msg)
}
import { Switch, Match, createMemo, ErrorBoundary, onMount } from "solid-js"
import { RouteProvider, useRoute } from "@tui/context/route"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { KeybindProvider } from "@tui/context/keybind"
import { KVProvider } from "@tui/context/kv"
import { ConfigProvider } from "@tui/context/config"
import { loadConfig } from "@/core/config"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { ToastProvider, useToast } from "@tui/ui/toast"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogSessions } from "@tui/component/dialog-sessions"
import { DialogNew } from "@tui/component/dialog-new"
import { DialogTemplateEditor, DialogTemplateManager } from "@tui/component/dialog-template"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { setStorage, Storage } from "@/core/storage"
import { isTmuxAvailable, killSession, splitSessionPane } from "@/core/tmux"

async function detectTerminalMode(): Promise<"dark" | "light"> {
  // Simple detection - could be enhanced
  return "dark"
}

export interface TuiOptions {
  mode?: "dark" | "light"
  onExit?: () => Promise<void>
}

export async function tui(options: TuiOptions = {}) {
  log("=== Seshions starting ===")

  // Check tmux availability
  const tmuxOk = await isTmuxAvailable()
  if (!tmuxOk) {
    console.error("Error: tmux is not available. Please install tmux first.")
    process.exit(1)
  }

  // Initialize storage
  const storage = new Storage()
  storage.migrate()
  setStorage(storage)

  // Load config from ~/.seshions/config.json
  await loadConfig()

  const mode = options.mode ?? (await detectTerminalMode())

  return new Promise<void>((resolve) => {
    const onExit = async () => {
      try {
        const sessions = storage.loadSessions()
        const tmuxSessions = Array.from(
          new Set(sessions.map((session) => session.tmuxSession).filter(Boolean))
        )

        for (const tmuxSession of tmuxSessions) {
          await killSession(tmuxSession)
        }

        storage.close()
        await options.onExit?.()
      } catch (e) {
        // Ignore cleanup errors
      }

      // Restore terminal state before exiting
      process.stdout.write("\x1b[?1049l") // Exit alternate screen buffer
      process.stdout.write("\x1b[?25h")   // Show cursor
      process.stdout.write("\x1b[0m")     // Reset all attributes
      process.stdout.write("\x1b[2J\x1b[H") // Clear screen and move to top

      resolve()
      process.exit(0)
    }

    render(
      () => (
        <ErrorBoundary fallback={(error: Error) => <ErrorComponent error={error} />}>
          <KVProvider>
            <ConfigProvider>
              <RouteProvider>
                <SyncProvider>
                  <ThemeProvider mode={mode}>
                    <ToastProvider>
                      <KeybindProvider>
                        <DialogProvider>
                          <CommandProvider>
                            <App onExit={onExit} />
                          </CommandProvider>
                        </DialogProvider>
                      </KeybindProvider>
                    </ToastProvider>
                  </ThemeProvider>
                </SyncProvider>
              </RouteProvider>
            </ConfigProvider>
          </KVProvider>
        </ErrorBoundary>
      ),
      {
        targetFps: 60,
        exitOnCtrlC: false,
        useMouse: false,
        autoFocus: false,
        useKittyKeyboard: {},
        openConsoleOnError: true
      }
    )
  })
}

function App(props: { onExit: () => Promise<void> }) {
  log("App component rendering")
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const dialog = useDialog()
  const command = useCommandDialog()
  const sync = useSync()
  const toast = useToast()
  const renderer = useRenderer()

  log("App initialized, route:", route.data.type, "dimensions:", dimensions().width, "x", dimensions().height)

  // Disable stdout interception to allow keyboard input
  onMount(() => {
    renderer.disableStdoutInterception()
  })

  // Register global commands
  onMount(() => {
    command.register(() => [
      {
        title: "Jump to session",
        value: "session.list",
        category: "Session",
        keybind: "Ctrl+L",
        suggested: sync.data.sessions.length > 0,
        onSelect: () => {
          dialog.replace(() => <DialogSessions />)
        }
      },
      {
        title: "Launch session",
        value: "session.new",
        category: "Session",
        keybind: "N",
        suggested: true,
        onSelect: () => {
          dialog.replace(() => <DialogNew />)
        }
      },
      {
        title: "Launch from template",
        value: "template.launch",
        category: "Templates",
        onSelect: () => {
          dialog.replace(() => (
            <DialogTemplateManager
              title="Launch From Template"
              onApply={(template) => {
                dialog.replace(() => <DialogNew templateId={template.id} />)
              }}
            />
          ))
        }
      },
      {
        title: "Create template",
        value: "template.create",
        category: "Templates",
        onSelect: () => {
          dialog.replace(() => <DialogTemplateEditor />)
        }
      },
      {
        title: "Manage templates",
        value: "template.manage",
        category: "Templates",
        onSelect: () => {
          dialog.replace(() => <DialogTemplateManager />)
        }
      },
      {
        title: "Split terminal in current session",
        value: "session.split.current",
        category: "Workspace",
        onSelect: async () => {
          if (route.data.type !== "session") {
            toast.show({ message: "Open a session view first", variant: "info", duration: 2000 })
            return
          }
          const currentSession = sync.session.get(route.data.sessionId)
          if (!currentSession?.tmuxSession) {
            toast.show({ message: "Session has no active tmux session", variant: "error", duration: 2200 })
            return
          }
          try {
            await splitSessionPane(currentSession.tmuxSession)
            toast.show({ message: "Opened terminal split", variant: "success", duration: 1500 })
          } catch (err) {
            toast.error(err as Error)
          }
        }
      },
      {
        title: "Split terminal in another session",
        value: "session.split.pick",
        category: "Workspace",
        onSelect: () => {
          dialog.replace(() => (
            <DialogSessionSplit
              onSplit={async (sessionId) => {
                const session = sync.session.get(sessionId)
                if (!session?.tmuxSession) {
                  toast.show({ message: "Session has no active tmux session", variant: "error", duration: 2200 })
                  return
                }
                try {
                  await splitSessionPane(session.tmuxSession)
                  toast.show({ message: `Opened split in ${session.title}`, variant: "success", duration: 1800 })
                  dialog.clear()
                } catch (err) {
                  toast.error(err as Error)
                }
              }}
            />
          ))
        }
      },
      {
        title: "Workspace home",
        value: "nav.home",
        category: "Navigation",
        onSelect: () => {
          route.navigate({ type: "home" })
          dialog.clear()
        }
      },
      {
        title: "Close app",
        value: "app.exit",
        category: "System",
        keybind: "Q",
        onSelect: async () => {
          await props.onExit()
        }
      }
    ])
  })

  useKeyboard((evt) => {
    log("App useKeyboard:", evt.name, "ctrl:", evt.ctrl)

    if (dialog.stack.length > 0) return

    if (evt.ctrl && evt.name === "k") {
      command.open()
    }

    if (evt.name === "n") {
      evt.preventDefault()
      log("Opening new dialog from App")
      dialog.replace(() => <DialogNew />)
    }

    if (evt.name === "l") {
      log("Opening sessions dialog from App")
      dialog.replace(() => <DialogSessions />)
    }

    if (evt.name === "q") {
      props.onExit()
    }

    if (evt.name === "?") {
      toast.show({
        title: "Help",
        message: "Ctrl+K: Action Hub | L: Sessions | N: Launch | Q: Close",
        variant: "info",
        duration: 5000
      })
    }
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>
    </box>
  )
}

function DialogSessionSplit(props: { onSplit: (sessionId: string) => void | Promise<void> }) {
  const sync = useSync()

  const selectOptions = createMemo<DialogSelectOption<string>[]>(() => {
    return sync.session.list().filter((session) => !!session.tmuxSession).map((session) => ({
      title: session.title,
      value: session.id,
      category: "Sessions",
      description: session.projectPath,
      footer: session.status
    }))
  })

  return (
    <DialogSelect
      title="Split Terminal In Session"
      placeholder="Select session..."
      options={selectOptions()}
      flat
      onSelect={(option) => {
        void props.onSplit(option.value)
      }}
    />
  )
}

function ErrorComponent(props: { error: Error }) {
  const dimensions = useTerminalDimensions()

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor="#1e1e2e"
      flexDirection="column"
      padding={2}
      gap={1}
    >
      <text fg="#f38ba8" attributes={0x01}>
        Fatal Error
      </text>
      <text fg="#cdd6f4">{props.error.message}</text>
      <text fg="#6c7086">{props.error.stack}</text>
      <text fg="#6c7086">Close and relaunch the app</text>
    </box>
  )
}

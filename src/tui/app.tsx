/**
 * Main TUI application
 * Provider hierarchy and routing
 */

import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"
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
import { Switch, Match, createEffect, ErrorBoundary, Show, onMount } from "solid-js"
import { RouteProvider, useRoute } from "@tui/context/route"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { KVProvider, useKV } from "@tui/context/kv"
import { ConfigProvider } from "@tui/context/config"
import { loadConfig } from "@/core/config"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { ToastProvider, useToast } from "@tui/ui/toast"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogSessions } from "@tui/component/dialog-sessions"
import { DialogNew } from "@tui/component/dialog-new"
import { DialogProfileManager } from "@tui/component/dialog-profile"
import { DialogBlueprintManager } from "@tui/component/dialog-blueprint"
import { DialogBroadcastGroupSelect, DialogDispatchRoleSelect } from "@tui/component/dialog-orchestrate"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { getStorage, setStorage, Storage } from "@/core/storage"
import { isTmuxAvailable } from "@/core/tmux"

async function detectTerminalMode(): Promise<"dark" | "light"> {
  // Simple detection - could be enhanced
  return "dark"
}

export interface TuiOptions {
  mode?: "dark" | "light"
  onExit?: () => Promise<void>
}

function restoreTerminalState(): void {
  // Make sure stdin does not remain in raw mode after teardown.
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false)
    } catch {
      // ignore
    }
    process.stdin.pause()
  }

  // Write synchronously to guarantee terminal reset before process exit.
  const resetSequence = [
    "\x1b[?1000l", // VT200 mouse
    "\x1b[?1002l", // Button-event mouse
    "\x1b[?1003l", // Any-event mouse
    "\x1b[?1005l", // UTF-8 mouse encoding
    "\x1b[?1006l", // SGR mouse encoding
    "\x1b[?1015l", // URXVT mouse encoding
    "\x1b[?1016l", // SGR pixel mouse encoding
    "\x1b[?1004l", // Focus tracking
    "\x1b[?1007l", // Alternate scroll mode
    "\x1b[?2004l", // Bracketed paste
    "\x1b[<u",     // Kitty keyboard protocol (disable)
    "\x1b[?1l",    // Application cursor keys
    "\x1b[?47l",   // Alternate buffer (legacy)
    "\x1b[?1047l", // Alternate buffer
    "\x1b[?1048l", // Restore cursor
    "\x1b[?1049l", // Exit alternate screen buffer
    "\x1b[?25h",   // Show cursor
    "\x1b[0m",     // Reset attributes
    "\x1b[2J\x1b[H" // Clear screen and move to top
  ].join("")

  try {
    fs.writeSync(process.stdout.fd, resetSequence)
  } catch {
    // Fall back to buffered write if sync write is unavailable.
    process.stdout.write(resetSequence)
  }
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

  let done = false
  let resolveDone: () => void = () => {}
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = () => {
      if (done) return
      done = true
      resolve()
    }
  })

  const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false,
    autoFocus: false,
    useKittyKeyboard: {},
    openConsoleOnError: true,
    onDestroy: () => {
      restoreTerminalState()
      resolveDone()
    }
  })

  let exiting = false
  const onExit = async (exitCode: number) => {
    if (exiting) return
    exiting = true
    process.exitCode = exitCode

    try {
      storage.close()
      if (exitCode === 0) {
        await options.onExit?.()
      }
    } catch {
      // Ignore cleanup errors
    }

    try {
      // Disable interactive terminal protocols immediately, then destroy renderer.
      renderer.useMouse = false
      renderer.disableKittyKeyboard()
      renderer.destroy()
    } catch {
      // Fallback reset if renderer teardown fails.
      restoreTerminalState()
      resolveDone()
    }
  }

  try {
    await render(
      () => (
        <ErrorBoundary fallback={(error: Error) => <ErrorComponent error={error} onExit={() => onExit(1)} />}>
          <KVProvider>
            <ConfigProvider>
              <RouteProvider>
                <SyncProvider>
                  <ThemeProvider mode={mode}>
                    <ToastProvider>
                      <KeybindProvider>
                        <DialogProvider>
                          <CommandProvider>
                            <App onExit={() => onExit(0)} />
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
      renderer
    )
  } catch (error) {
    await onExit(1)
    throw error
  }

  return donePromise
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
  const keybind = useKeybind()
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
        title: "Switch session",
        value: "session.list",
        category: "Session",
        keybind: "Ctrl+L",
        suggested: sync.data.sessions.length > 0,
        onSelect: () => {
          dialog.replace(() => <DialogSessions />)
        }
      },
      {
        title: "New session",
        value: "session.new",
        category: "Session",
        keybind: "N",
        suggested: true,
        onSelect: () => {
          dialog.replace(() => <DialogNew />)
        }
      },
      {
        title: "Workspace profiles",
        value: "session.profiles",
        category: "Session",
        keybind: "P",
        onSelect: () => {
          dialog.replace(() => <DialogProfileManager />)
        }
      },
      {
        title: "Launch blueprints",
        value: "session.blueprints",
        category: "Session",
        keybind: "B",
        onSelect: () => {
          dialog.replace(() => <DialogBlueprintManager />)
        }
      },
      {
        title: "Dispatch to role",
        value: "orchestrate.dispatch",
        category: "Orchestration",
        onSelect: () => {
          dialog.replace(() => <DialogDispatchRoleSelect />)
        }
      },
      {
        title: "Broadcast to group",
        value: "orchestrate.broadcast",
        category: "Orchestration",
        onSelect: () => {
          dialog.replace(() => <DialogBroadcastGroupSelect />)
        }
      },
      {
        title: "Go home",
        value: "nav.home",
        category: "Navigation",
        onSelect: () => {
          route.navigate({ type: "home" })
          dialog.clear()
        }
      },
      {
        title: "Exit",
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

    if (evt.name === "p") {
      dialog.replace(() => <DialogProfileManager />)
    }

    if (evt.name === "b") {
      dialog.replace(() => <DialogBlueprintManager />)
    }

    if (evt.name === "q") {
      props.onExit()
    }

    if (evt.name === "?") {
      toast.show({
        title: "Help",
        message: "Ctrl+K: Action Hub | N: New | B: Blueprints | P: Profiles | Q: Quit",
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

function ErrorComponent(props: { error: Error; onExit: () => Promise<void> }) {
  const dimensions = useTerminalDimensions()

  useKeyboard((evt) => {
    if (evt.name === "q" || evt.name === "escape") {
      props.onExit()
    }
  })

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
      <text fg="#6c7086">Press Q or Esc to exit</text>
    </box>
  )
}

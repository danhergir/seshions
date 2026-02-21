/**
 * Command palette dialog
 * Central command registration and execution
 */

import { createContext, useContext, type ParentProps, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { getStorage } from "@/core/storage"
import type { CommandRouteContext, CommandUsageSnapshot } from "@tui/util/command-rank"
import { rankCommands } from "@tui/util/command-rank"

export interface Command {
  title: string
  value: string
  category?: string
  description?: string
  keybind?: string
  suggested?: boolean
  hidden?: boolean
  contexts?: CommandRouteContext[]
  slash?: {
    name: string
    aliases?: string[]
  }
  onSelect: (dialog: ReturnType<typeof useDialog>) => void
}

interface CommandState {
  commands: Command[]
  usage: Record<string, CommandUsageSnapshot>
}

interface CommandContext {
  register(provider: () => Command[]): () => void
  trigger(value: string): void
  open(): void
}

const ctx = createContext<CommandContext>()

export function CommandProvider(props: ParentProps) {
  const dialog = useDialog()
  const [state, setState] = createStore<CommandState>({
    commands: [],
    usage: {}
  })
  const storage = getStorage()

  const providers: Set<() => Command[]> = new Set()

  function loadUsage() {
    const usageRows = storage.listCommandUsage()
    const next: Record<string, CommandUsageSnapshot> = {}
    for (const row of usageRows) {
      next[row.commandId] = {
        useCount: row.useCount,
        lastUsedAt: row.lastUsedAt.getTime()
      }
    }
    setState("usage", next)
  }

  function refreshCommands() {
    const commands: Command[] = []
    for (const provider of providers) {
      commands.push(...provider())
    }
    setState("commands", commands)
  }

  function executeCommand(cmd: Command) {
    const usage = storage.touchCommandUsage(cmd.value)
    setState("usage", cmd.value, {
      useCount: usage.useCount,
      lastUsedAt: usage.lastUsedAt.getTime()
    })
    cmd.onSelect(dialog)
  }

  loadUsage()

  const value: CommandContext = {
    register(provider) {
      providers.add(provider)
      refreshCommands()
      return () => {
        providers.delete(provider)
        refreshCommands()
      }
    },
    trigger(cmdValue) {
      const cmd = state.commands.find((c) => c.value === cmdValue)
      if (cmd) {
        executeCommand(cmd)
      }
    },
    open() {
      dialog.replace(() => <DialogCommand commands={state.commands} usage={state.usage} onExecute={executeCommand} />)
    }
  }

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useCommandDialog(): CommandContext {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within CommandProvider")
  }
  return value
}

function DialogCommand(props: {
  commands: Command[]
  usage: Record<string, CommandUsageSnapshot>
  onExecute: (command: Command) => void
}) {
  const route = useRoute()

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const visible = props.commands.filter((c) => !c.hidden)
    const currentRoute = route.data.type === "session" ? "session" : "home"
    const ranked = rankCommands(visible, props.usage, currentRoute)

    return ranked.map(({ command, cues }) => ({
      title: command.title,
      value: command.value,
      category: command.category,
      description: [cues.length > 0 ? cues.join(" • ") : "", command.description ?? ""].filter(Boolean).join(" • "),
      footer: command.keybind,
      onSelect: () => props.onExecute(command)
    }))
  })

  return (
    <DialogSelect
      title="Commands"
      placeholder="Search commands..."
      options={options()}
      flat
    />
  )
}

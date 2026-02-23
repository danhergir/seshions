/**
 * Global inbox for cross-session attention and quick actions.
 */

import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { attachSessionSync, capturePane } from "@/core/tmux"
import type { Session, SessionStatus } from "@/core/types"
import { STATUS_ICONS } from "@tui/util/status"
import { truncatePath } from "@tui/util/locale"

type InboxKind = "waiting" | "error" | "running"

interface InboxItem {
  session: Session
  kind: InboxKind
  rank: number
}

function statusRank(status: SessionStatus): number {
  switch (status) {
    case "waiting":
      return 100
    case "error":
      return 90
    case "running":
      return 70
    case "idle":
      return 30
    case "stopped":
    default:
      return 0
  }
}

function classify(session: Session): InboxKind | null {
  if (!session.tmuxSession || session.status === "stopped" || session.status === "idle") {
    return null
  }
  if (session.status === "waiting") return "waiting"
  if (session.status === "error") return "error"
  if (session.status === "running") return "running"
  return null
}

function parseSnippet(output: string): string {
  const cleaned = output
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  if (cleaned.length === 0) {
    return "No recent output"
  }

  return cleaned[cleaned.length - 1]!.slice(0, 100)
}

function categoryLabel(kind: InboxKind, counts: Record<InboxKind, number>): string {
  if (kind === "waiting") {
    return `${STATUS_ICONS.waiting} Waiting (${counts.waiting})`
  }
  if (kind === "error") {
    return `${STATUS_ICONS.error} Errors (${counts.error})`
  }
  return `${STATUS_ICONS.running} Active (${counts.running})`
}

export function DialogInbox() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const renderer = useRenderer()
  const route = useRoute()
  const { theme } = useTheme()
  const [snippets, setSnippets] = createStore<Record<string, string>>({})

  const items = createMemo<InboxItem[]>(() => {
    return sync.session
      .list()
      .map((session): InboxItem | null => {
        const kind = classify(session)
        if (!kind) return null
        return {
          session,
          kind,
          rank: statusRank(session.status)
        }
      })
      .filter((item): item is InboxItem => !!item)
      .sort((a, b) => {
        if (a.rank !== b.rank) return b.rank - a.rank
        return b.session.lastAccessed.getTime() - a.session.lastAccessed.getTime()
      })
  })

  createEffect(() => {
    const snapshot = items().slice(0, 16)
    let disposed = false

    ;(async () => {
      for (const item of snapshot) {
        if (!item.session.tmuxSession) continue
        if (snippets[item.session.id]) continue

        try {
          const output = await capturePane(item.session.tmuxSession, {
            startLine: -14,
            endLine: -1,
            join: true
          })
          if (!disposed) {
            setSnippets(item.session.id, parseSnippet(output))
          }
        } catch {
          if (!disposed) {
            setSnippets(item.session.id, "Output unavailable")
          }
        }
      }
    })()

    return () => {
      disposed = true
    }
  })

  const counts = createMemo(() => {
    return {
      waiting: items().filter((item) => item.kind === "waiting").length,
      error: items().filter((item) => item.kind === "error").length,
      running: items().filter((item) => item.kind === "running").length
    }
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    return items().map((item) => {
      const snippet = snippets[item.session.id] || truncatePath(item.session.projectPath, 80)
      return {
        title: item.session.title,
        value: item.session.id,
        category: categoryLabel(item.kind, counts()),
        description: snippet,
        footer: item.session.tool,
        gutter: <text fg={item.kind === "error" ? theme.error : item.kind === "waiting" ? theme.warning : theme.success}>{STATUS_ICONS[item.session.status]}</text>
      }
    })
  })

  function attach(sessionId: string) {
    const session = sync.session.get(sessionId)
    if (!session?.tmuxSession) {
      toast.show({ message: "Session is not attachable", variant: "error", duration: 2000 })
      return
    }

    renderer.suspend()
    try {
      attachSessionSync(session.tmuxSession)
    } catch (err) {
      console.error("Attach error:", err)
    }
    renderer.resume()
    dialog.clear()
    sync.refresh()
  }

  async function respond(sessionId: string, answer: "y" | "n") {
    const session = sync.session.get(sessionId)
    if (!session?.tmuxSession) {
      toast.show({ message: "Session is not running", variant: "error", duration: 2000 })
      return
    }
    try {
      await sync.session.send(sessionId, answer)
      sync.session.acknowledge(sessionId)
      toast.show({
        message: `${answer === "y" ? "Approved" : "Denied"} ${session.title}`,
        variant: "success",
        duration: 1800
      })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function view(sessionId: string) {
    route.navigate({ type: "session", sessionId })
    dialog.clear()
  }

  return (
    <DialogSelect
      title="Global Inbox"
      placeholder="Filter waiting/errors/active sessions..."
      options={options()}
      flat
      onSelect={(option) => attach(option.value)}
      keybinds={[
        { key: "y", title: "Approve", onTrigger: (opt) => void respond(opt.value, "y") },
        { key: "n", title: "Deny", onTrigger: (opt) => void respond(opt.value, "n") },
        { key: "a", title: "Acknowledge", onTrigger: (opt) => sync.session.acknowledge(opt.value) },
        { key: "v", title: "View", onTrigger: (opt) => view(opt.value) }
      ]}
    />
  )
}

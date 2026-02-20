/**
 * In-app orchestration dialogs.
 * Dispatch a prompt to one role or broadcast to a group.
 */

import { createMemo, createSignal } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { Session } from "@/core/types"
import { truncatePath } from "@tui/util/locale"

function canSendToSession(session: Session): boolean {
  return !!session.tmuxSession && session.status !== "stopped"
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

interface DialogComposeProps {
  mode: "dispatch" | "broadcast"
  sessionId?: string
  groupPath?: string
  onBack: () => void
}

function DialogCompose(props: DialogComposeProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [message, setMessage] = createSignal("")
  const [sending, setSending] = createSignal(false)
  let inputRef: InputRenderable | undefined

  const targetSession = createMemo(() =>
    props.sessionId ? sync.session.get(props.sessionId) : undefined
  )

  const targets = createMemo<Session[]>(() => {
    if (props.mode === "dispatch") {
      const current = targetSession()
      if (!current || !canSendToSession(current)) return []
      return [current]
    }

    if (!props.groupPath) return []
    return sync.session
      .list()
      .filter((session) => session.groupPath === props.groupPath && canSendToSession(session))
  })

  const targetLabel = createMemo(() => {
    if (props.mode === "dispatch") {
      return targetSession()?.title ?? "unknown session"
    }
    return props.groupPath ?? "unknown group"
  })

  async function submit() {
    if (sending()) return
    const prompt = message().trim()
    if (!prompt) {
      toast.show({ message: "Message is required", variant: "error", duration: 2000 })
      return
    }

    const sessionTargets = targets()
    if (sessionTargets.length === 0) {
      toast.show({ message: "No active targets available", variant: "error", duration: 2200 })
      return
    }

    setSending(true)
    let sent = 0
    let failed = 0

    for (const session of sessionTargets) {
      try {
        await sync.session.send(session.id, prompt)
        sent += 1
      } catch {
        failed += 1
      }
    }

    if (props.mode === "dispatch" && sent > 0) {
      toast.show({ message: `Sent to "${targetLabel()}"`, variant: "success", duration: 2200 })
    } else if (props.mode === "broadcast" && sent > 0) {
      toast.show(
        {
          message: `Broadcast sent to ${plural(sent, "session")} in "${targetLabel()}"`,
          variant: "success",
          duration: 2400
        }
      )
    }

    if (failed > 0) {
      toast.show(
        {
          message: `${plural(failed, "session")} failed to receive the message`,
          variant: "error",
          duration: 2600
        }
      )
    }

    setSending(false)
    if (sent > 0) {
      dialog.clear()
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      props.onBack()
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      void submit()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.mode === "dispatch" ? "Dispatch To Role" : "Broadcast To Group"}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1}>
        <text fg={theme.primary}>Target</text>
        <text fg={theme.text}>
          {targetLabel()}
        </text>
        <text fg={theme.textMuted}>
          {plural(targets().length, "active session")}
        </text>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.primary}>Message</text>
        <input
          value={message()}
          onInput={setMessage}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            inputRef = r
            setTimeout(() => inputRef?.focus(), 1)
          }}
        />
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={sending() ? theme.backgroundElement : theme.primary}
          padding={1}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {sending() ? "Sending..." : "Send Message"}
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Enter: send | Esc: back</text>
      </box>
    </box>
  )
}

export function DialogDispatchRoleSelect() {
  const dialog = useDialog()
  const sync = useSync()

  const sessions = createMemo(() => {
    return sync.session
      .list()
      .filter((session) => canSendToSession(session))
      .sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title)
        if (byTitle !== 0) return byTitle
        return b.lastAccessed.getTime() - a.lastAccessed.getTime()
      })
  })

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    sessions().map((session) => ({
      title: session.title,
      value: session.id,
      category: session.groupPath,
      description: `${session.tool} • ${truncatePath(session.projectPath, 52)}`
    }))
  )

  return (
    <DialogSelect
      title="Dispatch To Role"
      placeholder="Search role/session..."
      options={options()}
      flat
      onSelect={(option) => {
        const sessionId = option.value as string
        dialog.replace(() => (
          <DialogCompose
            mode="dispatch"
            sessionId={sessionId}
            onBack={() => dialog.replace(() => <DialogDispatchRoleSelect />)}
          />
        ))
      }}
    />
  )
}

export function DialogBroadcastGroupSelect() {
  const dialog = useDialog()
  const sync = useSync()

  const groups = createMemo(() => {
    return [...sync.group.list()].sort((a, b) => a.name.localeCompare(b.name))
  })

  const sessionCountByGroup = createMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sync.session.list()) {
      if (!canSendToSession(session)) continue
      counts.set(session.groupPath, (counts.get(session.groupPath) ?? 0) + 1)
    }
    return counts
  })

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    groups().map((group) => {
      const count = sessionCountByGroup().get(group.path) ?? 0
      return {
        title: group.name,
        value: group.path,
        category: "Groups",
        description: `${plural(count, "active session")}`,
        footer: count === 0 ? "empty" : "send",
        disabled: count === 0
      }
    })
  )

  return (
    <DialogSelect
      title="Broadcast To Group"
      placeholder="Search groups..."
      options={options()}
      flat
      onSelect={(option) => {
        const groupPath = option.value as string
        dialog.replace(() => (
          <DialogCompose
            mode="broadcast"
            groupPath={groupPath}
            onBack={() => dialog.replace(() => <DialogBroadcastGroupSelect />)}
          />
        ))
      }}
    />
  )
}

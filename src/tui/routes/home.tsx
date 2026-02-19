/**
 * Home screen with dual-column layout
 * Shows session list on left, preview pane on right
 */

import { createMemo, createSignal, For, Show, createEffect, onCleanup } from "solid-js"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogNew } from "@tui/component/dialog-new"
import { DialogRename } from "@tui/component/dialog-rename"
import { DialogGroup } from "@tui/component/dialog-group"
import { DialogMove } from "@tui/component/dialog-move"
import { DialogProfileManager } from "@tui/component/dialog-profile"
import { attachSessionSync, capturePane, wasCommandPaletteRequested } from "@/core/tmux"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { Session, Group } from "@/core/types"
import { formatSmartTime, truncatePath } from "@tui/util/locale"
import { STATUS_ICONS } from "@tui/util/status"
import { sortSessionsByCreatedAt } from "@tui/util/session"
import {
  flattenGroupTree,
  ensureDefaultGroup,
  getGroupSessionCount,
  getGroupStatusSummary,
  DEFAULT_GROUP_PATH,
  type GroupedItem
} from "@tui/util/groups"
import fs from "fs"
import { getDebugLogPath } from "@/core/app-paths"

const logFile = getDebugLogPath()
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [HOME] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

const LOGO = `
░██████╗███████╗░██████╗██╗░░██╗██╗░█████╗░███╗░░██╗░██████╗
██╔════╝██╔════╝██╔════╝██║░░██║██║██╔══██╗████╗░██║██╔════╝
╚█████╗░█████╗░░╚█████╗░███████║██║██║░░██║██╔██╗██║╚█████╗░
░╚═══██╗██╔══╝░░░╚═══██╗██╔══██║██║██║░░██║██║╚████║░╚═══██╗
██████╔╝███████╗██████╔╝██║░░██║██║╚█████╔╝██║░╚███║██████╔╝
╚═════╝░╚══════╝╚═════╝░╚═╝░░╚═╝╚═╝░╚════╝░╚═╝░░╚══╝╚═════╝░
`.trim()

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
}

// Minimum width for dual-column layout
const DUAL_COLUMN_MIN_WIDTH = 100
const LEFT_PANEL_RATIO = 0.35

interface FooterHint {
  key: string
  label: string
}

interface DeleteConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}

export function Home() {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()
  const command = useCommandDialog()

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [previewContent, setPreviewContent] = createSignal<string>("")
  const [previewLoading, setPreviewLoading] = createSignal(false)
  let scrollRef: ScrollBoxRenderable | undefined
  let previewDebounceTimer: ReturnType<typeof setTimeout> | undefined
  let previewFetchAbort = false

  // Check if we should use dual-column layout
  const useDualColumn = createMemo(() => dimensions().width >= DUAL_COLUMN_MIN_WIDTH)

  // Calculate panel widths
  const leftWidth = createMemo(() => {
    if (!useDualColumn()) return dimensions().width
    return Math.floor(dimensions().width * LEFT_PANEL_RATIO)
  })

  const rightWidth = createMemo(() => {
    if (!useDualColumn()) return 0
    return dimensions().width - leftWidth() - 1 // -1 for separator
  })

  // Ensure default group exists on first load
  createEffect(() => {
    const currentGroups = sync.group.list()
    const withDefault = ensureDefaultGroup(currentGroups)
    if (withDefault.length !== currentGroups.length) {
      sync.group.save(withDefault)
    }
  })

  // Get all sessions
  const allSessions = createMemo(() => sync.session.list())

  // Get grouped items (groups + sessions flattened)
  const groupedItems = createMemo(() => {
    const groups = ensureDefaultGroup(sync.group.list())
    return flattenGroupTree(allSessions(), groups)
  })

  // Keep selection in bounds
  createEffect(() => {
    const len = groupedItems().length
    if (selectedIndex() >= len && len > 0) {
      setSelectedIndex(len - 1)
    }
  })

  // Get the selected item (could be group or session)
  const selectedItem = createMemo(() => groupedItems()[selectedIndex()])

  // Get the selected session (only if a session is selected)
  const selectedSession = createMemo(() => {
    const item = selectedItem()
    return item?.type === "session" ? item.session : undefined
  })

  // Fetch preview with debounce; keep showing previous content while loading
  createEffect(() => {
    const session = selectedSession()

    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer)
    }

    if (!session || !session.tmuxSession) {
      setPreviewContent("")
      setPreviewLoading(false)
      return
    }

    // Only show loading if we have no content yet (first load)
    if (!previewContent()) {
      setPreviewLoading(true)
    }
    previewFetchAbort = false

    // Debounce: 150ms delay to prevent rapid fetching during navigation
    previewDebounceTimer = setTimeout(async () => {
      if (previewFetchAbort) return

      try {
        const content = await capturePane(session.tmuxSession, {
          startLine: -200, // Last 200 lines
          join: true
        })

        if (!previewFetchAbort) {
          setPreviewContent(content)
        }
      } catch {
        // Keep existing content on error, don't clear
      } finally {
        if (!previewFetchAbort) {
          setPreviewLoading(false)
        }
      }
    }, 150)
  })

  onCleanup(() => {
    previewFetchAbort = true
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer)
    }
  })

  // Session stats
  const stats = createMemo(() => {
    const byStatus = sync.session.byStatus()

    return {
      running: byStatus.running.length,
      waiting: byStatus.waiting.length,
      error: byStatus.error.length,
      idle: byStatus.idle.length,
      total: allSessions().length
    }
  })

  function move(delta: number) {
    const len = groupedItems().length
    if (len === 0) return
    let next = selectedIndex() + delta
    if (next < 0) next = len - 1
    if (next >= len) next = 0
    setSelectedIndex(next)
  }

  // Handle deleting a group
  async function executeDeleteGroup(group: Group) {
    const sessionCount = getGroupSessionCount(allSessions(), group.path)

    // Don't allow deleting default group
    if (group.path === DEFAULT_GROUP_PATH) {
      toast.show({ message: "Cannot delete the default group", variant: "error", duration: 2000 })
      return
    }

    // Move sessions to default group before deleting
    if (sessionCount > 0) {
      const sessionsInGroup = allSessions().filter(s => s.groupPath === group.path)
      for (const session of sessionsInGroup) {
        sync.session.moveToGroup(session.id, DEFAULT_GROUP_PATH)
      }
    }

    sync.group.delete(group.path)
    toast.show({ message: `Deleted group "${group.name}"`, variant: "info", duration: 2000 })
    sync.refresh()
  }

  function handleAttach(session: Session) {
    if (!session.tmuxSession) {
      toast.show({ message: "Session has no tmux session", variant: "error", duration: 2000 })
      return
    }

    previewFetchAbort = true
    renderer.suspend()
    try {
      attachSessionSync(session.tmuxSession)
    } catch (err) {
      console.error("Attach error:", err)
    }
    renderer.resume()
    sync.refresh()

    // Check if user pressed Ctrl+K to open command palette
    if (wasCommandPaletteRequested()) {
      command.open()
    }
  }

  async function executeDeleteSession(session: Session) {
    try {
      await sync.session.delete(session.id)
      toast.show({ message: `Deleted ${session.title}`, variant: "info", duration: 2000 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function openDeleteConfirm(item: GroupedItem): void {
    if (item.type === "session" && item.session) {
      const sessionId = item.session.id
      dialog.push(() => (
        <DeleteConfirmDialog
          title="Delete Session"
          message={`Delete "${item.session!.title}"?`}
          confirmLabel="Delete Session"
          onConfirm={async () => {
            const latest = sync.session.get(sessionId)
            if (!latest) return
            await executeDeleteSession(latest)
          }}
        />
      ))
      return
    }

    if (item.type === "group" && item.group) {
      if (item.group.path === DEFAULT_GROUP_PATH) {
        toast.show({ message: "Cannot delete the default group", variant: "error", duration: 2000 })
        return
      }

      const groupPath = item.group.path
      const count = getGroupSessionCount(allSessions(), groupPath)
      const prompt = count > 0
        ? `Delete "${item.group.name}" and move ${count} session${count === 1 ? "" : "s"} to My Sessions?`
        : `Delete "${item.group.name}"?`

      dialog.push(() => (
        <DeleteConfirmDialog
          title="Delete Group"
          message={prompt}
          confirmLabel="Delete Group"
          onConfirm={async () => {
            const latest = sync.group.get(groupPath)
            if (!latest) return
            await executeDeleteGroup(latest)
          }}
        />
      ))
    }
  }

  // Keyboard navigation
  useKeyboard((evt) => {
    log("Home useKeyboard:", evt.name, "dialog.stack.length:", dialog.stack.length)

    // Skip if dialog is open
    if (dialog.stack.length > 0) return

    if (evt.name === "up" || evt.name === "k") {
      move(-1)
    }
    if (evt.name === "down" || evt.name === "j") {
      move(1)
    }
    if (evt.name === "pageup") {
      move(-10)
    }
    if (evt.name === "pagedown") {
      move(10)
    }
    if (evt.name === "home") {
      setSelectedIndex(0)
    }
    if (evt.name === "end") {
      setSelectedIndex(Math.max(0, groupedItems().length - 1))
    }

    // Enter: attach to session
    if (evt.name === "return") {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        handleAttach(item.session)
      }
    }

    // d to delete session OR group
    if (evt.name === "d") {
      const item = selectedItem()
      if (item) {
        openDeleteConfirm(item)
      }
    }

    // r to rename session OR group
    if (evt.name === "r") {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        dialog.push(() => <DialogRename session={item.session!} />)
      } else if (item?.type === "group" && item.group) {
        dialog.push(() => <DialogGroup mode="rename" group={item.group!} />)
      }
    }

    // g to create new group
    if (evt.name === "g" && !evt.shift) {
      dialog.push(() => <DialogGroup mode="create" />)
    }

    // m to move session to group
    if (evt.name === "m") {
      const session = selectedSession()
      if (session) {
        dialog.push(() => <DialogMove session={session} />)
      }
    }

    // p to manage workspace profiles
    if (evt.name === "p" && !evt.shift) {
      dialog.push(() => <DialogProfileManager />)
    }

  })

  // Get preview lines that fit in the available height
  const previewLines = createMemo(() => {
    const content = previewContent()
    if (!content) return []

    const lines = content.split("\n")
    // Strip trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
      lines.pop()
    }
    return lines
  })

  // Render group header
  function GroupHeader(props: { group: Group; index: number }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const sessionCount = createMemo(() => getGroupSessionCount(allSessions(), props.group.path))
    const statusSummary = createMemo(() => getGroupStatusSummary(allSessions(), props.group.path))

    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : theme.backgroundElement}
      >
        <text fg={isSelected() ? theme.selectedListItemText : theme.primary}>▌</text>
        <text> </text>
        <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>◆</text>
        <text> </text>

        {/* Group name */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={TextAttributes.BOLD}
        >
          {props.group.name}
        </text>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Status indicators */}
        <Show when={statusSummary().running > 0}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.success}>
            {STATUS_ICONS.running}{statusSummary().running}
          </text>
          <text> </text>
        </Show>
        <Show when={statusSummary().waiting > 0}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.warning}>
            {STATUS_ICONS.waiting}{statusSummary().waiting}
          </text>
          <text> </text>
        </Show>

        {/* Session count */}
        <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
          ({sessionCount()})
        </text>

      </box>
    )
  }

  // Render session list item (indented under group)
  function SessionItem(props: { session: Session; index: number; indented?: boolean }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const statusColor = createMemo(() => {
      switch (props.session.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "error": return theme.error
        default: return theme.textMuted
      }
    })

    const maxTitleLen = useDualColumn() ? 15 : 20
    const title = props.session.title.length > maxTitleLen
      ? props.session.title.slice(0, maxTitleLen - 2) + ".."
      : props.session.title

    // Indentation for sessions under groups
    const indent = props.indented ? 2 : 0

    return (
      <box
        flexDirection="row"
        paddingLeft={1 + indent}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : undefined}
      >
        <text fg={isSelected() ? theme.selectedListItemText : statusColor()}>▌</text>
        <text> </text>
        {/* Status icon */}
        <text fg={isSelected() ? theme.selectedListItemText : statusColor()}>
          {STATUS_ICONS[props.session.status]}
        </text>
        <text> </text>

        {/* Title */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={isSelected() ? TextAttributes.BOLD : undefined}
        >
          {title}
        </text>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Tool (only in single column) */}
        <Show when={!useDualColumn()}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
            {props.session.tool}
          </text>
          <text> </text>
        </Show>

        {/* Time */}
        <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
          {formatSmartTime(props.session.lastAccessed)}
        </text>
      </box>
    )
  }

  // Render preview pane header
  function PreviewHeader() {
    const session = selectedSession()
    if (!session) return null

    const statusColor = createMemo(() => {
      switch (session.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "error": return theme.error
        default: return theme.textMuted
      }
    })

    const cwd = createMemo(() => {
      const max = Math.max(18, rightWidth() - (session.worktreeBranch ? 58 : 44))
      return truncatePath(session.projectPath, max)
    })

    function MetaChip(props: { label: string; value: string; valueColor?: typeof theme.text }) {
      return (
        <box
          flexDirection="row"
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          gap={1}
        >
          <text fg={theme.textMuted}>{props.label}</text>
          <text fg={props.valueColor ?? theme.text} attributes={TextAttributes.BOLD}>
            {props.value}
          </text>
        </box>
      )
    }

    return (
      <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
        {/* Session title and status */}
        <box flexDirection="row" justifyContent="space-between" height={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {session.title}
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={statusColor()}>{STATUS_ICONS[session.status]}</text>
            <text fg={statusColor()}>{session.status}</text>
          </box>
        </box>

        {/* Structured metadata chips */}
        <box flexDirection="row" gap={1} height={1}>
          <MetaChip label="TOOL" value={session.tool.toUpperCase()} valueColor={theme.accent} />
          <MetaChip label="CWD" value={cwd()} />
          <Show when={session.worktreeBranch}>
            <MetaChip label="BRANCH" value={session.worktreeBranch!} valueColor={theme.secondary} />
          </Show>
        </box>

        {/* Separator */}
        <box height={1}>
          <text fg={theme.border}>{"─".repeat(rightWidth() - 2)}</text>
        </box>
      </box>
    )
  }

  // Render empty state with logo
  function EmptyState() {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" gap={2}>
        <text fg={theme.primary}>{LOGO}</text>
        <box height={1} />
        <text fg={theme.textMuted}>No active tracks</text>
        <box flexDirection="row">
          <text fg={theme.textMuted}>Press </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>n</text>
          <text fg={theme.textMuted}> to launch your first session</text>
        </box>
      </box>
    )
  }

  // Render logo in preview when no session
  function PreviewLogo() {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
        <text fg={theme.primary}>{LOGO}</text>
        <box height={2} />
        <text fg={theme.textMuted}>Select a session to inspect live output</text>
      </box>
    )
  }

  function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
    const [submitting, setSubmitting] = createSignal(false)

    async function confirmDelete() {
      if (submitting()) return
      setSubmitting(true)
      try {
        await props.onConfirm()
        dialog.pop()
      } catch (err) {
        toast.error(err as Error)
      } finally {
        setSubmitting(false)
      }
    }

    useKeyboard((evt) => {
      if (evt.name === "escape" || evt.name === "n") {
        evt.preventDefault()
        dialog.pop()
      }
      if (evt.name === "y" || (evt.name === "return" && !evt.shift)) {
        evt.preventDefault()
        void confirmDelete()
      }
    })

    return (
      <box gap={1} paddingBottom={1}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
        </box>

        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text}>{props.message}</text>
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={2}>
          <box
            backgroundColor={submitting() ? theme.backgroundElement : theme.error}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
              {submitting() ? "Deleting..." : props.confirmLabel}
            </text>
          </box>
        </box>

        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>Y/Enter: confirm | N/Esc: cancel</text>
        </box>
      </box>
    )
  }

  const footerHints = createMemo<FooterHint[]>(() => {
    const base: FooterHint[] = [
      { key: "↑↓", label: "scan" },
      { key: "Enter", label: "attach" },
      { key: "r", label: "rename" },
      { key: "q", label: "detach" },
      { key: "Ctrl+K", label: "palette" }
    ]

    const item = selectedItem()
    if (item?.type === "session") {
      return [...base, { key: "d", label: "drop" }, { key: "m", label: "move" }]
    }
    if (item?.type === "group") {
      return [...base, { key: "d", label: "drop-group" }, { key: "g", label: "new-group" }]
    }
    return [...base, { key: "n", label: "launch" }, { key: "g", label: "group" }]
  })

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      {/* Header brand */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          SESHIONS
        </text>
        <text fg={theme.textMuted}>CTRL+K ACTION HUB</text>
      </box>

      {/* Header summary */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={theme.backgroundElement}
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.success}>RUN {stats().running}</text>
          <text fg={theme.warning}>WAIT {stats().waiting}</text>
          <text fg={theme.error}>ERR {stats().error}</text>
          <text fg={theme.textMuted}>IDLE {stats().idle}</text>
          <text fg={theme.info}>TOTAL {stats().total}</text>
        </box>
      </box>

      {/* Main content area */}
      <Show
        when={allSessions().length > 0}
        fallback={<EmptyState />}
      >
        <box flexDirection="row" flexGrow={1}>
          {/* Left panel: Session list */}
          <box flexDirection="column" width={leftWidth()}>
            {/* Panel title */}
            <box
              height={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.backgroundElement}
            >
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                CONTROL ROSTER
              </text>
            </box>

            {/* Session list (grouped) */}
            <scrollbox
              flexGrow={1}
              scrollbarOptions={{ visible: true }}
              ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
            >
              <For each={groupedItems()}>
                {(item, index) => (
                  <Show
                    when={item.type === "group"}
                    fallback={
                      <SessionItem
                        session={item.session!}
                        index={index()}
                        indented={true}
                      />
                    }
                  >
                    <GroupHeader group={item.group!} index={index()} />
                  </Show>
                )}
              </For>
            </scrollbox>
          </box>

          {/* Separator */}
          <Show when={useDualColumn()}>
            <box width={1} backgroundColor={theme.border}>
              <text fg={theme.border}>│</text>
            </box>
          </Show>

          {/* Right panel: Preview */}
          <Show when={useDualColumn()}>
            <box flexDirection="column" width={rightWidth()}>
              {/* Panel title */}
              <box
                height={1}
                paddingLeft={1}
                paddingRight={1}
              backgroundColor={theme.backgroundElement}
            >
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                LIVE FEED
              </text>
            </box>

              {/* Preview content */}
              <Show
                when={selectedSession()}
                fallback={<PreviewLogo />}
              >
                <box flexDirection="column" flexGrow={1}>
                  <PreviewHeader />

                  {/* Terminal output */}
                  <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
                    <Show
                      when={previewLines().length > 0}
                      fallback={
                        <box paddingLeft={1} paddingTop={1}>
                          <text fg={theme.textMuted}>
                            {previewLoading() ? "Loading..." : "No output yet"}
                          </text>
                        </box>
                      }
                    >
                      <box flexDirection="column" paddingLeft={1}>
                        <For each={previewLines().slice(-50)}>
                          {(line) => (
                            <text fg={theme.text}>{stripAnsi(line).slice(0, rightWidth() - 4)}</text>
                          )}
                        </For>
                      </box>
                    </Show>
                  </scrollbox>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </Show>

      {/* Footer with keybinds */}
      <box
        flexDirection="row"
        width={dimensions().width}
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={theme.backgroundPanel}
        alignItems="center"
      >
        <For each={footerHints()}>
          {(hint, index) => (
            <box flexDirection="row" alignItems="center">
              <text fg={theme.text}>{hint.key}</text>
              <text fg={theme.textMuted}> {hint.label}</text>
              <Show when={index() < footerHints().length - 1}>
                <text fg={theme.border}>  •  </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

/**
 * Launch blueprints for creating multiple sessions in one action.
 */

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { Blueprint, Tool } from "@/core/types"
import path from "path"

const NEW_BLUEPRINT_VALUE = "__new_blueprint__"
const BLUEPRINT_TOOLS: Tool[] = ["codex", "claude", "gemini", "opencode", "custom", "shell"]
const DEFAULT_ROLES = "planner,builder,debugger,reviewer,explorer"
const DEFAULT_ROOT_PATH = "../starcart-wt"

type FocusField = "name" | "groupPath" | "rootPath" | "roles" | "tool" | "template"

function defaultCommandTemplate(tool: Tool): string {
  switch (tool) {
    case "codex":
      return "codex \"You are the ${role} agent for this workspace. Stay in this role.\""
    case "claude":
      return "claude"
    case "gemini":
      return "gemini"
    case "opencode":
      return "opencode"
    case "shell":
      return process.env.SHELL || "/bin/bash"
    case "custom":
    default:
      return ""
  }
}

function renderRoleTemplate(template: string, role: string): string {
  return template.replaceAll("${role}", role).replaceAll("{role}", role)
}

function hasUnsupportedCodexAgentFlag(command: string): boolean {
  return /(^|\s)--agent(\s|$)/.test(command)
}

export function DialogBlueprintManager() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  const blueprints = createMemo(() => sync.blueprint.list())

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const items: DialogSelectOption<string>[] = [
      {
        title: "Create Blueprint",
        value: NEW_BLUEPRINT_VALUE,
        category: "Actions",
        footer: "n",
        description: "save a multi-session launch template"
      }
    ]

    for (const blueprint of blueprints()) {
      items.push({
        title: blueprint.name,
        value: blueprint.id,
        category: "Blueprints",
        description: `${blueprint.entries.length} sessions -> ${blueprint.groupPath}`,
        footer: "launch"
      })
    }

    return items
  })

  function openCreate() {
    dialog.replace(() => <DialogBlueprintEditor />)
  }

  function removeBlueprint(id: string) {
    const blueprint = sync.blueprint.get(id)
    if (!blueprint) return
    sync.blueprint.delete(id)
    toast.show({ message: `Deleted blueprint "${blueprint.name}"`, variant: "info", duration: 2000 })
    dialog.replace(() => <DialogBlueprintManager />)
  }

  return (
    <DialogSelect
      title="Launch Blueprints"
      placeholder="Search blueprints..."
      options={options()}
      flat
      keybinds={[
        {
          key: "n",
          title: "new",
          onTrigger: () => openCreate()
        },
        {
          key: "d",
          title: "delete",
          onTrigger: (option) => {
            if (option.value === NEW_BLUEPRINT_VALUE) return
            removeBlueprint(option.value as string)
          }
        }
      ]}
      onSelect={(option) => {
        const value = option.value as string
        if (value === NEW_BLUEPRINT_VALUE) {
          openCreate()
          return
        }
        dialog.replace(() => <DialogBlueprintLaunchConfirm blueprintId={value} />)
      }}
    />
  )
}

export function DialogBlueprintEditor() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [name, setName] = createSignal("")
  const [groupPath, setGroupPath] = createSignal("my-sessions")
  const [rootPath, setRootPath] = createSignal(DEFAULT_ROOT_PATH)
  const [roles, setRoles] = createSignal(DEFAULT_ROLES)
  const [toolIndex, setToolIndex] = createSignal(BLUEPRINT_TOOLS.indexOf("codex"))
  const [commandTemplate, setCommandTemplate] = createSignal(defaultCommandTemplate("codex"))
  const [saving, setSaving] = createSignal(false)
  const [focusedField, setFocusedField] = createSignal<FocusField>("name")

  let nameInputRef: InputRenderable | undefined
  let groupInputRef: InputRenderable | undefined
  let rootInputRef: InputRenderable | undefined
  let rolesInputRef: InputRenderable | undefined
  let templateInputRef: InputRenderable | undefined

  const selectedTool = createMemo<Tool>(() => BLUEPRINT_TOOLS[toolIndex()] ?? "codex")

  function focusField() {
    const field = focusedField()

    if (field === "name") nameInputRef?.focus()
    else nameInputRef?.blur()

    if (field === "groupPath") groupInputRef?.focus()
    else groupInputRef?.blur()

    if (field === "rootPath") rootInputRef?.focus()
    else rootInputRef?.blur()

    if (field === "roles") rolesInputRef?.focus()
    else rolesInputRef?.blur()

    if (field === "template") templateInputRef?.focus()
    else templateInputRef?.blur()
  }

  function getFocusableFields(): FocusField[] {
    return ["name", "groupPath", "rootPath", "roles", "tool", "template"]
  }

  function moveTool(delta: number) {
    const len = BLUEPRINT_TOOLS.length
    let next = toolIndex() + delta
    if (next < 0) next = len - 1
    if (next >= len) next = 0
    const nextTool = BLUEPRINT_TOOLS[next] ?? "codex"
    setToolIndex(next)
    setCommandTemplate(defaultCommandTemplate(nextTool))
  }

  async function saveBlueprint() {
    if (saving()) return

    const trimmedName = name().trim()
    const trimmedGroupPath = groupPath().trim() || "my-sessions"
    const trimmedRoot = rootPath().trim()
    const selected = selectedTool()

    if (!trimmedName) {
      toast.show({ message: "Blueprint name is required", variant: "error", duration: 2000 })
      return
    }

    if (!trimmedRoot) {
      toast.show({ message: "Worktree root path is required", variant: "error", duration: 2000 })
      return
    }

    const uniqueRoles = Array.from(
      new Set(
        roles()
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean)
      )
    )

    if (uniqueRoles.length === 0) {
      toast.show({ message: "Add at least one role", variant: "error", duration: 2000 })
      return
    }

    const template = commandTemplate().trim() || defaultCommandTemplate(selected)
    if (selected === "custom" && !template) {
      toast.show({ message: "Custom tool requires a command template", variant: "error", duration: 2200 })
      return
    }
    if (selected === "codex" && hasUnsupportedCodexAgentFlag(template)) {
      toast.show({ message: "Codex does not support --agent. Put role in the prompt instead.", variant: "error", duration: 2600 })
      return
    }

    setSaving(true)
    try {
      const entries = uniqueRoles.map((role) => ({
        title: role,
        projectPath: path.resolve(trimmedRoot, role),
        tool: selected,
        command: renderRoleTemplate(template, role) || defaultCommandTemplate(selected)
      }))

      const blueprint = sync.blueprint.create({
        name: trimmedName,
        groupPath: trimmedGroupPath,
        entries
      })

      toast.show({
        message: `Saved blueprint "${blueprint.name}" (${blueprint.entries.length} sessions)`,
        variant: "success",
        duration: 2200
      })
      dialog.replace(() => <DialogBlueprintManager />)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.show({ message, variant: "error", duration: 2200 })
    } finally {
      setSaving(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.replace(() => <DialogBlueprintManager />)
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      saveBlueprint()
      return
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      const fields = getFocusableFields()
      const index = fields.indexOf(focusedField())
      const next = index === -1
        ? fields[0]
        : fields[(index + (evt.shift ? -1 : 1) + fields.length) % fields.length]
      if (next) setFocusedField(next)
      return
    }

    if (focusedField() === "tool") {
      if (evt.name === "up" || evt.name === "k") {
        evt.preventDefault()
        moveTool(-1)
      }
      if (evt.name === "down" || evt.name === "j") {
        evt.preventDefault()
        moveTool(1)
      }
    }
  })

  createEffect(() => {
    focusedField()
    focusField()
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            New Blueprint
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1}>
        <text fg={focusedField() === "name" ? theme.primary : theme.textMuted}>Blueprint Name</text>
        <input
          value={name()}
          onInput={setName}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            nameInputRef = r
            setTimeout(() => nameInputRef?.focus(), 1)
          }}
        />
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
        <text fg={focusedField() === "groupPath" ? theme.primary : theme.textMuted}>Group Path</text>
        <input
          value={groupPath()}
          onInput={setGroupPath}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            groupInputRef = r
          }}
        />
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
        <text fg={focusedField() === "rootPath" ? theme.primary : theme.textMuted}>Worktree Root Path</text>
        <input
          value={rootPath()}
          onInput={setRootPath}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            rootInputRef = r
          }}
        />
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
        <text fg={focusedField() === "roles" ? theme.primary : theme.textMuted}>Roles (comma separated)</text>
        <input
          value={roles()}
          onInput={setRoles}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            rolesInputRef = r
          }}
        />
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
        <text fg={focusedField() === "tool" ? theme.primary : theme.textMuted}>Tool</text>
        <box flexDirection="column" gap={0}>
          <For each={BLUEPRINT_TOOLS}>
            {(tool, index) => (
              <box backgroundColor={index() === toolIndex() ? theme.backgroundElement : undefined} paddingLeft={1}>
                <text fg={index() === toolIndex() ? theme.primary : theme.textMuted}>
                  {index() === toolIndex() ? "●" : "○"}
                </text>
                <text> </text>
                <text fg={theme.text}>{tool}</text>
              </box>
            )}
          </For>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
        <text fg={focusedField() === "template" ? theme.primary : theme.textMuted}>Command Template</text>
        <input
          value={commandTemplate()}
          onInput={setCommandTemplate}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            templateInputRef = r
          }}
        />
        <text fg={theme.textMuted}>Supports {"${role}"} placeholder</text>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box backgroundColor={saving() ? theme.backgroundElement : theme.primary} padding={1} alignItems="center">
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {saving() ? "Saving..." : "Save Blueprint"}
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Tab: next field | Enter: save | Esc: back</text>
      </box>
    </box>
  )
}

function DialogBlueprintLaunchConfirm(props: { blueprintId: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const [launching, setLaunching] = createSignal(false)

  const blueprint = createMemo<Blueprint | undefined>(() => sync.blueprint.get(props.blueprintId))

  async function launchBlueprint() {
    if (launching()) return
    const current = blueprint()
    if (!current) return
    setLaunching(true)

    let success = 0
    let failed = 0
    let invalidCodexFlags = 0

    for (const entry of current.entries) {
      if (entry.tool === "codex" && hasUnsupportedCodexAgentFlag(entry.command)) {
        invalidCodexFlags += 1
        failed += 1
        continue
      }

      try {
        await sync.session.create({
          title: entry.title,
          projectPath: entry.projectPath,
          groupPath: current.groupPath,
          tool: entry.tool,
          command: entry.command
        })
        success += 1
      } catch {
        failed += 1
      }
    }

    if (success > 0) {
      toast.show({
        message: `Launched ${success} session${success === 1 ? "" : "s"} from "${current.name}"`,
        variant: "success",
        duration: 2500
      })
    }

    if (failed > 0) {
      toast.show({
        message: `${failed} session${failed === 1 ? "" : "s"} failed to launch`,
        variant: "error",
        duration: 2800
      })
    }

    if (invalidCodexFlags > 0) {
      toast.show({
        message: `${invalidCodexFlags} Codex command${invalidCodexFlags === 1 ? "" : "s"} used unsupported --agent`,
        variant: "error",
        duration: 3200
      })
    }

    dialog.clear()
    setLaunching(false)
  }

  useKeyboard((evt) => {
    if (evt.name === "escape" || evt.name === "n") {
      evt.preventDefault()
      dialog.replace(() => <DialogBlueprintManager />)
    }
    if (evt.name === "y" || (evt.name === "return" && !evt.shift)) {
      evt.preventDefault()
      void launchBlueprint()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Launch Blueprint
        </text>
      </box>

      <Show
        when={blueprint()}
        fallback={
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.error}>Blueprint not found</text>
          </box>
        }
      >
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text}>
            Launch "{blueprint()!.name}" with {blueprint()!.entries.length} sessions?
          </text>
        </box>

        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>Group: {blueprint()!.groupPath}</text>
        </box>

        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column" gap={0}>
          <For each={blueprint()!.entries.slice(0, 8)}>
            {(entry) => (
              <text fg={theme.textMuted}>• {entry.title} ({entry.tool})</text>
            )}
          </For>
          <Show when={blueprint()!.entries.length > 8}>
            <text fg={theme.textMuted}>… and {blueprint()!.entries.length - 8} more</text>
          </Show>
        </box>
      </Show>

      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box backgroundColor={launching() ? theme.backgroundElement : theme.primary} padding={1} alignItems="center">
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {launching() ? "Launching..." : "Launch Sessions"}
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Y/Enter: launch | N/Esc: cancel</text>
      </box>
    </box>
  )
}

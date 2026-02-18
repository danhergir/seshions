/**
 * Workspace profile manager and editor dialogs
 */

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { Profile, Tool } from "@/core/types"

const NEW_PROFILE_VALUE = "__new_profile__"

const PROFILE_TOOLS: Tool[] = ["claude", "codex", "gemini", "opencode", "custom", "shell"]

type FocusField = "name" | "path" | "tool" | "customCommand" | "worktree" | "baseBranch"

export function DialogProfileManager() {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  const profiles = createMemo(() => sync.profile.list())

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const items: DialogSelectOption<string>[] = [
      {
        title: "Create Profile",
        value: NEW_PROFILE_VALUE,
        category: "Actions",
        footer: "n",
        description: "new workspace preset"
      }
    ]

    for (const profile of profiles()) {
      items.push({
        title: profile.name,
        value: profile.id,
        category: "Profiles",
        description: profile.projectPath,
        footer: profile.defaultTool
      })
    }

    return items
  })

  function openCreate() {
    dialog.replace(() => <DialogProfileEditor />)
  }

  function openEdit(profileId: string) {
    dialog.replace(() => <DialogProfileEditor profileId={profileId} />)
  }

  function removeProfile(profileId: string) {
    const profile = sync.profile.get(profileId)
    if (!profile) return

    sync.profile.delete(profileId)
    toast.show({ message: `Deleted profile \"${profile.name}\"`, variant: "info", duration: 1800 })
    dialog.replace(() => <DialogProfileManager />)
  }

  return (
    <DialogSelect
      title="Workspace Profiles"
      placeholder="Search profiles..."
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
            if (option.value === NEW_PROFILE_VALUE) return
            removeProfile(option.value as string)
          }
        }
      ]}
      onSelect={(option) => {
        const value = option.value as string
        if (value === NEW_PROFILE_VALUE) {
          openCreate()
          return
        }
        openEdit(value)
      }}
    />
  )
}

export function DialogProfileEditor(props: { profileId?: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const original = createMemo<Profile | undefined>(() => {
    if (!props.profileId) return undefined
    return sync.profile.get(props.profileId)
  })

  const [name, setName] = createSignal(original()?.name ?? "")
  const [projectPath, setProjectPath] = createSignal(original()?.projectPath ?? process.cwd())
  const [toolIndex, setToolIndex] = createSignal(
    Math.max(0, PROFILE_TOOLS.findIndex((tool) => tool === (original()?.defaultTool ?? "claude")))
  )
  const [customCommand, setCustomCommand] = createSignal(original()?.defaultCustomCommand ?? "")
  const [useWorktree, setUseWorktree] = createSignal(original()?.useWorktree ?? false)
  const [baseBranch, setBaseBranch] = createSignal(original()?.defaultBaseBranch ?? "main")
  const [saving, setSaving] = createSignal(false)
  const [focusedField, setFocusedField] = createSignal<FocusField>("name")

  let nameInputRef: InputRenderable | undefined
  let pathInputRef: InputRenderable | undefined
  let customInputRef: InputRenderable | undefined
  let baseBranchInputRef: InputRenderable | undefined

  const selectedTool = createMemo<Tool>(() => PROFILE_TOOLS[toolIndex()] ?? "claude")

  function focusField() {
    const field = focusedField()

    if (field === "name") nameInputRef?.focus()
    else nameInputRef?.blur()

    if (field === "path") pathInputRef?.focus()
    else pathInputRef?.blur()

    if (field === "customCommand") customInputRef?.focus()
    else customInputRef?.blur()

    if (field === "baseBranch") baseBranchInputRef?.focus()
    else baseBranchInputRef?.blur()
  }

  function getFocusableFields(): FocusField[] {
    const fields: FocusField[] = ["name", "path", "tool"]
    if (selectedTool() === "custom") {
      fields.push("customCommand")
    }
    fields.push("worktree")
    if (useWorktree()) {
      fields.push("baseBranch")
    }
    return fields
  }

  function moveTool(delta: number) {
    const len = PROFILE_TOOLS.length
    let next = toolIndex() + delta
    if (next < 0) next = len - 1
    if (next >= len) next = 0
    setToolIndex(next)
  }

  async function saveProfile() {
    if (saving()) return

    const trimmedName = name().trim()
    const trimmedPath = projectPath().trim()
    const trimmedBaseBranch = baseBranch().trim()

    if (!trimmedName) {
      toast.show({ message: "Profile name is required", variant: "error", duration: 1800 })
      return
    }

    if (!trimmedPath) {
      toast.show({ message: "Project path is required", variant: "error", duration: 1800 })
      return
    }

    if (selectedTool() === "custom" && !customCommand().trim()) {
      toast.show({ message: "Custom tool requires a command", variant: "error", duration: 1800 })
      return
    }

    setSaving(true)

    try {
      const payload = {
        name: trimmedName,
        projectPath: trimmedPath,
        defaultTool: selectedTool(),
        defaultCustomCommand: selectedTool() === "custom" ? customCommand().trim() : "",
        useWorktree: useWorktree(),
        defaultBaseBranch: useWorktree() ? (trimmedBaseBranch || "main") : "main"
      }

      if (props.profileId) {
        const updated = sync.profile.update(props.profileId, payload)
        if (!updated) {
          throw new Error("Profile no longer exists")
        }
        toast.show({ message: `Updated profile \"${updated.name}\"`, variant: "success", duration: 1800 })
      } else {
        const created = sync.profile.create(payload)
        toast.show({ message: `Created profile \"${created.name}\"`, variant: "success", duration: 1800 })
      }

      dialog.replace(() => <DialogProfileManager />)
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
      dialog.replace(() => <DialogProfileManager />)
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      saveProfile()
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
      return
    }

    if (focusedField() === "worktree" && evt.name === "space") {
      evt.preventDefault()
      setUseWorktree(!useWorktree())
    }
  })

  createEffect(() => {
    focusField()
    focusedField()
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.profileId ? "Edit Profile" : "New Profile"}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1}>
        <text fg={focusedField() === "name" ? theme.primary : theme.textMuted}>Profile Name</text>
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
        <text fg={focusedField() === "path" ? theme.primary : theme.textMuted}>Project Path</text>
        <input
          value={projectPath()}
          onInput={setProjectPath}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            pathInputRef = r
          }}
        />
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
        <text fg={focusedField() === "tool" ? theme.primary : theme.textMuted}>Default Tool</text>
        <box flexDirection="column" gap={0}>
          <For each={PROFILE_TOOLS}>
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

      <Show when={selectedTool() === "custom"}>
        <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
          <text fg={focusedField() === "customCommand" ? theme.primary : theme.textMuted}>Custom Command</text>
          <input
            value={customCommand()}
            onInput={setCustomCommand}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              customInputRef = r
            }}
          />
        </box>
      </Show>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={focusedField() === "worktree" ? theme.primary : theme.textMuted}>
            {useWorktree() ? "[x]" : "[ ]"}
          </text>
          <text fg={focusedField() === "worktree" ? theme.text : theme.textMuted}>Use worktree defaults</text>
        </box>
      </box>

      <Show when={useWorktree()}>
        <box paddingLeft={4} paddingRight={4} gap={1} paddingTop={1}>
          <text fg={focusedField() === "baseBranch" ? theme.primary : theme.textMuted}>Default Base Branch</text>
          <input
            value={baseBranch()}
            onInput={setBaseBranch}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              baseBranchInputRef = r
            }}
          />
        </box>
      </Show>

      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box backgroundColor={saving() ? theme.backgroundElement : theme.primary} padding={1} alignItems="center">
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {saving() ? "Saving..." : "Save Profile"}
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Tab: next field | Enter: save | Esc: back</text>
      </box>
    </box>
  )
}

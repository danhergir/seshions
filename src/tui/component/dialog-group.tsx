/**
 * Create/Rename group dialog
 */

import { createSignal } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import type { Group } from "@/core/types"

interface DialogGroupProps {
  mode: "create" | "rename"
  group?: Group  // Required for rename mode
}

export function DialogGroup(props: DialogGroupProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [name, setName] = createSignal(props.mode === "rename" ? props.group?.name || "" : "")
  const [saving, setSaving] = createSignal(false)

  let inputRef: InputRenderable | undefined

  function validate(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) {
      return "Name cannot be empty"
    }
    if (trimmed.includes("/")) {
      return "Name cannot contain /"
    }
    if (trimmed.length > 50) {
      return "Name is too long (max 50 characters)"
    }
    return null
  }

  async function handleSubmit() {
    if (saving()) return

    const newName = name().trim()
    const error = validate(newName)

    if (error) {
      toast.show({ message: error, variant: "error", duration: 2000 })
      return
    }

    setSaving(true)

    try {
      if (props.mode === "create") {
        sync.group.create(newName)
        toast.show({ message: `Created group "${newName}"`, variant: "success", duration: 2000 })
      } else if (props.mode === "rename" && props.group) {
        if (newName === props.group.name) {
          dialog.clear()
          return
        }
        sync.group.rename(props.group.path, newName)
        toast.show({ message: `Renamed to "${newName}"`, variant: "success", duration: 2000 })
      }
      dialog.clear()
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setSaving(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleSubmit()
    }
  })

  const title = props.mode === "create" ? "Create Group" : "Rename Group"
  const buttonText = props.mode === "create" ? "Create" : "Rename"

  return (
    <box gap={1} paddingBottom={1}>
      {/* Header */}
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      {/* Name field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={theme.primary}>Group Name</text>
        <input
          value={name()}
          onInput={setName}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            inputRef = r
            setTimeout(() => inputRef?.focus(), 1)
          }}
        />
      </box>

      {/* Submit button */}
      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={saving() ? theme.backgroundElement : theme.primary}
          padding={1}
          onMouseUp={handleSubmit}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {saving() ? "Saving..." : buttonText}
          </text>
        </box>
      </box>

      {/* Footer */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Enter: save | Esc: cancel</text>
      </box>
    </box>
  )
}

/**
 * Session template dialogs.
 */

import { createMemo, createSignal, For, Show, createEffect } from "solid-js"
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { randomUUID } from "crypto"
import { useTheme } from "@tui/context/theme"
import { useConfig } from "@tui/context/config"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { SessionTemplate, Tool, ClaudeSessionMode, TemplateStartupAction } from "@/core/types"

const TOOLS: { value: Tool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's Claude CLI" },
  { value: "opencode", label: "OpenCode", description: "OpenCode CLI" },
  { value: "gemini", label: "Gemini", description: "Google's Gemini CLI" },
  { value: "codex", label: "Codex", description: "OpenAI's Codex CLI" },
  { value: "custom", label: "Custom", description: "Custom command" },
  { value: "shell", label: "Shell", description: "Plain terminal session" }
]

function startupActionsToText(actions?: TemplateStartupAction[]): string {
  if (!actions?.length) return ""
  return actions.map((action) => action.command).join(" ; ")
}

function startupActionsFromText(value: string): TemplateStartupAction[] {
  return value
    .split(/[\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((command) => ({ command }))
}

function templateSummary(template: SessionTemplate): string {
  const startupCount = template.startupActions?.length ?? 0
  const startupLabel = startupCount > 0 ? `startup:${startupCount}` : "startup:none"
  return `${template.tool} · ${template.projectPath} · ${startupLabel}`
}

interface DialogTemplateManagerProps {
  title?: string
  onApply?: (template: SessionTemplate) => void
}

export function DialogTemplateManager(props: DialogTemplateManagerProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { config, patch } = useConfig()

  const templates = createMemo(() => config().templates ?? [])

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    return templates().map((template) => ({
      title: template.name,
      value: template.id,
      category: "Templates",
      description: templateSummary(template)
    }))
  })

  async function saveTemplates(nextTemplates: SessionTemplate[]) {
    await patch({ templates: nextTemplates })
  }

  async function handleDelete(templateId: string) {
    const template = templates().find((item) => item.id === templateId)
    if (!template) return
    await saveTemplates(templates().filter((item) => item.id !== templateId))
    toast.show({ message: `Deleted template "${template.name}"`, variant: "info", duration: 2000 })
  }

  function handleEdit(templateId: string) {
    const template = templates().find((item) => item.id === templateId)
    if (!template) return
    dialog.push(() => <DialogTemplateEditor template={template} />)
  }

  function handleSelect(templateId: string) {
    const template = templates().find((item) => item.id === templateId)
    if (!template) return

    if (props.onApply) {
      props.onApply(template)
      return
    }

    handleEdit(template.id)
  }

  return (
    <DialogSelect
      title={props.title ?? "Session Templates"}
      placeholder="Filter templates..."
      options={options()}
      flat
      onSelect={(option) => handleSelect(option.value)}
      keybinds={[
        {
          key: "n",
          title: "Create",
          onTrigger: () => dialog.push(() => <DialogTemplateEditor />)
        },
        {
          key: "e",
          title: "Edit",
          onTrigger: (option) => handleEdit(option.value)
        },
        {
          key: "d",
          title: "Delete",
          onTrigger: (option) => {
            void handleDelete(option.value)
          }
        }
      ]}
    />
  )
}

type FocusField =
  | "name"
  | "tool"
  | "projectPath"
  | "groupPath"
  | "customCommand"
  | "useWorktree"
  | "worktreeBranch"
  | "claudeMode"
  | "startupActions"

interface DialogTemplateEditorProps {
  template?: SessionTemplate
}

export function DialogTemplateEditor(props: DialogTemplateEditorProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const { config, patch } = useConfig()

  const isEdit = createMemo(() => !!props.template)

  const initialTool = props.template?.tool ?? config().defaultTool ?? "claude"
  const initialToolIndex = Math.max(0, TOOLS.findIndex((tool) => tool.value === initialTool))

  const [name, setName] = createSignal(props.template?.name ?? "")
  const [selectedTool, setSelectedTool] = createSignal<Tool>(initialTool)
  const [toolIndex, setToolIndex] = createSignal(initialToolIndex)
  const [projectPath, setProjectPath] = createSignal(props.template?.projectPath ?? process.cwd())
  const [groupPath, setGroupPath] = createSignal(props.template?.groupPath ?? "")
  const [customCommand, setCustomCommand] = createSignal(props.template?.customCommand ?? "")
  const [useWorktree, setUseWorktree] = createSignal(!!props.template?.useWorktree)
  const [worktreeBranch, setWorktreeBranch] = createSignal(props.template?.worktreeBranch ?? "")
  const [claudeSessionMode, setClaudeSessionMode] = createSignal<ClaudeSessionMode>(
    props.template?.claudeOptions?.sessionMode ?? "new"
  )
  const [startupActionsText, setStartupActionsText] = createSignal(
    startupActionsToText(props.template?.startupActions)
  )
  const [focusedField, setFocusedField] = createSignal<FocusField>("name")
  const [saving, setSaving] = createSignal(false)

  let nameInputRef: InputRenderable | undefined
  let projectPathInputRef: InputRenderable | undefined
  let groupPathInputRef: InputRenderable | undefined
  let customCommandInputRef: InputRenderable | undefined
  let worktreeBranchInputRef: InputRenderable | undefined
  let startupActionsInputRef: InputRenderable | undefined

  const focusableFields = createMemo<FocusField[]>(() => {
    const fields: FocusField[] = ["name", "tool", "projectPath", "groupPath"]
    if (selectedTool() === "custom") {
      fields.push("customCommand")
    }
    fields.push("useWorktree")
    if (useWorktree()) {
      fields.push("worktreeBranch")
    }
    if (selectedTool() === "claude") {
      fields.push("claudeMode")
    }
    fields.push("startupActions")
    return fields
  })

  createEffect(() => {
    const field = focusedField()
    if (field === "name") nameInputRef?.focus()
    if (field === "projectPath") projectPathInputRef?.focus()
    if (field === "groupPath") groupPathInputRef?.focus()
    if (field === "customCommand") customCommandInputRef?.focus()
    if (field === "worktreeBranch") worktreeBranchInputRef?.focus()
    if (field === "startupActions") startupActionsInputRef?.focus()
  })

  async function handleSave() {
    if (saving()) return
    const nextName = name().trim()
    if (!nextName) {
      toast.show({ message: "Template name is required", variant: "error", duration: 2000 })
      return
    }
    if (!projectPath().trim()) {
      toast.show({ message: "Project path is required", variant: "error", duration: 2000 })
      return
    }
    if (selectedTool() === "custom" && !customCommand().trim()) {
      toast.show({ message: "Custom command is required for custom tool", variant: "error", duration: 2000 })
      return
    }

    const allTemplates = config().templates ?? []
    const duplicate = allTemplates.find((template) => {
      if (props.template && template.id === props.template.id) return false
      return template.name.toLowerCase() === nextName.toLowerCase()
    })
    if (duplicate) {
      toast.show({ message: `Template "${nextName}" already exists`, variant: "error", duration: 2000 })
      return
    }

    const nextTemplate: SessionTemplate = {
      id: props.template?.id ?? randomUUID(),
      name: nextName,
      tool: selectedTool(),
      projectPath: projectPath().trim(),
      groupPath: groupPath().trim() || undefined,
      customCommand: selectedTool() === "custom" ? customCommand().trim() : undefined,
      useWorktree: useWorktree(),
      worktreeBranch: useWorktree() ? worktreeBranch().trim() || undefined : undefined,
      claudeOptions: selectedTool() === "claude" ? { sessionMode: claudeSessionMode() } : undefined,
      startupActions: startupActionsFromText(startupActionsText())
    }

    const nextTemplates = props.template
      ? allTemplates.map((template) => (template.id === props.template?.id ? nextTemplate : template))
      : [...allTemplates, nextTemplate]

    setSaving(true)
    try {
      await patch({ templates: nextTemplates })
      toast.show({
        message: props.template ? `Updated template "${nextTemplate.name}"` : `Created template "${nextTemplate.name}"`,
        variant: "success",
        duration: 2200
      })
      dialog.pop()
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setSaving(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.pop()
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      void handleSave()
      return
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      const fields = focusableFields()
      if (fields.length === 0) return
      const currentIndex = fields.indexOf(focusedField())
      if (currentIndex === -1) {
        setFocusedField(fields[0]!)
        return
      }
      const delta = evt.shift ? -1 : 1
      const nextIndex = (currentIndex + delta + fields.length) % fields.length
      setFocusedField(fields[nextIndex]!)
      return
    }

    if (focusedField() === "tool") {
      if (evt.name === "up" || evt.name === "k") {
        evt.preventDefault()
        const next = (toolIndex() - 1 + TOOLS.length) % TOOLS.length
        setToolIndex(next)
        setSelectedTool(TOOLS[next]!.value)
        return
      }
      if (evt.name === "down" || evt.name === "j") {
        evt.preventDefault()
        const next = (toolIndex() + 1) % TOOLS.length
        setToolIndex(next)
        setSelectedTool(TOOLS[next]!.value)
        return
      }
    }

    if (focusedField() === "useWorktree" && evt.name === "space") {
      evt.preventDefault()
      setUseWorktree(!useWorktree())
      return
    }

    if (focusedField() === "claudeMode" && evt.name === "space") {
      evt.preventDefault()
      setClaudeSessionMode(claudeSessionMode() === "new" ? "resume" : "new")
    }
  })

  const title = createMemo(() => (isEdit() ? "Edit Template" : "Create Template"))

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {title()}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.pop()}>
            esc
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} gap={1}>
        <text fg={focusedField() === "name" ? theme.primary : theme.textMuted}>Template Name</text>
        <box onMouseUp={() => setFocusedField("name")}>
          <input
            value={name()}
            onInput={setName}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              nameInputRef = r
              setTimeout(() => {
                if (focusedField() === "name") {
                  nameInputRef?.focus()
                }
              }, 1)
            }}
          />
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "tool" ? theme.primary : theme.textMuted}>Tool</text>
        <For each={TOOLS}>
          {(tool, idx) => (
            <box
              flexDirection="row"
              gap={1}
              paddingLeft={1}
              onMouseUp={() => {
                setToolIndex(idx())
                setSelectedTool(tool.value)
                setFocusedField("tool")
              }}
              backgroundColor={selectedTool() === tool.value ? theme.backgroundElement : undefined}
            >
              <text fg={selectedTool() === tool.value ? theme.primary : theme.textMuted}>
                {selectedTool() === tool.value ? "●" : "○"}
              </text>
              <text fg={theme.text}>{tool.label}</text>
              <text fg={theme.textMuted}>- {tool.description}</text>
            </box>
          )}
        </For>
      </box>

      <Show when={selectedTool() === "custom"}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
          <text fg={focusedField() === "customCommand" ? theme.primary : theme.textMuted}>Custom Command</text>
          <box onMouseUp={() => setFocusedField("customCommand")}>
            <input
              value={customCommand()}
              onInput={setCustomCommand}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              ref={(r) => {
                customCommandInputRef = r
              }}
            />
          </box>
        </box>
      </Show>

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "projectPath" ? theme.primary : theme.textMuted}>Project Path</text>
        <box onMouseUp={() => setFocusedField("projectPath")}>
          <input
            value={projectPath()}
            onInput={setProjectPath}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              projectPathInputRef = r
            }}
          />
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "groupPath" ? theme.primary : theme.textMuted}>Group Path (optional)</text>
        <box onMouseUp={() => setFocusedField("groupPath")}>
          <input
            value={groupPath()}
            onInput={setGroupPath}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              groupPathInputRef = r
            }}
          />
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <box
          flexDirection="row"
          gap={1}
          onMouseUp={() => {
            setFocusedField("useWorktree")
            setUseWorktree(!useWorktree())
          }}
        >
          <text fg={focusedField() === "useWorktree" ? theme.primary : theme.textMuted}>
            {useWorktree() ? "[x]" : "[ ]"}
          </text>
          <text fg={focusedField() === "useWorktree" ? theme.text : theme.textMuted}>Use git worktree</text>
        </box>
      </box>

      <Show when={useWorktree()}>
        <box paddingLeft={8} paddingRight={4} paddingTop={1} gap={1}>
          <text fg={focusedField() === "worktreeBranch" ? theme.primary : theme.textMuted}>
            Worktree Branch (optional)
          </text>
          <box onMouseUp={() => setFocusedField("worktreeBranch")}>
            <input
              value={worktreeBranch()}
              onInput={setWorktreeBranch}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              ref={(r) => {
                worktreeBranchInputRef = r
              }}
            />
          </box>
        </box>
      </Show>

      <Show when={selectedTool() === "claude"}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setFocusedField("claudeMode")
              setClaudeSessionMode(claudeSessionMode() === "new" ? "resume" : "new")
            }}
          >
            <text fg={focusedField() === "claudeMode" ? theme.primary : theme.textMuted}>
              {claudeSessionMode() === "resume" ? "[x]" : "[ ]"}
            </text>
            <text fg={focusedField() === "claudeMode" ? theme.text : theme.textMuted}>
              Resume previous Claude session
            </text>
          </box>
        </box>
      </Show>

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focusedField() === "startupActions" ? theme.primary : theme.textMuted}>
          Startup Actions (separate with ";" or new lines)
        </text>
        <box onMouseUp={() => setFocusedField("startupActions")}>
          <input
            placeholder="pnpm install ; pnpm test"
            value={startupActionsText()}
            onInput={setStartupActionsText}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              startupActionsInputRef = r
            }}
          />
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={2}>
        <box
          backgroundColor={saving() ? theme.backgroundElement : theme.primary}
          padding={1}
          onMouseUp={() => void handleSave()}
          alignItems="center"
        >
          <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
            {saving() ? "Saving..." : isEdit() ? "Save Template" : "Create Template"}
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Tab: next field | Enter: save | Esc: cancel</text>
      </box>
    </box>
  )
}

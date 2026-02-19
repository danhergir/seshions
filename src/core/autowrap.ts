import { spawnSync } from "child_process"
import { constants as fsConstants } from "fs"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile
} from "fs/promises"
import os from "os"
import path from "path"

const TOOLS = ["codex", "claude", "gemini"] as const
const WRAPPER_MARKER = "# seshions-managed-wrapper"
const APP_DIR = path.join(os.homedir(), ".seshions")
const STATE_PATH = path.join(APP_DIR, "autowrap.json")
const BACKUP_DIR = path.join(APP_DIR, "autowrap", "backups")
const LOCAL_BIN = path.join(os.homedir(), ".local", "bin")
const PROFILE_MARKER_START = "# >>> seshions autowrap >>>"
const PROFILE_MARKER_END = "# <<< seshions autowrap <<<"

type WrappedTool = typeof TOOLS[number]

interface ToolState {
  enabled?: boolean
  wrapperPath?: string
  targetPath?: string
  backupPath?: string
}

interface AutoWrapState {
  version: 1
  enabled: boolean
  promptedAt: number
  tools: Record<string, ToolState>
}

interface PathFixResult {
  updated: boolean
  profilePaths: string[]
  shell: string
  supported: boolean
}

function defaultState(): AutoWrapState {
  return {
    version: 1,
    enabled: false,
    promptedAt: 0,
    tools: {}
  }
}

function quoteShell(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function getWrapInvoker(): string {
  const scriptPath = process.argv[1] || ""
  if (scriptPath && scriptPath.endsWith(".js")) {
    return `${quoteShell(process.execPath)} ${quoteShell(path.resolve(scriptPath))}`
  }
  return quoteShell(process.execPath)
}

function getShellName(): string {
  return path.basename(process.env.SHELL || "")
}

function getProfilePaths(): string[] {
  const shell = getShellName()
  const home = os.homedir()

  if (shell === "zsh") {
    return [path.join(home, ".zprofile"), path.join(home, ".zshrc")]
  }
  if (shell === "bash") {
    return [path.join(home, ".bash_profile"), path.join(home, ".bashrc")]
  }
  if (shell === "fish") {
    return [path.join(home, ".config", "fish", "config.fish")]
  }
  return []
}

function getActiveCommandPath(command: string): string {
  const result = spawnSync("which", [command], { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout) return ""
  return result.stdout.trim().split("\n")[0]?.trim() || ""
}

function isPathConfigured(): boolean {
  const currentPath = process.env.PATH || ""
  const entries = currentPath.split(path.delimiter).filter(Boolean)
  return entries.includes(LOCAL_BIN)
}

async function readState(): Promise<AutoWrapState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as Partial<AutoWrapState>

    return {
      version: 1,
      enabled: Boolean(parsed?.enabled),
      promptedAt: Number(parsed?.promptedAt) || 0,
      tools: parsed?.tools && typeof parsed.tools === "object" ? parsed.tools : {}
    }
  } catch {
    return defaultState()
  }
}

async function writeState(state: AutoWrapState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true, mode: 0o700 })
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8")
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function isExecutable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function isManagedWrapper(wrapperPath: string): Promise<boolean> {
  try {
    const raw = await readFile(wrapperPath, "utf8")
    return raw.includes(WRAPPER_MARKER)
  } catch {
    return false
  }
}

function whichAll(command: string): string[] {
  const result = spawnSync("which", ["-a", command], { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout) return []

  const seen = new Set<string>()
  const items: string[] = []
  for (const line of result.stdout.split("\n")) {
    const item = line.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    items.push(item)
  }

  return items
}

async function resolveToolBinary(
  tool: WrappedTool,
  wrapperPath: string,
  stateEntry?: ToolState
): Promise<string> {
  if (stateEntry?.targetPath && await isExecutable(stateEntry.targetPath)) {
    return stateEntry.targetPath
  }

  const candidates = whichAll(tool)
  for (const candidate of candidates) {
    if (path.resolve(candidate) === path.resolve(wrapperPath)) continue
    if (await isExecutable(candidate)) return candidate
  }

  return ""
}

function buildWrapperScript(tool: WrappedTool, targetPath: string, wrapInvoker: string): string {
  return `#!/usr/bin/env bash
${WRAPPER_MARKER}
set -euo pipefail

if [[ "\${SESHIONS_WRAP_BYPASS:-0}" == "1" ]]; then
  exec ${quoteShell(targetPath)} "$@"
fi

exec ${wrapInvoker} __wrap ${quoteShell(tool)} -- "$@"
`
}

async function backupFile(sourcePath: string, backupPath: string): Promise<void> {
  await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 })
  await copyFile(sourcePath, backupPath)
  await unlink(sourcePath)
}

async function restoreBackup(backupPath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o755 })
  await copyFile(backupPath, targetPath)
  await chmod(targetPath, 0o755)
  await unlink(backupPath)
}

async function appendPathBlock(profilePath: string, shell: string): Promise<boolean> {
  let current = ""
  try {
    current = await readFile(profilePath, "utf8")
  } catch {
    current = ""
  }

  if (current.includes(PROFILE_MARKER_START) && current.includes(PROFILE_MARKER_END)) {
    return false
  }

  const block = shell === "fish"
    ? `${PROFILE_MARKER_START}
if not contains $HOME/.local/bin $PATH
  set -gx PATH $HOME/.local/bin $PATH
end
${PROFILE_MARKER_END}
`
    : `${PROFILE_MARKER_START}
export PATH="$HOME/.local/bin:$PATH"
${PROFILE_MARKER_END}
`

  const prefix = current.trim().length === 0 ? "" : "\n"
  await mkdir(path.dirname(profilePath), { recursive: true, mode: 0o755 })
  await writeFile(profilePath, `${current}${prefix}${block}`, "utf8")
  return true
}

async function applyPathFix(): Promise<PathFixResult> {
  if (isPathConfigured()) {
    return { updated: false, profilePaths: [], shell: getShellName() || "unknown", supported: true }
  }

  const shell = getShellName() || "unknown"
  const profilePaths = getProfilePaths()
  if (profilePaths.length === 0) {
    return { updated: false, profilePaths: [], shell, supported: false }
  }

  let updated = false
  for (const profilePath of profilePaths) {
    const changed = await appendPathBlock(profilePath, shell)
    updated = updated || changed
  }

  return { updated, profilePaths, shell, supported: true }
}

export async function getAutoWrapStatus() {
  const state = await readState()
  const tools = []

  for (const tool of TOOLS) {
    const entry = state.tools?.[tool] || {}
    const wrapperPath = entry.wrapperPath || path.join(LOCAL_BIN, tool)
    const targetPath = entry.targetPath || ""
    const wrapperExists = await pathExists(wrapperPath)
    const managed = wrapperExists ? await isManagedWrapper(wrapperPath) : false
    const targetExists = targetPath ? await pathExists(targetPath) : false
    const activePath = getActiveCommandPath(tool)
    const activeManaged = managed && activePath && path.resolve(activePath) === path.resolve(wrapperPath)

    tools.push({
      tool,
      wrapperPath,
      targetPath,
      wrapperExists,
      managed,
      targetExists,
      activePath,
      activeManaged
    })
  }

  return {
    enabled: Boolean(state.enabled),
    promptedAt: Number(state.promptedAt) || 0,
    pathConfigured: isPathConfigured(),
    localBin: LOCAL_BIN,
    tools
  }
}

export async function markPromptSeen(): Promise<void> {
  const state = await readState()
  if (!state.promptedAt) {
    state.promptedAt = Date.now()
    await writeState(state)
  }
}

export async function enableAutoWrap(options?: { attemptPathFix?: boolean; markPromptSeen?: boolean }) {
  const state = await readState()
  const timestamp = Date.now()
  const wrapInvoker = getWrapInvoker()
  const installed: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  await mkdir(LOCAL_BIN, { recursive: true, mode: 0o755 })
  await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 })

  for (const tool of TOOLS) {
    const wrapperPath = path.join(LOCAL_BIN, tool)
    const previousEntry = state.tools?.[tool] || {}
    let backupPath = previousEntry.backupPath || ""

    const hasWrapper = await pathExists(wrapperPath)
    const alreadyManaged = hasWrapper ? await isManagedWrapper(wrapperPath) : false

    if (hasWrapper && !alreadyManaged) {
      backupPath = path.join(BACKUP_DIR, `${tool}-${timestamp}.bak`)
      await backupFile(wrapperPath, backupPath)
    }

    const targetPath = await resolveToolBinary(tool, wrapperPath, previousEntry)
    if (!targetPath) {
      if (backupPath && await pathExists(backupPath) && !(await pathExists(wrapperPath))) {
        await restoreBackup(backupPath, wrapperPath)
        backupPath = ""
      }
      skipped.push(tool)
      errors.push(`[${tool}] command not found in PATH`)
      continue
    }

    const script = buildWrapperScript(tool, targetPath, wrapInvoker)
    await writeFile(wrapperPath, script, "utf8")
    await chmod(wrapperPath, 0o755)

    state.tools[tool] = {
      enabled: true,
      wrapperPath,
      targetPath,
      backupPath
    }
    installed.push(tool)
  }

  state.enabled = installed.length > 0
  if (options?.markPromptSeen || !state.promptedAt) {
    state.promptedAt = Date.now()
  }
  await writeState(state)

  const pathFix = options?.attemptPathFix
    ? await applyPathFix()
    : { updated: false, profilePaths: [], shell: getShellName() || "unknown", supported: true }

  const status = await getAutoWrapStatus()
  const notActive = status.tools
    .filter((tool) => installed.includes(tool.tool) && !tool.activeManaged)
    .map((tool) => tool.tool)

  return {
    installed,
    skipped,
    errors,
    notActive,
    pathFix,
    localBin: LOCAL_BIN
  }
}

export async function disableAutoWrap() {
  const state = await readState()
  const restored: string[] = []
  const removed: string[] = []
  const errors: string[] = []

  for (const tool of TOOLS) {
    const entry = state.tools?.[tool] || {}
    const wrapperPath = entry.wrapperPath || path.join(LOCAL_BIN, tool)
    const backupPath = entry.backupPath || ""

    try {
      if (await pathExists(wrapperPath)) {
        if (await isManagedWrapper(wrapperPath)) {
          await rm(wrapperPath, { force: true })
          removed.push(tool)
        }
      }

      if (backupPath && await pathExists(backupPath) && !(await pathExists(wrapperPath))) {
        await restoreBackup(backupPath, wrapperPath)
        restored.push(tool)
      }

      state.tools[tool] = {
        enabled: false,
        wrapperPath,
        targetPath: entry.targetPath || "",
        backupPath: ""
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`[${tool}] ${message}`)
    }
  }

  state.enabled = false
  if (!state.promptedAt) {
    state.promptedAt = Date.now()
  }
  await writeState(state)

  return { removed, restored, errors }
}

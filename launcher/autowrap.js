import { spawnSync } from "node:child_process"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import os from "node:os"
import path from "node:path"

const TOOLS = ["codex", "claude", "gemini"]
const WRAPPER_MARKER = "# seshions-managed-wrapper"
const APP_DIR = path.join(os.homedir(), ".seshions")
const STATE_PATH = path.join(APP_DIR, "autowrap.json")
const BACKUP_DIR = path.join(APP_DIR, "autowrap", "backups")
const LOCAL_BIN = path.join(os.homedir(), ".local", "bin")
const PROFILE_MARKER_START = "# >>> seshions autowrap >>>"
const PROFILE_MARKER_END = "# <<< seshions autowrap <<<"

function defaultState() {
  return {
    version: 1,
    enabled: false,
    promptedAt: 0,
    tools: {}
  }
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function getWrapInvoker() {
  const scriptPath = process.argv[1] || ""
  if (scriptPath && scriptPath.endsWith(".js")) {
    return `${quoteShell(process.execPath)} ${quoteShell(path.resolve(scriptPath))}`
  }
  return quoteShell(process.execPath)
}

function getShellName() {
  return path.basename(process.env.SHELL || "")
}

function getProfilePaths() {
  const shell = getShellName()
  const home = os.homedir()
  if (shell === "zsh") return [path.join(home, ".zprofile"), path.join(home, ".zshrc")]
  if (shell === "bash") return [path.join(home, ".bash_profile"), path.join(home, ".bashrc")]
  if (shell === "fish") return [path.join(home, ".config", "fish", "config.fish")]
  return []
}

function isPathConfigured() {
  const currentPath = process.env.PATH || ""
  const entries = currentPath.split(path.delimiter).filter(Boolean)
  return entries.includes(LOCAL_BIN)
}

async function readState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw)
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

async function writeState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true, mode: 0o700 })
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8")
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function isExecutable(targetPath) {
  try {
    await access(targetPath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function isManagedWrapper(wrapperPath) {
  try {
    const raw = await readFile(wrapperPath, "utf8")
    return raw.includes(WRAPPER_MARKER)
  } catch {
    return false
  }
}

function whichAll(command) {
  const result = spawnSync("which", ["-a", command], { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout) return []

  const seen = new Set()
  const items = []
  for (const line of result.stdout.split("\n")) {
    const item = line.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    items.push(item)
  }
  return items
}

function getActiveCommandPath(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout) return ""
  return result.stdout.trim().split("\n")[0]?.trim() || ""
}

async function resolveToolBinary(tool, wrapperPath, stateEntry) {
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

function buildWrapperScript(tool, targetPath, wrapInvoker) {
  return `#!/usr/bin/env bash
${WRAPPER_MARKER}
set -euo pipefail

if [[ "\${SESHIONS_WRAP_BYPASS:-0}" == "1" ]]; then
  exec ${quoteShell(targetPath)} "$@"
fi

exec ${wrapInvoker} __wrap ${quoteShell(tool)} -- "$@"
`
}

async function backupFile(sourcePath, backupPath) {
  await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 })
  await copyFile(sourcePath, backupPath)
  await unlink(sourcePath)
}

async function restoreBackup(backupPath, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o755 })
  await copyFile(backupPath, targetPath)
  await chmod(targetPath, 0o755)
  await unlink(backupPath)
}

async function applyPathFix() {
  if (isPathConfigured()) {
    return { updated: false, profilePaths: [], shell: getShellName() || "unknown", supported: true }
  }

  const profilePaths = getProfilePaths()
  const shell = getShellName() || "unknown"
  if (profilePaths.length === 0) {
    return { updated: false, profilePaths: [], shell, supported: false }
  }

  let updated = false
  const block = shell === "fish" ? `${PROFILE_MARKER_START}
if not contains $HOME/.local/bin $PATH
  set -gx PATH $HOME/.local/bin $PATH
end
${PROFILE_MARKER_END}
` : `${PROFILE_MARKER_START}
export PATH="$HOME/.local/bin:$PATH"
${PROFILE_MARKER_END}
`

  for (const profilePath of profilePaths) {
    let current = ""
    try {
      current = await readFile(profilePath, "utf8")
    } catch {
      current = ""
    }

    if (current.includes(PROFILE_MARKER_START) && current.includes(PROFILE_MARKER_END)) {
      continue
    }

    const prefix = current.trim().length === 0 ? "" : "\n"
    await mkdir(path.dirname(profilePath), { recursive: true, mode: 0o755 })
    await writeFile(profilePath, `${current}${prefix}${block}`, "utf8")
    updated = true
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

export async function markPromptSeen() {
  const state = await readState()
  if (!state.promptedAt) {
    state.promptedAt = Date.now()
    await writeState(state)
  }
}

export async function enableAutoWrap(options = {}) {
  const state = await readState()
  const timestamp = Date.now()
  const wrapInvoker = getWrapInvoker()
  const installed = []
  const skipped = []
  const errors = []

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
  if (options.markPromptSeen || !state.promptedAt) {
    state.promptedAt = Date.now()
  }
  await writeState(state)

  const pathFix = options.attemptPathFix ? await applyPathFix() : {
    updated: false,
    profilePaths: [],
    shell: getShellName() || "unknown",
    supported: true
  }

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
  const restored = []
  const removed = []
  const errors = []

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

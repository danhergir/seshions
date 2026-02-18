import fs from "fs"
import * as fsp from "fs/promises"
import os from "os"
import path from "path"

export const APP_NAME = "agent-view"
export const LEGACY_APP_NAME = "agent-orchestrator"
export const COMPATIBILITY_WINDOW_NOTICE =
  "Compatibility aliases are temporary and will be removed in the next release."

export const PRIMARY_COMMANDS = ["agent-view", "av"] as const
export const LEGACY_COMMANDS = ["agent-orchestrator", "ao"] as const

export const SESSION_PREFIX = "agentview_"
export const LEGACY_SESSION_PREFIX = "agentorch_"

export function getAppDir(): string {
  return path.join(os.homedir(), ".agent-view")
}

export function getLegacyAppDir(): string {
  return path.join(os.homedir(), ".agent-orchestrator")
}

export function getConfigPath(): string {
  return path.join(getAppDir(), "config.json")
}

export function getLegacyConfigPath(): string {
  return path.join(getLegacyAppDir(), "config.json")
}

export function getStateDbPath(): string {
  return path.join(getAppDir(), "state.db")
}

export function getLegacyStateDbPath(): string {
  return path.join(getLegacyAppDir(), "state.db")
}

export function getDebugLogPath(): string {
  return path.join(getAppDir(), "debug.log")
}

export function ensureAppDirSync(): void {
  fs.mkdirSync(getAppDir(), { recursive: true, mode: 0o700 })
}

export interface LegacyMigrationResult {
  migrated: string[]
  warnings: string[]
}

async function copyIfMissing(source: string, destination: string, label: string, result: LegacyMigrationResult) {
  try {
    const sourceExists = fs.existsSync(source)
    const destinationExists = fs.existsSync(destination)
    if (!sourceExists || destinationExists) return

    await fsp.copyFile(source, destination)
    result.migrated.push(label)
  } catch (err: any) {
    result.warnings.push(`${label}: ${err.message}`)
  }
}

export async function migrateLegacyAppData(): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { migrated: [], warnings: [] }

  await fsp.mkdir(getAppDir(), { recursive: true, mode: 0o700 })

  const legacyDb = getLegacyStateDbPath()
  const currentDb = getStateDbPath()

  await copyIfMissing(getLegacyConfigPath(), getConfigPath(), "config", result)
  await copyIfMissing(legacyDb, currentDb, "state.db", result)
  await copyIfMissing(`${legacyDb}-wal`, `${currentDb}-wal`, "state.db-wal", result)
  await copyIfMissing(`${legacyDb}-shm`, `${currentDb}-shm`, "state.db-shm", result)
  await copyIfMissing(path.join(getLegacyAppDir(), "debug.log"), getDebugLogPath(), "debug.log", result)

  return result
}

export function resolveStateDbPathWithFallback(): { path: string; usingLegacy: boolean } {
  const primaryPath = getStateDbPath()
  if (fs.existsSync(primaryPath)) {
    return { path: primaryPath, usingLegacy: false }
  }

  const legacyPath = getLegacyStateDbPath()
  if (fs.existsSync(legacyPath)) {
    return { path: legacyPath, usingLegacy: true }
  }

  return { path: primaryPath, usingLegacy: false }
}

export function getLegacyCommandWarning(invokedName: string | undefined): string | null {
  if (!invokedName) return null
  if (!LEGACY_COMMANDS.includes(invokedName as typeof LEGACY_COMMANDS[number])) {
    return null
  }

  return `[deprecation] '${invokedName}' is an old alias. Use 'agent-view' or 'av'. ${COMPATIBILITY_WINDOW_NOTICE}`
}

import fs from "fs"
import os from "os"
import path from "path"

export const APP_NAME = "seshions"
export const PRIMARY_COMMANDS = ["seshions"] as const
export const SESSION_PREFIX = "seshions_"

export function getAppDir(): string {
  return path.join(os.homedir(), ".seshions")
}

export function getConfigPath(): string {
  return path.join(getAppDir(), "config.json")
}

export function getStateDbPath(): string {
  return path.join(getAppDir(), "state.json")
}

export function getDebugLogPath(): string {
  return path.join(getAppDir(), "debug.log")
}

export function ensureAppDirSync(): void {
  fs.mkdirSync(getAppDir(), { recursive: true, mode: 0o700 })
}

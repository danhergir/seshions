/**
 * Configuration loader for agent-view
 * Reads from ~/.agent-view/config.json
 */

import * as fs from "fs/promises"
import type { Tool } from "./types"
import {
  getAppDir,
  getConfigPath as getPrimaryConfigPath,
  getLegacyConfigPath,
  COMPATIBILITY_WINDOW_NOTICE
} from "./app-paths"

export interface WorktreeConfig {
  defaultBaseBranch?: string
  autoCleanup?: boolean
}

export interface AppConfig {
  defaultTool?: Tool
  theme?: string
  worktree?: WorktreeConfig
  defaultGroup?: string
}

const CONFIG_DIR = getAppDir()
const CONFIG_PATH = getPrimaryConfigPath()
const LEGACY_CONFIG_PATH = getLegacyConfigPath()

const DEFAULT_CONFIG: AppConfig = {
  defaultTool: "claude",
  theme: "dark",
  worktree: {
    defaultBaseBranch: "main",
    autoCleanup: true
  },
  defaultGroup: "default"
}

// Cached config for sync access
let cachedConfig: AppConfig = { ...DEFAULT_CONFIG }

/**
 * Ensure the config directory exists
 */
export async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true })
  } catch (err) {
    // Directory might already exist
  }
}

/**
 * Load configuration from disk, merging with defaults
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8")
    const parsed = JSON.parse(content) as Partial<AppConfig>

    // Deep merge with defaults
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      worktree: {
        ...DEFAULT_CONFIG.worktree,
        ...parsed.worktree
      }
    }

    return cachedConfig
  } catch (err: any) {
    if (err.code === "ENOENT") {
      try {
        const legacyContent = await fs.readFile(LEGACY_CONFIG_PATH, "utf-8")
        const parsed = JSON.parse(legacyContent) as Partial<AppConfig>

        cachedConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          worktree: {
            ...DEFAULT_CONFIG.worktree,
            ...parsed.worktree
          }
        }

        console.warn(
          `[deprecation] Loaded config from legacy path '${LEGACY_CONFIG_PATH}'. ${COMPATIBILITY_WINDOW_NOTICE}`
        )
        return cachedConfig
      } catch (legacyErr: any) {
        if (legacyErr.code !== "ENOENT") {
          console.warn(
            `Warning: Failed to load legacy config from ${LEGACY_CONFIG_PATH}: ${legacyErr.message}`
          )
        }
      }

      cachedConfig = { ...DEFAULT_CONFIG }
      return cachedConfig
    }

    // Invalid JSON or other error - log warning and use defaults
    console.warn(`Warning: Failed to load config from ${CONFIG_PATH}: ${err.message}`)
    cachedConfig = { ...DEFAULT_CONFIG }
    return cachedConfig
  }
}

/**
 * Get the cached config synchronously
 * Call loadConfig() first to ensure config is loaded
 */
export function getConfig(): AppConfig {
  return cachedConfig
}

/**
 * Save configuration to disk
 */
export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir()
  const content = JSON.stringify(config, null, 2)
  await fs.writeFile(CONFIG_PATH, content, "utf-8")
  cachedConfig = config
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH
}

/**
 * Get default config (for reference)
 */
export function getDefaultConfig(): AppConfig {
  return { ...DEFAULT_CONFIG }
}

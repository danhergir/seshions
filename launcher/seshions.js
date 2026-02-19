#!/usr/bin/env node

import { spawn } from "node:child_process"
import { createInterface } from "node:readline/promises"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ensureRuntime } from "../scripts/runtime/resolve-runtime.mjs"
import {
  disableAutoWrap,
  enableAutoWrap,
  getAutoWrapStatus,
  markPromptSeen
} from "./autowrap.js"

const APP = "seshions"
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const UPDATE_TIMEOUT_MS = 1500
const UPDATE_STATE_PATH = path.join(os.homedir(), ".seshions", "update-check.json")
const WRAP_PROMPT_ENV = "SESHIONS_SKIP_AUTOWRAP_PROMPT"

function printHelp() {
  console.log(`
Seshions - Terminal Agent Management

Usage:
  seshions [options]
  seshions enable [--no-path-fix]
  seshions disable
  seshions status

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --light        Use light mode theme

Commands:
  enable         Install wrappers for codex/claude/gemini
  disable        Remove wrappers and restore previous commands
  status         Show auto-wrap status
`)
}

async function readPackageVersion() {
  const packagePath = new URL("../package.json", import.meta.url)
  const pkg = JSON.parse(await readFile(packagePath, "utf8"))
  return String(pkg.version || "").replace(/^v/, "")
}

function normalizeVersion(version) {
  return String(version || "").replace(/^v/, "").trim()
}

function isNewerVersion(latest, current) {
  const a = normalizeVersion(latest).split(".").map((part) => Number(part) || 0)
  const b = normalizeVersion(current).split(".").map((part) => Number(part) || 0)
  const size = Math.max(a.length, b.length, 3)

  for (let i = 0; i < size; i += 1) {
    const left = a[i] || 0
    const right = b[i] || 0
    if (left > right) return true
    if (left < right) return false
  }

  return false
}

async function readUpdateState() {
  try {
    const raw = await readFile(UPDATE_STATE_PATH, "utf8")
    const parsed = JSON.parse(raw)
    return {
      lastCheckedAt: Number(parsed?.lastCheckedAt) || 0,
      latestVersion: normalizeVersion(parsed?.latestVersion || "")
    }
  } catch {
    return { lastCheckedAt: 0, latestVersion: "" }
  }
}

async function writeUpdateState(state) {
  try {
    await mkdir(path.dirname(UPDATE_STATE_PATH), { recursive: true })
    await writeFile(UPDATE_STATE_PATH, JSON.stringify(state), "utf8")
  } catch {
    // Ignore update cache errors.
  }
}

async function fetchLatestNpmVersion() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS)

  try {
    const response = await fetch(`https://registry.npmjs.org/${APP}/latest`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`npm registry error (${response.status})`)
    }

    const data = await response.json()
    return normalizeVersion(data?.version || "")
  } finally {
    clearTimeout(timeout)
  }
}

function printUpdateHint(currentVersion, latestVersion) {
  console.log(
    `[seshions] Update available: v${currentVersion} -> v${latestVersion}. Run: npm install -g seshions@latest`
  )
}

async function maybeNotifyUpdate(currentVersion) {
  if (process.env.SESHIONS_DISABLE_UPDATE_CHECK === "1") {
    return
  }

  const state = await readUpdateState()
  const now = Date.now()
  const shouldRefresh = now - state.lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS

  if (state.latestVersion && isNewerVersion(state.latestVersion, currentVersion)) {
    printUpdateHint(currentVersion, state.latestVersion)
  }

  if (!shouldRefresh) {
    return
  }

  try {
    const latestVersion = await fetchLatestNpmVersion()
    await writeUpdateState({ lastCheckedAt: now, latestVersion })

    if (latestVersion && isNewerVersion(latestVersion, currentVersion) && latestVersion !== state.latestVersion) {
      printUpdateHint(currentVersion, latestVersion)
    }
  } catch {
    await writeUpdateState({ lastCheckedAt: now, latestVersion: state.latestVersion })
  }
}

function shouldPromptForAutoWrap(args) {
  if (process.env[WRAP_PROMPT_ENV] === "1") return false
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  if (args.length === 0) return true
  return args.every((arg) => arg.startsWith("-"))
}

async function promptAutoWrapSetup() {
  const status = await getAutoWrapStatus()
  if (status.enabled || status.promptedAt > 0) return

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    console.log("")
    console.log("[seshions] Optional setup: auto-wrap codex/claude/gemini into tmux for automatic session tracking.")
    const answer = await rl.question("[seshions] Enable now? [Y/n] ")
    const normalized = answer.trim().toLowerCase()
    const accept = normalized === "" || normalized === "y" || normalized === "yes"

    if (!accept) {
      await markPromptSeen()
      console.log("[seshions] Auto-wrap disabled. You can enable later with: seshions enable")
      return
    }

    const result = await enableAutoWrap({
      attemptPathFix: true,
      markPromptSeen: true
    })

    if (result.installed.length > 0) {
      console.log(`[seshions] Auto-wrap enabled for: ${result.installed.join(", ")}`)
    } else {
      console.log("[seshions] Auto-wrap could not be enabled for any tool.")
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(`[seshions] ${err}`)
      }
    }

    if (result.pathFix.updated) {
      console.log(`[seshions] Added ~/.local/bin to PATH in: ${result.pathFix.profilePaths.join(", ")}. Restart your shell to apply.`)
    } else if (!status.pathConfigured) {
      if (result.pathFix.supported) {
        console.log("[seshions] Ensure ~/.local/bin is in your PATH for wrappers to take effect.")
      } else {
        console.log(`[seshions] Could not auto-update PATH for shell '${result.pathFix.shell}'. Add ~/.local/bin manually.`)
      }
    }

    if (result.notActive.length > 0) {
      console.log(`[seshions] Not active yet (PATH order): ${result.notActive.join(", ")}`)
      console.log("[seshions] Run `which codex` / `which claude` / `which gemini` and ensure they resolve to ~/.local/bin.")
    }
  } finally {
    rl.close()
  }
}

async function runAutoWrapCommand(command, args) {
  if (command === "status") {
    const status = await getAutoWrapStatus()
    console.log(`Auto-wrap: ${status.enabled ? "enabled" : "disabled"}`)
    console.log(`PATH includes ~/.local/bin: ${status.pathConfigured ? "yes" : "no"}`)
    for (const tool of status.tools) {
      const mode = tool.activeManaged
        ? "active"
        : tool.managed
          ? "installed-not-active"
          : tool.wrapperExists
            ? "custom"
            : "missing"
      const target = tool.targetPath ? ` -> ${tool.targetPath}` : ""
      const activePath = tool.activePath ? ` (which: ${tool.activePath})` : ""
      console.log(`- ${tool.tool}: ${mode}${target}${activePath}`)
    }
    return true
  }

  if (command === "enable") {
    const attemptPathFix = !args.includes("--no-path-fix")
    const result = await enableAutoWrap({ attemptPathFix, markPromptSeen: true })

    if (result.installed.length > 0) {
      console.log(`Enabled: ${result.installed.join(", ")}`)
    } else {
      console.log("Enabled: none")
    }

    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.join(", ")}`)
    }

    for (const err of result.errors) {
      console.log(`Error: ${err}`)
    }

    if (result.pathFix.updated) {
      console.log(`PATH updated in: ${result.pathFix.profilePaths.join(", ")}. Restart your shell.`)
    } else if (!result.pathFix.supported) {
      console.log(`Could not auto-update PATH for shell '${result.pathFix.shell}'. Add ~/.local/bin manually.`)
    }

    if (result.notActive.length > 0) {
      console.log(`Not active yet (PATH order): ${result.notActive.join(", ")}`)
      console.log("Run `which codex` / `which claude` / `which gemini` and ensure they resolve to ~/.local/bin.")
    }

    return true
  }

  if (command === "disable") {
    const result = await disableAutoWrap()
    if (result.removed.length > 0) {
      console.log(`Removed wrappers: ${result.removed.join(", ")}`)
    } else {
      console.log("Removed wrappers: none")
    }

    if (result.restored.length > 0) {
      console.log(`Restored previous commands: ${result.restored.join(", ")}`)
    }

    for (const err of result.errors) {
      console.log(`Error: ${err}`)
    }

    return true
  }

  return false
}

async function main() {
  const args = process.argv.slice(2)
  const installedVersion = await readPackageVersion()
  const command = args[0] || ""

  if (command === "--help" || command === "-h") {
    printHelp()
    return
  }

  if (command === "--version" || command === "-v") {
    console.log(installedVersion)
    return
  }

  if (await runAutoWrapCommand(command, args.slice(1))) {
    return
  }

  if (shouldPromptForAutoWrap(args)) {
    await promptAutoWrapSetup()
  }

  if (command !== "__wrap") {
    await maybeNotifyUpdate(installedVersion)
  }

  const desiredVersion = process.env.SESHIONS_RUNTIME_VERSION || installedVersion
  const runtime = await ensureRuntime({
    version: desiredVersion,
    allowLatestFallback: true
  })

  const child = spawn(runtime.binaryPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_PTY_PREBUILDS: runtime.prebuildsPath
    }
  })

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })

  child.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[seshions] Failed to launch runtime: ${message}`)
    process.exit(1)
  })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[seshions] ${message}`)
  process.exit(1)
})

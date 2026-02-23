#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { ensureRuntime } from "../scripts/runtime/resolve-runtime.mjs"

const APP = "seshions"
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const UPDATE_TIMEOUT_MS = 1500
const UPDATE_STATE_PATH = path.join(os.homedir(), ".seshions", "update-check.json")
const UPDATE_CMD = "npm install -g seshions@latest"

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

async function resolveLatestVersion(currentVersion) {
  if (process.env.SESHIONS_DISABLE_UPDATE_CHECK === "1") {
    return ""
  }

  const state = await readUpdateState()
  const now = Date.now()
  const shouldRefresh = now - state.lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS

  if (!shouldRefresh) {
    return state.latestVersion
  }

  try {
    const latestVersion = await fetchLatestNpmVersion()
    await writeUpdateState({ lastCheckedAt: now, latestVersion })
    return latestVersion
  } catch {
    await writeUpdateState({ lastCheckedAt: now, latestVersion: state.latestVersion })
    return state.latestVersion
  }
}

function canPromptInTerminal() {
  return process.stdin.isTTY && process.stdout.isTTY
}

async function askUpdateConfirmation(currentVersion, latestVersion) {
  if (!canPromptInTerminal()) {
    return false
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    const answer = await rl.question(
      `[seshions] Update available: v${currentVersion} -> v${latestVersion}\nInstall now? (yes/no): `
    )
    const normalized = String(answer || "").trim().toLowerCase()
    return normalized === "yes" || normalized === "y"
  } finally {
    rl.close()
  }
}

function installLatestNow() {
  const result = spawnSync("npm", ["install", "-g", "seshions@latest"], {
    stdio: "inherit",
    env: process.env
  })
  return result.status === 0
}

async function maybeHandleUpdate(currentVersion) {
  const latestVersion = await resolveLatestVersion(currentVersion)
  if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) {
    return { updated: false, blocked: false }
  }

  console.log(`[seshions] Installed version: v${currentVersion}`)
  console.log(`[seshions] Latest version:    v${latestVersion}`)
  console.log("[seshions] You must update before continuing.")
  printUpdateHint(currentVersion, latestVersion)

  const shouldInstall = await askUpdateConfirmation(currentVersion, latestVersion)
  if (!shouldInstall) {
    console.error("[seshions] Update required. Exiting.")
    return { updated: false, blocked: true }
  }

  const installed = installLatestNow()
  if (!installed) {
    console.error("[seshions] Update failed. Exiting.")
    return { updated: false, blocked: true }
  }

  console.log("[seshions] Update installed. Please run seshions again.")
  return { updated: true, blocked: true }
}

async function main() {
  const args = process.argv.slice(2)
  const installedVersion = await readPackageVersion()

  if (args.includes("--version") || args.includes("-v")) {
    console.log(installedVersion)
    return
  }

  const updateResult = await maybeHandleUpdate(installedVersion)
  if (updateResult.blocked || updateResult.updated) {
    return
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

#!/usr/bin/env node

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { ensureRuntime } from "../scripts/runtime/resolve-runtime.mjs"

async function readPackageVersion() {
  const packagePath = new URL("../package.json", import.meta.url)
  const pkg = JSON.parse(await readFile(packagePath, "utf8"))
  return String(pkg.version || "").replace(/^v/, "")
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes("--version") || args.includes("-v")) {
    console.log(await readPackageVersion())
    return
  }

  const desiredVersion = process.env.SESHIONS_RUNTIME_VERSION || await readPackageVersion()
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

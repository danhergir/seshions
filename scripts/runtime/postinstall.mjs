import { readFile } from "node:fs/promises"
import { ensureRuntime, getRuntimeInfo } from "./resolve-runtime.mjs"

async function readPackageVersion() {
  const packagePath = new URL("../../package.json", import.meta.url)
  const pkg = JSON.parse(await readFile(packagePath, "utf8"))
  return String(pkg.version || "").replace(/^v/, "")
}

async function main() {
  const skip = process.env.SESHIONS_SKIP_POSTINSTALL === "1" || process.env.CI === "true"
  if (skip) {
    return
  }

  const globalInstall = process.env.npm_config_global === "true"
  const force = process.env.SESHIONS_POSTINSTALL_FORCE === "1"

  if (!globalInstall && !force) {
    console.log("[seshions] Runtime download deferred. It will install on first run.")
    return
  }

  try {
    const version = await readPackageVersion()
    const runtime = await ensureRuntime({ version, allowLatestFallback: true })
    console.log(`[seshions] Runtime ready: v${runtime.version} (${runtime.platform})`)
  } catch (error) {
    const { platform, repo, runtimeRoot } = getRuntimeInfo()
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[seshions] Runtime prefetch skipped: ${message}`)
    console.warn(`[seshions] Platform: ${platform} | Repo: ${repo} | Cache: ${runtimeRoot}`)
    console.warn("[seshions] First run will retry download automatically.")
  }
}

main()

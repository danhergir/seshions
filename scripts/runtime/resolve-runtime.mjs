import { spawnSync } from "node:child_process"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"
import { access, chmod, mkdir, readFile, rename, rm } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import os from "node:os"
import path from "node:path"

const APP = "seshions"
const DEFAULT_REPO = "danhergir/seshions"
const USER_AGENT = "seshions-runtime-installer"

function normalizeVersion(version) {
  return String(version).replace(/^v/, "")
}

function detectPlatform() {
  const osName = process.platform
  const arch = process.arch

  if (osName !== "darwin" && osName !== "linux") {
    throw new Error(`Unsupported OS: ${osName}. Seshions runtime supports macOS and Linux.`)
  }

  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported architecture: ${arch}. Supported architectures: arm64, x64.`)
  }

  return `${osName}-${arch}`
}

function getRepo() {
  return process.env.SESHIONS_REPO || DEFAULT_REPO
}

function getRuntimeRoot() {
  return process.env.SESHIONS_RUNTIME_DIR || path.join(os.homedir(), ".seshions", "runtime")
}

function getArchiveName(platform) {
  return `${APP}-${platform}.tar.gz`
}

function getReleaseAssetUrl(repo, version, platform) {
  return `https://github.com/${repo}/releases/download/v${version}/${getArchiveName(platform)}`
}

function getRuntimeDir(runtimeRoot, version, platform) {
  return path.join(runtimeRoot, version, platform)
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function isExecutable(filePath) {
  try {
    await access(filePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function fetchLatestVersion(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve latest release for ${repo} (HTTP ${response.status})`)
  }

  const data = await response.json()
  if (!data?.tag_name) {
    throw new Error(`Latest release response for ${repo} did not include tag_name`)
  }

  return normalizeVersion(data.tag_name)
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/octet-stream"
    }
  })

  if (!response.ok || !response.body) {
    const error = new Error(`Download failed (${response.status}) for ${url}`)
    error.statusCode = response.status
    throw error
  }

  const writable = createWriteStream(destination, { mode: 0o600 })
  await pipeline(Readable.fromWeb(response.body), writable)
}

async function extractArchive(archivePath, destinationDir) {
  const result = spawnSync(
    "tar",
    ["-xzf", archivePath, "-C", destinationDir, "--strip-components=1"],
    { stdio: "pipe" }
  )

  if (result.error) {
    throw new Error(`Failed to run tar: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").toString().trim()
    throw new Error(`Failed to extract runtime archive${stderr ? `: ${stderr}` : ""}`)
  }
}

async function installRuntimeVersion({ repo, version, platform, runtimeRoot }) {
  const runtimeDir = getRuntimeDir(runtimeRoot, version, platform)
  const binaryPath = path.join(runtimeDir, APP)

  if (await isExecutable(binaryPath)) {
    return {
      binaryPath,
      prebuildsPath: path.join(runtimeDir, "prebuilds"),
      runtimeDir,
      version,
      platform,
      repo
    }
  }

  const tmpDir = `${runtimeDir}.tmp-${process.pid}`
  const archivePath = path.join(tmpDir, getArchiveName(platform))
  const url = getReleaseAssetUrl(repo, version, platform)

  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })

  try {
    await downloadFile(url, archivePath)
    await extractArchive(archivePath, tmpDir)

    const extractedBinaryPath = path.join(tmpDir, APP)
    if (!(await pathExists(extractedBinaryPath))) {
      throw new Error(`Runtime archive was missing '${APP}' binary`)
    }

    await chmod(extractedBinaryPath, 0o755)
    await mkdir(path.dirname(runtimeDir), { recursive: true })
    await rm(runtimeDir, { recursive: true, force: true })
    await rename(tmpDir, runtimeDir)

    return {
      binaryPath: path.join(runtimeDir, APP),
      prebuildsPath: path.join(runtimeDir, "prebuilds"),
      runtimeDir,
      version,
      platform,
      repo
    }
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true })
    throw error
  }
}

async function readPackageVersion() {
  const packagePath = new URL("../../package.json", import.meta.url)
  const pkg = JSON.parse(await readFile(packagePath, "utf8"))
  return normalizeVersion(pkg.version)
}

export async function ensureRuntime(options = {}) {
  const repo = options.repo || getRepo()
  const platform = options.platform || detectPlatform()
  const runtimeRoot = options.runtimeRoot || getRuntimeRoot()
  const allowLatestFallback = options.allowLatestFallback !== false

  let version = options.version ? normalizeVersion(options.version) : normalizeVersion(process.env.SESHIONS_RUNTIME_VERSION || "")
  if (!version) {
    version = await readPackageVersion()
  }

  try {
    return await installRuntimeVersion({ repo, version, platform, runtimeRoot })
  } catch (error) {
    const statusCode = typeof error?.statusCode === "number" ? error.statusCode : undefined
    if (!allowLatestFallback || (statusCode !== 404 && statusCode !== 403)) {
      throw error
    }

    const latestVersion = await fetchLatestVersion(repo)
    if (latestVersion === version) {
      throw error
    }

    return installRuntimeVersion({ repo, version: latestVersion, platform, runtimeRoot })
  }
}

export function getRuntimeInfo() {
  return {
    platform: detectPlatform(),
    repo: getRepo(),
    runtimeRoot: getRuntimeRoot()
  }
}

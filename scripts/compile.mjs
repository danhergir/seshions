#!/usr/bin/env node

import { execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(new URL("..", import.meta.url).pathname)
const binDir = path.join(root, "bin")

function platformName() {
  const platform = os.platform() === "darwin" ? "darwin" : "linux"
  const arch = os.arch() === "arm64" ? "arm64" : "x64"
  return `${platform}-${arch}`
}

function packageFor(platform) {
  const folder = path.join(binDir, `seshions-${platform}`)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })

  cpSync(path.join(root, "dist"), path.join(folder, "dist"), { recursive: true })
  cpSync(path.join(root, "package.json"), path.join(folder, "package.json"))
  cpSync(path.join(root, "README.md"), path.join(folder, "README.md"))

  const launcher = `#!/usr/bin/env bash\nSCRIPT_DIR=\"$(cd \"$(dirname \"${"$"}{BASH_SOURCE[0]}\")\" && pwd)\"\nnode \"$SCRIPT_DIR/dist/cli/index.js\" \"${"$"}@\"\n`
  writeFileSync(path.join(folder, "seshions"), launcher, "utf8")
  execSync(`chmod +x "${path.join(folder, "seshions")}"`)

  const tarball = path.join(binDir, `seshions-${platform}.tar.gz`)
  rmSync(tarball, { force: true })
  execSync(`tar -czf "${tarball}" -C "${binDir}" "seshions-${platform}"`, { stdio: "inherit" })
  console.log(`Created ${tarball}`)
}

process.chdir(root)
execSync("npm run build", { stdio: "inherit" })

rmSync(binDir, { recursive: true, force: true })
mkdirSync(binDir, { recursive: true })

const wantsAll = process.argv.includes("--all")
if (wantsAll) {
  console.log("--all requested: creating package for current platform only (cross-platform packaging not supported in Node-only mode).")
}

const current = platformName()
if (!existsSync(path.join(root, "dist", "cli", "index.js"))) {
  throw new Error("Build output missing: dist/cli/index.js")
}

packageFor(current)

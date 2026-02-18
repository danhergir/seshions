#!/usr/bin/env node

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(new URL("..", import.meta.url).pathname)
process.chdir(root)

const args = process.argv.slice(2)
const version = args.find((arg) => !arg.startsWith("--"))
const compileAll = args.includes("--all-platforms")

if (!version) {
  console.error("Usage: node scripts/release.mjs <version> [--all-platforms]")
  process.exit(1)
}

const normalized = version.replace(/^v/, "")
const tag = `v${normalized}`

const pkgPath = path.join(root, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
pkg.version = normalized
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")

execSync(compileAll ? "npm run compile -- --all" : "npm run compile", { stdio: "inherit" })

try {
  execSync(`git add package.json && git commit -m \"chore: bump version to ${tag}\"`, { stdio: "inherit" })
} catch {
  // Ignore if nothing to commit.
}

console.log(`Prepared release ${tag}. Create/push tag and GitHub release manually or with gh CLI.`)

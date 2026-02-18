#!/usr/bin/env node

import { execSync } from "node:child_process"
import { rmSync } from "node:fs"
import path from "node:path"

const root = path.resolve(new URL("..", import.meta.url).pathname)
process.chdir(root)

rmSync(path.join(root, "dist"), { recursive: true, force: true })
execSync("npx tsc -p tsconfig.json", { stdio: "inherit" })

console.log("Build successful")

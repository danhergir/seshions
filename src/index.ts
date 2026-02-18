/**
 * Agent View
 * OpenTUI-based multi-agent management
 */

import { tui } from "./tui/app"
import { basename } from "path"
import packageJson from "../package.json"
import { getLegacyCommandWarning } from "./core/app-paths"

async function main() {
  const args = process.argv.slice(2)
  const invokedFromEnv = process.env._ ? basename(process.env._) : ""
  const invokedName = invokedFromEnv || basename(process.argv[1] || "")
  const legacyCommandWarning = getLegacyCommandWarning(invokedName)

  if (legacyCommandWarning) {
    console.error(legacyCommandWarning)
  }

  // Simple CLI argument handling
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Agent View - Terminal Agent Management

Usage:
  agent-view [options]

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --light        Use light mode theme

Compatibility (deprecated, one release only):
  agent-orchestrator
  ao

Keyboard Shortcuts (in TUI):
  Ctrl+K         Command palette
  Ctrl+L         Session list
  N              New session
  Q              Quit / Detach
  ?              Help
`)
    process.exit(0)
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(packageJson.version)
    process.exit(0)
  }

  const mode = args.includes("--light") ? "light" : "dark"

  try {
    const { tui } = await import("./tui/app")
    await tui({
      mode,
      onExit: async () => {
        console.log("Goodbye!")
      }
    })
  } catch (error) {
    console.error("Fatal error:", error)
    process.exit(1)
  }
}

main()

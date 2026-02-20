/**
 * Seshions
 * OpenTUI-based multi-agent management
 */

import { tui } from "./tui/app"
import packageJson from "../package.json"

async function main() {
  const args = process.argv.slice(2)

  // Simple CLI argument handling
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Seshions - Terminal Agent Management

Usage:
  seshions [options]

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --light        Use light mode theme

Keyboard Shortcuts (in TUI):
  Enter          Attach selected session
  r              Rename selected session/group
  d              Delete selected (with confirmation)
  q              Detach / Back
  Ctrl+K         Action Hub
                (includes Dispatch to role / Broadcast to group)
  n              Launch session
  g              Create group
  m              Move session to group
  p              Workspace profiles

Attached session:
  Ctrl+C         Detach from tmux session
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

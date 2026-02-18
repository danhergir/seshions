import { describe, test, expect } from "bun:test"
import {
  SESSION_PREFIX,
  LEGACY_SESSION_PREFIX,
  getLegacyCommandWarning,
  LEGACY_COMMANDS
} from "./app-paths"

describe("app-paths", () => {
  test("uses agent-view session prefix by default", () => {
    expect(SESSION_PREFIX).toBe("agentview_")
  })

  test("retains legacy session prefix for compatibility checks", () => {
    expect(LEGACY_SESSION_PREFIX).toBe("agentorch_")
  })

  test("returns deprecation warning for legacy commands", () => {
    for (const command of LEGACY_COMMANDS) {
      expect(getLegacyCommandWarning(command)).toContain("[deprecation]")
    }
  })

  test("returns null for non-legacy commands", () => {
    expect(getLegacyCommandWarning("agent-view")).toBeNull()
    expect(getLegacyCommandWarning("av")).toBeNull()
    expect(getLegacyCommandWarning(undefined)).toBeNull()
  })
})

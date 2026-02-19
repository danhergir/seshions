import { describe, expect, test } from "bun:test"
import { detectImportedTool, humanizeImportedSessionTitle } from "./import-detection"

describe("detectImportedTool", () => {
  test("detects codex by session name", () => {
    const result = detectImportedTool("my-codex-session")
    expect(result).toEqual({ tool: "codex", detectedBy: "name" })
  })

  test("detects claude by session name", () => {
    const result = detectImportedTool("claude-code-main")
    expect(result).toEqual({ tool: "claude", detectedBy: "name" })
  })

  test("detects gemini by session name", () => {
    const result = detectImportedTool("gemini_cli")
    expect(result).toEqual({ tool: "gemini", detectedBy: "name" })
  })

  test("detects tool by pane preview when name is generic", () => {
    const result = detectImportedTool("work", "Connected to Anthropic Claude API")
    expect(result).toEqual({ tool: "claude", detectedBy: "pane" })
  })

  test("falls back to shell when unknown", () => {
    const result = detectImportedTool("work", "plain bash prompt")
    expect(result).toEqual({ tool: "shell", detectedBy: "fallback" })
  })
})

describe("humanizeImportedSessionTitle", () => {
  test("humanizes common separators", () => {
    expect(humanizeImportedSessionTitle("my-codex_session")).toBe("my codex session")
  })

  test("removes seshions prefix", () => {
    expect(humanizeImportedSessionTitle("seshions_my-task")).toBe("my task")
  })
})

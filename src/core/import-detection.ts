import type { Tool } from "./types"

export interface ImportedToolDetection {
  tool: Tool
  detectedBy: "name" | "pane" | "fallback"
}

const NAME_PATTERNS: Array<{ tool: Tool; pattern: RegExp }> = [
  { tool: "codex", pattern: /(^|[^a-z0-9])codex([^a-z0-9]|$)/i },
  { tool: "claude", pattern: /(^|[^a-z0-9])claude([^a-z0-9]|$)/i },
  { tool: "gemini", pattern: /(^|[^a-z0-9])gemini([^a-z0-9]|$)/i },
]

const PANE_PATTERNS: Array<{ tool: Tool; patterns: RegExp[] }> = [
  {
    tool: "codex",
    patterns: [
      /\bcodex\b/i,
      /\bopenai\b/i,
    ]
  },
  {
    tool: "claude",
    patterns: [
      /\bclaude\b/i,
      /\banthropic\b/i,
    ]
  },
  {
    tool: "gemini",
    patterns: [
      /\bgemini\b/i,
      /\bgoogle\b/i,
    ]
  }
]

function detectByName(sessionName: string): Tool | null {
  for (const entry of NAME_PATTERNS) {
    if (entry.pattern.test(sessionName)) {
      return entry.tool
    }
  }
  return null
}

function detectByPane(text: string): Tool | null {
  for (const entry of PANE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.tool
    }
  }
  return null
}

export function detectImportedTool(sessionName: string, panePreview = ""): ImportedToolDetection {
  const byName = detectByName(sessionName)
  if (byName) {
    return { tool: byName, detectedBy: "name" }
  }

  const byPane = detectByPane(panePreview)
  if (byPane) {
    return { tool: byPane, detectedBy: "pane" }
  }

  return { tool: "shell", detectedBy: "fallback" }
}

export function humanizeImportedSessionTitle(sessionName: string): string {
  return sessionName
    .replace(/^seshions[_-]?/i, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Imported Session"
}

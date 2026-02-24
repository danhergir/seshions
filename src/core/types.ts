/**
 * Core types for Seshions
 */

export type SessionStatus =
  | "running"     // Agent is actively working
  | "waiting"     // Agent needs input/approval
  | "idle"        // Session exists but agent is not active
  | "error"       // Session has an error
  | "stopped"     // Session was explicitly stopped

export type Tool =
  | "claude"      // Claude Code
  | "opencode"    // OpenCode
  | "gemini"      // Gemini CLI
  | "codex"       // OpenAI Codex CLI
  | "custom"      // Custom command
  | "shell"       // Plain shell

export interface Session {
  id: string
  title: string
  projectPath: string
  groupPath: string
  order: number
  command: string
  wrapper: string
  tool: Tool
  status: SessionStatus
  tmuxSession: string
  createdAt: Date
  lastAccessed: Date
  parentSessionId: string
  worktreePath: string
  worktreeRepo: string
  worktreeBranch: string
  toolData: Record<string, unknown>
  acknowledged: boolean
}

export interface Group {
  path: string
  name: string
  expanded: boolean
  order: number
  defaultPath: string
}

export interface Profile {
  id: string
  name: string
  projectPath: string
  defaultTool: Tool
  defaultCustomCommand: string
  useWorktree: boolean
  defaultBaseBranch: string
  createdAt: Date
  updatedAt: Date
}

export interface BlueprintEntry {
  title: string
  projectPath: string
  tool: Tool
  command: string
}

export interface Blueprint {
  id: string
  name: string
  groupPath: string
  entries: BlueprintEntry[]
  createdAt: Date
  updatedAt: Date
}

export interface CommandUsage {
  commandId: string
  useCount: number
  lastUsedAt: Date
}

export interface StatusUpdate {
  sessionId: string
  status: SessionStatus
  tool: Tool
  acknowledged: boolean
}

export type ClaudeTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export type ClaudeLinkConfidence = "exact_agent_id" | "name_match" | "unmatched"

export interface ClaudeTeamMember {
  id: string
  name: string
  role: string
  agentType: string
  metadata: Record<string, unknown>
}

export interface ClaudeTask {
  id: string
  title: string
  status: ClaudeTaskStatus
  assigneeId: string
  assigneeName: string
  createdAt: Date
  updatedAt: Date
  sourcePath: string
}

export interface ClaudeTeam {
  name: string
  path: string
  leadId: string
  members: ClaudeTeamMember[]
  updatedAt: Date
  metadata: Record<string, unknown>
}

export interface ClaudeMemberRuntime {
  member: ClaudeTeamMember
  sessionId: string
  sessionTitle: string
  tmuxSession: string
  paneId: string
  status: SessionStatus
  activity: string
  linkConfidence: ClaudeLinkConfidence
  linked: boolean
  isLead: boolean
  pendingCount: number
  inProgressCount: number
  completedCount: number
  failedCount: number
  lastTaskAt: Date | null
  stale: boolean
}

export interface ClaudeTeamRuntime {
  team: ClaudeTeam
  tasks: ClaudeTask[]
  members: ClaudeMemberRuntime[]
  pendingCount: number
  inProgressCount: number
  completedCount: number
  failedCount: number
  activeCount: number
  updatedAt: Date
}

export interface MCPServer {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

export interface MCPStatus {
  server: MCPServer
  connected: boolean
  error?: string
}

export type ClaudeSessionMode = "new" | "resume"

export interface ClaudeOptions {
  sessionMode: ClaudeSessionMode
}

export interface SessionCreateOptions {
  title?: string
  projectPath: string
  groupPath?: string
  tool: Tool
  command?: string
  wrapper?: string
  parentSessionId?: string
  worktreePath?: string
  worktreeRepo?: string
  worktreeBranch?: string
  claudeOptions?: ClaudeOptions
}

export interface SessionForkOptions {
  sourceSessionId: string
  title?: string
  preserveHistory?: boolean
  worktreePath?: string
  worktreeRepo?: string
  worktreeBranch?: string
}

export interface WorktreeConfig {
  defaultBaseBranch?: string
  command?: string
  autoCleanup?: boolean
}

export interface Config {
  theme?: string
  defaultTool?: Tool
  defaultGroup?: string
  worktree?: WorktreeConfig
  mcpServers?: MCPServer[]
  keybinds?: Record<string, string>
}

export function getToolCommand(tool: Tool, customCmd?: string): string {
  switch (tool) {
    case "claude":
      return "claude"
    case "opencode":
      return "opencode"
    case "gemini":
      return "gemini"
    case "codex":
      return "codex"
    case "custom":
      return customCmd || process.env.SHELL || "/bin/bash"
    case "shell":
    default:
      return process.env.SHELL || "/bin/bash"
  }
}

/**
 * Claude team discovery and runtime linking.
 * Reads local Claude team/task metadata and maps members to tmux-backed sessions.
 */

import { homedir } from "os"
import path from "path"
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "fs"
import type {
  ClaudeMemberRuntime,
  ClaudeTask,
  ClaudeTaskStatus,
  ClaudeTeam,
  ClaudeTeamMember,
  ClaudeTeamRuntime,
  Session,
  SessionStatus
} from "./types"

const CLAUDE_HOME_OVERRIDE_ENV = "SESHIONS_CLAUDE_HOME"
const STALE_THRESHOLD_MS = 10 * 60 * 1000

export function getClaudeBaseDir(): string {
  const override = process.env[CLAUDE_HOME_OVERRIDE_ENV]?.trim()
  if (override) {
    return path.resolve(override)
  }
  return path.join(homedir(), ".claude")
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readDirSafe(dirPath: string): Dirent[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function readJsonSafe(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function fileMtime(filePath: string): Date {
  try {
    return statSync(filePath).mtime
  } catch {
    return new Date(0)
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return ""
}

function parseDateCandidate(value: unknown): Date | null {
  if (typeof value === "number") {
    const ms = value > 1_000_000_000_000 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === "string" && value.trim()) {
    const fromText = new Date(value)
    if (!Number.isNaN(fromText.getTime())) {
      return fromText
    }
    const fromNumber = Number.parseInt(value, 10)
    if (!Number.isNaN(fromNumber)) {
      const ms = fromNumber > 1_000_000_000_000 ? fromNumber : fromNumber * 1000
      const d = new Date(ms)
      return Number.isNaN(d.getTime()) ? null : d
    }
  }
  return null
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function compactNorm(value: string): string {
  return norm(value).replace(/\s+/g, "")
}

function hasNameOverlap(a: string, b: string): boolean {
  const aTokens = norm(a).split(" ").filter(Boolean)
  const bTokens = new Set(norm(b).split(" ").filter(Boolean))
  if (aTokens.length === 0 || bTokens.size === 0) {
    return false
  }

  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap >= Math.min(2, aTokens.length)
}

function normalizeTaskStatus(value: string): ClaudeTaskStatus {
  const lowered = norm(value).replace(/\s+/g, "_")
  if (!lowered) return "unknown"

  if (["pending", "todo", "queued", "open", "ready"].includes(lowered)) {
    return "pending"
  }
  if (["in_progress", "progress", "running", "active", "working"].includes(lowered)) {
    return "in_progress"
  }
  if (["completed", "complete", "done", "success", "resolved", "finished"].includes(lowered)) {
    return "completed"
  }
  if (["failed", "error", "errored"].includes(lowered)) {
    return "failed"
  }
  if (["cancelled", "canceled", "aborted", "stopped"].includes(lowered)) {
    return "cancelled"
  }
  return "unknown"
}

function parseMember(raw: unknown, fallbackName: string, index: number): ClaudeTeamMember {
  const record = asRecord(raw)
  const id = pickString(record, ["id", "agent_id", "agentId", "member_id", "memberId"]) || `${fallbackName}-${index + 1}`
  const name = pickString(record, ["name", "title", "display_name", "displayName"]) || id
  const role = pickString(record, ["role", "kind", "type"]) || "teammate"
  const agentType = pickString(record, ["agent_type", "agentType", "tool", "model"]) || "claude"

  return {
    id,
    name,
    role,
    agentType,
    metadata: record
  }
}

function parseTeamFromDir(teamDir: string, dirName: string): ClaudeTeam | null {
  const configPath = path.join(teamDir, "config.json")
  if (!existsSync(configPath)) {
    return null
  }

  const parsed = asRecord(readJsonSafe(configPath))
  const metaTeam = asRecord(parsed.team)
  const teamName = pickString(parsed, ["name", "team_name", "teamName"]) ||
    pickString(metaTeam, ["name", "team_name", "teamName"]) ||
    dirName

  const rawMembers = [
    ...asArray(parsed.members),
    ...asArray(parsed.teammates),
    ...asArray(parsed.agents),
    ...asArray(parsed.workers),
    ...asArray(metaTeam.members),
    ...asArray(metaTeam.teammates)
  ]

  const members: ClaudeTeamMember[] = []
  for (let i = 0; i < rawMembers.length; i += 1) {
    members.push(parseMember(rawMembers[i], teamName, i))
  }

  const leadObj = asRecord(parsed.lead)
  if (Object.keys(leadObj).length > 0) {
    const leadMember = parseMember(leadObj, `${teamName}-lead`, members.length)
    if (!members.some((m) => compactNorm(m.id) === compactNorm(leadMember.id))) {
      members.unshift({ ...leadMember, role: leadMember.role || "lead" })
    }
  }

  let leadId = pickString(parsed, ["lead_id", "leadId", "lead_agent_id", "leadAgentId"])
  if (!leadId) {
    leadId = pickString(leadObj, ["id", "agent_id", "agentId", "name"])
  }
  if (!leadId) {
    const roleLead = members.find((m) => /(lead|coord|orchestr)/i.test(m.role))
    leadId = roleLead?.id || members[0]?.id || ""
  }

  const deduped: ClaudeTeamMember[] = []
  const seen = new Set<string>()
  for (const member of members) {
    const key = compactNorm(member.id || member.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(member)
  }

  return {
    name: teamName,
    path: teamDir,
    leadId,
    members: deduped,
    updatedAt: fileMtime(configPath),
    metadata: parsed
  }
}

export function listClaudeTeams(): ClaudeTeam[] {
  const teamsDir = path.join(getClaudeBaseDir(), "teams")
  const dirs = readDirSafe(teamsDir)

  const teams: ClaudeTeam[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const team = parseTeamFromDir(path.join(teamsDir, dir.name), dir.name)
    if (team && team.members.length > 0) {
      teams.push(team)
    }
  }

  return teams.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

function collectTaskFiles(rootPath: string, depth = 0): string[] {
  if (depth > 2) return []

  const entries = readDirSafe(rootPath)
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTaskFiles(entryPath, depth + 1))
      continue
    }
    if (!entry.isFile()) continue

    const lowered = entry.name.toLowerCase()
    if (lowered.endsWith(".json") || lowered.endsWith(".jsonl") || lowered.includes("task")) {
      files.push(entryPath)
    }
  }
  return files
}

function parseTaskFromRecord(record: Record<string, unknown>, sourcePath: string, fallbackTime: Date): ClaudeTask | null {
  const id = pickString(record, ["id", "task_id", "taskId", "uuid"]) ||
    path.basename(sourcePath).replace(/\.[a-z0-9]+$/i, "")
  const title = pickString(record, ["title", "name", "task", "description", "prompt"]) || id

  const statusRaw = pickString(record, ["status", "state", "phase"])
  const status = normalizeTaskStatus(statusRaw)

  const assigneeObj = asRecord(record.assignee)
  const assigneeId = pickString(record, ["assignee_id", "assigneeId", "owner_id", "ownerId"]) ||
    pickString(assigneeObj, ["id", "agent_id", "agentId"])
  const assigneeName = pickString(record, ["assignee_name", "assigneeName", "owner_name", "ownerName"]) ||
    pickString(assigneeObj, ["name", "title"])

  const createdAt = parseDateCandidate(record.created_at) ||
    parseDateCandidate(record.createdAt) ||
    fallbackTime
  const updatedAt = parseDateCandidate(record.updated_at) ||
    parseDateCandidate(record.updatedAt) ||
    parseDateCandidate(record.ts) ||
    createdAt

  if (!id || !title) {
    return null
  }

  return {
    id,
    title,
    status,
    assigneeId,
    assigneeName,
    createdAt,
    updatedAt,
    sourcePath
  }
}

function parseTaskFile(filePath: string): ClaudeTask[] {
  const mtime = fileMtime(filePath)
  const lower = filePath.toLowerCase()

  if (lower.endsWith(".jsonl")) {
    try {
      const lines = readFileSync(filePath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean)
      const parsed: ClaudeTask[] = []
      for (const line of lines) {
        try {
          const obj = asRecord(JSON.parse(line))
          const candidate = parseTaskFromRecord(obj, filePath, mtime)
          if (candidate) parsed.push(candidate)
        } catch {
          // Ignore malformed lines.
        }
      }
      return parsed
    } catch {
      return []
    }
  }

  const json = readJsonSafe(filePath)
  if (!json) return []

  const record = asRecord(json)
  const collection = [
    ...asArray(json),
    ...asArray(record.tasks),
    ...asArray(record.items)
  ]

  if (collection.length > 0) {
    const tasks: ClaudeTask[] = []
    for (const item of collection) {
      const parsed = parseTaskFromRecord(asRecord(item), filePath, mtime)
      if (parsed) tasks.push(parsed)
    }
    return tasks
  }

  const single = parseTaskFromRecord(record, filePath, mtime)
  return single ? [single] : []
}

export function listClaudeTasks(teamName: string): ClaudeTask[] {
  const taskRoot = path.join(getClaudeBaseDir(), "tasks", teamName)
  if (!existsSync(taskRoot)) {
    return []
  }

  const files = collectTaskFiles(taskRoot)
  const deduped = new Map<string, ClaudeTask>()
  for (const filePath of files) {
    for (const task of parseTaskFile(filePath)) {
      const existing = deduped.get(task.id)
      if (!existing || task.updatedAt.getTime() > existing.updatedAt.getTime()) {
        deduped.set(task.id, task)
      }
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

function scoreSessionCandidate(member: ClaudeTeamMember, session: Session): { score: number; confidence: ClaudeMemberRuntime["linkConfidence"] } {
  if (session.tool !== "claude") {
    return { score: 0, confidence: "unmatched" }
  }

  const memberId = compactNorm(member.id)
  const memberName = norm(member.name)
  const sessionTitle = norm(session.title)
  const command = norm(session.command)

  const toolData = session.toolData ?? {}
  const toolDataValues = Object.values(toolData)
    .filter((value): value is string => typeof value === "string")
    .map((value) => norm(value))
    .join(" ")

  if (memberId && compactNorm(toolDataValues).includes(memberId)) {
    return { score: 100, confidence: "exact_agent_id" }
  }

  if (
    (memberName && sessionTitle.includes(memberName)) ||
    (memberName && command.includes(memberName)) ||
    hasNameOverlap(member.name, session.title)
  ) {
    return { score: 60, confidence: "name_match" }
  }

  return { score: 0, confidence: "unmatched" }
}

function deriveStatusFromTasks(memberTasks: ClaudeTask[]): SessionStatus {
  if (memberTasks.some((task) => task.status === "in_progress")) return "running"
  if (memberTasks.some((task) => task.status === "pending")) return "waiting"
  if (memberTasks.some((task) => task.status === "failed")) return "error"
  return "idle"
}

function normalizePaneId(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (/^%\d+$/.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) return `%${trimmed}`
  return trimmed
}

function extractPaneId(member: ClaudeTeamMember): string {
  return normalizePaneId(
    pickString(member.metadata, [
      "tmuxPaneId",
      "tmux_pane_id",
      "tmuxPane",
      "tmux_pane",
      "paneId",
      "pane_id"
    ])
  )
}

function taskPriority(status: ClaudeTaskStatus): number {
  switch (status) {
    case "in_progress":
      return 0
    case "pending":
      return 1
    case "failed":
      return 2
    case "completed":
      return 3
    case "cancelled":
      return 4
    case "unknown":
    default:
      return 5
  }
}

function summarizeActivity(tasks: ClaudeTask[]): string {
  if (tasks.length === 0) {
    return "No assigned task"
  }

  const focus = [...tasks].sort((a, b) => {
    const pa = taskPriority(a.status)
    const pb = taskPriority(b.status)
    if (pa !== pb) return pa - pb
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })[0]!

  if (focus.status === "in_progress") {
    return `Working on ${focus.title}`
  }
  if (focus.status === "pending") {
    return `Queued: ${focus.title}`
  }
  if (focus.status === "failed") {
    return `Blocked: ${focus.title}`
  }
  if (focus.status === "completed") {
    return `Done: ${focus.title}`
  }
  return focus.title
}

export function buildClaudeTeamRuntime(sessions: Session[]): ClaudeTeamRuntime[] {
  const teams = listClaudeTeams()
  const now = Date.now()

  const runtimes: ClaudeTeamRuntime[] = []
  for (const team of teams) {
    const tasks = listClaudeTasks(team.name)
    const allClaudeSessions = sessions.filter((session) => session.tool === "claude")

    const members: ClaudeMemberRuntime[] = team.members.map((member) => {
      let bestSession: Session | null = null
      let bestScore = 0
      let bestConfidence: ClaudeMemberRuntime["linkConfidence"] = "unmatched"

      for (const session of allClaudeSessions) {
        const scored = scoreSessionCandidate(member, session)
        if (scored.score > bestScore) {
          bestScore = scored.score
          bestConfidence = scored.confidence
          bestSession = session
        }
      }

      const assignedTasks = tasks.filter((task) => {
        if (task.assigneeId && compactNorm(task.assigneeId) === compactNorm(member.id)) {
          return true
        }
        if (task.assigneeName && (norm(task.assigneeName) === norm(member.name) || hasNameOverlap(task.assigneeName, member.name))) {
          return true
        }
        return false
      })

      const pendingCount = assignedTasks.filter((task) => task.status === "pending").length
      const inProgressCount = assignedTasks.filter((task) => task.status === "in_progress").length
      const completedCount = assignedTasks.filter((task) => task.status === "completed").length
      const failedCount = assignedTasks.filter((task) => task.status === "failed").length
      const lastTaskAt = assignedTasks.length > 0 ? assignedTasks[0]!.updatedAt : null
      const paneId = extractPaneId(member)
      const hasDirectPaneLink = paneId.length > 0
      const stale = !bestSession && !!lastTaskAt && now - lastTaskAt.getTime() > STALE_THRESHOLD_MS

      return {
        member,
        sessionId: bestSession?.id || "",
        sessionTitle: bestSession?.title || "",
        tmuxSession: bestSession?.tmuxSession || "",
        paneId,
        status: bestSession?.status || deriveStatusFromTasks(assignedTasks),
        activity: summarizeActivity(assignedTasks),
        linkConfidence: bestSession ? bestConfidence : hasDirectPaneLink ? "exact_agent_id" : "unmatched",
        linked: !!bestSession || hasDirectPaneLink,
        isLead: compactNorm(member.id) === compactNorm(team.leadId) ||
          /(lead|coord|orchestr)/i.test(member.role),
        pendingCount,
        inProgressCount,
        completedCount,
        failedCount,
        lastTaskAt,
        stale
      }
    })

    members.sort((a, b) => {
      if (a.isLead !== b.isLead) {
        return a.isLead ? -1 : 1
      }
      if (a.inProgressCount !== b.inProgressCount) {
        return b.inProgressCount - a.inProgressCount
      }
      if (a.pendingCount !== b.pendingCount) {
        return b.pendingCount - a.pendingCount
      }
      return a.member.name.localeCompare(b.member.name)
    })

    const pendingCount = tasks.filter((task) => task.status === "pending").length
    const inProgressCount = tasks.filter((task) => task.status === "in_progress").length
    const completedCount = tasks.filter((task) => task.status === "completed").length
    const failedCount = tasks.filter((task) => task.status === "failed").length
    const activeCount = members.filter((member) => member.status === "running" || member.status === "waiting").length
    const latestTask = tasks[0]?.updatedAt || new Date(0)
    const updatedAt = new Date(Math.max(team.updatedAt.getTime(), latestTask.getTime()))

    runtimes.push({
      team,
      tasks,
      members,
      pendingCount,
      inProgressCount,
      completedCount,
      failedCount,
      activeCount,
      updatedAt
    })
  }

  return runtimes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

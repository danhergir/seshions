/**
 * File-based storage for session/group persistence
 * Node runtime compatible replacement for Bun SQLite storage
 */

import path from "path"
import fs from "fs"
import type { Session, Group, StatusUpdate, Tool, SessionStatus } from "./types"
import { getStateDbPath } from "./app-paths"

const SCHEMA_VERSION = 1

interface PersistedSession {
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
  createdAt: number
  lastAccessed: number
  parentSessionId: string
  worktreePath: string
  worktreeRepo: string
  worktreeBranch: string
  toolData: Record<string, unknown>
  acknowledged: boolean
}

interface HeartbeatRow {
  pid: number
  started: number
  heartbeat: number
  isPrimary: boolean
}

interface PersistedState {
  schemaVersion: number
  metadata: Record<string, string>
  sessions: PersistedSession[]
  groups: Group[]
  heartbeats: HeartbeatRow[]
}

const DEFAULT_STATE: PersistedState = {
  schemaVersion: SCHEMA_VERSION,
  metadata: {},
  sessions: [],
  groups: [],
  heartbeats: [],
}

export interface StorageOptions {
  dbPath?: string
}

export class Storage {
  private readonly filePath: string
  private readonly pid: number
  private state: PersistedState
  private closed = false

  constructor(options: StorageOptions = {}) {
    this.filePath = options.dbPath ?? this.getDefaultPath()
    this.pid = process.pid

    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    }

    this.state = this.loadState()
  }

  private getDefaultPath(): string {
    return getStateDbPath()
  }

  private loadState(): PersistedState {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULT_STATE }
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8")
      const parsed = JSON.parse(raw) as Partial<PersistedState>

      return {
        schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
        metadata: parsed.metadata ?? {},
        sessions: (parsed.sessions ?? []).map((session) => ({
          id: session.id ?? "",
          title: session.title ?? "",
          projectPath: session.projectPath ?? "",
          groupPath: session.groupPath ?? "my-sessions",
          order: session.order ?? 0,
          command: session.command ?? "",
          wrapper: session.wrapper ?? "",
          tool: (session.tool ?? "shell") as Tool,
          status: (session.status ?? "idle") as SessionStatus,
          tmuxSession: session.tmuxSession ?? "",
          createdAt: Number(session.createdAt ?? Date.now()),
          lastAccessed: Number(session.lastAccessed ?? 0),
          parentSessionId: session.parentSessionId ?? "",
          worktreePath: session.worktreePath ?? "",
          worktreeRepo: session.worktreeRepo ?? "",
          worktreeBranch: session.worktreeBranch ?? "",
          toolData: session.toolData ?? {},
          acknowledged: Boolean(session.acknowledged),
        })),
        groups: parsed.groups ?? [],
        heartbeats: parsed.heartbeats ?? [],
      }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  private persist(): void {
    if (this.closed) return

    const tempPath = `${this.filePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), "utf8")
    fs.renameSync(tempPath, this.filePath)
  }

  private toPersistedSession(session: Session): PersistedSession {
    return {
      id: session.id,
      title: session.title,
      projectPath: session.projectPath,
      groupPath: session.groupPath,
      order: session.order,
      command: session.command,
      wrapper: session.wrapper,
      tool: session.tool,
      status: session.status,
      tmuxSession: session.tmuxSession,
      createdAt: session.createdAt.getTime(),
      lastAccessed: session.lastAccessed.getTime(),
      parentSessionId: session.parentSessionId,
      worktreePath: session.worktreePath,
      worktreeRepo: session.worktreeRepo,
      worktreeBranch: session.worktreeBranch,
      toolData: session.toolData,
      acknowledged: session.acknowledged,
    }
  }

  private toSession(session: PersistedSession): Session {
    return {
      id: session.id,
      title: session.title,
      projectPath: session.projectPath,
      groupPath: session.groupPath,
      order: session.order,
      command: session.command,
      wrapper: session.wrapper,
      tool: session.tool,
      status: session.status,
      tmuxSession: session.tmuxSession,
      createdAt: new Date(session.createdAt),
      lastAccessed: new Date(session.lastAccessed),
      parentSessionId: session.parentSessionId,
      worktreePath: session.worktreePath,
      worktreeRepo: session.worktreeRepo,
      worktreeBranch: session.worktreeBranch,
      toolData: session.toolData,
      acknowledged: session.acknowledged,
    }
  }

  migrate(): void {
    this.state.schemaVersion = SCHEMA_VERSION
    if (!this.state.metadata.schema_version) {
      this.state.metadata.schema_version = String(SCHEMA_VERSION)
    }
    this.persist()
  }

  close(): void {
    if (this.closed) return
    this.persist()
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }

  saveSession(session: Session): void {
    const persisted = this.toPersistedSession(session)
    const index = this.state.sessions.findIndex((s) => s.id === session.id)
    if (index === -1) {
      this.state.sessions.push(persisted)
    } else {
      this.state.sessions[index] = persisted
    }
    this.persist()
  }

  saveSessions(sessions: Session[]): void {
    this.state.sessions = sessions.map((session) => this.toPersistedSession(session))
    this.persist()
  }

  loadSessions(): Session[] {
    if (this.closed) return []
    return [...this.state.sessions]
      .sort((a, b) => a.order - b.order)
      .map((session) => this.toSession(session))
  }

  getSession(id: string): Session | null {
    const session = this.state.sessions.find((s) => s.id === id)
    return session ? this.toSession(session) : null
  }

  deleteSession(id: string): void {
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id)
    this.persist()
  }

  updateSessionField(id: string, field: string, value: unknown): void {
    const session = this.state.sessions.find((s) => s.id === id)
    if (!session) return

    const fieldMap: Record<string, keyof PersistedSession> = {
      project_path: "projectPath",
      projectPath: "projectPath",
      group_path: "groupPath",
      groupPath: "groupPath",
      sort_order: "order",
      sortOrder: "order",
      order: "order",
      tmux_session: "tmuxSession",
      tmuxSession: "tmuxSession",
      created_at: "createdAt",
      createdAt: "createdAt",
      last_accessed: "lastAccessed",
      lastAccessed: "lastAccessed",
      parent_session_id: "parentSessionId",
      parentSessionId: "parentSessionId",
      worktree_path: "worktreePath",
      worktreePath: "worktreePath",
      worktree_repo: "worktreeRepo",
      worktreeRepo: "worktreeRepo",
      worktree_branch: "worktreeBranch",
      worktreeBranch: "worktreeBranch",
      tool_data: "toolData",
      toolData: "toolData",
      title: "title",
      command: "command",
      wrapper: "wrapper",
      tool: "tool",
      status: "status",
      acknowledged: "acknowledged",
    }

    const key = fieldMap[field]
    if (!key) return

    if (key === "toolData") {
      if (typeof value === "string") {
        try {
          session.toolData = JSON.parse(value) as Record<string, unknown>
        } catch {
          session.toolData = {}
        }
      } else {
        session.toolData = (value ?? {}) as Record<string, unknown>
      }
    } else if (key === "createdAt" || key === "lastAccessed") {
      session[key] = typeof value === "number" ? value : Date.now()
    } else if (key === "acknowledged") {
      session.acknowledged = Boolean(value)
    } else if (key === "order") {
      session.order = Number(value ?? 0)
    } else {
      ;(session as any)[key] = value
    }

    this.persist()
  }

  writeStatus(id: string, status: SessionStatus, tool: Tool): void {
    const session = this.state.sessions.find((s) => s.id === id)
    if (!session) return
    session.status = status
    session.tool = tool
    this.persist()
  }

  readAllStatuses(): Map<string, StatusUpdate> {
    const result = new Map<string, StatusUpdate>()
    for (const session of this.state.sessions) {
      result.set(session.id, {
        sessionId: session.id,
        status: session.status,
        tool: session.tool,
        acknowledged: session.acknowledged,
      })
    }
    return result
  }

  setAcknowledged(id: string, ack: boolean): void {
    const session = this.state.sessions.find((s) => s.id === id)
    if (!session) return
    session.acknowledged = ack
    this.persist()
  }

  saveGroups(groups: Group[]): void {
    this.state.groups = [...groups]
    this.persist()
  }

  loadGroups(): Group[] {
    if (this.closed) return []
    return [...this.state.groups].sort((a, b) => a.order - b.order)
  }

  deleteGroup(groupPath: string): void {
    this.state.groups = this.state.groups.filter((g) => g.path !== groupPath)
    this.persist()
  }

  registerInstance(isPrimary: boolean): void {
    const now = Math.floor(Date.now() / 1000)
    const existing = this.state.heartbeats.find((h) => h.pid === this.pid)
    if (existing) {
      existing.heartbeat = now
      existing.isPrimary = isPrimary
    } else {
      this.state.heartbeats.push({
        pid: this.pid,
        started: now,
        heartbeat: now,
        isPrimary,
      })
    }
    this.persist()
  }

  heartbeat(): void {
    const now = Math.floor(Date.now() / 1000)
    const row = this.state.heartbeats.find((h) => h.pid === this.pid)
    if (!row) return
    row.heartbeat = now
    this.persist()
  }

  unregisterInstance(): void {
    this.state.heartbeats = this.state.heartbeats.filter((h) => h.pid !== this.pid)
    this.persist()
  }

  cleanDeadInstances(timeoutSeconds: number): void {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds
    this.state.heartbeats = this.state.heartbeats.filter((h) => h.heartbeat >= cutoff)
    this.persist()
  }

  aliveInstanceCount(): number {
    const cutoff = Math.floor(Date.now() / 1000) - 30
    return this.state.heartbeats.filter((h) => h.heartbeat >= cutoff).length
  }

  electPrimary(timeoutSeconds: number): boolean {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds

    for (const row of this.state.heartbeats) {
      if (row.heartbeat < cutoff && row.isPrimary) {
        row.isPrimary = false
      }
    }

    const existing = this.state.heartbeats.find((h) => h.isPrimary && h.heartbeat >= cutoff)
    if (existing) {
      return existing.pid === this.pid
    }

    const own = this.state.heartbeats.find((h) => h.pid === this.pid)
    if (!own) return false

    own.isPrimary = true
    this.persist()
    return true
  }

  resignPrimary(): void {
    const own = this.state.heartbeats.find((h) => h.pid === this.pid)
    if (!own) return
    own.isPrimary = false
    this.persist()
  }

  setMeta(key: string, value: string): void {
    if (this.closed) return
    this.state.metadata[key] = value
    this.persist()
  }

  getMeta(key: string): string | null {
    if (this.closed) return null
    return this.state.metadata[key] ?? null
  }

  touch(): void {
    this.setMeta("last_modified", String(Date.now()))
  }

  lastModified(): number {
    const value = this.getMeta("last_modified")
    return value ? Number.parseInt(value, 10) : 0
  }

  isEmpty(): boolean {
    return this.state.sessions.length === 0
  }
}

let globalStorage: Storage | null = null

export function getStorage(): Storage {
  if (!globalStorage) {
    globalStorage = new Storage()
    globalStorage.migrate()
  }
  return globalStorage
}

export function setStorage(storage: Storage): void {
  globalStorage = storage
}

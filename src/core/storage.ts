/**
 * SQLite storage for session/group persistence
 * Uses Bun's built-in SQLite
 */

import { Database } from "bun:sqlite"
import path from "path"
import fs from "fs"
import { randomUUID } from "crypto"
import type {
  Session,
  Group,
  Profile,
  Blueprint,
  BlueprintEntry,
  StatusUpdate,
  Tool,
  SessionStatus
} from "./types"
import { getStateDbPath } from "./app-paths"

const SCHEMA_VERSION = 3

export interface StorageOptions {
  dbPath?: string
}

export class Storage {
  private db: Database
  private pid: number
  private closed = false

  constructor(options: StorageOptions = {}) {
    const dbPath = options.dbPath ?? this.getDefaultPath()

    // Ensure directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    }

    this.db = new Database(dbPath)
    this.pid = process.pid

    // Configure SQLite for concurrent access
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA busy_timeout = 5000")
    this.db.exec("PRAGMA foreign_keys = ON")
  }

  private getDefaultPath(): string {
    return getStateDbPath()
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_path TEXT NOT NULL,
        group_path TEXT NOT NULL DEFAULT 'my-sessions',
        sort_order INTEGER NOT NULL DEFAULT 0,
        command TEXT NOT NULL DEFAULT '',
        wrapper TEXT NOT NULL DEFAULT '',
        tool TEXT NOT NULL DEFAULT 'shell',
        status TEXT NOT NULL DEFAULT 'idle',
        tmux_session TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL DEFAULT 0,
        parent_session_id TEXT NOT NULL DEFAULT '',
        worktree_path TEXT NOT NULL DEFAULT '',
        worktree_repo TEXT NOT NULL DEFAULT '',
        worktree_branch TEXT NOT NULL DEFAULT '',
        tool_data TEXT NOT NULL DEFAULT '{}',
        acknowledged INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        expanded INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        default_path TEXT NOT NULL DEFAULT ''
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        project_path TEXT NOT NULL,
        default_tool TEXT NOT NULL DEFAULT 'claude',
        default_custom_command TEXT NOT NULL DEFAULT '',
        use_worktree INTEGER NOT NULL DEFAULT 0,
        default_base_branch TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blueprints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        group_path TEXT NOT NULL DEFAULT 'my-sessions',
        entries_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS heartbeats (
        pid INTEGER PRIMARY KEY,
        started INTEGER NOT NULL,
        heartbeat INTEGER NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Set schema version
    const setVersion = this.db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)"
    )
    setVersion.run(String(SCHEMA_VERSION))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
      this.db.close()
    } catch {
      // Ignore close errors
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  // Session CRUD

  saveSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      session.id,
      session.title,
      session.projectPath,
      session.groupPath,
      session.order,
      session.command,
      session.wrapper,
      session.tool,
      session.status,
      session.tmuxSession,
      session.createdAt.getTime(),
      session.lastAccessed.getTime(),
      session.parentSessionId,
      session.worktreePath,
      session.worktreeRepo,
      session.worktreeBranch,
      JSON.stringify(session.toolData),
      session.acknowledged ? 1 : 0
    )
  }

  saveSessions(sessions: Session[]): void {
    const deleteStmt = this.db.prepare("DELETE FROM sessions WHERE id NOT IN (" +
      sessions.map(() => "?").join(",") + ")")
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      if (sessions.length === 0) {
        this.db.exec("DELETE FROM sessions")
      } else {
        deleteStmt.run(...sessions.map(s => s.id))
      }

      for (const session of sessions) {
        insertStmt.run(
          session.id,
          session.title,
          session.projectPath,
          session.groupPath,
          session.order,
          session.command,
          session.wrapper,
          session.tool,
          session.status,
          session.tmuxSession,
          session.createdAt.getTime(),
          session.lastAccessed.getTime(),
          session.parentSessionId,
          session.worktreePath,
          session.worktreeRepo,
          session.worktreeBranch,
          JSON.stringify(session.toolData),
          session.acknowledged ? 1 : 0
        )
      }
    })

    transaction()
  }

  loadSessions(): Session[] {
    if (this.closed) return []
    const stmt = this.db.prepare(`
      SELECT id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      FROM sessions ORDER BY sort_order
    `)

    const rows = stmt.all() as any[]
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      projectPath: row.project_path,
      groupPath: row.group_path,
      order: row.sort_order,
      command: row.command,
      wrapper: row.wrapper,
      tool: row.tool as Tool,
      status: row.status as SessionStatus,
      tmuxSession: row.tmux_session,
      createdAt: new Date(row.created_at),
      lastAccessed: new Date(row.last_accessed),
      parentSessionId: row.parent_session_id,
      worktreePath: row.worktree_path,
      worktreeRepo: row.worktree_repo,
      worktreeBranch: row.worktree_branch,
      toolData: JSON.parse(row.tool_data),
      acknowledged: row.acknowledged === 1
    }))
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT id, title, project_path, group_path, sort_order,
        command, wrapper, tool, status, tmux_session,
        created_at, last_accessed,
        parent_session_id, worktree_path, worktree_repo, worktree_branch,
        tool_data, acknowledged
      FROM sessions WHERE id = ?
    `)

    const row = stmt.get(id) as any
    if (!row) return null

    return {
      id: row.id,
      title: row.title,
      projectPath: row.project_path,
      groupPath: row.group_path,
      order: row.sort_order,
      command: row.command,
      wrapper: row.wrapper,
      tool: row.tool as Tool,
      status: row.status as SessionStatus,
      tmuxSession: row.tmux_session,
      createdAt: new Date(row.created_at),
      lastAccessed: new Date(row.last_accessed),
      parentSessionId: row.parent_session_id,
      worktreePath: row.worktree_path,
      worktreeRepo: row.worktree_repo,
      worktreeBranch: row.worktree_branch,
      toolData: JSON.parse(row.tool_data),
      acknowledged: row.acknowledged === 1
    }
  }

  deleteSession(id: string): void {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?")
    stmt.run(id)
  }

  updateSessionField(id: string, field: string, value: unknown): void {
    // Map TypeScript field names to SQL column names
    const columnMap: Record<string, string> = {
      projectPath: "project_path",
      groupPath: "group_path",
      sortOrder: "sort_order",
      tmuxSession: "tmux_session",
      createdAt: "created_at",
      lastAccessed: "last_accessed",
      parentSessionId: "parent_session_id",
      worktreePath: "worktree_path",
      worktreeRepo: "worktree_repo",
      worktreeBranch: "worktree_branch",
      toolData: "tool_data"
    }
    const column = columnMap[field] ?? field
    const stmt = this.db.prepare(`UPDATE sessions SET ${column} = ? WHERE id = ?`)
    stmt.run(value as string | number | null, id)
  }

  // Status updates

  writeStatus(id: string, status: SessionStatus, tool: Tool): void {
    if (this.closed) return
    const stmt = this.db.prepare("UPDATE sessions SET status = ?, tool = ? WHERE id = ?")
    stmt.run(status, tool, id)
  }

  readAllStatuses(): Map<string, StatusUpdate> {
    const stmt = this.db.prepare("SELECT id, status, tool, acknowledged FROM sessions")
    const rows = stmt.all() as any[]

    const result = new Map<string, StatusUpdate>()
    for (const row of rows) {
      result.set(row.id, {
        sessionId: row.id,
        status: row.status as SessionStatus,
        tool: row.tool as Tool,
        acknowledged: row.acknowledged === 1
      })
    }
    return result
  }

  setAcknowledged(id: string, ack: boolean): void {
    const stmt = this.db.prepare("UPDATE sessions SET acknowledged = ? WHERE id = ?")
    stmt.run(ack ? 1 : 0, id)
  }

  // Group CRUD

  saveGroups(groups: Group[]): void {
    const transaction = this.db.transaction(() => {
      this.db.exec("DELETE FROM groups")

      const stmt = this.db.prepare(`
        INSERT INTO groups (path, name, expanded, sort_order, default_path)
        VALUES (?, ?, ?, ?, ?)
      `)

      for (const group of groups) {
        stmt.run(
          group.path,
          group.name,
          group.expanded ? 1 : 0,
          group.order,
          group.defaultPath
        )
      }
    })

    transaction()
  }

  loadGroups(): Group[] {
    if (this.closed) return []
    const stmt = this.db.prepare(`
      SELECT path, name, expanded, sort_order, default_path
      FROM groups ORDER BY sort_order
    `)

    const rows = stmt.all() as any[]
    return rows.map(row => ({
      path: row.path,
      name: row.name,
      expanded: row.expanded === 1,
      order: row.sort_order,
      defaultPath: row.default_path
    }))
  }

  deleteGroup(path: string): void {
    const stmt = this.db.prepare("DELETE FROM groups WHERE path = ?")
    stmt.run(path)
  }

  // Profile CRUD

  private profileFromRow(row: any): Profile {
    return {
      id: row.id,
      name: row.name,
      projectPath: row.project_path,
      defaultTool: row.default_tool as Tool,
      defaultCustomCommand: row.default_custom_command,
      useWorktree: row.use_worktree === 1,
      defaultBaseBranch: row.default_base_branch,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }
  }

  listProfiles(): Profile[] {
    if (this.closed) return []
    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        project_path,
        default_tool,
        default_custom_command,
        use_worktree,
        default_base_branch,
        created_at,
        updated_at
      FROM profiles
      ORDER BY updated_at DESC, name ASC
    `)

    const rows = stmt.all() as any[]
    return rows.map((row) => this.profileFromRow(row))
  }

  getProfile(id: string): Profile | null {
    if (this.closed) return null
    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        project_path,
        default_tool,
        default_custom_command,
        use_worktree,
        default_base_branch,
        created_at,
        updated_at
      FROM profiles
      WHERE id = ?
    `)
    const row = stmt.get(id) as any
    return row ? this.profileFromRow(row) : null
  }

  createProfile(input: Omit<Profile, "id" | "createdAt" | "updatedAt">): Profile {
    const now = Date.now()
    const id = randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO profiles (
        id,
        name,
        project_path,
        default_tool,
        default_custom_command,
        use_worktree,
        default_base_branch,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      input.name,
      input.projectPath,
      input.defaultTool,
      input.defaultCustomCommand,
      input.useWorktree ? 1 : 0,
      input.defaultBaseBranch,
      now,
      now
    )

    return {
      ...input,
      id,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    }
  }

  updateProfile(
    id: string,
    updates: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>
  ): Profile | null {
    const current = this.getProfile(id)
    if (!current) return null

    const next: Profile = {
      ...current,
      ...updates,
      updatedAt: new Date()
    }

    const stmt = this.db.prepare(`
      UPDATE profiles
      SET
        name = ?,
        project_path = ?,
        default_tool = ?,
        default_custom_command = ?,
        use_worktree = ?,
        default_base_branch = ?,
        updated_at = ?
      WHERE id = ?
    `)

    stmt.run(
      next.name,
      next.projectPath,
      next.defaultTool,
      next.defaultCustomCommand,
      next.useWorktree ? 1 : 0,
      next.defaultBaseBranch,
      next.updatedAt.getTime(),
      id
    )

    return next
  }

  deleteProfile(id: string): void {
    const stmt = this.db.prepare("DELETE FROM profiles WHERE id = ?")
    stmt.run(id)
  }

  // Blueprint CRUD

  private parseBlueprintEntries(raw: string): BlueprintEntry[] {
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []

      return parsed
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          title: String(entry.title || "").trim(),
          projectPath: String(entry.projectPath || "").trim(),
          tool: (entry.tool as Tool) || "shell",
          command: String(entry.command || "").trim()
        }))
        .filter((entry) => entry.title && entry.projectPath)
    } catch {
      return []
    }
  }

  private blueprintFromRow(row: any): Blueprint {
    return {
      id: row.id,
      name: row.name,
      groupPath: row.group_path,
      entries: this.parseBlueprintEntries(row.entries_json),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }
  }

  listBlueprints(): Blueprint[] {
    if (this.closed) return []
    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        group_path,
        entries_json,
        created_at,
        updated_at
      FROM blueprints
      ORDER BY updated_at DESC, name ASC
    `)

    const rows = stmt.all() as any[]
    return rows.map((row) => this.blueprintFromRow(row))
  }

  getBlueprint(id: string): Blueprint | null {
    if (this.closed) return null
    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        group_path,
        entries_json,
        created_at,
        updated_at
      FROM blueprints
      WHERE id = ?
    `)
    const row = stmt.get(id) as any
    return row ? this.blueprintFromRow(row) : null
  }

  createBlueprint(input: Omit<Blueprint, "id" | "createdAt" | "updatedAt">): Blueprint {
    const now = Date.now()
    const id = randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO blueprints (
        id,
        name,
        group_path,
        entries_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    const entries = input.entries.map((entry) => ({
      title: entry.title.trim(),
      projectPath: entry.projectPath.trim(),
      tool: entry.tool,
      command: entry.command.trim()
    }))

    stmt.run(
      id,
      input.name,
      input.groupPath,
      JSON.stringify(entries),
      now,
      now
    )

    return {
      ...input,
      entries,
      id,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    }
  }

  updateBlueprint(
    id: string,
    updates: Partial<Omit<Blueprint, "id" | "createdAt" | "updatedAt">>
  ): Blueprint | null {
    const current = this.getBlueprint(id)
    if (!current) return null

    const next: Blueprint = {
      ...current,
      ...updates,
      updatedAt: new Date()
    }

    const entries = next.entries.map((entry) => ({
      title: entry.title.trim(),
      projectPath: entry.projectPath.trim(),
      tool: entry.tool,
      command: entry.command.trim()
    }))

    const stmt = this.db.prepare(`
      UPDATE blueprints
      SET
        name = ?,
        group_path = ?,
        entries_json = ?,
        updated_at = ?
      WHERE id = ?
    `)

    stmt.run(
      next.name,
      next.groupPath,
      JSON.stringify(entries),
      next.updatedAt.getTime(),
      id
    )

    return {
      ...next,
      entries
    }
  }

  deleteBlueprint(id: string): void {
    const stmt = this.db.prepare("DELETE FROM blueprints WHERE id = ?")
    stmt.run(id)
  }

  // Heartbeat management

  registerInstance(isPrimary: boolean): void {
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO heartbeats (pid, started, heartbeat, is_primary)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(this.pid, now, now, isPrimary ? 1 : 0)
  }

  heartbeat(): void {
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare("UPDATE heartbeats SET heartbeat = ? WHERE pid = ?")
    stmt.run(now, this.pid)
  }

  unregisterInstance(): void {
    const stmt = this.db.prepare("DELETE FROM heartbeats WHERE pid = ?")
    stmt.run(this.pid)
  }

  cleanDeadInstances(timeoutSeconds: number): void {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds
    const stmt = this.db.prepare("DELETE FROM heartbeats WHERE heartbeat < ?")
    stmt.run(cutoff)
  }

  aliveInstanceCount(): number {
    const cutoff = Math.floor(Date.now() / 1000) - 30
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM heartbeats WHERE heartbeat >= ?")
    const row = stmt.get(cutoff) as { count: number }
    return row.count
  }

  electPrimary(timeoutSeconds: number): boolean {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds

    const transaction = this.db.transaction(() => {
      // Clear stale primaries
      this.db.prepare(
        "UPDATE heartbeats SET is_primary = 0 WHERE heartbeat < ? AND is_primary = 1"
      ).run(cutoff)

      // Check for existing primary
      const existing = this.db.prepare(
        "SELECT pid FROM heartbeats WHERE is_primary = 1 AND heartbeat >= ? LIMIT 1"
      ).get(cutoff) as { pid: number } | undefined

      if (existing) {
        return existing.pid === this.pid
      }

      // Claim primary
      this.db.prepare("UPDATE heartbeats SET is_primary = 1 WHERE pid = ?").run(this.pid)
      return true
    })

    return transaction()
  }

  resignPrimary(): void {
    const stmt = this.db.prepare("UPDATE heartbeats SET is_primary = 0 WHERE pid = ?")
    stmt.run(this.pid)
  }

  // Metadata

  setMeta(key: string, value: string): void {
    if (this.closed) return
    const stmt = this.db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
    stmt.run(key, value)
  }

  getMeta(key: string): string | null {
    if (this.closed) return null
    const stmt = this.db.prepare("SELECT value FROM metadata WHERE key = ?")
    const row = stmt.get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  // Change detection

  touch(): void {
    this.setMeta("last_modified", String(Date.now()))
  }

  lastModified(): number {
    const value = this.getMeta("last_modified")
    return value ? parseInt(value, 10) : 0
  }

  isEmpty(): boolean {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM sessions")
    const row = stmt.get() as { count: number }
    return row.count === 0
  }
}

// Global instance
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

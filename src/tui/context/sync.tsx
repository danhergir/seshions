/**
 * Sync context for session state management
 * Based on OpenCode's sync pattern
 */

import { createSignal, createEffect, onCleanup, batch } from "solid-js"
import { createStore } from "solid-js/store"
import { getStorage } from "@/core/storage"
import { getSessionManager } from "@/core/session"
import { buildClaudeTeamRuntime } from "@/core/claude-teams"
import type { Session, Group, Profile, Blueprint, Config, ClaudeTeamRuntime } from "@/core/types"
import { createSimpleContext } from "./helper"

export type SyncStatus = "loading" | "partial" | "complete"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [status, setStatus] = createSignal<SyncStatus>("loading")
    const [store, setStore] = createStore<{
      sessions: Session[]
      groups: Group[]
      profiles: Profile[]
      blueprints: Blueprint[]
      claudeTeamRuntime: ClaudeTeamRuntime[]
      config: Config
    }>({
      sessions: [],
      groups: [],
      profiles: [],
      blueprints: [],
      claudeTeamRuntime: [],
      config: {}
    })

    // Initial load
    const storage = getStorage()
    const manager = getSessionManager()
    let lastClaudeRuntimeAt = 0
    let cachedClaudeRuntime: ClaudeTeamRuntime[] = []

    // Load sessions and groups
    function refresh() {
      const sessions = storage.loadSessions()
      const groups = storage.loadGroups()
      const profiles = storage.listProfiles()
      const blueprints = storage.listBlueprints()
      const now = Date.now()
      if (now - lastClaudeRuntimeAt >= 2000) {
        cachedClaudeRuntime = buildClaudeTeamRuntime(sessions)
        lastClaudeRuntimeAt = now
      }

      batch(() => {
        setStore("sessions", sessions)
        setStore("groups", groups)
        setStore("profiles", profiles)
        setStore("blueprints", blueprints)
        setStore("claudeTeamRuntime", cachedClaudeRuntime)
        if (status() === "loading") {
          setStatus("partial")
        }
      })
    }

    refresh()
    setStatus("complete")

    // Start refresh loop
    manager.startRefreshLoop(500)

    // Poll for changes (simple approach)
    let lastModified = storage.lastModified()
    const pollInterval = setInterval(() => {
      const newModified = storage.lastModified()
      if (newModified !== lastModified) {
        lastModified = newModified
        refresh()
      }
    }, 200)

    onCleanup(() => {
      clearInterval(pollInterval)
      manager.stopRefreshLoop()
    })

    return {
      get status() {
        return status()
      },
      get data() {
        return store
      },
      session: {
        get(id: string): Session | undefined {
          return store.sessions.find((s) => s.id === id)
        },
        list(): Session[] {
          return store.sessions
        },
        byStatus() {
          return {
            running: store.sessions.filter((s) => s.status === "running"),
            waiting: store.sessions.filter((s) => s.status === "waiting"),
            idle: store.sessions.filter((s) => s.status === "idle"),
            stopped: store.sessions.filter((s) => s.status === "stopped"),
            error: store.sessions.filter((s) => s.status === "error")
          }
        },
        byGroup(): Map<string, Session[]> {
          const groups = new Map<string, Session[]>()
          for (const session of store.sessions) {
            const existing = groups.get(session.groupPath) || []
            existing.push(session)
            groups.set(session.groupPath, existing)
          }
          return groups
        },
        async create(options: Parameters<typeof manager.create>[0]): Promise<Session> {
          const session = await manager.create(options)
          refresh()
          return session
        },
        async delete(id: string): Promise<void> {
          await manager.delete(id)
          refresh()
        },
        async restart(id: string): Promise<Session> {
          const session = await manager.restart(id)
          refresh()
          return session
        },
        async stop(id: string): Promise<void> {
          await manager.stop(id)
          refresh()
        },
        async fork(options: Parameters<typeof manager.fork>[0]): Promise<Session> {
          const session = await manager.fork(options)
          refresh()
          return session
        },
        rename(id: string, title: string): void {
          manager.updateTitle(id, title)
          refresh()
        },
        moveToGroup(id: string, groupPath: string): void {
          manager.moveToGroup(id, groupPath)
          refresh()
        },
        async send(id: string, message: string): Promise<void> {
          await manager.sendMessage(id, message)
          refresh()
        },
        acknowledge(id: string): void {
          manager.acknowledge(id)
          refresh()
        }
      },
      group: {
        get(path: string): Group | undefined {
          return store.groups.find((g) => g.path === path)
        },
        list(): Group[] {
          return store.groups
        },
        save(groups: Group[]): void {
          storage.saveGroups(groups)
          refresh()
        },
        delete(path: string): void {
          storage.deleteGroup(path)
          refresh()
        },
        toggle(path: string): void {
          const groups = store.groups.map((g) =>
            g.path === path ? { ...g, expanded: !g.expanded } : g
          )
          storage.saveGroups(groups)
          refresh()
        },
        create(name: string): void {
          const path = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group"
          // Ensure unique path
          let finalPath = path
          let counter = 1
          while (store.groups.some(g => g.path === finalPath)) {
            finalPath = `${path}-${counter}`
            counter++
          }
          const newGroup: Group = {
            path: finalPath,
            name,
            expanded: true,
            order: store.groups.length,
            defaultPath: ""
          }
          storage.saveGroups([...store.groups, newGroup])
          refresh()
        },
        rename(path: string, newName: string): void {
          const groups = store.groups.map((g) =>
            g.path === path ? { ...g, name: newName } : g
          )
          storage.saveGroups(groups)
          refresh()
        }
      },
      profile: {
        get(id: string): Profile | undefined {
          return store.profiles.find((p) => p.id === id)
        },
        list(): Profile[] {
          return store.profiles
        },
        create(input: Omit<Profile, "id" | "createdAt" | "updatedAt">): Profile {
          const profile = storage.createProfile(input)
          storage.touch()
          refresh()
          return profile
        },
        update(id: string, updates: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>): Profile | null {
          const profile = storage.updateProfile(id, updates)
          if (profile) {
            storage.touch()
            refresh()
          }
          return profile
        },
        delete(id: string): void {
          storage.deleteProfile(id)
          storage.touch()
          refresh()
        }
      },
      blueprint: {
        get(id: string): Blueprint | undefined {
          return store.blueprints.find((b) => b.id === id)
        },
        list(): Blueprint[] {
          return store.blueprints
        },
        create(input: Omit<Blueprint, "id" | "createdAt" | "updatedAt">): Blueprint {
          const blueprint = storage.createBlueprint(input)
          storage.touch()
          refresh()
          return blueprint
        },
        update(id: string, updates: Partial<Omit<Blueprint, "id" | "createdAt" | "updatedAt">>): Blueprint | null {
          const blueprint = storage.updateBlueprint(id, updates)
          if (blueprint) {
            storage.touch()
            refresh()
          }
          return blueprint
        },
        delete(id: string): void {
          storage.deleteBlueprint(id)
          storage.touch()
          refresh()
        }
      },
      claudeTeams: {
        listRuntime(): ClaudeTeamRuntime[] {
          return store.claudeTeamRuntime
        }
      },
      refresh
    }
  }
})

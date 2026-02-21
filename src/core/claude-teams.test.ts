import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { tmpdir } from "os"
import { buildClaudeTeamRuntime, listClaudeTasks, listClaudeTeams } from "./claude-teams"
import type { Session } from "./types"

const OVERRIDE_ENV = "SESHIONS_CLAUDE_HOME"

let tempRoot = ""
let previousOverride: string | undefined

function createSession(overrides: Partial<Session>): Session {
  const now = new Date()
  return {
    id: "session-id",
    title: "session",
    projectPath: "/tmp/project",
    groupPath: "my-sessions",
    order: 0,
    command: "claude",
    wrapper: "",
    tool: "claude",
    status: "idle",
    tmuxSession: "tmux-session",
    createdAt: now,
    lastAccessed: now,
    parentSessionId: "",
    worktreePath: "",
    worktreeRepo: "",
    worktreeBranch: "",
    toolData: {},
    acknowledged: false,
    ...overrides
  }
}

beforeEach(() => {
  previousOverride = process.env[OVERRIDE_ENV]
  tempRoot = mkdtempSync(path.join(tmpdir(), "seshions-claude-teams-"))
  process.env[OVERRIDE_ENV] = tempRoot
})

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env[OVERRIDE_ENV]
  } else {
    process.env[OVERRIDE_ENV] = previousOverride
  }
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

describe("claude-teams discovery", () => {
  test("loads teams and tasks from Claude metadata dirs", () => {
    const teamDir = path.join(tempRoot, "teams", "frontend-squad")
    mkdirSync(teamDir, { recursive: true })
    writeFileSync(
      path.join(teamDir, "config.json"),
      JSON.stringify(
        {
          name: "frontend-squad",
          lead_agent_id: "planner",
          teammates: [
            { agent_id: "planner", name: "planner", role: "lead" },
            { agent_id: "builder", name: "builder", role: "builder" }
          ]
        },
        null,
        2
      )
    )

    const taskDir = path.join(tempRoot, "tasks", "frontend-squad")
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(
      path.join(taskDir, "tasks.json"),
      JSON.stringify(
        [
          { id: "t-1", title: "Plan the architecture", status: "pending", assignee_id: "planner" },
          { id: "t-2", title: "Build milestone", status: "in_progress", assignee_name: "builder" }
        ],
        null,
        2
      )
    )

    const teams = listClaudeTeams()
    const tasks = listClaudeTasks("frontend-squad")

    expect(teams).toHaveLength(1)
    expect(teams[0]?.name).toBe("frontend-squad")
    expect(teams[0]?.leadId).toBe("planner")
    expect(teams[0]?.members.map((member) => member.name)).toEqual(["planner", "builder"])

    expect(tasks).toHaveLength(2)
    expect(tasks.map((task) => task.status).sort()).toEqual(["in_progress", "pending"])
  })

  test("builds runtime and links members to Claude sessions", () => {
    const teamDir = path.join(tempRoot, "teams", "backend-team")
    mkdirSync(teamDir, { recursive: true })
    writeFileSync(
      path.join(teamDir, "config.json"),
      JSON.stringify(
        {
          name: "backend-team",
          lead_agent_id: "planner",
          teammates: [
            { agent_id: "planner", name: "planner", role: "lead" },
            { agent_id: "builder", name: "builder", role: "builder" },
            { agent_id: "reviewer", name: "reviewer", role: "reviewer" }
          ]
        },
        null,
        2
      )
    )

    const taskDir = path.join(tempRoot, "tasks", "backend-team")
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(
      path.join(taskDir, "tasks.json"),
      JSON.stringify(
        [
          { id: "task-1", title: "Draft plan", status: "pending", assignee_id: "planner" },
          { id: "task-2", title: "Implement API", status: "in_progress", assignee_name: "builder" },
          { id: "task-3", title: "Review PR", status: "completed", assignee_name: "reviewer" }
        ],
        null,
        2
      )
    )

    const sessions: Session[] = [
      createSession({
        id: "s-planner",
        title: "planner",
        status: "running",
        tmuxSession: "planner",
        toolData: {
          agent_id: "planner"
        }
      }),
      createSession({
        id: "s-builder",
        title: "backend-builder",
        status: "waiting",
        tmuxSession: "builder"
      }),
      createSession({
        id: "s-other",
        title: "shell",
        tool: "shell",
        status: "running",
        tmuxSession: "shell-1"
      })
    ]

    const runtime = buildClaudeTeamRuntime(sessions)
    expect(runtime).toHaveLength(1)
    expect(runtime[0]?.team.name).toBe("backend-team")
    expect(runtime[0]?.inProgressCount).toBe(1)
    expect(runtime[0]?.pendingCount).toBe(1)
    expect(runtime[0]?.completedCount).toBe(1)

    const planner = runtime[0]?.members.find((member) => member.member.id === "planner")
    const builder = runtime[0]?.members.find((member) => member.member.id === "builder")
    const reviewer = runtime[0]?.members.find((member) => member.member.id === "reviewer")

    expect(planner?.linked).toBe(true)
    expect(planner?.linkConfidence).toBe("exact_agent_id")
    expect(planner?.sessionId).toBe("s-planner")
    expect(planner?.isLead).toBe(true)

    expect(builder?.linked).toBe(true)
    expect(builder?.linkConfidence).toBe("name_match")
    expect(builder?.status).toBe("waiting")

    expect(reviewer?.linked).toBe(false)
    expect(reviewer?.status).toBe("idle")
  })
})

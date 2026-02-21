import { describe, expect, test } from "bun:test"
import { rankCommands } from "./command-rank"

describe("rankCommands", () => {
  test("prefers matching context over non-matching context", () => {
    const ranked = rankCommands(
      [
        { title: "Go home", value: "nav.home", contexts: ["session"] },
        { title: "Launch blueprints", value: "session.blueprints", contexts: ["home"] }
      ],
      {},
      "home"
    )

    expect(ranked[0]?.command.value).toBe("session.blueprints")
  })

  test("boosts recent commands", () => {
    const now = Date.now()
    const ranked = rankCommands(
      [
        { title: "Dispatch", value: "orchestrate.dispatch" },
        { title: "Profiles", value: "session.profiles" }
      ],
      {
        "orchestrate.dispatch": { useCount: 1, lastUsedAt: now - 2 * 60_000 }
      },
      "home",
      now
    )

    expect(ranked[0]?.command.value).toBe("orchestrate.dispatch")
    expect(ranked[0]?.cues.includes("recent")).toBe(true)
  })

  test("falls back to stable alphabetical order on equal scores", () => {
    const ranked = rankCommands(
      [
        { title: "Broadcast to group", value: "bcast", category: "Orchestration" },
        { title: "Dispatch to role", value: "dispatch", category: "Orchestration" }
      ],
      {},
      "home",
      0
    )

    expect(ranked[0]?.command.value).toBe("bcast")
    expect(ranked[1]?.command.value).toBe("dispatch")
  })
})

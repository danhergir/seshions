export type CommandRouteContext = "home" | "session" | "global"

export interface RankableCommand {
  title: string
  value: string
  category?: string
  keybind?: string
  suggested?: boolean
  contexts?: CommandRouteContext[]
  description?: string
}

export interface CommandUsageSnapshot {
  useCount: number
  lastUsedAt: number
}

export interface RankedCommand {
  command: RankableCommand
  score: number
  cues: string[]
}

function getContextScore(command: RankableCommand, route: "home" | "session"): { score: number; cue?: string } {
  if (!command.contexts || command.contexts.length === 0) return { score: 0 }
  if (command.contexts.includes("global")) return { score: 8, cue: "context" }
  if (command.contexts.includes(route)) return { score: 18, cue: "context" }
  return { score: -24 }
}

function getUsageScore(
  usage: CommandUsageSnapshot | undefined,
  now: number
): { score: number; cue?: string } {
  if (!usage) return { score: 0 }

  const countScore = Math.min(usage.useCount, 24) * 1.5
  const ageMs = Math.max(0, now - usage.lastUsedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  let recency = 0
  if (ageMs < 10 * minute) recency = 20
  else if (ageMs < hour) recency = 14
  else if (ageMs < day) recency = 8
  else if (ageMs < 7 * day) recency = 4

  return {
    score: countScore + recency,
    cue: recency > 0 ? "recent" : undefined
  }
}

export function rankCommands<T extends RankableCommand>(
  commands: T[],
  usageByCommand: Record<string, CommandUsageSnapshot>,
  route: "home" | "session",
  now = Date.now()
): Array<{ command: T; score: number; cues: string[] }> {
  return commands
    .map((command) => {
      let score = 0
      const cues: string[] = []

      const context = getContextScore(command, route)
      score += context.score
      if (context.cue) cues.push(context.cue)

      if (command.suggested) score += 12
      if (command.keybind) score += 6

      const usage = getUsageScore(usageByCommand[command.value], now)
      score += usage.score
      if (usage.cue) cues.push(usage.cue)

      return {
        command,
        score,
        cues
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const categoryCompare = (a.command.category ?? "").localeCompare(b.command.category ?? "")
      if (categoryCompare !== 0) return categoryCompare
      return a.command.title.localeCompare(b.command.title)
    })
}

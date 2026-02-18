import { describe, test, expect } from "bun:test"
import {
  APP_NAME,
  PRIMARY_COMMANDS,
  SESSION_PREFIX,
  getAppDir,
  getConfigPath,
  getStateDbPath
} from "./app-paths"

describe("app-paths", () => {
  test("uses seshions defaults", () => {
    expect(APP_NAME).toBe("seshions")
    expect(PRIMARY_COMMANDS).toEqual(["seshions"])
    expect(SESSION_PREFIX).toBe("seshions_")
    expect(getAppDir()).toContain(".seshions")
    expect(getConfigPath()).toContain(".seshions/config.json")
    expect(getStateDbPath()).toContain(".seshions/state.db")
  })
})

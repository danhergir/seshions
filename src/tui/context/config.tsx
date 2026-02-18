/**
 * Config context for app-wide configuration access
 */

import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import { loadConfig, getConfig, saveConfig, type AppConfig } from "@/core/config"

export interface ConfigContext {
  config: () => AppConfig
  reload: () => Promise<void>
  save: (nextConfig: AppConfig) => Promise<void>
  patch: (partial: Partial<AppConfig>) => Promise<void>
}

export const { provider: ConfigProvider, use: useConfig } = createSimpleContext<ConfigContext>({
  name: "Config",
  init: () => {
    const [config, setConfig] = createSignal<AppConfig>(getConfig())

    const reload = async () => {
      const newConfig = await loadConfig()
      setConfig(newConfig)
    }

    const save = async (nextConfig: AppConfig) => {
      await saveConfig(nextConfig)
      setConfig(nextConfig)
    }

    const patch = async (partial: Partial<AppConfig>) => {
      const merged: AppConfig = {
        ...config(),
        ...partial,
        worktree: {
          ...(config().worktree ?? {}),
          ...(partial.worktree ?? {})
        },
        templates: partial.templates ?? config().templates ?? []
      }
      await save(merged)
    }

    return {
      config,
      reload,
      save,
      patch
    }
  }
})

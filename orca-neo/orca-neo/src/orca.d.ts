/**
 * Orca Note 运行时 API 的最小类型声明。
 * 仅覆盖 orca-neo 用到的部分；签名已对照
 * /Applications/Orca Note.app/Contents/Resources/app.asar 实际代码校验。
 */

export type SettingsSchemaType =
  | "boolean"
  | "string"
  | "number"
  | "color"
  | "singleChoice"
  | "multiChoices"
  | "array"

export interface SettingsSchemaItem {
  type: SettingsSchemaType
  label: string
  description?: string
  defaultValue?: unknown
  choices?: { label: string; value: string }[]
  arrayItemSchema?: SettingsSchemaItem
}

export type SettingsSchema = Record<string, SettingsSchemaItem>

export interface PluginState {
  enabled?: boolean
  schema?: SettingsSchema
  settings?: Record<string, unknown>
}

export interface OrcaState {
  locale: string
  repo: string
  dataDir: string
  repoDir: string
  /** "light" | "dark" —— 由 Orca 维护，同步映射到 prefers-color-scheme */
  themeMode: string
  plugins: Record<string, PluginState | undefined>
  themes: Record<string, string>
  settings: Record<string, unknown>
}

export interface Orca {
  state: OrcaState
  themes: {
    register(pluginName: string, themeName: string, cssFile: string): void
    unregister(themeName: string): void
    injectCSSResource?(url: string, role: string): void
    removeCSSResources?(role: string): void
  }
  plugins: {
    setSettingsSchema(pluginName: string, schema: SettingsSchema): Promise<void>
    setSettings(
      repo: string | null,
      pluginName: string,
      settings: Record<string, unknown>,
    ): Promise<void>
  }
  commands: {
    registerCommand(
      id: string,
      fn: (...args: any[]) => void | Promise<void>,
      label: string,
    ): void
    unregisterCommand(id: string): void
    invokeCommand(id: string, ...args: any[]): Promise<any>
  }
  headbar: {
    registerHeadbarButton(id: string, render: () => any): void
    unregisterHeadbarButton(id: string): void
  }
  notify(
    type: "info" | "success" | "warn" | "error",
    message: string,
    options?: { title?: string },
  ): void
}

declare global {
  const orca: Orca
  interface Window {
    orca: Orca
    Valtio: { subscribe: (proxy: object, cb: () => void) => () => void }
  }
}

export {}

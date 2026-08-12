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
    /** SQLite PluginStorage：按插件名 + key 存/取/删小值（适合索引类元数据）。
     *  value 为任意可序列化对象（内部 JSON）。 */
    setData(name: string, key: string, value: unknown): Promise<void>
    getData(name: string, key: string): Promise<unknown>
    getDataKeys(name: string): Promise<string[]>
    removeData(name: string, key: string): Promise<void>
    /** 写插件私有目录文件，无大小限制（适合整页快照）。
     *  fileName 可含子目录，如 "trash/<repoId>/<pageId>.json"。 */
    setFile(name: string, fileName: string, content: string): Promise<void>
    getFile(name: string, fileName: string): Promise<string>
    listFiles(name: string, folder?: string): Promise<string[]>
    removeFile(name: string, fileName: string): Promise<void>
    removeFolder(name: string, folder: string): Promise<void>
  }
  /** 统一后端 RPC 通道。返回值均为 Promise。
   *  已知命令（字符串）："delete-blocks"(blockIds:number[])、"get-block"(id)、
   *  "get-block-tree"(id)、"create-block"(parentId,leftId,repr,content)、
   *  "set-plugin-file"/"get-plugin-file"/"list-plugin-files"/"remove-plugin-file"/
   *  "remove-plugin-folder"、"set-plugin-data"/"get-plugin-data" 等。
   *  命令名取自 app.asar 的 APIMsgs 枚举。 */
  invokeBackend(msg: string, ...args: any[]): Promise<any>
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

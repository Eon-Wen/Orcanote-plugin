import {
  AutoRefresher,
  applyFeatures,
  applyPalette,
  cleanupDom,
  smoothCaret,
} from "./features"
import { SETTINGS_SCHEMA, withDefaults, type NeoSettings } from "./settings"
import { startScopeHighlight, stopScopeHighlight } from "./scope"
import { startColorSidebar, stopColorSidebar } from "./colorSidebar"

const PLUGIN_NAME = "orca-neo"
const THEME_NAME = "Neo"
const THEME_CSS = "neo.css"
const PLUS_CSS_ID = "neo-plus-styles"
const TEXTURES_CSS_ID = "neo-textures-styles"

let unsubscribe: (() => void) | null = null
let refresher: AutoRefresher | null = null
let lastSnapshot = ""

/** 把插件自带的一份 CSS 以 <link> 挂进 <head>（带去缓存后缀）。
 *  若 <link> 已存在，则强制刷新 href（新时间戳），确保重载插件时 CSS 真正更新。 */
function injectStyle(id: string, file: string) {
  const href = `file://${orca.state.dataDir}/plugins/${PLUGIN_NAME}/dist/${file}?_t=${Date.now()}`
  const existing = document.getElementById(id) as HTMLLinkElement | null
  if (existing) {
    existing.href = href
    return
  }
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.type = "text/css"
  link.href = href
  document.head.appendChild(link)
}

function removeStyle(id: string) {
  document.getElementById(id)?.remove()
}

/**
 * neo.css 由 Orca 的主题机制加载（仅在用户选中 Neo 主题时生效），
 * neo-plus.css 与 textures.css 是功能层，需要插件自己挂进 <head>。
 */
function injectPlusStyles() {
  injectStyle(PLUS_CSS_ID, "neo-plus.css")
  injectStyle(TEXTURES_CSS_ID, "textures.css")
}

function removePlusStyles() {
  removeStyle(PLUS_CSS_ID)
  removeStyle(TEXTURES_CSS_ID)
}

function readSettings(): NeoSettings {
  return withDefaults(orca.state.plugins[PLUGIN_NAME]?.settings)
}

function apply() {
  const settings = readSettings()
  applyPalette(settings)
  applyFeatures(settings)

  if (settings.smoothCaret === true) smoothCaret.enable()
  else smoothCaret.disable()

  // 只有「跟随时间」才需要定时器
  refresher?.start(apply, settings.palette === "followTime")
}

/** 设置变更后才重新应用，避免 valtio 的高频通知造成无谓的样式重算 */
function applyIfChanged() {
  const snapshot = JSON.stringify(readSettings())
  if (snapshot === lastSnapshot) return
  lastSnapshot = snapshot
  apply()
}

export async function load() {
  orca.themes.register(PLUGIN_NAME, THEME_NAME, THEME_CSS)
  await orca.plugins.setSettingsSchema(PLUGIN_NAME, SETTINGS_SCHEMA)

  injectPlusStyles()

  startColorSidebar()
  startScopeHighlight()

  refresher = new AutoRefresher()
  lastSnapshot = JSON.stringify(readSettings())
  apply()

  const pluginState = orca.state.plugins[PLUGIN_NAME]
  if (pluginState != null) {
    unsubscribe = window.Valtio.subscribe(pluginState, applyIfChanged)
  }

  orca.commands.registerCommand(
    `${PLUGIN_NAME}.reload`,
    () => {
      injectPlusStyles()
      lastSnapshot = ""
      applyIfChanged()
    },
    "Neo: 重新应用主题设置",
  )
}

export async function unload() {
  orca.commands.unregisterCommand(`${PLUGIN_NAME}.reload`)
  unsubscribe?.()
  unsubscribe = null
  refresher?.stop()
  refresher = null
  smoothCaret.disable()
  stopScopeHighlight()
  stopColorSidebar()
  removePlusStyles()
  cleanupDom()
  orca.themes.unregister(THEME_NAME)
}

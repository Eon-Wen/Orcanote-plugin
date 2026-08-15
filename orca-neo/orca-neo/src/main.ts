import {
  AutoRefresher,
  applyFeatures,
  applyPalette,
  cleanupDom,
  immersive,
  typewriter,
  typeSound,
} from "./features"
import {
  SETTINGS_SCHEMA,
  buildPaletteChoices,
  withDefaults,
  type NeoSettings,
} from "./settings"
import { startScopeHighlight, stopScopeHighlight } from "./scope"
import { setColorSidebar, stopColorSidebar } from "./colorSidebar"
import { renderNeoHeadbar } from "./headbar"
import { initTrash, disposeTrash } from "./trash"
import { installTrashMenuInjector, disposeTrashMenuInjector } from "./trashMenuInject"
import {
  installRefMigrateInjector,
  disposeRefMigrateInjector,
} from "./refMigrateInject"
import { currentEditorBlockId, repairAllDanglingTags, repairIncomplete } from "./refMigrate"
import { applyPageSort, disposePageSort, installPageSort } from "./pageSort"
import {
  installPageSortInjector,
  disposePageSortInjector,
} from "./pageSortInject"
import {
  installPageBatchSelect,
  disposePageBatchSelect,
} from "./pageBatchInclude"
import { installListView, disposeListView } from "./listView"
import { installBlockMenuCommands, disposeBlockMenuCommands } from "./blockMenuCommands"
import { openRefMigrateDialog } from "./refMigrateDialog"
import { enableTabs, disableTabs } from "./tabs"
import { enableWordCount, disableWordCount } from "./wordCount"
import { installWelcome, disposeWelcome } from "./welcome"

const PLUGIN_NAME = "orca-neo"
const THEME_NAME = "Neo"
const THEME_CSS = "neo.css"
const PLUS_CSS_ID = "neo-plus-styles"
const TEXTURES_CSS_ID = "neo-textures-styles"

let unsubscribe: (() => void) | null = null
let refresher: AutoRefresher | null = null
let lastSnapshot = ""
let modeMql: MediaQueryList | null = null

/** 虎鲸明暗切换时重建配色下拉（按新模式过滤），并立即用新模式重新应用配色。
 * 否则插件的 --neo-x-* 内联变量（含暗色反转的 background/surface 交换）会停留在
 * 旧模式的取值，导致反转 / 预设配色在切换明暗后“看似失效”。 */
function onModeChange() {
  void refreshPaletteSchema().then(apply)
}

/** 把插件自带的一份 CSS 以 <link> 挂进 <head>（带去缓存后缀） */
function injectStyle(id: string, file: string) {
  if (document.getElementById(id)) return
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.type = "text/css"
  link.href = `file://${orca.state.dataDir}/plugins/${PLUGIN_NAME}/dist/${file}?_t=${Date.now()}`
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

/** 按虎鲸当前明暗模式重建配色下拉：
 *  - 浅色模式只暴露浅色配色，深色模式只暴露深色配色；
 *  - 若当前所选配色在新模式下不可用（例如浅色模式下曾选了深色-only 方案），
 *    回落到 default（明暗两套都有），避免误用错模式色值；
 *  - 重新注册设置 schema，使设置面板立即反映新的可选集合。 */
async function refreshPaletteSchema() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const choices = buildPaletteChoices(dark)
  SETTINGS_SCHEMA.palette.choices = choices
  const values = choices.map((c) => c.value)
  const cur = orca.state.plugins[PLUGIN_NAME]?.settings?.palette
  if (typeof cur === "string" && cur !== "custom" && !values.includes(cur)) {
    await orca.plugins.setSettings(
      "repo",
      PLUGIN_NAME,
      { ...readSettings(), palette: "default" },
    )
  }
  await orca.plugins.setSettingsSchema(PLUGIN_NAME, SETTINGS_SCHEMA)
}

function apply() {
  const settings = readSettings()
  applyPalette(settings)
  applyFeatures(settings)

  // 彩色文档树：由「彩色文档树」开关驱动，开 → 莫兰迪色 + 渐变，关 → 跟随 Neo 主题配色
  setColorSidebar(settings.colorfulDocTree === true)

  // 沉浸模式：跟随光标的强调色高亮带 + 隐藏非必要 UI
  if (settings.immersive === true) immersive.enable()
  else immersive.disable()

  // 打字机模式：输入时当前行始终垂直居中
  if (settings.typewriter === true) typewriter.enable()
  else typewriter.disable()

  // 打字音：敲击键盘播放打字机音效
  if (settings.typeSound === true) typeSound.enable()
  else typeSound.disable()

  // 浏览器式页签条：顶部横排页签 + 拖拽分栏
  if (settings.browserTabs === true) enableTabs()
  else disableTabs()

  // 写作进度统计：写作子标签旁的圆点 + 字数/目标完成度面板
  if (settings.wordCount === true) {
    enableWordCount(
      String(settings.wordCountTag ?? "元·主·Express"),
      String(settings.wordCountTargetProp ?? "目标字数"),
      String(settings.wordCountDeadlineProp ?? "截止日期"),
    )
  } else disableWordCount()

  // 精细迁移引用：反链面板工具条入口按钮（运行时开关，关掉即移除按钮）
  if (settings.refMigrateEnabled === true) installRefMigrateInjector()
  else disposeRefMigrateInjector()

  // 侧边栏页面排序：下拉注入 + 观察器/拖拽（运行时开关）
  if (settings.pageSortEnabled === true) {
    installPageSortInjector()
    installPageSort()
    void applyPageSort()
  } else {
    disposePageSortInjector()
    disposePageSort()
  }

  // 侧边栏多选批量改「包含于」（运行时开关）
  if (settings.pageBatchEnabled === true) installPageBatchSelect()
  else disposePageBatchSelect()

  // 列表视图（运行时开关）：展示层转换逻辑（入口在块菜单「插件命令」分组）
  if (settings.listViewEnabled === true) {
    installListView()
  } else {
    disposeListView()
  }

  // 块菜单命令：两个功能共用的原生入口（render 里按各开关过滤）
  // 表格转统计图（chartEnabled）只有菜单入口——图表本身是真块（图片块），
  // 无需观察器/注入渲染（旧 chartEmbed 注入方案已废弃）
  if (settings.listViewEnabled === true || settings.chartEnabled === true) {
    installBlockMenuCommands()
  } else {
    disposeBlockMenuCommands()
  }

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

  injectPlusStyles()

  startScopeHighlight()

  refresher = new AutoRefresher()
  lastSnapshot = JSON.stringify(readSettings())
  apply()

  const pluginState = orca.state.plugins[PLUGIN_NAME]
  if (pluginState != null) {
    unsubscribe = window.Valtio.subscribe(pluginState, applyIfChanged)
  }

  // 首次启用 Neo 主题的欢迎庆祝：首装/更新后各放一次，Neo 与其它主题来回切换不重放
  installWelcome()

  // 配色下拉按虎鲸明暗模式过滤：初次注册 + 监听明暗切换时重建
  await refreshPaletteSchema()
  modeMql = window.matchMedia("(prefers-color-scheme: dark)")
  modeMql.addEventListener("change", onModeChange)

  // 顶部插件栏入口：点开即出可勾选的 Neo 菜单
  orca.headbar.registerHeadbarButton(`${PLUGIN_NAME}.menu`, renderNeoHeadbar)

  // 回收站：安装 delete-blocks 拦截器（真删前先快照进私有存储）；
  // 入口注入到右上角三点菜单（设置/插件市场/备份/帮助浮层），不放顶栏按钮
  await initTrash()
  installTrashMenuInjector()

  // 侧边栏页面排序 / 多选批量包含：开关与安装由 apply() 控制（运行时可切换）
  // 精细迁移引用入口注入与开关由 apply() 里的 refMigrateEnabled 控制（运行时可切换）

  // 后台全局修复：历史 bug 可能留下悬空 _tags（会让标签选择菜单 yu.map 崩溃）。
  // 修复依赖编辑器面板（setProperties 是编辑器命令），故延迟几秒并带重试：
  // 首次 4s，若仍有未修成的坏块则每 12s 重试，最多 4 次。
  const autoRepair = (attempt: number) => {
    if (readSettings().refMigrateEnabled !== true) return
    void repairAllDanglingTags().then(() => {
      if (repairIncomplete() && attempt < 4) {
        setTimeout(() => autoRepair(attempt + 1), 12000)
      }
    })
  }
  setTimeout(() => autoRepair(1), 4000)

  // 手动修复入口：命令面板可搜到，弹窗报结果（用于验证/紧急修复）
  orca.commands.registerCommand(
    `${PLUGIN_NAME}.repairtags`,
    async () => {
      if (readSettings().refMigrateEnabled !== true) {
        window.alert("[Neo] 精细迁移引用已关闭，无法使用此功能")
        return
      }
      try {
        const n = await repairAllDanglingTags(true)
        if (n < 0) window.alert("[Neo] 悬空标签扫描失败，请查看控制台日志")
        else if (n === 0) window.alert("[Neo] 扫描完成：未发现悬空标签（数据干净）")
        else window.alert(`[Neo] 已修复 ${n} 个块的悬空标签，现在可以正常打标签了`)
      } catch (e: any) {
        window.alert(`[Neo] 修复出错：${e?.message ?? e}`)
      }
    },
    "Neo: 修复悬空标签（全库扫描）",
  )

  orca.commands.registerCommand(
    `${PLUGIN_NAME}.reload`,
    () => {
      lastSnapshot = ""
      applyIfChanged()
    },
    "Neo: 重新应用主题设置",
  )

  // 精细迁移引用兜底入口（命令面板可搜到）：对当前编辑器块打开迁移弹窗
  orca.commands.registerCommand(
    `${PLUGIN_NAME}.refmigrate`,
    () => {
      try {
        if (readSettings().refMigrateEnabled !== true) {
          window.alert("[Neo] 精细迁移引用已关闭，请在设置中开启")
          return
        }
        const id = currentEditorBlockId()
        if (id == null) {
          console.warn("[REFMIGRATE] 命令入口：无法确定当前块")
          window.alert("[精细迁移引用] 无法确定当前块")
          return
        }
        console.log("[REFMIGRATE] 命令入口：打开迁移弹窗，来源块", id)
        openRefMigrateDialog(id)
      } catch (e: any) {
        console.error("[REFMIGRATE] 命令入口异常", e)
        window.alert(`[精细迁移引用] 打开失败：${e?.message ?? e}`)
      }
    },
    "Neo: 精细迁移引用（当前块反链）",
  )
}

export async function unload() {
  orca.commands.unregisterCommand(`${PLUGIN_NAME}.reload`)
  orca.commands.unregisterCommand(`${PLUGIN_NAME}.refmigrate`)
  orca.commands.unregisterCommand(`${PLUGIN_NAME}.repairtags`)
  orca.headbar.unregisterHeadbarButton(`${PLUGIN_NAME}.menu`)
  disposeTrashMenuInjector()
  disposeTrash()
  disposeRefMigrateInjector()
  disposePageSortInjector()
  disposePageSort()
  disposePageBatchSelect()
  disposeListView()
  disposeBlockMenuCommands()
  disposeWelcome()
  unsubscribe?.()
  unsubscribe = null
  modeMql?.removeEventListener("change", onModeChange)
  modeMql = null
  refresher?.stop()
  refresher = null
  immersive.disable()
  typewriter.disable()
  typeSound.disable()
  disableTabs()
  disableWordCount()
  stopScopeHighlight()
  stopColorSidebar()
  removePlusStyles()
  cleanupDom()
  orca.themes.unregister(THEME_NAME)
}

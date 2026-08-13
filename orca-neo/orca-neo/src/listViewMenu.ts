// 列表视图菜单注入：右键列表块 / 点击块手柄弹出的原生菜单里按状态加条目——
// 普通列表 → 「转为表格」；已是表格 → 「缩放条（百分比+滑杆）、全屏查看、转回列表」。
import {
  isTopLevelList,
  setListView,
  viewOfBlock,
  setListViewZoom,
  zoomOfBlock,
  applyZoomLive,
  toggleFullscreen,
  ZOOM_MIN,
  ZOOM_MAX,
  type ListViewType,
} from "./listView"

const MENU_SEL = ".orca-context-menu"
const ITEM_CLASS = "neo-lv-menu-item"

// 最近一次在块上右键/点手柄的目标块 id
let _targetBlockId: number | null = null
let _targetAt = 0

function onContextMenuCapture(e: MouseEvent) {
  const block = (e.target as HTMLElement | null)?.closest?.(".orca-block[data-id]") as HTMLElement | null
  const id = Number(block?.getAttribute("data-id"))
  if (Number.isFinite(id)) {
    _targetBlockId = id
    _targetAt = Date.now()
  }
}

function onMouseDownCapture(e: MouseEvent) {
  const handle = (e.target as HTMLElement | null)?.closest?.(".orca-block-handle") as HTMLElement | null
  if (!handle) return
  const block = handle.closest(".orca-block[data-id]") as HTMLElement | null
  const id = Number(block?.getAttribute("data-id"))
  if (Number.isFinite(id)) {
    _targetBlockId = id
    _targetAt = Date.now()
  }
}

/** 关闭原生菜单（Escape 派发），随后执行动作。 */
function closeMenuAndRun(menu: HTMLElement, action: () => void) {
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  setTimeout(action, 60)
}

/** 造一个原生菜单条目（结构与 Orca 自带条目一致）。 */
function buildActionItem(menu: HTMLElement, icon: string, label: string, action: () => void): HTMLElement {
  const item = document.createElement("div")
  item.className = "orca-menu-text " + ITEM_CLASS
  const ic = document.createElement("i")
  ic.className = `${icon} orca-menu-text-icon orca-menu-text-pre`
  const text = document.createElement("div")
  text.className = "orca-menu-text-text"
  text.textContent = label
  item.appendChild(ic)
  item.appendChild(text)
  item.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    closeMenuAndRun(menu, action)
  })
  return item
}

function buildSeparator(): HTMLElement {
  const sep = document.createElement("div")
  sep.className = "orca-menu-separator"
  return sep
}

/** 菜单里的缩放条：百分比输入 + 拖动滑杆。阻止事件冒泡使拖动时菜单保持打开。 */
function buildZoomRow(menu: HTMLElement, blockId: number): HTMLElement {
  const row = document.createElement("div")
  row.className = "orca-menu-text " + ITEM_CLASS + " neo-lv-zoomrow"
  row.addEventListener("mousedown", (e) => e.stopPropagation())
  row.addEventListener("click", (e) => e.stopPropagation())
  row.addEventListener("dblclick", (e) => e.stopPropagation())

  const num = document.createElement("input")
  num.type = "number"
  num.min = String(Math.round(ZOOM_MIN * 100))
  num.max = String(Math.round(ZOOM_MAX * 100))
  num.step = "5"
  num.className = "neo-lv-zb-num"
  num.title = "缩放百分比"

  const range = document.createElement("input")
  range.type = "range"
  range.min = String(Math.round(ZOOM_MIN * 100))
  range.max = String(Math.round(ZOOM_MAX * 100))
  range.step = "5"
  range.className = "neo-lv-zb-range"
  range.title = "拖动缩放"

  const sync = () => {
    const v = Math.round(zoomOfBlock(blockId) * 100)
    num.value = String(v)
    range.value = String(v)
  }
  sync()

  num.addEventListener("change", () => {
    const v = parseFloat(num.value)
    if (!Number.isFinite(v) || v <= 0) {
      sync()
      return
    }
    void setListViewZoom(blockId, v / 100).then(sync)
  })
  range.addEventListener("input", () => {
    const v = parseFloat(range.value)
    if (Number.isFinite(v) && v > 0) {
      applyZoomLive(blockId, v / 100)
      num.value = String(Math.round(v))
    }
  })
  range.addEventListener("change", () => {
    const v = parseFloat(range.value)
    if (Number.isFinite(v) && v > 0) void setListViewZoom(blockId, v / 100)
  })

  row.append(num, range)
  return row
}

function injectInto(menu: HTMLElement) {
  if (menu.querySelector("." + ITEM_CLASS)) return
  const id = _targetBlockId
  if (id == null || Date.now() - _targetAt > 2000) return

  // 已是表格：缩放条（百分比 + 滑杆）、全屏查看、转回列表
  if (viewOfBlock(id) === "table") {
    menu.appendChild(buildZoomRow(menu, id))
    menu.appendChild(buildSeparator())
    menu.appendChild(buildActionItem(menu, "ti ti-arrows-maximize", "全屏查看（Esc 退出）", () => toggleFullscreen(id)))
    menu.appendChild(buildActionItem(menu, "ti ti-list", "转回列表", () => void setListView(id, "")))
    return
  }

  // 普通列表：仅「头上没有列表类父级块」的顶层列表提供一键转为表格
  if (!isTopLevelList(id)) return
  menu.appendChild(buildActionItem(menu, "ti ti-table", "转为表格", () => void setListView(id, "table" as ListViewType)))
}

let _bodyObserver: MutationObserver | null = null
let _menuWatchers = new Set<MutationObserver>()

function onBodyChange() {
  document.querySelectorAll(MENU_SEL).forEach((menu) => {
    const el = menu as HTMLElement
    injectInto(el)
    // 防 React 重渲染抹除注入项
    let mo = (el as any).__neoLvWatch
    if (!mo) {
      mo = new MutationObserver(() => injectInto(el))
      mo.observe(el, { childList: true })
      ;(el as any).__neoLvWatch = mo
      _menuWatchers.add(mo)
    }
  })
}

export function installListViewMenu() {
  if (_bodyObserver) return
  document.addEventListener("contextmenu", onContextMenuCapture, true)
  document.addEventListener("mousedown", onMouseDownCapture, true)
  _bodyObserver = new MutationObserver(onBodyChange)
  _bodyObserver.observe(document.body, { childList: true, subtree: true })
}

export function disposeListViewMenu() {
  _bodyObserver?.disconnect()
  _bodyObserver = null
  document.removeEventListener("contextmenu", onContextMenuCapture, true)
  document.removeEventListener("mousedown", onMouseDownCapture, true)
  _menuWatchers.forEach((mo) => mo.disconnect())
  _menuWatchers.clear()
  document.querySelectorAll("." + ITEM_CLASS).forEach((el) => el.remove())
}

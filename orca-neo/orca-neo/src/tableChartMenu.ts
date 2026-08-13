// 表格转统计图菜单注入：右键表格块 / 点块手柄弹出的原生菜单加「数据图表」条目。
// 模式同 listViewMenu.ts（捕获最近目标块 → 菜单出现时注入 → Escape 关菜单后执行）。
// 定位表格块走纯 DOM 链（不依赖 state 父链）：右键元素 → closest 表格容器
// （.orca-repr-table2 / .orca-table-block）→ closest 所属块 → data-id。右键落在
// 表格标题/单元格/边框内都能命中；落在表格外则不弹条目（语义上也不是表格）。
import { isTableBlock } from "./tableChart"
import { openTableChartDialog } from "./tableChartDialog"

const MENU_SEL = ".orca-context-menu"
const ITEM_CLASS = "neo-chart-menu-item"

// 最近一次在表格上右键/点手柄定位到的表格块 id
let _targetTableId: number | null = null
let _targetAt = 0

/** 从事件目标沿 DOM 向上找表格块 id。 */
function tableBlockIdFromTarget(t: EventTarget | null): number | null {
  const el = t as HTMLElement | null
  const grid = el?.closest?.(".orca-table-block, .orca-repr-table2") as HTMLElement | null
  const block = grid?.closest?.(".orca-block[data-id]") as HTMLElement | null
  const id = Number(block?.getAttribute("data-id"))
  return Number.isFinite(id) ? id : null
}

function onContextMenuCapture(e: MouseEvent) {
  const id = tableBlockIdFromTarget(e.target)
  if (id != null) {
    _targetTableId = id
    _targetAt = Date.now()
  }
}

function onMouseDownCapture(e: MouseEvent) {
  const handle = (e.target as HTMLElement | null)?.closest?.(".orca-block-handle") as HTMLElement | null
  if (!handle) return
  const block = handle.closest(".orca-block[data-id]") as HTMLElement | null
  const id = Number(block?.getAttribute("data-id"))
  // 手柄必须属于表格块自身（内容块的手柄不算）
  if (Number.isFinite(id) && isTableBlock(id)) {
    _targetTableId = id
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

function injectInto(menu: HTMLElement) {
  if (menu.querySelector("." + ITEM_CLASS)) return
  const tableId = _targetTableId
  if (tableId == null || Date.now() - _targetAt > 2000) return
  if (!isTableBlock(tableId)) return
  menu.appendChild(buildSeparator())
  menu.appendChild(
    buildActionItem(menu, "ti ti-chart-bar", "数据图表", () => openTableChartDialog(tableId)),
  )
}

let _bodyObserver: MutationObserver | null = null
let _menuWatchers = new Set<MutationObserver>()

function onBodyChange() {
  document.querySelectorAll(MENU_SEL).forEach((menu) => {
    const el = menu as HTMLElement
    injectInto(el)
    // 防 React 重渲染抹除注入项
    let mo = (el as any).__neoChartWatch
    if (!mo) {
      mo = new MutationObserver(() => injectInto(el))
      mo.observe(el, { childList: true })
      ;(el as any).__neoChartWatch = mo
      _menuWatchers.add(mo)
    }
  })
}

export function installTableChartMenu() {
  if (_bodyObserver) return
  document.addEventListener("contextmenu", onContextMenuCapture, true)
  document.addEventListener("mousedown", onMouseDownCapture, true)
  _bodyObserver = new MutationObserver(onBodyChange)
  _bodyObserver.observe(document.body, { childList: true, subtree: true })
}

export function disposeTableChartMenu() {
  _bodyObserver?.disconnect()
  _bodyObserver = null
  document.removeEventListener("contextmenu", onContextMenuCapture, true)
  document.removeEventListener("mousedown", onMouseDownCapture, true)
  _menuWatchers.forEach((mo) => mo.disconnect())
  _menuWatchers.clear()
  document.querySelectorAll("." + ITEM_CLASS).forEach((el) => el.remove())
}

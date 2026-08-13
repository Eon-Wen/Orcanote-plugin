// 侧边栏列表（页面/标签/收藏）的排序下拉：注入到各列表根容器（列表上方，等宽）。
// 点击弹出排序菜单（独立 React 根、锚定按钮），选择后写 repo 维度设置 pageSortMode，
// 由 main.ts 的 apply() 触发 pageSort 重排。
import { currentSortMode, type PageSortMode } from "./pageSort"

let React: any
let ReactDOM: any
let orca: any

function ensureGlobals() {
  if (React) return
  const g = window as unknown as { React: any; ReactDOM: any; orca: any }
  React = g.React
  ReactDOM = g.ReactDOM
  orca = g.orca
}

const PLUGIN = "orca-neo"
const ROW_CLASS = "neo-pagesort"

// 两个列表（页面/标签）：根容器 + 列表容器（下拉行插在列表容器前）。
// 收藏栏纯靠原生拖拽（原生即重排+持久化），不加排序按钮、不参与排序。
const TARGETS = [
  { rootSel: ".orca-aliased", listSel: ".orca-aliased-list" },
  { rootSel: ".orca-tags-list", listSel: ".orca-tags-list-list" },
]

const MODE_LABELS: Record<PageSortMode, string> = {
  default: "默认拼音",
  created: "创建时间",
  modified: "修改时间",
  manual: "手动拖拽",
}

const MODES: { value: PageSortMode; label: string; desc: string }[] = [
  { value: "default", label: "默认拼音", desc: "按拼音/层级原生排序" },
  { value: "created", label: "创建时间", desc: "按页面建立时间排序" },
  { value: "modified", label: "修改时间", desc: "按最后修改时间排序" },
  { value: "manual", label: "手动拖拽", desc: "拖动条目调整顺序，自动保存" },
]

function setSortMode(mode: PageSortMode) {
  try {
    const cur = orca?.state?.plugins?.[PLUGIN]?.settings ?? {}
    orca?.plugins?.setSettings?.("repo", PLUGIN, { ...cur, pageSortMode: mode })
  } catch (e) {
    console.warn("[PAGESORT] 写设置失败", e)
  }
}

function buildRow(): HTMLElement {
  const row = document.createElement("div")
  row.className = ROW_CLASS
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "neo-pagesort-btn"
  btn.textContent = `排序：${MODE_LABELS[currentSortMode()]} ▾`
  btn.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(btn)
  })
  row.appendChild(btn)
  return row
}

function injectInto(root: HTMLElement, listSel: string) {
  const row = root.querySelector(`:scope > .${ROW_CLASS}`) as HTMLElement | null
  if (row) {
    // 更新标签（仅文案变化时才写，避免无谓 DOM 变更触发观察器死循环）
    const btn = row.querySelector(".neo-pagesort-btn") as HTMLElement | null
    const target = `排序：${MODE_LABELS[currentSortMode()]} ▾`
    if (btn && btn.textContent !== target) btn.textContent = target
    return
  }
  const list = root.querySelector(`:scope > ${listSel}`)
  const newRow = buildRow()
  if (list) root.insertBefore(newRow, list)
  else root.appendChild(newRow)
}

let _bodyObserver: MutationObserver | null = null
let _injectDebounce: ReturnType<typeof setTimeout> | null = null
let _closeMenu: (() => void) | null = null

function onBodyChange() {
  // 防抖：body 上任何 DOM 变更都会触发观察器（打字时每秒上百次），必须节流
  if (_injectDebounce) return
  _injectDebounce = setTimeout(() => {
    _injectDebounce = null
    for (const t of TARGETS) {
      document.querySelectorAll(t.rootSel).forEach((el) => injectInto(el as HTMLElement, t.listSel))
    }
  }, 150)
}

function openMenu(anchor: HTMLElement) {
  ensureGlobals()
  _closeMenu?.()
  const rect = anchor.getBoundingClientRect()
  const host = document.createElement("div")
  host.className = "neo-pagesort-menu-host"
  document.body.appendChild(host)

  let root: any
  try {
    root = ReactDOM.createRoot(host)
  } catch {
    root = {
      render: (el: any) => ReactDOM.render(el, host),
      unmount: () => ReactDOM.unmountComponentAtNode?.(host),
    }
  }

  const close = () => {
    try {
      root.unmount()
    } catch {
      ReactDOM.unmountComponentAtNode?.(host)
    }
    host.remove()
    if (_closeMenu === close) _closeMenu = null
  }
  _closeMenu = close

  const menu = React.createElement(
    "div",
    {
      className: "neo-pagesort-menu",
      style: { position: "fixed", top: rect.bottom + 4, left: rect.left, minWidth: rect.width },
      onMouseDown: (e: any) => e.stopPropagation(),
    },
    MODES.map((m) =>
      React.createElement(
        "div",
        {
          key: m.value,
          className:
            "neo-pagesort-menu-item" +
            (currentSortMode() === m.value ? " neo-pagesort-menu-item-on" : ""),
          onClick: () => {
            setSortMode(m.value)
            close()
          },
        },
        React.createElement("div", { className: "neo-pagesort-menu-label" }, m.label),
        React.createElement("div", { className: "neo-pagesort-menu-desc" }, m.desc),
      ),
    ),
    React.createElement(
      "div",
      { className: "neo-pagesort-menu-hint" },
      "排序同时作用于页面、标签两个列表。手动拖拽：拖动条目调整顺序，自动保存（收藏栏由原生拖拽管理）。",
    ),
  )
  root.render(menu)

  const onDown = (e: MouseEvent) => {
    if (!host.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close()
  }
  setTimeout(() => {
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
  }, 0)
  const origClose = close
  _closeMenu = () => {
    document.removeEventListener("mousedown", onDown)
    document.removeEventListener("keydown", onKey)
    origClose()
  }
}

export function installPageSortInjector() {
  if (_bodyObserver) return
  onBodyChange()
  _bodyObserver = new MutationObserver(onBodyChange)
  _bodyObserver.observe(document.body, { childList: true, subtree: true })
}

export function disposePageSortInjector() {
  _bodyObserver?.disconnect()
  _bodyObserver = null
  _closeMenu?.()
  document.querySelectorAll(`.${ROW_CLASS}`).forEach((el) => el.remove())
}

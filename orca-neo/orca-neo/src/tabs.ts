// 横排缓存编辑器 —— 把 Orca 原本竖排的「缓存编辑器」列表（Ctrl+Tab，
// 命令 core.panel.showRecents，弹出 .orca-recents-menu 竖向菜单）
// 改造成编辑器顶部的横排页签条，并额外支持拖拽分栏。
//
// 为什么自己维护列表：
//   原生的缓存编辑器数组存在面板组件的 React state 里（useState），
//   既不在 orca.state 上，也没有公开 API，读 fiber 太脆弱。
//   但它的语义很简单——「本面板最近访问过的若干个视图，按缓存数上限淘汰」，
//   完全可以用 orca.state.panels 的变更自行复刻，而且更可控：
//   我们保持「稳定顺序」（新视图追加到末尾），页签不会像 MRU 那样来回跳。
//   上限读 Orca 自己的设置 AppKeys.CachedEditorNum = 13。
//
// 交互：
//   点击     -> orca.nav.goTo(view, viewArgs, panelId) 在本面板切换
//   中键 / × -> 从缓存条移除（最后一个则关闭面板）
//   拖到面板 -> 边缘 orca.nav.addTo(target, 方向, {view,viewArgs}) 分栏；中心则在该面板打开
//   拖到本条 -> 重新排序
//
// 注意：必须用全局 window.Valtio（Orca 注入），不能 import "valtio"——
// 后者会被 vite 外置成 `import ... from "valtio"`，而插件加载器不解析裸模块说明符，
// 会导致整个插件“加载出错”。

/** Orca 设置键：每个面板缓存的编辑器数量 */
const APPKEY_CACHED_EDITOR_NUM = 13

interface PanelNode {
  id?: string
  view?: string
  viewArgs?: { blockId?: string; title?: string; [k: string]: unknown }
  children?: PanelNode[]
  [k: string]: unknown
}

interface RecentItem {
  key: string
  view: string
  viewArgs: Record<string, unknown>
  /** 自增序号，用于超出缓存上限时淘汰最久未访问的 */
  used: number
  /** 上一次成功解析出的标题：块尚未载入 orca.state.blocks 时兜底，避免闪成空白 */
  title?: string
}

type Dir = "left" | "right" | "top" | "bottom"

let bar: HTMLElement | null = null
let resizeHandle: HTMLElement | null = null
let dropHint: HTMLElement | null = null
let observer: MutationObserver | null = null
let classObserver: MutationObserver | null = null
let geoObserver: ResizeObserver | null = null
let unsubState: (() => void) | null = null
let rafPending = false
let dragging = false
let tick = 0
/** 上一次渲染的内容签名：valtio 订阅在编辑时会高频触发，内容没变就不重建 DOM */
let sig = ""

/** panelId -> 该面板的缓存编辑器（稳定顺序） */
const store = new Map<string, RecentItem[]>()
/** 正在拖拽的项 */
let dragPayload: { panelId: string; key: string } | null = null

// ---------------------------------------------------------------- 几何同步

// 页签条只应盖在编辑器（#main）上方/左侧，不能压到 #sidebar。
// #sidebar 宽度可折叠/可拖拽（还有 vibrant 模式的 8px 外边距），
// 所以不写死宽度，而是实时把 #main 的边界写进 CSS 变量。
function isVertical() {
  return document.body.classList.contains("neo-vertical-tabs")
}

function syncGeometry() {
  if (!bar) return
  const main = document.getElementById("main")
  if (!main) return
  const r = main.getBoundingClientRect()
  const s = document.body.style
  // 竖排时 #main 已被 margin-left 推开，页签栏要贴进这段留白里
  const w = isVertical() ? bar.getBoundingClientRect().width : 0
  s.setProperty("--neo-tabbar-left", `${Math.max(0, Math.round(r.left - w))}px`)
  s.setProperty(
    "--neo-tabbar-right",
    `${Math.max(0, Math.round(window.innerWidth - r.right))}px`,
  )
  s.setProperty("--neo-tabbar-top", `${Math.max(0, Math.round(r.top))}px`)
  s.setProperty(
    "--neo-tabbar-bottom",
    `${Math.max(0, Math.round(window.innerHeight - r.bottom))}px`,
  )
}

// ------------------------------------------------ 竖排宽度（拖拽调整 / 记忆）

const BAR_W_DEFAULT = 150
const BAR_W_MIN = 100
const BAR_W_MAX = 350
const BAR_W_KEY = "neo-tabbar-width"

function setBarWidth(px: number) {
  const w = Math.max(BAR_W_MIN, Math.min(BAR_W_MAX, Math.round(px)))
  document.body.style.setProperty("--neo-tabbar-w", `${w}px`)
  try {
    localStorage.setItem(BAR_W_KEY, String(w))
  } catch {
    /* 忽略存储失败 */
  }
  syncGeometry()
}

function restoreBarWidth() {
  try {
    const saved = Number(localStorage.getItem(BAR_W_KEY))
    if (saved >= BAR_W_MIN && saved <= BAR_W_MAX) {
      document.body.style.setProperty("--neo-tabbar-w", `${saved}px`)
    }
  } catch {
    /* 忽略读取失败 */
  }
}

function onResizeDown(e: MouseEvent) {
  if (e.button !== 0 || !bar) return
  e.preventDefault()
  const startX = e.clientX
  const startW = bar.getBoundingClientRect().width || BAR_W_DEFAULT
  const onMove = (ev: MouseEvent) => setBarWidth(startW + ev.clientX - startX)
  const onUp = () => {
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
    document.body.style.removeProperty("cursor")
  }
  document.body.style.cursor = "col-resize"
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

function onResizeDblClick() {
  setBarWidth(BAR_W_DEFAULT)
}

// ---------------------------------------------------------------- 数据

function collectLeaves(node: unknown, out: PanelNode[]) {
  if (!node) return
  const arr = Array.isArray(node) ? (node as PanelNode[]) : [node as PanelNode]
  for (const n of arr) {
    if (!n) continue
    if (n.children && n.children.length) collectLeaves(n.children, out)
    else out.push(n)
  }
}

/** 视图身份：同一个 view + viewArgs 视为同一个缓存编辑器 */
function viewKey(view: string, args: unknown): string {
  let tail = ""
  try {
    const o = (args ?? {}) as Record<string, unknown>
    tail = Object.keys(o)
      .sort()
      .map((k) => `${k}=${String(o[k])}`)
      .join("&")
  } catch {
    /* ignore */
  }
  return `${view}|${tail}`
}

function cacheLimit(): number {
  const n = Number((orca as any).state?.settings?.[APPKEY_CACHED_EDITOR_NUM])
  return Number.isFinite(n) && n > 0 ? n : 5
}

/** 依据 orca.state.panels 的当前视图，增量维护每个面板的缓存编辑器列表 */
function syncRecents() {
  const leaves: PanelNode[] = []
  collectLeaves((orca as any).state?.panels, leaves)

  const alive = new Set<string>()
  for (const l of leaves) if (l.id) alive.add(l.id)
  for (const id of Array.from(store.keys())) if (!alive.has(id)) store.delete(id)

  const limit = cacheLimit()

  for (const leaf of leaves) {
    const id = leaf.id
    const view = leaf.view
    if (!id || !view) continue
    if (id.startsWith("_")) continue // _globalSearch / _reference 这类内部面板不计

    const key = viewKey(view, leaf.viewArgs)
    let list = store.get(id)
    if (!list) {
      list = []
      store.set(id, list)
    }

    let item = list.find((i) => i.key === key)
    if (!item) {
      item = { key, view, viewArgs: { ...(leaf.viewArgs ?? {}) }, used: 0 }
      list.push(item)
    }
    item.used = ++tick

    // 超出缓存上限：淘汰最久未访问的（当前正在看的那个永远保留）
    while (list.length > limit) {
      let victim = -1
      let oldest = Infinity
      for (let i = 0; i < list.length; i++) {
        if (list[i].key === key) continue
        if (list[i].used < oldest) {
          oldest = list[i].used
          victim = i
        }
      }
      if (victim < 0) break
      list.splice(victim, 1)
    }
  }
}

function currentLeaf(panelId: string): PanelNode | null {
  const leaves: PanelNode[] = []
  collectLeaves((orca as any).state?.panels, leaves)
  return leaves.find((l) => l.id === panelId) ?? null
}

// 标题/图标完全复刻 Orca 原生的 getViewText / getViewIcon：
// 块没有 .title 字段，真正的标题来自 _repr 属性 + aliases[0] + text。
// （之前读 b.title 恒为 undefined，所以页签只显示 view 名或“未命名”。）

function getRepr(block: any): any {
  return block?.properties?.find((p: any) => p.name === "_repr")?.value
}

function blockOf(id: unknown): any {
  if (id == null) return null
  const blocks = (orca as any).state?.blocks
  return blocks?.[id as any] ?? null
}

function journalText(date: unknown): string {
  try {
    const d = date instanceof Date ? date : new Date(date as any)
    if (isNaN(d.getTime())) return ""
    return new Intl.DateTimeFormat((orca as any).state?.locale || undefined, {
      dateStyle: "medium",
    }).format(d)
  } catch {
    return ""
  }
}

function blockText(block: any, depth = 0): string {
  if (!block || depth > 3) return ""
  const repr = getRepr(block)
  if (repr == null) return ""
  if (repr.type === "mirror") return blockText(blockOf(repr.mirroredId), depth + 1)
  if (repr.type === "journal") return journalText(repr.date)

  if (block.aliases?.length) {
    const a = String(block.aliases[0])
    return a.startsWith("/") ? (a.split("/").at(-1) ?? a) : a
  }
  if (block.text != null) {
    // 去掉行尾的 #标签，与原生 removeTrailingTags 行为一致
    const t = String(block.text)
      .trim()
      .replace(/(\s*#[^\s#]+)+$/u, "")
      .trim()
    if (t) return t
  }
  return repr.cap ? String(repr.cap) : `(${repr.type})`
}

const VIEW_LABEL: Record<string, string> = {
  journal: "日记",
  search: "搜索",
  tags: "标签",
  graph: "关系图",
  whiteboard: "白板",
}

function titleOf(item: RecentItem): string {
  let t = ""
  try {
    if (item.view === "journal") {
      t = journalText(item.viewArgs?.date)
    } else if (item.view === "block" || item.view === "bgraph") {
      t = blockText(blockOf(item.viewArgs?.blockId))
      if (t && item.view === "bgraph") t = `关系图：${t}`
    }
    if (!t) t = String(item.viewArgs?.title ?? "")
  } catch {
    /* ignore */
  }
  // 块可能还没载入 orca.state.blocks，此时沿用上次解析到的标题，避免闪成空白
  if (t) {
    item.title = t
    return t
  }
  return item.title || VIEW_LABEL[item.view] || item.view || "未命名"
}

const REPR_ICON: Record<string, string> = {
  journal: "ti ti-calendar",
  quote: "ti ti-blockquote",
  quote2: "ti ti-blockquote",
  ol: "ti ti-list-numbers",
  ul: "ti ti-list",
  image: "ti ti-photo",
  video: "ti ti-movie",
  audio: "ti ti-volume",
  math: "ti ti-math",
  code: "ti ti-code",
  query: "ti ti-zoom-question",
  query2: "ti ti-zoom-question",
  mermaid: "ti ti-chart-bar",
  table: "ti ti-table",
  table2: "ti ti-table",
  spreadsheet: "ti ti-file-spreadsheet",
  task: "ti ti-checkbox",
  pdf: "ti ti-pdf",
  epub: "ti ti-book",
  whiteboard: "ti ti-chalkboard",
  hr: "ti ti-separator",
}

function iconOf(item: RecentItem): string {
  if (item.view === "journal") return "ti ti-calendar"
  const block = blockOf(item.viewArgs?.blockId)
  const repr = getRepr(block)
  if (repr == null) return "ti ti-file-text"
  if (repr.type === "heading") {
    const lv = Number(repr.level)
    return lv >= 1 && lv <= 6 ? `ti ti-h-${lv}` : "ti ti-heading"
  }
  const mapped = REPR_ICON[repr.type as string]
  if (mapped) return mapped
  if (block?.aliases?.length) {
    const hidden = block.properties?.find((p: any) => p.name === "_hide")?.value
    return hidden ? "ti ti-file" : "ti ti-hash"
  }
  return "ti ti-cube"
}

// ---------------------------------------------------------------- 动作

function goToItem(panelId: string, item: RecentItem) {
  try {
    ;(orca as any).nav.goTo(item.view, item.viewArgs, panelId)
    ;(orca as any).nav.switchFocusTo(panelId)
  } catch {
    /* ignore */
  }
}

function closeItem(panelId: string, key: string) {
  const list = store.get(panelId)
  if (!list) return
  const idx = list.findIndex((i) => i.key === key)
  if (idx < 0) return

  const leaf = currentLeaf(panelId)
  const isCurrent = leaf != null && viewKey(leaf.view ?? "", leaf.viewArgs) === key

  list.splice(idx, 1)

  if (!list.length) {
    // 缓存条空了，等价于关闭这个面板
    try {
      ;(orca as any).nav.close(panelId)
    } catch {
      /* ignore */
    }
    store.delete(panelId)
    scheduleRender()
    return
  }

  if (isCurrent) {
    const next = list[Math.min(idx, list.length - 1)]
    if (next) goToItem(panelId, next)
  }
  scheduleRender()
}

// ---------------------------------------------------------------- 拖拽

function ensureDropHint(): HTMLElement {
  if (!dropHint) {
    dropHint = document.createElement("div")
    dropHint.className = "neo-tab-drophint"
    document.body.appendChild(dropHint)
  }
  return dropHint
}

function hideDropHint() {
  dropHint?.classList.remove("neo-tab-drophint-on")
}

function calcDir(rect: DOMRect, x: number, y: number): Dir | "center" {
  const rx = (x - rect.left) / Math.max(1, rect.width)
  const ry = (y - rect.top) / Math.max(1, rect.height)
  const d: Array<[Dir, number]> = [
    ["left", rx],
    ["right", 1 - rx],
    ["top", ry],
    ["bottom", 1 - ry],
  ]
  d.sort((a, b) => a[1] - b[1])
  // 靠近某条边 25% 以内才算分栏，否则视为“在该面板打开”
  return d[0][1] <= 0.25 ? d[0][0] : "center"
}

function showDropHint(rect: DOMRect, dir: Dir | "center") {
  const h = ensureDropHint()
  h.classList.add("neo-tab-drophint-on")
  let { left, top, width, height } = rect
  if (dir === "left") width = rect.width / 2
  else if (dir === "right") {
    left = rect.left + rect.width / 2
    width = rect.width / 2
  } else if (dir === "top") height = rect.height / 2
  else if (dir === "bottom") {
    top = rect.top + rect.height / 2
    height = rect.height / 2
  }
  h.style.left = `${left}px`
  h.style.top = `${top}px`
  h.style.width = `${width}px`
  h.style.height = `${height}px`
}

function onDragOver(e: DragEvent) {
  if (!dragPayload) return
  const target = e.target as HTMLElement | null
  if (bar && target && bar.contains(target)) {
    // 在缓存条内部：重排序，指示交给页签自身的插入线
    e.preventDefault()
    hideDropHint()
    return
  }
  const panel = target?.closest?.(".orca-panel") as HTMLElement | null
  if (!panel) {
    hideDropHint()
    return
  }
  e.preventDefault()
  const rect = panel.getBoundingClientRect()
  showDropHint(rect, calcDir(rect, e.clientX, e.clientY))
}

function onDrop(e: DragEvent) {
  if (!dragPayload) return
  const payload = dragPayload
  const target = e.target as HTMLElement | null
  if (bar && target && bar.contains(target)) return // 交给页签自身的 drop 做重排序

  const panel = target?.closest?.(".orca-panel") as HTMLElement | null
  if (!panel) {
    hideDropHint()
    return
  }
  e.preventDefault()
  hideDropHint()

  const targetPanelId = panel.dataset.panelId
  if (!targetPanelId) return
  const item = store.get(payload.panelId)?.find((i) => i.key === payload.key)
  if (!item) return

  const rect = panel.getBoundingClientRect()
  const dir = calcDir(rect, e.clientX, e.clientY)

  try {
    if (dir === "center") {
      ;(orca as any).nav.goTo(item.view, item.viewArgs, targetPanelId)
      ;(orca as any).nav.switchFocusTo(targetPanelId)
    } else {
      const newId = (orca as any).nav.addTo(targetPanelId, dir, {
        view: item.view,
        viewArgs: item.viewArgs,
        viewState: {},
      })
      if (newId) (orca as any).nav.switchFocusTo(newId)
    }
  } catch {
    /* ignore */
  }
  scheduleRender()
}

// ---------------------------------------------------------------- 渲染

function scheduleRender() {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    syncRecents()
    render()
  })
}

interface Group {
  panelId: string
  list: RecentItem[]
  /** 该面板此刻正在显示的视图 */
  currentKey: string
  /** 是否是当前聚焦的面板 */
  focused: boolean
}

function collectGroups(): Group[] {
  const leaves: PanelNode[] = []
  collectLeaves((orca as any).state?.panels, leaves)
  const activePanel = (orca as any).state?.activePanel as string | undefined

  const groups: Group[] = []
  for (const leaf of leaves) {
    const id = leaf.id
    if (!id || id.startsWith("_")) continue
    const list = store.get(id)
    if (!list || !list.length) continue
    groups.push({
      panelId: id,
      list,
      currentKey: viewKey(leaf.view ?? "", leaf.viewArgs),
      focused: id === activePanel,
    })
  }
  return groups
}

function render() {
  if (!bar) return
  if (dragging) return // 拖拽中不重建 DOM，否则会打断正在拖的页签

  // 展示所有面板的缓存编辑器，按面板在布局中的顺序分组排列
  const groups = collectGroups()
  if (!groups.length) {
    bar.innerHTML = ""
    bar.style.display = "none"
    sig = ""
    return
  }

  const nextSig = groups
    .map(
      (g) =>
        `${g.panelId}${g.focused ? "*" : ""}@${g.currentKey}#` +
        g.list.map((i) => `${i.key}~${titleOf(i)}`).join(","),
    )
    .join("||")
  if (nextSig === sig) return
  sig = nextSig

  bar.style.display = "flex"
  bar.innerHTML = ""

  for (let gi = 0; gi < groups.length; gi++) {
    if (gi > 0) {
      const sep = document.createElement("div")
      sep.className = "neo-tab-sep"
      bar.appendChild(sep)
    }
    renderGroup(groups[gi])
  }
}

function renderGroup(group: Group) {
  if (!bar) return
  const panelId = group.panelId
  const activeKey = group.currentKey

  for (const item of group.list) {
    const title = titleOf(item)
    const tab = document.createElement("div")
    // 每个面板都有自己「正在显示」的那一项：聚焦面板用强调色，其他面板弱化显示
    const isCurrent = item.key === activeKey
    tab.className =
      "neo-tab" +
      (isCurrent ? (group.focused ? " neo-tab-active" : " neo-tab-current") : "")
    tab.draggable = true
    tab.title = title

    const icon = document.createElement("i")
    icon.className = `neo-tab-icon ${iconOf(item)}`
    tab.appendChild(icon)

    const label = document.createElement("span")
    label.className = "neo-tab-label"
    label.textContent = title
    tab.appendChild(label)

    const close = document.createElement("span")
    close.className = "neo-tab-close"
    close.textContent = "×"
    close.title = "移出缓存"
    close.addEventListener("click", (ev) => {
      ev.stopPropagation()
      closeItem(panelId, item.key)
    })
    tab.appendChild(close)

    tab.addEventListener("click", () => goToItem(panelId, item))
    tab.addEventListener("auxclick", (ev) => {
      if ((ev as MouseEvent).button === 1) {
        ev.preventDefault()
        closeItem(panelId, item.key)
      }
    })

    tab.addEventListener("dragstart", (ev: DragEvent) => {
      const dt = ev.dataTransfer
      if (!dt) return
      dragging = true
      dragPayload = { panelId, key: item.key }
      dt.effectAllowed = "copyMove"
      try {
        // 用纯文本兜底即可；不设置 Orca 的 orca/panel/* MIME，
        // 避免误触发原生的“整个面板移动”逻辑。
        dt.setData("text/plain", title)
      } catch {
        /* ignore */
      }
      tab.classList.add("neo-tab-dragging")
    })
    tab.addEventListener("dragend", () => {
      dragging = false
      dragPayload = null
      hideDropHint()
      bar?.querySelectorAll(".neo-tab-insert").forEach((el) =>
        el.classList.remove("neo-tab-insert"),
      )
      tab.classList.remove("neo-tab-dragging")
      scheduleRender()
    })

    // 条内重排序
    tab.addEventListener("dragover", (ev: DragEvent) => {
      if (!dragPayload || dragPayload.panelId !== panelId) return
      ev.preventDefault()
      ev.stopPropagation()
      tab.classList.add("neo-tab-insert")
    })
    tab.addEventListener("dragleave", () => tab.classList.remove("neo-tab-insert"))
    tab.addEventListener("drop", (ev: DragEvent) => {
      if (!dragPayload || dragPayload.panelId !== panelId) return
      ev.preventDefault()
      ev.stopPropagation()
      tab.classList.remove("neo-tab-insert")
      const arr = store.get(panelId)
      if (!arr) return
      const from = arr.findIndex((i) => i.key === dragPayload!.key)
      const to = arr.findIndex((i) => i.key === item.key)
      if (from < 0 || to < 0 || from === to) return
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      dragging = false
      dragPayload = null
      scheduleRender()
    })

    bar.appendChild(tab)
  }
}

// ---------------------------------------------------------------- 生命周期

export function enableTabs() {
  if (bar) return
  const headbar = document.getElementById("headbar")
  if (!headbar) return
  bar = document.createElement("div")
  bar.className = "neo-tabbar"
  headbar.insertAdjacentElement("afterend", bar)

  // 竖排时的宽度调整手柄（横排时由 CSS 隐藏）
  restoreBarWidth()
  resizeHandle = document.createElement("div")
  resizeHandle.className = "neo-tabbar-resize"
  resizeHandle.addEventListener("mousedown", onResizeDown)
  resizeHandle.addEventListener("dblclick", onResizeDblClick)
  bar.insertAdjacentElement("afterend", resizeHandle)

  syncRecents()
  render()

  // 1) 订阅 orca.state：面板切换视图、打开新页面都会改 panels，
  //    这是缓存条能实时跟上的关键驱动。
  try {
    unsubState = window.Valtio.subscribe((orca as any).state, scheduleRender)
  } catch {
    unsubState = null
  }

  // 2) 兜底：DOM 变化也刷新
  observer = new MutationObserver(scheduleRender)
  const main = document.getElementById("main")
  if (main) {
    observer.observe(main, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "data-panel-id"],
    })
  }
  document.addEventListener("focusin", scheduleRender)
  window.addEventListener("focus", scheduleRender)

  // 3) 拖拽分栏（捕获阶段，避免被面板内部 stopPropagation 吃掉）
  document.addEventListener("dragover", onDragOver, true)
  document.addEventListener("drop", onDrop, true)

  // 4) 跟随 #main 的左右边界（侧栏开合、拖拽改宽、窗口缩放都会变）
  syncGeometry()
  geoObserver = new ResizeObserver(syncGeometry)
  if (main) geoObserver.observe(main)
  const sidebar = document.getElementById("sidebar")
  if (sidebar) geoObserver.observe(sidebar)
  window.addEventListener("resize", syncGeometry)
  document.addEventListener("transitionend", syncGeometry)
  // 横排 ↔ 竖排切换（body class 变化）后几何完全不同，必须重算
  classObserver = new MutationObserver(syncGeometry)
  classObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  })
}

export function disableTabs() {
  unsubState?.()
  unsubState = null
  observer?.disconnect()
  observer = null
  geoObserver?.disconnect()
  geoObserver = null
  document.removeEventListener("focusin", scheduleRender)
  window.removeEventListener("focus", scheduleRender)
  document.removeEventListener("dragover", onDragOver, true)
  document.removeEventListener("drop", onDrop, true)
  window.removeEventListener("resize", syncGeometry)
  document.removeEventListener("transitionend", syncGeometry)
  classObserver?.disconnect()
  classObserver = null
  document.body.style.removeProperty("--neo-tabbar-left")
  document.body.style.removeProperty("--neo-tabbar-right")
  document.body.style.removeProperty("--neo-tabbar-top")
  document.body.style.removeProperty("--neo-tabbar-bottom")
  resizeHandle?.removeEventListener("mousedown", onResizeDown)
  resizeHandle?.removeEventListener("dblclick", onResizeDblClick)
  resizeHandle?.remove()
  resizeHandle = null
  dropHint?.remove()
  dropHint = null
  bar?.remove()
  bar = null
  dragging = false
  dragPayload = null
  sig = ""
  store.clear()
}

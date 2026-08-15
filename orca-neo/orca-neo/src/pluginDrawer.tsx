// 图标抽屉（参考思源插件 siyuan-plugin-drawer）：把顶栏越积越多的图标折叠收纳。
// 收纳面 = 插件按钮容器（.orca-headbar-user-tools）+ 虎鲸原生按钮容器
// （.orca-headbar-global-tools：同步/搜索/命令面板/今日日记/明暗切换/通知/设置菜单）。
// 左侧 .orca-headbar-sidebar-tools（侧栏开关/前进后退）是导航必需，保持原生不纳入
// （思源 drawer 同样保留「工作空间、前进后退、退出」始终显示）。
//
// 虎鲸与思源的关键差异（app.asar 逆向结论）：
//  - 插件顶栏按钮由 HeadBar 内联渲染在 .orca-headbar-user-tools 里，DOM 上无 id、无每插件包装；
//  - React 根在 #app，React 18 的合成事件委托也挂在 #app 容器上 → 像思源 drawer 那样
//    把按钮元素"移进"抽屉会让 onClick 失效（事件在 #app 之外冒泡不到根容器）。
// 因此虎鲸版采用「原地隐藏 + 抽屉内放视觉克隆 + 点击克隆把原按钮临时锚到克隆位置再
// 派发 click」的方案（点击转发是思源 triggerNativeToolbar 同款思路）：
//  - 折叠 = 用 inline style 把原按钮压成零尺寸（position:absolute + visibility:hidden +
//    width/height:0；flex 容器里 absolute 子项不占位、不吃 gap），弹层列表里放它的克隆；
//  - 抽屉里点击条目 = 把原按钮临时设成克隆的位置/尺寸并恢复可见 → 派发 click（冒泡到
//    #app 触发 React onClick，插件弹出自己的菜单，锚点即抽屉里的位置）→ 下个宏任务还原；
//  - 插件 React 重渲染可能覆盖我们写的 inline style，headbar 观察器发现后重新补上；
//  - 收纳状态按「className + aria-label/title + 内部图标类名」签名持久化到 localStorage
//    （Orca 官方插件数据接口 set-plugin-data 是仓库维度，跨仓库的全局 UI 偏好不合适；
//    Orca 自身也用 localStorage 存 UI 偏好）。
//
// 抽屉锁：抽屉头部「锁住」按钮。上锁后——抽屉里的图标取不出（「取出」/「全部取出」
// 禁用）、顶栏按钮的 ▾ 收纳徽标消失（「收纳」/「全部收纳」禁用），图标仍可点击使用；
// 锁状态同样持久化到 localStorage。fold/unfold 函数入口再挡一道，双保险。
//
// 模块顶层不碰 DOM / API（铁律）：React、orca、localStorage 全部惰性到函数里。
let React: any
let ReactDOM: any
let orca: any

function ensureGlobals() {
  if (React) return
  const g = window as unknown as {
    React: any
    ReactDOM: any
    orca: any
  }
  React = g.React
  ReactDOM = g.ReactDOM
  orca = g.orca
}

const PLUGIN_NAME = "orca-neo"
const HEADBAR_ID = `${PLUGIN_NAME}.drawer`
const LS_KEY = "orca-neo.pluginDrawer.folded"
const LS_KEY_LOCKED = "orca-neo.pluginDrawer.locked"
// 可收纳面 = 插件按钮容器（user-tools）+ 虎鲸原生按钮容器（global-tools）。
// 左侧 .orca-headbar-sidebar-tools（侧栏开关/前进后退）是导航必需，不纳入（思源 drawer 同样保留）。
const TOOLBAR_SEL =
  "#headbar .orca-headbar-user-tools, #headbar .orca-headbar-global-tools"
const BADGE_CLASS = "neo-fold-badge"
const HIDE_MARKER = "--neo-folded"

// 原生按钮没有 aria-label/title（提示文字在 Tooltip 浮层里），按图标类名映射中文名
const NATIVE_LABELS: Record<string, string> = {
  "ti-cloud": "同步",
  "ti-search": "搜索",
  "ti-terminal": "命令面板",
  "ti-home": "今日日记",
  "ti-moon": "切换明暗模式",
  "ti-sun": "切换明暗模式",
  "ti-bell": "通知",
  "ti-dots": "设置菜单",
}

// ── 收纳状态 ──────────────────────────────────────────────────────────────
interface FoldRecord {
  sig: string
  label: string
}

const foldedEls = new WeakSet<HTMLElement>()
let persisted: FoldRecord[] = []
let persistedLoaded = false
let locked = false
let installed = false
let observer: MutationObserver | null = null
let timer = 0

// ── 弹层 ──────────────────────────────────────────────────────────────────
let popupEl: HTMLDivElement | null = null
let anchorEl: HTMLElement | null = null

function loadPersisted() {
  if (persistedLoaded) return
  persistedLoaded = true
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (raw) persisted = JSON.parse(raw) as FoldRecord[]
    locked = window.localStorage.getItem(LS_KEY_LOCKED) === "1"
  } catch {
    persisted = []
    locked = false
  }
}

function savePersisted() {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(persisted))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：本次会话内收纳仍可用
  }
}

function saveLocked() {
  try {
    window.localStorage.setItem(LS_KEY_LOCKED, locked ? "1" : "0")
  } catch {
    // 同上：静默降级，锁仅本次会话生效
  }
}

// ── 签名与标签：顶栏插件按钮无 id，只能靠可见特征识别 ─────────────────────
function iconHint(el: HTMLElement): string {
  const ti = el.querySelector<HTMLElement>('[class*="ti-"]')
  if (ti) return ti.className
  const svg = el.querySelector("svg")
  if (svg) {
    const use = svg.querySelector("use")
    const href = use?.getAttribute("href")
    if (href) return String(href)
    const cls = svg.getAttribute("class")
    if (cls) return cls
  }
  const first = el.firstElementChild
  if (first instanceof HTMLElement) return first.className || first.tagName
  return ""
}

function sigOf(el: HTMLElement): string {
  const cls = typeof el.className === "string" ? el.className : ""
  return JSON.stringify([
    cls,
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("title") ?? "",
    iconHint(el),
  ])
}

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim()
  if (aria) return aria
  const title = el.getAttribute("title")?.trim()
  if (title) return title
  // 原生按钮：提示文字在 Tooltip 浮层里、不在按钮属性上，按图标类名映射
  for (const cls of iconHint(el).split(/\s+/)) {
    const name = NATIVE_LABELS[cls]
    if (name) return name
  }
  return "顶栏图标"
}

function isOwn(el: HTMLElement): boolean {
  return el.hasAttribute("data-neo-own")
}

// ── 折叠 / 恢复 ───────────────────────────────────────────────────────────
function applyHiddenProps(el: HTMLElement) {
  const s = el.style
  s.setProperty("position", "absolute", "important")
  s.setProperty("visibility", "hidden", "important")
  s.setProperty("width", "0px", "important")
  s.setProperty("height", "0px", "important")
  s.setProperty("min-width", "0px", "important")
  s.setProperty("min-height", "0px", "important")
  s.setProperty("padding", "0px", "important")
  s.setProperty("margin", "0px", "important")
  s.setProperty("border-width", "0px", "important")
  s.setProperty("overflow", "hidden", "important")
  s.setProperty("pointer-events", "none", "important")
  s.setProperty(HIDE_MARKER, "1", "important")
}

function hideEl(el: HTMLElement) {
  // 保存折叠前的 inline style（React 之后若重渲染覆盖 style，观察器会重新补隐藏样式，
  // 但恢复时仍以折叠时刻的样式为准——它才是"折叠前用户看到的样子"）
  el.setAttribute("data-neo-orig-style", el.getAttribute("style") ?? "")
  applyHiddenProps(el)
}

function ensureHidden(el: HTMLElement) {
  if (el.style.getPropertyValue(HIDE_MARKER) === "1") return
  applyHiddenProps(el)
}

function showEl(el: HTMLElement) {
  const orig = el.getAttribute("data-neo-orig-style")
  if (orig === "" || orig == null) el.removeAttribute("style")
  else el.setAttribute("style", orig)
  el.removeAttribute("data-neo-orig-style")
}

function ensureBadge(el: HTMLElement) {
  if (locked) return // 上锁：收纳入口整体隐藏
  if (el.querySelector(`:scope > .${BADGE_CLASS}`)) return
  const badge = document.createElement("span")
  badge.className = BADGE_CLASS
  badge.textContent = "▾"
  badge.title = "收纳进抽屉"
  badge.addEventListener("click", (e) => {
    // 不冒泡到按钮本身，避免误触发该插件自己的点击逻辑
    e.preventDefault()
    e.stopPropagation()
    fold(el)
  })
  el.appendChild(badge)
}

function fold(el: HTMLElement) {
  if (locked) return // 上锁：不允许新收纳
  if (foldedEls.has(el) || isOwn(el)) return
  hideEl(el)
  foldedEls.add(el)
  const sig = sigOf(el)
  if (!persisted.some((p) => p.sig === sig)) {
    persisted.push({ sig, label: labelOf(el) })
    savePersisted()
  }
  refreshPopupList()
}

function unfold(el: HTMLElement) {
  if (locked) return // 上锁：不允许取出
  if (!foldedEls.has(el)) return
  foldedEls.delete(el)
  showEl(el)
  persisted = persisted.filter((p) => p.sig !== sigOf(el))
  savePersisted()
  ensureBadge(el)
  refreshPopupList()
}

function foldAll() {
  if (locked) return
  const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SEL)
  if (!toolbar) return
  for (const el of Array.from(toolbar.children)) {
    if (el instanceof HTMLElement && !isOwn(el)) fold(el)
  }
}

function unfoldAll() {
  if (locked) return
  for (const el of currentChildren()) {
    if (foldedEls.has(el)) {
      foldedEls.delete(el)
      showEl(el)
      ensureBadge(el)
    }
  }
  persisted = []
  savePersisted()
  refreshPopupList()
}

function currentChildren(): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const container of document.querySelectorAll<HTMLElement>(TOOLBAR_SEL)) {
    for (const c of Array.from(container.children)) {
      if (c instanceof HTMLElement) out.push(c)
    }
  }
  return out
}

// ── 点击转发：临时恢复原按钮（留在顶栏原槽位）→ 派发 click 触发插件菜单 ──
// 逆向要点（app.asar 的 Popup 组件 + #headbar CSS）：
//  - Orca Popup 用 `trigger.offsetParent` 当 portal 容器，容器为 null 时整个弹层
//    直接不渲染 → 转发期间绝不能把按钮设成 position:fixed（offsetParent 变 null）；
//  - #headbar 有 zoom（calc(1/orca-zoom-factor)），视口坐标会被 zoom 扭曲 → 不设 left/top，
//    按钮保持 position:absolute 停在顶栏原槽位（静态位置），插件菜单按原生方式
//    锚在顶栏该图标的位置弹出；
//  - 插件弹层 z-index 仅 ~300，而抽屉弹层 2147483000 → 派发前必须先关抽屉，否则菜单被盖住。
function forwardClick(orig: HTMLElement, size: { width: number; height: number }) {
  const saved = orig.getAttribute("style")
  const s = orig.style
  s.setProperty("width", `${Math.max(size.width, 22)}px`, "important")
  s.setProperty("height", `${Math.max(size.height, 22)}px`, "important")
  s.setProperty("visibility", "visible", "important")
  s.setProperty("pointer-events", "auto", "important")
  // 事件坐标设为按钮槽位中心（部分插件菜单按 e.clientX/Y 定位）
  const r = orig.getBoundingClientRect()
  orig.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  )
  // 插件 onClick 同步执行完（此时已读到正确锚点），下个宏任务还原隐藏样式。
  // 还原回的是隐藏态样式，折叠中的按钮本来就该保持隐藏。
  window.setTimeout(() => {
    if (saved == null) orig.removeAttribute("style")
    else orig.setAttribute("style", saved)
  }, 0)
}

// ── 抽屉弹层（纯 DOM，React 不接管 → 克隆/补回无摩擦） ───────────────────
function refreshPopupList() {
  if (!popupEl) return
  const list = popupEl.querySelector<HTMLElement>(".neo-drawer-list")
  if (!list) return
  list.textContent = ""

  const entries = currentChildren()
    .filter((el) => foldedEls.has(el) && el.isConnected)
    .map((el) => ({ el, label: labelOf(el) }))

  if (entries.length === 0) {
    const empty = document.createElement("div")
    empty.className = "neo-drawer-empty"
    empty.textContent =
      "暂未收纳任何图标。把鼠标移到顶栏图标（插件或原生）上，点它右上角出现的 ▾ 收纳进来。"
    list.appendChild(empty)
    return
  }

  for (const { el, label } of entries) {
    const item = document.createElement("div")
    item.className = "neo-drawer-item"
    item.title = `点击使用「${label}」`

    const iconWrap = document.createElement("div")
    iconWrap.className = "neo-drawer-icon"
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove())
    clone.removeAttribute("style")
    iconWrap.appendChild(clone)

    const lbl = document.createElement("div")
    lbl.className = "neo-drawer-label"
    lbl.textContent = label

    const takeOut = document.createElement("button")
    takeOut.className = "neo-drawer-unfold"
    takeOut.type = "button"
    takeOut.textContent = "取出"
    takeOut.title = locked ? "抽屉已锁定：先解锁才能取出" : "取出放回顶栏原位"
    takeOut.disabled = locked
    takeOut.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      unfold(el)
    })

    item.appendChild(iconWrap)
    item.appendChild(lbl)
    item.appendChild(takeOut)
    item.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      // 先取克隆尺寸（关掉抽屉后 rect 归零），再关抽屉，最后转发点击：
      // 插件菜单会在顶栏图标的位置弹出，不被抽屉遮挡（见 forwardClick 注释）
      const box = iconWrap.getBoundingClientRect()
      closeDrawer()
      forwardClick(el, { width: box.width, height: box.height })
    })
    list.appendChild(item)
  }
}

function closeDrawer() {
  if (popupEl) {
    popupEl.remove()
    popupEl = null
  }
  anchorEl = null
  document.removeEventListener("mousedown", onDocMousedown, true)
  document.removeEventListener("keydown", onDocKeydown, true)
}

function onDocMousedown(e: MouseEvent) {
  const t = e.target as Node | null
  if (!popupEl) return
  if (popupEl.contains(t)) return
  if (anchorEl && t && anchorEl.contains(t)) return // 交给按钮自己的 click 做开关切换
  closeDrawer()
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeDrawer()
}

function toggleDrawer(anchor: HTMLElement) {
  if (popupEl?.isConnected) {
    closeDrawer()
    return
  }
  anchorEl = anchor
  popupEl = document.createElement("div")
  popupEl.className = "neo-drawer-pop"

  const head = document.createElement("div")
  head.className = "neo-drawer-head"
  const title = document.createElement("span")
  title.textContent = "插件抽屉"
  const actions = document.createElement("div")
  actions.className = "neo-drawer-actions"
  const foldAllBtn = document.createElement("button")
  foldAllBtn.type = "button"
  foldAllBtn.className = "neo-drawer-minibtn neo-drawer-fold-all"
  foldAllBtn.textContent = "全部收纳"
  foldAllBtn.title = "把顶栏全部插件图标收纳进来"
  foldAllBtn.disabled = locked
  foldAllBtn.addEventListener("click", () => {
    foldAll()
    refreshPopupList()
  })
  const unfoldAllBtn = document.createElement("button")
  unfoldAllBtn.type = "button"
  unfoldAllBtn.className = "neo-drawer-minibtn neo-drawer-unfold-all"
  unfoldAllBtn.textContent = "全部取出"
  unfoldAllBtn.title = "把所有收纳的图标放回顶栏原位"
  unfoldAllBtn.disabled = locked
  unfoldAllBtn.addEventListener("click", () => {
    unfoldAll()
    refreshPopupList()
  })
  const lockBtn = document.createElement("button")
  lockBtn.type = "button"
  lockBtn.className = "neo-drawer-minibtn neo-drawer-lock"
  lockBtn.textContent = locked ? "🔓 解锁" : "🔒 锁住"
  lockBtn.title = locked
    ? "解锁抽屉：解锁后才能取出图标、收纳新图标"
    : "锁住抽屉：锁住后抽屉里的图标取不出，顶栏的 ▾ 收纳入口也会消失"
  lockBtn.addEventListener("click", () => {
    setLocked(!locked)
  })
  const closeBtn = document.createElement("span")
  closeBtn.className = "neo-hb-close"
  closeBtn.textContent = "✕"
  closeBtn.addEventListener("click", closeDrawer)
  actions.appendChild(foldAllBtn)
  actions.appendChild(unfoldAllBtn)
  actions.appendChild(lockBtn)
  head.appendChild(title)
  head.appendChild(actions)
  head.appendChild(closeBtn)

  const list = document.createElement("div")
  list.className = "neo-drawer-list"

  popupEl.appendChild(head)
  popupEl.appendChild(list)
  document.body.appendChild(popupEl)

  const r = anchor.getBoundingClientRect()
  const width = 320
  popupEl.style.top = `${r.bottom + 6}px`
  popupEl.style.left = `${Math.max(8, r.right - width)}px`

  refreshPopupList()
  document.addEventListener("mousedown", onDocMousedown, true)
  document.addEventListener("keydown", onDocKeydown, true)
}

// ── 抽屉锁 ────────────────────────────────────────────────────────────────
/** 切换锁状态：持久化 + 更新抽屉头部按钮（若开着）+ 全量重扫（移除/恢复 ▾ 徽标、
 *  刷新条目「取出」按钮的禁用态）。 */
function setLocked(v: boolean) {
  if (locked === v) return
  locked = v
  saveLocked()

  if (popupEl?.isConnected) {
    const lockBtn = popupEl.querySelector<HTMLButtonElement>(".neo-drawer-lock")
    if (lockBtn) {
      lockBtn.textContent = locked ? "🔓 解锁" : "🔒 锁住"
      lockBtn.title = locked
        ? "解锁抽屉：解锁后才能取出图标、收纳新图标"
        : "锁住抽屉：锁住后抽屉里的图标取不出，顶栏的 ▾ 收纳入口也会消失"
      lockBtn.classList.toggle("neo-drawer-locked", locked)
    }
    const foldAllBtn = popupEl.querySelector<HTMLButtonElement>(".neo-drawer-fold-all")
    const unfoldAllBtn = popupEl.querySelector<HTMLButtonElement>(".neo-drawer-unfold-all")
    if (foldAllBtn) foldAllBtn.disabled = locked
    if (unfoldAllBtn) unfoldAllBtn.disabled = locked
  }

  rescan() // 会顺带 refreshPopupList 刷新「取出」按钮禁用态
}

// ── 观察器：补隐藏样式 / 补收纳徽标 / 响应插件的重渲染与增删 ───────────────
function rescan() {
  for (const el of currentChildren()) {
    if (isOwn(el)) continue
    if (foldedEls.has(el)) {
      ensureHidden(el) // React 重渲染覆盖 style 时重新补上隐藏
      continue
    }
    if (persisted.some((p) => p.sig === sigOf(el))) {
      hideEl(el)
      foldedEls.add(el)
      continue
    }
    if (locked) {
      // 上锁：收纳徽标整体移除（React 重渲染补回的徽标也在这里清掉）
      el.querySelector(`:scope > .${BADGE_CLASS}`)?.remove()
    } else {
      ensureBadge(el)
    }
  }
  refreshPopupList()
}

function scheduleRescan() {
  clearTimeout(timer)
  timer = window.setTimeout(rescan, 200)
}

function startObserver() {
  if (observer) return
  observer = new MutationObserver(() => {
    // 收纳徽标是后补进按钮 DOM 的，React 重渲染会抹掉 → 观察器补回；
    // 隐藏样式也可能被覆盖 → ensureHidden 补回。两者都是幂等写，不会自触发成环
    // （写相同 inline style 值不产生新的 attribute 变更记录）。
    scheduleRescan()
  })
  observer.observe(document.querySelector("#headbar") ?? document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  })
}

function stopObserver() {
  observer?.disconnect()
  observer = null
  clearTimeout(timer)
}

// ── 入口 ──────────────────────────────────────────────────────────────────
function DrawerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function DrawerButton() {
  const btnRef = React.useRef<HTMLElement | null>(null)
  return (
    <button
      ref={btnRef as any}
      className="neo-hb-btn neo-drawer-btn"
      data-neo-own="1"
      title="插件抽屉"
      aria-label="插件抽屉"
      onClick={() => {
        if (btnRef.current) toggleDrawer(btnRef.current)
      }}
    >
      <DrawerIcon />
    </button>
  )
}

export function renderPluginDrawer(): any {
  ensureGlobals()
  return React.createElement(DrawerButton)
}

export function installPluginDrawer() {
  if (installed) return
  installed = true
  ensureGlobals()
  loadPersisted()
  orca.headbar.registerHeadbarButton(HEADBAR_ID, renderPluginDrawer)
  startObserver()
  rescan()
}

export function disposePluginDrawer() {
  if (!installed) return
  installed = false
  try {
    orca.headbar.unregisterHeadbarButton(HEADBAR_ID)
  } catch {
    // 重复卸载时 Orca 可能抛异常，忽略
  }
  closeDrawer()
  stopObserver()
  // 全部还原：折叠的放回原位、清掉徽标，避免插件被关闭后残留隐藏图标
  for (const el of currentChildren()) {
    if (isOwn(el)) continue
    if (foldedEls.has(el)) showEl(el)
    el.querySelector(`:scope > .${BADGE_CLASS}`)?.remove()
  }
}

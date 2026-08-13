// 列表视图 · 表格（参考思源 QYL-ListView 的纯 CSS 技术路线）。
// 纯展示层转换：给列表根块写持久化属性 `_lv`（值为 "table"；恢复列表则删除），
// 插件把该属性映射到 DOM 属性 data-neo-lv，由 CSS 把列表重排为网格表格；数据完全不动，
// 可随时切回普通列表。不注入 DOM、不改动 React 管理的节点（避免被重渲染抹掉）。
// DOM 结构（app.asar 逆向）：.orca-block[data-id] > .orca-repr(.orca-repr-ul)
//   > .orca-repr-main(可选表头) + .orca-repr-children(项容器)
//   > .orca-block(项) > .orca-repr > .orca-repr-main(单元格) + .orca-repr-children(嵌套子表)

export type ListViewType = "table"

const PROP = "_lv"
const ATTR = "data-neo-lv"
const FULLSCREEN_CLASS = "neo-lv-fullscreen"

// 缩放（zoom）：范围 0.3–1.5、步进 0.1；注册表为即时来源，_lvzoom 属性仅作重载兜底
export const ZOOM_MIN = 0.3
export const ZOOM_MAX = 1.5
export const ZOOM_STEP = 0.1
const _zoomRegistry = new Map<number, number>()

let _orca: any = null
function orca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}

const LIST_REPRS = new Set(["ul", "ol", "task"])

// 本地注册表：视图模式的即时来源（不依赖 state 更新时序），state 仅作重载兜底
const _viewRegistry = new Map<number, string>()

/** 块是否是列表类块（repr 类型 ul/ol/task；state 缺失时读 DOM data-type）。 */
export function isListBlock(blockId: number): boolean {
  const b = orca().state?.blocks?.[blockId]
  const repr = b?.properties?.find((p: any) => p.name === "_repr")?.value
  if (LIST_REPRS.has(repr?.type)) return true
  const el = document.querySelector(`.orca-block[data-id="${blockId}"]`)
  return LIST_REPRS.has(el?.getAttribute("data-type") ?? "")
}

/** 是否是「顶层」列表：自身是列表块、且头上没有列表类父级块（嵌套子列表
   不能转表格，否则会出现表中套表的混乱结构）。 */
export function isTopLevelList(blockId: number): boolean {
  if (!isListBlock(blockId)) return false
  const b = orca().state?.blocks?.[blockId]
  const parent = b?.parent != null ? orca().state?.blocks?.[b.parent] : undefined
  const repr = parent?.properties?.find((p: any) => p.name === "_repr")?.value
  return !LIST_REPRS.has(repr?.type)
}

/** 当前块已有的视图模式（"table" 或 ""）。 */
export function viewOfBlock(blockId: number): string {
  const reg = _viewRegistry.get(blockId)
  if (reg !== undefined) return reg
  const b = orca().state?.blocks?.[blockId]
  const v = b?.properties?.find((p: any) => p.name === PROP)?.value
  return typeof v === "string" && v === "table" ? v : ""
}

/** 设置/清除表格视图（写块属性 _lv + 立即应用 DOM 属性）。 */
export async function setListView(blockId: number, view: ListViewType | ""): Promise<void> {
  if (view !== "" && !isTopLevelList(blockId)) {
    // 只允许「头上没有列表类父级块」的列表转表格
    console.warn("[LISTVIEW] 仅顶层列表可转表格，已拒绝", blockId)
    return
  }
  if (view === "") {
    // 恢复普通列表：删除 _lv 属性
    try {
      await orca().commands.invokeEditorCommand("core.editor.deleteProperties", null, [blockId], [PROP])
    } catch (e) {
      console.warn("[LISTVIEW] 删除 _lv 失败", e)
    }
    _viewRegistry.set(blockId, "")
  } else {
    try {
      await orca().commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [blockId],
        [{ name: PROP, type: 1 /* Text */, value: view }],
      )
    } catch (e) {
      console.warn("[LISTVIEW] 写 _lv 失败", e)
    }
    _viewRegistry.set(blockId, view)
  }
  // 直接应用 DOM 属性（不依赖 state 更新时序）
  document.querySelectorAll(`.orca-block[data-id="${blockId}"]`).forEach((el) => {
    if (view) (el as HTMLElement).setAttribute(ATTR, view)
    else (el as HTMLElement).removeAttribute(ATTR)
  })
}

// ── 缩放（zoom） ──

/** 读取某张表的缩放值（0.3–1.5，默认 1）。 */
export function zoomOfBlock(blockId: number): number {
  const reg = _zoomRegistry.get(blockId)
  if (reg !== undefined) return reg
  const b = orca().state?.blocks?.[blockId]
  const v = b?.properties?.find((p: any) => p.name === "_lvzoom")?.value
  const z = typeof v === "string" ? parseFloat(v) : NaN
  return Number.isFinite(z) && z > 0 ? z : 1
}

/** 把缩放应用到表根元素的 repr（比较后写入，避免观察器自触发；工具栏在 repr 外不随缩放）。 */
function applyZoomTo(blockId: number, el: HTMLElement): void {
  const z = zoomOfBlock(blockId)
  const want = z === 1 ? "" : String(z)
  const repr = el.querySelector(":scope > .orca-repr") as HTMLElement | null
  if (repr && repr.style.zoom !== want) repr.style.zoom = want
}

/** 设置缩放：注册表即时生效 + 写 _lvzoom 属性持久化 + 立即应用到 DOM。 */
export async function setListViewZoom(blockId: number, zoom: number): Promise<void> {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10))
  _zoomRegistry.set(blockId, z)
  try {
    await orca().commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [blockId],
      [{ name: "_lvzoom", type: 1 /* Text */, value: String(z) }],
    )
  } catch (e) {
    console.warn("[LISTVIEW] 写 _lvzoom 失败", e)
  }
  document.querySelectorAll(`.orca-block[data-id="${blockId}"]`).forEach((el) => {
    applyZoomTo(blockId, el as HTMLElement)
  })
}

// ── 全屏 ──
let _fullscreenId: number | null = null

function exitFullscreen() {
  if (_fullscreenId == null) return
  document
    .querySelectorAll(`.orca-block[data-id="${_fullscreenId}"]`)
    .forEach((el) => el.classList.remove(FULLSCREEN_CLASS))
  _fullscreenId = null
}

function onFullscreenKey(e: KeyboardEvent) {
  if (e.key === "Escape") exitFullscreen()
}

export function toggleFullscreen(blockId: number) {
  if (_fullscreenId === blockId) {
    exitFullscreen()
    return
  }
  exitFullscreen()
  _fullscreenId = blockId
  // 全屏看表格时自动收起侧栏（日历/收藏/标签栏），给表格最大宽度；
  // core.closeSidebar 内部自带 SidebarOpened 判断，重复调用无害
  try {
    void orca().commands.invokeCommand("core.closeSidebar")
  } catch {
    /* ignore */
  }
  // 避开页签条：全屏上边界 = 页签条底边（无页签条则为 0）
  const bar = document.querySelector(".neo-tabbar") as HTMLElement | null
  const top = bar && bar.getBoundingClientRect().height > 0 ? bar.getBoundingClientRect().bottom : 0
  document
    .querySelectorAll(`.orca-block[data-id="${blockId}"]`)
    .forEach((el) => {
      const h = el as HTMLElement
      h.style.setProperty("--neo-lv-fs-top", `${top}px`)
      h.classList.add(FULLSCREEN_CLASS)
    })
}

/** 全屏类因重渲染丢失时补回（观察器调用）。 */
function ensureFullscreen() {
  if (_fullscreenId == null) return
  document
    .querySelectorAll(`.orca-block[data-id="${_fullscreenId}"]`)
    .forEach((el) => el.classList.add(FULLSCREEN_CLASS))
}

/** 仅改注册表与 DOM、不落库（拖动过程实时生效，松手才持久化）。 */
export function applyZoomLive(blockId: number, zoom: number) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100))
  _zoomRegistry.set(blockId, z)
  document.querySelectorAll(`.orca-block[data-id="${blockId}"]`).forEach((el) => {
    applyZoomTo(blockId, el as HTMLElement)
  })
}

/** 把内存里的 _lv 属性映射到 DOM（data-neo-lv 属性），CSS 据此渲染表格；同时补回缩放。 */
export async function applyViews(): Promise<void> {
  const blocks = orca().state?.blocks
  if (!blocks) return
  document.querySelectorAll(".orca-block[data-id]").forEach((el) => {
    const id = Number((el as HTMLElement).getAttribute("data-id"))
    if (!Number.isFinite(id)) return
    const view = viewOfBlock(id)
    if (view) (el as HTMLElement).setAttribute(ATTR, view)
    else (el as HTMLElement).removeAttribute(ATTR)
  })
  // 缩放补回（React 重建 repr 元素后丢失 zoom 时恢复）
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => {
    const id = Number((el as HTMLElement).getAttribute("data-id"))
    if (Number.isFinite(id)) applyZoomTo(id, el as HTMLElement)
  })
  ensureFullscreen()
  forceHorizontalText()
}

/** 用内联 !important 强制表格内所有节点横排（只改文字方向，不动布局）。 */
export function forceHorizontalText(): void {
  document.querySelectorAll(`[${ATTR}="table"] *`).forEach((el) => {
    const s = (el as HTMLElement).style
    s.setProperty("writing-mode", "horizontal-tb", "important")
    s.setProperty("text-orientation", "mixed", "important")
    s.setProperty("direction", "ltr", "important")
  })
}

/** 诊断：打印表格单元格的 computed style 与 DOM 结构（控制台执行 __lvDebug()）。 */
export function debugTable(): void {
  const roots = document.querySelectorAll(`[${ATTR}="table"]`)
  console.log("[LISTVIEW] debug 表格块数:", roots.length)
  roots.forEach((root, ri) => {
    const cells = root.querySelectorAll(".orca-repr-main")
    cells.forEach((cell, ci) => {
      if (ci > 4) return
      const el = cell as HTMLElement
      const cs = getComputedStyle(el)
      console.log(`[LISTVIEW] 块${ri} 格${ci} <${el.tagName.toLowerCase()} class="${el.className}">`, {
        writingMode: cs.writingMode,
        direction: cs.direction,
        display: cs.display,
        flexDirection: cs.flexDirection,
        transform: cs.transform,
        fontFamily: cs.fontFamily,
        inlineStyle: el.getAttribute("style"),
        innerHTML: el.innerHTML.slice(0, 300),
      })
    })
  })
}

/** 自动诊断：把渲染信息写入块属性 _lv_debug，落库后可由开发者直接读取（节流 15s）。 */
export async function autoDiagnose(): Promise<void> {
  const root = document.querySelector(`[${ATTR}="table"]`) as HTMLElement | null
  if (!root) return
  const rootCs = getComputedStyle(root)
  const rows: Record<string, unknown> = {
    root: {
      tag: root.tagName.toLowerCase(),
      cls: root.className,
      writingMode: rootCs.writingMode,
      direction: rootCs.direction,
      display: rootCs.display,
      fontFamily: rootCs.fontFamily,
      forcedInline: root.style.writingMode || "(无)",
    },
    cells: [] as Record<string, unknown>[],
  }
  root.querySelectorAll(".orca-repr-main").forEach((cell, ci) => {
    if (ci > 19) return
    const el = cell as HTMLElement
    const cs = getComputedStyle(el)
    const inner = el.querySelector(".orca-repr-main-content") as HTMLElement | null
    const ics = inner ? getComputedStyle(inner) : null
    const span = inner?.querySelector("span.orca-inline") as HTMLElement | null
    const scs = span ? getComputedStyle(span) : null
    rows.cells.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className,
      w: cs.width,
      h: cs.height,
      writingMode: cs.writingMode,
      direction: cs.direction,
      display: cs.display,
      flexDirection: cs.flexDirection,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      whiteSpace: cs.whiteSpace,
      wordBreak: cs.wordBreak,
      transform: cs.transform !== "none" ? cs.transform : "",
      forcedInline: el.style.writingMode || "(无)",
      inner: inner
        ? {
            tag: inner.tagName.toLowerCase(),
            cls: inner.className,
            writingMode: ics?.writingMode,
            display: ics?.display,
            w: ics?.width,
            h: ics?.height,
            widthProp: ics?.width,
            maxWidth: ics?.maxWidth,
            boxSizing: ics?.boxSizing,
            textWrap: ics?.textWrap,
            textWrapStyle: ics?.textWrapStyle,
            whiteSpace: ics?.whiteSpace,
            spanW: scs?.width,
            spanH: scs?.height,
            spanWhiteSpace: scs?.whiteSpace,
            spanWordBreak: scs?.wordBreak,
            innerStyleAttr: inner.getAttribute("style"),
            spanStyleAttr: span?.getAttribute("style"),
            html: inner.innerHTML.slice(0, 200),
          }
        : "(无 .orca-repr-main-content)",
      cellStyleAttr: el.getAttribute("style"),
      cellPadding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      cellChildren: Array.from(el.children).map((ch) => {
        const h = ch as HTMLElement
        const chs = getComputedStyle(h)
        return `${h.tagName.toLowerCase()}.${h.className} ${chs.width}x${chs.height} disp=${chs.display}`
      }),
      parentReprW: (el.parentElement ? getComputedStyle(el.parentElement).width : ""),
      parentBlockW: (el.parentElement?.parentElement ? getComputedStyle(el.parentElement.parentElement).width : ""),
    })
  })
  const report = JSON.stringify(rows)
  console.log("[LISTVIEW] 自动诊断:", report)
  const id = Number(root.getAttribute("data-id"))
  if (!Number.isFinite(id)) return
  try {
    await orca().commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [id],
      [{ name: "_lv_debug", type: 1, value: report }],
    )
  } catch (e) {
    console.warn("[LISTVIEW] 写 _lv_debug 失败", e)
  }
}

let _lastDiagnose = 0
function throttledDiagnose() {
  if (!document.querySelector(`[${ATTR}="table"]`)) return
  const now = Date.now()
  if (now - _lastDiagnose < 15000) return
  _lastDiagnose = now
  void autoDiagnose()
}

// ── 观察与重应用 ──
let _observer: MutationObserver | null = null
let _debounce: ReturnType<typeof setTimeout> | null = null

function scheduleReapply() {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(() => {
    _debounce = null
    // 清理旧版本残留注入节点（插件热重载不重建文档 DOM，旧节点会一直留在文档里）
    document.querySelectorAll(".neo-lv-zoombar, .neo-lv-toolbar, .neo-lv-restore, .neo-lv-dot").forEach((el) => {
      el.remove()
    })
    void applyViews()
    forceHorizontalText()
    throttledDiagnose()
  }, 200)
}

export function installListView() {
  if (_observer) return
  _observer = new MutationObserver(scheduleReapply)
  _observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener("keydown", onFullscreenKey)
  void applyViews()
  // 控制台调试入口：__lvDebug() 看单元格 computed 结构，__lvForce() 手动再强制一次横排
  ;(window as unknown as Record<string, unknown>).__lvDebug = debugTable
  ;(window as unknown as Record<string, unknown>).__lvForce = forceHorizontalText
}

export function disposeListView() {
  _observer?.disconnect()
  _observer = null
  document.removeEventListener("keydown", onFullscreenKey)
  exitFullscreen()
  _zoomRegistry.clear()
  // 清理插件注入的全部节点（含旧版本残留）
  document.querySelectorAll(".neo-lv-zoombar, .neo-lv-toolbar, .neo-lv-restore, .neo-lv-dot").forEach((el) => {
    el.remove()
  })
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => {
    (el as HTMLElement).removeAttribute(ATTR)
  })
}

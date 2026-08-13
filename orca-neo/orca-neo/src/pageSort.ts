// 侧边栏列表排序（展示层实现）：页面 / 标签 / 收藏 三个列表统一按设置 pageSortMode 排序。
// 背景（app.asar 逆向）：
//   - 原生排序在后端 SQL（页面 getAliasedBlocksSt、标签 getAliasesSt 按 name_p 拼音），
//     接口无排序参数，插件改不了 SQL → 只能展示层 DOM 重排；
//   - 页面列表：.orca-aliased → .orca-aliased-list → 条目 .orca-aliased-block（名 .orca-aliased-block-name），
//     子页面嵌套在父条目内（直接子元素）；标签列表同型：.orca-tags-list → .orca-tags-list-list →
//     .orca-tags-tag（名 .orca-tags-tag-name）；收藏：.orca-favorites-list → .orca-favorites-items →
//     .orca-fav-item（带 data-id 块 id）；
//   - 别名全局唯一（DuplicateAlias），可用名字把 DOM 条目映射到块；
//   - 页面/标签条目原生拖拽=设 _is 包含关系（拖进成为子项），不是排序 → 手动模式在 document
//     捕获阶段拦截原生拖拽做同级重排；**收藏的原生拖拽就是重排且持久化（repo config key 1003）**，
//     故收藏的手动模式直接交给原生。
// 实现：对每个列表的顶层容器与嵌套子层容器，按其直接子块排序后重排 DOM；MutationObserver 防
// React 重渲染覆盖；手动顺序持久化到插件文件 pages-sort/<repo>.json（repo 维度，重启保留）。

export type PageSortMode =
  | "default"
  | "created"
  | "createdDesc"
  | "modified"
  | "modifiedDesc"
  | "manual"

let _orca: any = null
function orca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}
function ib(): (msg: string, ...args: any[]) => Promise<any> {
  const o = orca()
  return o.invokeBackend.bind(o)
}

interface SortListSpec {
  id: "pages" | "tags"
  rootSel: string
  listSel: string // 顶层条目容器
  wrapSel: string // 条目/包装块选择器
  nameSel: string | null // 名字元素
  nested: boolean // 条目是否嵌套子层（子层容器=wrap 元素自身）
}

// 仅页面与标签两个列表参与排序；收藏栏纯靠原生拖拽（原生即重排+持久化），不参与。
const LISTS: SortListSpec[] = [
  {
    id: "pages",
    rootSel: ".orca-aliased",
    listSel: ".orca-aliased-list",
    wrapSel: ".orca-aliased-block",
    nameSel: ".orca-aliased-block-name",
    nested: true,
  },
  {
    id: "tags",
    rootSel: ".orca-tags-list",
    listSel: ".orca-tags-list-list",
    wrapSel: ".orca-tags-tag",
    nameSel: ".orca-tags-tag-name",
    nested: true,
  },
]

// 排序键（名字或块 id 字符串）→ 块；每列表的原生顺序
const _blocksByKey = new Map<string, any>()
const _nativeOrders: Record<string, string[]> = { pages: [], tags: [] }
let _observer: MutationObserver | null = null
let _debounce: ReturnType<typeof setTimeout> | null = null

// 手动顺序：pages/tags 均用名字
interface ManualListOrder {
  roots?: string[]
  children?: Record<string, string[]>
}
interface ManualOrders {
  pages?: ManualListOrder
  tags?: ManualListOrder
}
let _manual: ManualOrders = {}

const PLUGIN = "orca-neo"

function settings(): Record<string, any> {
  return orca().state.plugins?.[PLUGIN]?.settings ?? {}
}

/** 当前排序模式（页面/标签各自独立：pageSortModePages / pageSortModeTags，
    旧版共享的 pageSortMode 作回退）。 */
export function currentSortMode(specId?: "pages" | "tags"): PageSortMode {
  const s = settings()
  let m: unknown
  if (specId === "pages") m = s.pageSortModePages ?? s.pageSortMode
  else if (specId === "tags") m = s.pageSortModeTags ?? s.pageSortMode
  else m = s.pageSortMode
  return m === "created" ||
    m === "createdDesc" ||
    m === "modified" ||
    m === "modifiedDesc" ||
    m === "manual"
    ? (m as PageSortMode)
    : "default"
}

function manualFileName(): string {
  const repo = String(orca().state.repo ?? "default")
  return `pages-sort/${encodeURIComponent(repo)}.json`
}

async function loadManualOrders(): Promise<void> {
  try {
    const raw = await ib()("get-plugin-file", PLUGIN, manualFileName())
    if (raw) _manual = JSON.parse(raw) ?? {}
  } catch {
    _manual = {}
  }
}

async function saveManualOrders(): Promise<void> {
  try {
    await ib()("set-plugin-file", PLUGIN, manualFileName(), JSON.stringify(_manual))
  } catch (e) {
    console.warn("[PAGESORT] 保存手动顺序失败", e)
  }
}

/** 拉取三个列表的全量数据：名字/块 id → 块（含 created/modified）+ 各自原生顺序。 */
export async function refreshPageData(): Promise<void> {
  try {
    const [pageTotal, pageIds] = await ib()("get-aliased-blocks", null, 1, 100000)
    const [tagTotal, tagIds] = await ib()("get-aliases", null, 1, 100000)
    const idSet = new Set<number>()
    for (const id of pageIds ?? []) idSet.add(Number(id))
    for (const id of tagIds ?? []) idSet.add(Number(id))
    const blocks: any[] = await ib()("get-blocks", Array.from(idSet))
    const byId = new Map<number, any>()
    for (const b of blocks ?? []) byId.set(b.id, b)

    const nameOf = (id: number) => (byId.get(id)?.aliases?.[0] ?? "").trim()
    _nativeOrders.pages = (pageIds ?? []).map((id: number) => nameOf(id)).filter(Boolean)
    _nativeOrders.tags = (tagIds ?? []).map((id: number) => nameOf(id)).filter(Boolean)

    _blocksByKey.clear()
    for (const b of blocks ?? []) {
      const name = (b?.aliases?.[0] ?? "").trim()
      if (name) _blocksByKey.set(name, b)
      _blocksByKey.set(String(b.id), b)
    }
  } catch (e) {
    console.warn("[PAGESORT] 拉取列表数据失败", e)
  }
}

function itemKeyOf(spec: SortListSpec, wrap: HTMLElement): string {
  return spec.nameSel ? wrap.querySelector(spec.nameSel)?.textContent?.trim() ?? "" : ""
}

function directItems(spec: SortListSpec, container: HTMLElement): HTMLElement[] {
  return Array.from(container.children).filter((el) => el.matches?.(spec.wrapSel)) as HTMLElement[]
}

/** 容器对应的父键（顶层容器为 null，嵌套容器为其自身键）。 */
function containerParentKey(spec: SortListSpec, container: HTMLElement): string | null {
  if (container.matches(spec.listSel)) return null
  if (container.matches(spec.wrapSel)) return itemKeyOf(spec, container)
  return null
}

function blockKeyOf(spec: SortListSpec, key: string): any {
  return _blocksByKey.get(key)
}

function desiredOrder(spec: SortListSpec, mode: PageSortMode): string[] {
  const native = _nativeOrders[spec.id] ?? []
  if (mode === "default") return native
  // created/createdDesc/modified/modifiedDesc：按块时间排序（正序/倒序），缺数据按原生序排后
  const field = mode === "created" || mode === "createdDesc" ? "created" : "modified"
  const desc = mode === "createdDesc" || mode === "modifiedDesc"
  const idx = new Map(native.map((n, i) => [n, i]))
  return native.slice().sort((a, b) => {
    const ta = blockKeyOf(spec, a)?.[field]
    const tb = blockKeyOf(spec, b)?.[field]
    const ka = ta instanceof Date ? ta.getTime() : Number.MAX_SAFE_INTEGER
    const kb = tb instanceof Date ? tb.getTime() : Number.MAX_SAFE_INTEGER
    if (ka !== kb) return desc ? kb - ka : ka - kb
    return (idx.get(a) ?? 0) - (idx.get(b) ?? 0)
  })
}

/** 对一个容器应用排序（只在顺序不同时移动 DOM）。 */
function applySortToContainer(spec: SortListSpec, container: HTMLElement, mode: PageSortMode) {
  const items = directItems(spec, container)
  if (items.length < 2) return
  const parentKey = containerParentKey(spec, container)
  let order: string[]
  if (mode === "manual") {
    const m = _manual[spec.id] as ManualListOrder | undefined
    const manual = parentKey == null ? m?.roots : m?.children?.[parentKey]
    if (!manual?.length) return
    order = manual
  } else {
    order = desiredOrder(spec, mode)
  }
  const idx = new Map<string, number>()
  order.forEach((n, i) => {
    if (!idx.has(n)) idx.set(n, i)
  })
  const nativeIdx = new Map((_nativeOrders[spec.id] ?? []).map((n, i) => [n, i]))
  const key = (item: HTMLElement) => {
    const k = itemKeyOf(spec, item)
    const i = idx.get(k)
    if (i != null) return i
    return 1e9 + (nativeIdx.get(k) ?? 0)
  }
  const want = items.slice().sort((a, b) => key(a) - key(b))
  if (want.every((el, i) => el === items[i])) return
  for (const el of want) container.appendChild(el)
}

/** 递归应用排序到某列表的所有容器。 */
function applySortToList(spec: SortListSpec, mode: PageSortMode) {
  document.querySelectorAll(spec.rootSel).forEach((root) => {
    root.querySelectorAll(spec.listSel).forEach((list) => applySortToContainer(spec, list as HTMLElement, mode))
    if (spec.nested) {
      root.querySelectorAll(spec.wrapSel).forEach((wrap) => {
        const el = wrap as HTMLElement
        if (el.querySelector(`:scope > ${spec.wrapSel}`)) applySortToContainer(spec, el, mode)
      })
    }
  })
}

function applyAllSorts() {
  for (const spec of LISTS) {
    const mode = currentSortMode(spec.id)
    if (mode !== "default") applySortToList(spec, mode)
  }
}

/** 把某容器当前 DOM 顺序写入手动顺序（返回是否有变化）。 */
function persistContainerOrderInto(spec: SortListSpec, container: HTMLElement): boolean {
  const keys = directItems(spec, container).map((el) => itemKeyOf(spec, el))
  const parentKey = containerParentKey(spec, container)
  const m = (_manual[spec.id] ??= {})
  const target = parentKey == null ? (m.roots ??= []) : ((m.children ??= {})[parentKey] ??= [])
  if (target.length === keys.length && target.every((k, i) => k === keys[i])) return false
  if (parentKey == null) m.roots = keys
  else m.children![parentKey] = keys
  return true
}

/** 把某列表所有容器的当前 DOM 顺序快照进手动记忆（返回是否有变化）。 */
function snapshotListOrders(spec: SortListSpec): boolean {
  let changed = false
  document.querySelectorAll(spec.rootSel).forEach((root) => {
    root.querySelectorAll(spec.listSel).forEach((list) => {
      if (persistContainerOrderInto(spec, list as HTMLElement)) changed = true
    })
    if (spec.nested) {
      root.querySelectorAll(spec.wrapSel).forEach((wrap) => {
        const el = wrap as HTMLElement
        if (el.querySelector(`:scope > ${spec.wrapSel}`)) {
          if (persistContainerOrderInto(spec, el)) changed = true
        }
      })
    }
  })
  return changed
}

async function persistContainerOrder(spec: SortListSpec, container: HTMLElement) {
  if (persistContainerOrderInto(spec, container)) await saveManualOrders()
}

// ── 手动拖拽（document 捕获阶段；页面/标签拦截原生 include-in 拖拽） ──
let _dragSpec: SortListSpec | null = null
let _dragKey: string | null = null
let _dragContainer: HTMLElement | null = null

function clearDrag() {
  _dragSpec = null
  _dragKey = null
  _dragContainer = null
  document.querySelectorAll(".neo-pagesort-over").forEach((el) => el.classList.remove("neo-pagesort-over"))
}

function specOfItem(target: EventTarget | null): { spec: SortListSpec; wrap: HTMLElement } | null {
  const el = target as HTMLElement | null
  if (!el) return null
  for (const spec of LISTS) {
    const wrap = el.closest(spec.wrapSel) as HTMLElement | null
    if (wrap?.closest(spec.rootSel)) return { spec, wrap }
  }
  return null
}

function onDragStartCapture(e: DragEvent) {
  const hit = specOfItem(e.target)
  if (!hit) return
  if (currentSortMode(hit.spec.id) !== "manual") return
  _dragSpec = hit.spec
  _dragContainer = hit.wrap.parentElement
  _dragKey = itemKeyOf(hit.spec, hit.wrap)
  e.stopPropagation() // 阻止原生 include-in 拖拽
}

function onDragOverCapture(e: DragEvent) {
  if (_dragSpec == null) return
  const hit = specOfItem(e.target)
  if (!hit || hit.spec !== _dragSpec) return
  if (hit.wrap.parentElement !== _dragContainer) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
  document.querySelectorAll(".neo-pagesort-over").forEach((el) => el.classList.remove("neo-pagesort-over"))
  hit.wrap.classList.add("neo-pagesort-over")
}

function onDropCapture(e: DragEvent) {
  if (_dragSpec == null) return
  e.preventDefault()
  e.stopPropagation()
  const hit = specOfItem(e.target)
  const targetWrap = hit && hit.spec === _dragSpec ? hit.wrap : null
  const container = targetWrap?.parentElement ?? _dragContainer
  if (!container || !_dragSpec) {
    clearDrag()
    return
  }
  const dragWrap = directItems(_dragSpec, container).find((el) => itemKeyOf(_dragSpec!, el) === _dragKey)
  if (!dragWrap || dragWrap === targetWrap) {
    clearDrag()
    return
  }
  if (targetWrap) container.insertBefore(dragWrap, targetWrap)
  else container.appendChild(dragWrap)
  void persistContainerOrder(_dragSpec, container)
  clearDrag()
}

function onDragEndCapture() {
  clearDrag()
}

// ── 观察与重应用 ──
function anyRootPresent(): boolean {
  return LISTS.some((s) => document.querySelector(s.rootSel))
}

/** 是否还有列表处于非默认排序（两个列表都默认则无需干预）。 */
function anyNonDefaultMode(): boolean {
  return LISTS.some((s) => currentSortMode(s.id) !== "default")
}

function scheduleReapply() {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(() => {
    _debounce = null
    if (!anyNonDefaultMode()) return
    if (!anyRootPresent()) return
    applyAllSorts()
  }, 250)
}

// 上次应用的模式（用于检测「离开手动」时快照手动顺序）
const _prevModes: Record<string, PageSortMode> = { pages: "default", tags: "default" }

/** 应用当前排序模式（设置变更时由 main.ts apply() 调用）。 */
export async function applyPageSort(): Promise<void> {
  try {
    await loadManualOrders()
  } catch (e) {
    console.warn("[PAGESORT] 初始化失败", e)
  }
  let dirty = false
  for (const spec of LISTS) {
    const mode = currentSortMode(spec.id)
    const prev = _prevModes[spec.id] ?? "default"
    if (prev === "manual" && mode !== "manual") {
      // 离开手动：把当前（手动）顺序快照下来，保证转回手动时顺序不变
      if (snapshotListOrders(spec)) dirty = true
    } else if (mode === "manual" && !_manual[spec.id]) {
      // 首次进入手动：以当前顺序为手动基线
      if (snapshotListOrders(spec)) dirty = true
    }
    _prevModes[spec.id] = mode
  }
  if (dirty) await saveManualOrders()
  await refreshPageData()
  applyAllSorts()
}

/** 安装观察器与拖拽监听（load 时调用一次）。 */
export function installPageSort() {
  if (_observer) return
  _observer = new MutationObserver(() => {
    const mode = currentSortMode()
    if (mode === "default") return
    if (!anyRootPresent()) return
    scheduleReapply()
  })
  _observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener("dragstart", onDragStartCapture, true)
  document.addEventListener("dragover", onDragOverCapture, true)
  document.addEventListener("drop", onDropCapture, true)
  document.addEventListener("dragend", onDragEndCapture, true)
  void applyPageSort()
}

export function disposePageSort() {
  _observer?.disconnect()
  _observer = null
  document.removeEventListener("dragstart", onDragStartCapture, true)
  document.removeEventListener("dragover", onDragOverCapture, true)
  document.removeEventListener("drop", onDropCapture, true)
  document.removeEventListener("dragend", onDragEndCapture, true)
  clearDrag()
}

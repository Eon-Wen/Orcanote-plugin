// 侧边栏多选（页面/标签/收藏）+ 批量改变「包含于」页面
// 用法：按住 Cmd（Mac）/ Ctrl（Windows）点击条目多选（高亮），列表上方出现操作条：
//   「包含于…」打开目标选择弹窗（复用批量转引用的弹窗骨架：勾选行 + 每页 50 条分页 +
//   搜索），把所选块同时包含到勾选的多个目标（页面/标签）下（改写 _is 属性）；
//   「移到顶层」清空 _is（取消包含）；「取消」清空选择。
// 原生机制（app.asar 逆向）：包含关系 = 块属性 `_is`（PropType.TextChoices=6, typeArgs
// {subType:"multi"}，值为父页面名数组，数组 = 同时成为多个页面的子页面）；原生拖拽
// drop 即 push 父名进 _is。
// 目标列表数据源 = 原生侧边栏同款后端接口：
//   get-aliased-blocks(kw, page, pageSize) → [总数, 块id数组]（页面：带 _hide 的别名块）
//   get-aliases(kw, page, pageSize)        → [总数, 块id数组]（标签：不带 _hide 的别名块）
// 每次打开弹窗全量拉取一次（size 100000 一次拉完），搜索/分页在内存里做（与批量转引用
// 一致），块名字用 get-blocks 分批（每批 200）取，避免超大 id 数组。
// 页面/标签条目 DOM 无块 id，别名唯一用名字映射；收藏条目带 data-id。

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
function orcaG(): any {
  if (!orca) ensureGlobals()
  return orca
}
function ib(): (msg: string, ...args: any[]) => Promise<any> {
  const o = orcaG()
  return o.invokeBackend.bind(o)
}

const BAR_CLASS = "neo-pagesel-bar"
const SEL_CLASS = "neo-pagesel-on"
const PAGE_SIZE = 50 // 目标列表每页条数（与批量转引用一致）

interface ListSpec {
  id: string
  rootSel: string
  itemSel: string // 点击条目
  wrapSel: string // 高亮包装（favs 与 item 相同）
  nameSel: string | null // 名字元素（favs 无，用 data-id）
  listSel: string // 操作条插入位置（列表容器前）
}

const SPECS: ListSpec[] = [
  {
    id: "pages",
    rootSel: ".orca-aliased",
    itemSel: ".orca-aliased-block-item",
    wrapSel: ".orca-aliased-block",
    nameSel: ".orca-aliased-block-name",
    listSel: ".orca-aliased-list",
  },
  {
    id: "tags",
    rootSel: ".orca-tags-list",
    itemSel: ".orca-tags-tag-item",
    wrapSel: ".orca-tags-tag",
    nameSel: ".orca-tags-tag-name",
    listSel: ".orca-tags-list-list",
  },
  {
    id: "favs",
    rootSel: ".orca-favorites-list",
    itemSel: ".orca-fav-item",
    wrapSel: ".orca-fav-item",
    nameSel: null,
    listSel: ".orca-favorites-items",
  },
]

// 已选：选择键 → 块 id（0 = 尚未解析）。键 = 名字（页面/标签）或 "f:<data-id>"（收藏）。
const _selected = new Map<string, number>()
let _nameIdCache: { pages: Map<string, number>; tags: Map<string, number> } | null = null
let _nameIdAt = 0
let _observer: MutationObserver | null = null
let _debounce: ReturnType<typeof setTimeout> | null = null
let _closePicker: (() => void) | null = null

/** 页面/标签：名字 → 块 id（2 分钟缓存；插件加载时预热）。 */
async function fetchNameIdMaps(): Promise<{ pages: Map<string, number>; tags: Map<string, number> }> {
  if (_nameIdCache && Date.now() - _nameIdAt < 120000) return _nameIdCache
  const [pt, pageIds] = await ib()("get-aliased-blocks", null, 1, 100000)
  const [tt, tagIds] = await ib()("get-aliases", null, 1, 100000)
  const idSet = new Set<number>()
  for (const id of pageIds ?? []) idSet.add(Number(id))
  for (const id of tagIds ?? []) idSet.add(Number(id))
  const blocks: any[] = await ib()("get-blocks", Array.from(idSet))
  const pages = new Map<string, number>()
  const tags = new Map<string, number>()
  const byId = new Map<number, any>()
  for (const b of blocks) byId.set(b.id, b)
  const nameOf = (id: number) => (byId.get(id)?.aliases?.[0] ?? "").trim()
  for (const id of pageIds ?? []) {
    const n = nameOf(Number(id))
    if (n) pages.set(n, Number(id))
  }
  for (const id of tagIds ?? []) {
    const n = nameOf(Number(id))
    if (n) tags.set(n, Number(id))
  }
  _nameIdCache = { pages, tags }
  _nameIdAt = Date.now()
  return _nameIdCache
}

/** 某条目的选择键与包装元素。 */
function hitOf(target: EventTarget | null): { spec: ListSpec; key: string; wrap: HTMLElement } | null {
  const el = target as HTMLElement | null
  if (!el) return null
  for (const spec of SPECS) {
    const item = el.closest(spec.itemSel) as HTMLElement | null
    if (!item || !item.closest(spec.rootSel)) continue
    const wrap = item.closest(spec.wrapSel) as HTMLElement
    let key = ""
    if (spec.nameSel) {
      key = wrap?.querySelector?.(spec.nameSel)?.textContent?.trim() ?? ""
    } else {
      key = `f:${item.getAttribute("data-id") ?? ""}`
    }
    if (!key) continue
    return { spec, key, wrap }
  }
  return null
}

function selectedIds(): number[] {
  return Array.from(_selected.values()).filter((v) => v > 0)
}

function clearSelection() {
  _selected.clear()
  document.querySelectorAll(`.${SEL_CLASS}`).forEach((el) => el.classList.remove(SEL_CLASS))
  renderBars()
}

function mkBtn(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "neo-pagesel-btn"
  b.textContent = label
  b.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return b
}

/** 创建操作条（只创建一次，按钮保持稳定，避免反复重建丢点击）。 */
function buildBar(): HTMLElement {
  const bar = document.createElement("div")
  bar.className = BAR_CLASS
  const count = document.createElement("div")
  count.className = "neo-pagesel-count"
  bar.appendChild(count)
  const row = document.createElement("div")
  row.className = "neo-pagesel-row"
  row.appendChild(mkBtn("包含于…", openPicker))
  row.appendChild(mkBtn("移到顶层", () => void applyIncludeClear()))
  row.appendChild(mkBtn("取消", clearSelection))
  bar.appendChild(row)
  return bar
}

/** 在每个存在的列表根容器里渲染/更新操作条（仅在计数变化时写文字，避免自触发循环）。 */
function renderBars() {
  for (const spec of SPECS) {
    const root = document.querySelector(spec.rootSel)
    if (!root) continue
    let bar = root.querySelector(`:scope > .${BAR_CLASS}`) as HTMLElement | null
    if (_selected.size === 0) {
      bar?.remove()
      continue
    }
    if (!bar) {
      bar = buildBar()
      const list = root.querySelector(`:scope > ${spec.listSel}`)
      if (list) root.insertBefore(bar, list)
      else root.appendChild(bar)
    }
    const count = bar.querySelector(":scope > .neo-pagesel-count") as HTMLElement | null
    const target = `已选 ${_selected.size}`
    if (count && count.textContent !== target) count.textContent = target
  }
}

/** 全量拉取目标列表（页面/标签），返回 [{id, name}]。
 *  数据源与原生侧边栏一致：get-aliased-blocks（页面，_hide=1）/
 *  get-aliases（标签）。一次拉完（size 100000），名字用 get-blocks 分批取。 */
async function fetchTargetList(kind: "pages" | "tags"): Promise<{ id: number; name: string }[]> {
  const cmd = kind === "pages" ? "get-aliased-blocks" : "get-aliases"
  let ids: number[] = []
  try {
    const res: any = await ib()(cmd, "", 1, 100000)
    ids = Array.isArray(res?.[1])
      ? res[1].map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v) && v > 0)
      : []
  } catch (e) {
    console.warn("[PAGESEL] 拉取目标列表失败", kind, e)
    return []
  }
  const out: { id: number; name: string }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    try {
      const blocks: any[] = await ib()("get-blocks", chunk)
      const byId = new Map<number, any>()
      for (const b of blocks ?? []) byId.set(Number(b.id), b)
      for (const id of chunk) {
        const b = byId.get(id)
        const name = (b?.aliases?.[0] ?? b?.text ?? "").trim()
        out.push({ id, name: name || String(id) })
      }
    } catch (e) {
      console.warn("[PAGESEL] 取目标名字失败", kind, e)
      for (const id of chunk) out.push({ id, name: String(id) })
    }
  }
  return out
}

/** 批量改写 _is：把所选块包含到 targets 里的每个目标下（多目标 = 同时成为多个页面的子页面）。 */
async function applyIncludeTargets(targetNames: string[]): Promise<void> {
  const entries = Array.from(_selected.entries()).filter(([, v]) => v > 0)
  if (!entries.length) {
    orcaG().notify?.("info", "没有已选项（或未能解析块 id）")
    return
  }
  if (!targetNames.length) {
    orcaG().notify?.("info", "请先勾选目标页面 / 标签")
    return
  }
  let ok = 0
  let skipped = 0
  for (const [key, id] of entries) {
    // 不能把页面包含进它自己：跳过与来源同名的目标（别名全局唯一，比较名字即安全）
    const self = key.startsWith("f:") ? null : key
    const names = self ? targetNames.filter((n) => n !== self) : targetNames
    if (!names.length) {
      skipped++
      continue
    }
    try {
      await orcaG().commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [id],
        [
          {
            name: "_is",
            type: 6, // PropType.TextChoices
            typeArgs: { subType: "multi" },
            value: names,
          },
        ],
      )
      ok++
    } catch (e) {
      console.warn("[PAGESEL] 更新 _is 失败", id, e)
    }
  }
  clearSelection()
  orcaG().notify?.(
    "info",
    `已更新 ${ok} 个块的包含关系（每个块包含到 ${targetNames.length} 个目标）${
      skipped ? `，跳过 ${skipped} 个（目标与来源相同）` : ""
    }`,
  )
}

/** 移到顶层：清空所有已选块的 _is（取消包含）。 */
async function applyIncludeClear(): Promise<void> {
  const ids = selectedIds()
  if (!ids.length) {
    orcaG().notify?.("info", "没有已选项（或未能解析块 id）")
    return
  }
  let ok = 0
  for (const id of ids) {
    try {
      await orcaG().commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [id],
        [{ name: "_is", type: 6, typeArgs: { subType: "multi" }, value: [] }],
      )
      ok++
    } catch (e) {
      console.warn("[PAGESEL] 清空 _is 失败", id, e)
    }
  }
  clearSelection()
  orcaG().notify?.("info", `已更新 ${ok} 个块的包含关系`)
}

/** 目标选择弹窗（居中遮罩，复用批量转引用的弹窗骨架）：
 *  - 页面 / 标签两个分组都全量列出，内存中搜索（不区分大小写）；
 *  - 每页 50 条分页（本页全选/取消 + 上一页/下一页）；
 *  - 勾选多个目标（可跨页、跨分组、随搜索保留），点「包含到所选目标」一次应用。 */
function openPicker() {
  ensureGlobals()
  _closePicker?.()
  const host = document.createElement("div")
  host.className = "neo-pagesel-picker-host"
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
    if (_closePicker === close) _closePicker = null
  }
  _closePicker = close

  interface TargetRow {
    id: number
    name: string
  }

  function Picker() {
    const [pages, setPages] = React.useState<TargetRow[]>([])
    const [tags, setTags] = React.useState<TargetRow[]>([])
    const [kw, setKw] = React.useState("")
    const [pagePages, setPagePages] = React.useState(1)
    const [pageTags, setPageTags] = React.useState(1)
    const [sel, setSel] = React.useState<Map<number, string>>(new Map()) // id → name

    React.useEffect(() => {
      let alive = true
      Promise.all([fetchTargetList("pages"), fetchTargetList("tags")]).then(([p, t]) => {
        if (alive) {
          setPages(p)
          setTags(t)
        }
      })
      return () => {
        alive = false
      }
    }, [])

    React.useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") close()
      }
      document.addEventListener("keydown", onKey)
      return () => document.removeEventListener("keydown", onKey)
    }, [])

    // 搜索词变化回到第 1 页
    React.useEffect(() => {
      setPagePages(1)
      setPageTags(1)
    }, [kw])

    const q = kw.trim().toLowerCase()
    const matchedPages = q ? pages.filter((p) => p.name.toLowerCase().includes(q)) : pages
    const matchedTags = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags

    const toggle = (id: number, name: string) => {
      setSel((prev) => {
        const n = new Map(prev)
        if (n.has(id)) n.delete(id)
        else n.set(id, name)
        return n
      })
    }

    const apply = () => {
      const names = Array.from(sel.values())
      close()
      void applyIncludeTargets(names)
    }

    const renderSection = (
      title: string,
      all: TargetRow[],
      matched: TargetRow[],
      page: number,
      setPage: (p: number) => void,
    ) => {
      const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
      const cur = Math.min(page, totalPages)
      const rows = matched.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
      const pageSel = rows.filter((r) => sel.has(r.id)).length
      return React.createElement(
        "div",
        { className: "neo-pagesel-sec", key: title },
        React.createElement(
          "div",
          { className: "neo-pagesel-sec-head" },
          title,
          React.createElement(
            "span",
            { className: "neo-pagesel-sec-count" },
            q ? `匹配 ${matched.length} / 共 ${all.length} 条` : `共 ${all.length} 条`,
          ),
        ),
        rows.length === 0
          ? React.createElement(
              "div",
              { className: "neo-pagesel-picker-empty" },
              all.length === 0 ? "加载中…" : "没有匹配的条目",
            )
          : rows.map((r) =>
              React.createElement(
                "label",
                { className: "neo-refmig-row neo-pagesel-targetrow", key: r.id },
                React.createElement("input", {
                  type: "checkbox",
                  checked: sel.has(r.id),
                  onChange: () => toggle(r.id, r.name),
                }),
                React.createElement(
                  "span",
                  { className: "neo-refmig-cell neo-refmig-title" },
                  r.name,
                ),
              ),
            ),
        matched.length > 0 &&
          React.createElement(
            "div",
            { className: "neo-refmig-pager" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "neo-refmig-pagerbtn",
                disabled: pageSel === rows.length,
                onClick: () => rows.forEach((r) => !sel.has(r.id) && toggle(r.id, r.name)),
              },
              "本页全选",
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "neo-refmig-pagerbtn",
                disabled: pageSel === 0,
                onClick: () => rows.forEach((r) => sel.has(r.id) && toggle(r.id, r.name)),
              },
              "本页取消",
            ),
            matched.length > PAGE_SIZE &&
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "neo-refmig-pagerbtn",
                  disabled: cur <= 1,
                  onClick: () => setPage(cur - 1),
                },
                "上一页",
              ),
            React.createElement(
              "span",
              { className: "neo-refmig-pagerinfo" },
              matched.length > PAGE_SIZE
                ? `第 ${cur}/${totalPages} 页 · 共 ${matched.length} 条 · 已选 ${sel.size}`
                : `共 ${matched.length} 条 · 已选 ${sel.size}`,
            ),
            matched.length > PAGE_SIZE &&
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "neo-refmig-pagerbtn",
                  disabled: cur >= totalPages,
                  onClick: () => setPage(cur + 1),
                },
                "下一页",
              ),
          ),
      )
    }

    return React.createElement(
      "div",
      { className: "neo-trash-backdrop", onMouseDown: close },
      React.createElement(
        "div",
        { className: "neo-refmig-pop", onMouseDown: (e: any) => e.stopPropagation() },
        React.createElement(
          "div",
          { className: "neo-trash-head" },
          React.createElement(
            "div",
            { className: "neo-trash-title" },
            `包含于哪些页面 / 标签（已选 ${_selected.size} 个块）`,
          ),
          React.createElement(
            "div",
            { className: "neo-trash-head-tools" },
            React.createElement("button", { className: "neo-trash-sort", onClick: close }, "关闭"),
          ),
        ),
        React.createElement("input", {
          className: "neo-refmig-input",
          placeholder: "搜索页面或标签…",
          value: kw,
          autoFocus: true,
          onChange: (e: any) => setKw(e.target.value),
        }),
        React.createElement(
          "div",
          { className: "neo-refmig-body" },
          renderSection("页面", pages, matchedPages, pagePages, setPagePages),
          renderSection("标签", tags, matchedTags, pageTags, setPageTags),
        ),
        React.createElement(
          "div",
          { className: "neo-refmig-dst neo-pagesel-selbar" },
          React.createElement(
            "div",
            { className: "neo-pagesel-selinfo" },
            sel.size === 0
              ? "勾选一个或多个目标（可跨页、可搜索）——所选块将同时成为这些目标页面的子页面"
              : `已选 ${sel.size} 个目标：${Array.from(sel.values()).slice(0, 3).join("、")}${
                  sel.size > 3 ? ` 等 ${sel.size} 个` : ""
                }`,
          ),
          React.createElement(
            "div",
            { className: "neo-pagesel-selactions" },
            sel.size > 0 &&
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "neo-refmig-pagerbtn",
                  onClick: () => setSel(new Map()),
                },
                "清空选择",
              ),
            React.createElement(
              "button",
              { className: "neo-refmig-go", disabled: sel.size === 0, onClick: apply },
              `包含到所选目标（${sel.size}）`,
            ),
          ),
        ),
      ),
    )
  }
  root.render(React.createElement(Picker))
}

// Cmd/Ctrl+点击条目 → 切换选择（拦截原生打开）
function onClickCapture(e: MouseEvent) {
  if (!(e.metaKey || e.ctrlKey)) return
  const hit = hitOf(e.target)
  if (!hit) return
  e.preventDefault()
  e.stopPropagation()
  if (_selected.has(hit.key)) {
    _selected.delete(hit.key)
    hit.wrap.classList.remove(SEL_CLASS)
  } else {
    _selected.set(hit.key, 0)
    hit.wrap.classList.add(SEL_CLASS)
    void resolveId(hit.spec, hit.key)
  }
  renderBars()
}

async function resolveId(spec: ListSpec, key: string) {
  try {
    let id: number | undefined
    if (spec.nameSel) {
      const maps = await fetchNameIdMaps()
      id = maps[spec.id as "pages" | "tags"].get(key)
    } else {
      id = Number(key.slice(2)) // f:<data-id>
    }
    if (id != null && Number.isFinite(id) && _selected.has(key)) _selected.set(key, id)
  } catch (e) {
    console.warn("[PAGESEL] 解析块 id 失败", key, e)
  }
}

// Esc 清空选择（选择器打开时除外）
function onKeyDownCapture(e: KeyboardEvent) {
  if (e.key === "Escape" && _selected.size > 0 && !_closePicker) {
    clearSelection()
  }
}

// 列表重渲染后重新高亮已选项 + 恢复操作条
function scheduleRefresh() {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(() => {
    _debounce = null
    if (_selected.size === 0) return
    for (const spec of SPECS) {
      document.querySelectorAll(spec.wrapSel).forEach((wrap) => {
        const el = wrap as HTMLElement
        let key = ""
        if (spec.nameSel) key = el.querySelector?.(spec.nameSel)?.textContent?.trim() ?? ""
        else {
          const item = el.matches(spec.itemSel) ? el : el.querySelector(spec.itemSel)
          key = `f:${(item as HTMLElement | null)?.getAttribute("data-id") ?? ""}`
        }
        if (key && _selected.has(key)) el.classList.add(SEL_CLASS)
        else el.classList.remove(SEL_CLASS)
      })
    }
    renderBars()
  }, 200)
}

let _clickHandler: ((e: MouseEvent) => void) | null = null
let _keyHandler: ((e: KeyboardEvent) => void) | null = null

export function installPageBatchSelect() {
  if (_observer) return
  _clickHandler = onClickCapture
  _keyHandler = onKeyDownCapture
  document.addEventListener("click", _clickHandler, true)
  document.addEventListener("keydown", _keyHandler, true)
  _observer = new MutationObserver(scheduleRefresh)
  _observer.observe(document.body, { childList: true, subtree: true })
  // 预热名字→id 缓存，避免首次点「包含于」时等待
  void fetchNameIdMaps()
}

export function disposePageBatchSelect() {
  _observer?.disconnect()
  _observer = null
  if (_clickHandler) document.removeEventListener("click", _clickHandler, true)
  if (_keyHandler) document.removeEventListener("keydown", _keyHandler, true)
  _clickHandler = null
  _keyHandler = null
  _closePicker?.()
  _selected.clear()
  document.querySelectorAll(`.${SEL_CLASS}`).forEach((el) => el.classList.remove(SEL_CLASS))
  document.querySelectorAll(`.${BAR_CLASS}`).forEach((el) => el.remove())
  document.querySelectorAll(`.neo-pagesel-count`).forEach((el) => el.remove())
}

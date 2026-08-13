// 侧边栏多选（页面/标签/收藏）+ 批量改变「包含于」页面
// 用法：按住 Cmd（Mac）/ Ctrl（Windows）点击条目多选（高亮），列表上方出现操作条：
//   「包含于…」打开页面选择器，把所选块整体改包含到目标页面下（改写 _is 属性）；
//   「移到顶层」清空 _is（取消包含）；「取消」清空选择。
// 原生机制（app.asar 逆向）：包含关系 = 块属性 `_is`（PropType.TextChoices=6, typeArgs
// {subType:"multi"}，值为父页面名数组）；原生拖拽 drop 即 push 父名进 _is。
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
  row.appendChild(mkBtn("移到顶层", () => void applyInclude(null)))
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

/** 批量改写 _is：targetName 为 null 表示清空（移到顶层）。 */
async function applyInclude(targetName: string | null): Promise<void> {
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
        [
          {
            name: "_is",
            type: 6, // PropType.TextChoices
            typeArgs: { subType: "multi" },
            value: targetName ? [targetName] : [],
          },
        ],
      )
      ok++
    } catch (e) {
      console.warn("[PAGESEL] 更新 _is 失败", id, e)
    }
  }
  clearSelection()
  orcaG().notify?.("info", `已更新 ${ok} 个块的包含关系`)
}

/** 页面选择器（居中弹窗，列出全部页面，点击即应用）。 */
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

  function Picker() {
    const [pages, setPages] = React.useState<{ name: string; id: number }[]>([])
    const [kw, setKw] = React.useState("")
    React.useEffect(() => {
      fetchNameIdMaps().then(({ pages: m }) => {
        setPages(Array.from(m.entries()).map(([name, id]) => ({ name, id })))
      })
    }, [])
    React.useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") close()
      }
      document.addEventListener("keydown", onKey)
      return () => document.removeEventListener("keydown", onKey)
    }, [])
    const filtered = pages.filter((p) => !kw || p.name.toLowerCase().includes(kw.toLowerCase()))
    const shortOf = (name: string) => name.split("/").pop() ?? name
    return React.createElement(
      "div",
      { className: "neo-trash-backdrop", onMouseDown: close },
      React.createElement(
        "div",
        { className: "neo-pagesel-picker", onMouseDown: (e: any) => e.stopPropagation() },
        React.createElement(
          "div",
          { className: "neo-trash-head" },
          React.createElement("div", { className: "neo-trash-title" }, "包含于哪个页面"),
          React.createElement(
            "div",
            { className: "neo-trash-head-tools" },
            React.createElement("button", { className: "neo-trash-sort", onClick: close }, "关闭"),
          ),
        ),
        React.createElement("input", {
          className: "neo-refmig-input",
          placeholder: "搜索页面…",
          value: kw,
          onChange: (e: any) => setKw(e.target.value),
        }),
        React.createElement(
          "div",
          { className: "neo-pagesel-picker-list" },
          filtered.length === 0
            ? React.createElement("div", { className: "neo-pagesel-picker-empty" }, "没有匹配的页面")
            : filtered.map((p) =>
                React.createElement(
                  "div",
                  {
                    key: p.id,
                    className: "neo-pagesel-picker-item",
                    title: p.name,
                    onClick: () => {
                      close()
                      void applyInclude(p.name)
                    },
                  },
                  React.createElement("div", { className: "neo-pagesel-picker-item-name" }, shortOf(p.name)),
                  React.createElement("div", { className: "neo-pagesel-picker-item-path" }, p.name),
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

// 精细迁移引用弹窗：列出当前块的反链 + 勾选框 + 目标选择 + 批量迁移。
// 复用 trashHeadbar 的全局 React（window.React）+ 独立 React 根 + 居中遮罩模式。
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

import {
  blockExists,
  blockTitle,
  candidateTargets,
  getBacklinks,
  getBlockTitles,
  isTagBlock,
  refTypeLabel,
  repairAllDanglingTags,
  repairBlockTags,
  transferRefs,
  type Backlink,
  type RefMigrateMode,
} from "./refMigrate"

interface RefRow {
  b: Backlink
  title: string
}

const PAGE_SIZE = 50

function RefMigratePop({ srcId, onClose }: { srcId: number; onClose: () => void }) {
  const [rows, setRows] = React.useState<RefRow[]>([])
  const [titles, setTitles] = React.useState<Map<number, string>>(new Map())
  const [checked, setChecked] = React.useState<Set<number>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<string>("")
  const [dstId, setDstId] = React.useState<string>("")
  const [dstChoose, setDstChoose] = React.useState<string>("")
  const [candidates, setCandidates] = React.useState<{ id: number; title: string }[]>([])
  const [srcTitle, setSrcTitle] = React.useState<string>("")
  const [dstMode, setDstMode] = React.useState<string>("")
  const [migMode, setMigMode] = React.useState<RefMigrateMode>("auto")
  const [page, setPage] = React.useState(1)

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  /** 按页批量取标题（一次 IPC 拿一页，避免逐条 get-block）。 */
  const loadTitles = React.useCallback(
    (pageNo: number, all: RefRow[]) => {
      const slice = all.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE)
      const ids = slice.map((r) => r.b.from)
      getBlockTitles(ids).then((m) => {
        setTitles((prev) => {
          const n = new Map(prev)
          m.forEach((v, k) => n.set(k, v))
          return n
        })
      })
    },
    [],
  )

  const refresh = React.useCallback(() => {
    // 顺手修复来源块自身可能存在的悬空 _tags（历史 bug 产生的坏数据会让标签菜单崩溃）
    repairBlockTags(srcId).catch(() => {})
    // 同时后台补一次全局扫描（带冷却，失败/未扫到不影响弹窗）
    repairAllDanglingTags().catch(() => {})
    Promise.all([getBacklinks(srcId), blockTitle(srcId), candidateTargets(srcId)])
      .then(([bls, title, cands]) => {
        setSrcTitle(title)
        const all = bls.map((b) => ({ b, title: "" }))
        setRows(all)
        setTitles(new Map())
        setPage(1)
        // 默认全选
        setChecked(new Set(bls.map((b) => b.id)))
        setCandidates(cands)
        // 只取第一页标题
        loadTitles(1, all)
      })
      .catch((e) => {
        console.warn("[REFMIGRATE] 加载反链失败", e)
        setRows([])
      })
  }, [srcId, loadTitles])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  React.useEffect(() => {
    loadTitles(curPage, rows)
  }, [curPage, rows.length, loadTitles])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const allChecked = rows.length > 0 && checked.size === rows.length
  const someChecked = checked.size > 0 && checked.size < rows.length

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.b.id)))
  }
  function toggleOne(id: number) {
    setChecked((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const targetId = (dstChoose || dstId || "").trim()

  // 目标类型检测：标签 → 转成标签；页面/普通块 → 转成 @引用（仅自动模式展示）
  React.useEffect(() => {
    const tid = Number(targetId)
    if (!Number.isInteger(tid) || tid <= 0) {
      setDstMode("")
      return
    }
    if (migMode !== "auto") {
      setDstMode(migMode === "tag" ? "标签 → 迁移后成为该标签" : "页面/块 → 迁移后成为 @引用")
      return
    }
    let alive = true
    isTagBlock(tid).then((isTag) => {
      if (alive) setDstMode(isTag ? "标签 → 迁移后成为该标签" : "页面/块 → 迁移后成为 @引用")
    })
    return () => {
      alive = false
    }
  }, [targetId, migMode])

  async function onMigrate() {
    if (checked.size === 0) {
      orca.notify?.("info", "请先勾选要迁移的引用")
      return
    }
    const tid = Number(targetId)
    if (!Number.isInteger(tid) || tid <= 0) {
      orca.notify?.("info", "请填写有效的目标块 ID")
      return
    }
    if (!(await blockExists(tid))) {
      orca.notify?.("info", `目标块 ${tid} 不存在`)
      return
    }
    const selected = rows.filter((r) => checked.has(r.b.id)).map((r) => r.b)
    // 大批量时先确认（分批执行，不会卡死，但耗时较长）
    if (selected.length > 200) {
      if (
        !window.confirm(
          `已选 ${selected.length} 条，将按每批 50 条分批迁移（期间会显示进度）。数量较多可能耗时较长，是否继续？`,
        )
      ) {
        return
      }
    }
    setBusy(true)
    setProgress("")
    try {
      const { ok, fail } = await transferRefs(srcId, selected, tid, migMode, (done, total) => {
        setProgress(`迁移中 ${done}/${total}`)
      })
      orca.notify?.("info", `已迁移 ${ok} 条${fail ? `，${fail} 条失败` : ""}`)
      onClose()
    } catch (e: any) {
      orca.notify?.("info", `迁移失败：${e?.message ?? e}`)
    } finally {
      setBusy(false)
      setProgress("")
    }
  }

  return React.createElement(
    "div",
    { className: "neo-trash-backdrop", onMouseDown: onClose },
    React.createElement(
      "div",
      {
        className: "neo-refmig-pop",
        onMouseDown: (e: any) => e.stopPropagation(),
      },
      React.createElement(
        "div",
        { className: "neo-trash-head" },
        React.createElement(
          "div",
          { className: "neo-trash-title" },
          "精细迁移引用",
          React.createElement("span", { className: "neo-refmig-src" }, ` · ${srcTitle || srcId}`),
        ),
        React.createElement(
          "div",
          { className: "neo-trash-head-tools" },
          React.createElement(
            "button",
            { className: "neo-trash-sort", onClick: onClose },
            "关闭",
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: "neo-refmig-body" },
        rows.length === 0
          ? React.createElement("div", { className: "neo-trash-empty" }, "当前块没有反链")
          : React.createElement(
              "div",
              { className: "neo-refmig-list" },
              React.createElement(
                "div",
                { className: "neo-refmig-row neo-refmig-row-head" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: allChecked,
                  ref: (el: any) => {
                    if (el) el.indeterminate = someChecked
                  },
                  onChange: toggleAll,
                }),
                React.createElement("div", { className: "neo-refmig-cell" }, `引用我的（${rows.length}）`),
                React.createElement("div", { className: "neo-refmig-cell neo-refmig-type" }, "类型"),
              ),
              pageRows.map((r) => {
                const id = r.b.id
                return React.createElement(
                  "div",
                  { className: "neo-refmig-row", key: id },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: checked.has(id),
                    onChange: () => toggleOne(id),
                  }),
                  React.createElement(
                    "div",
                    { className: "neo-refmig-cell neo-refmig-title", title: String(r.b.from) },
                    titles.get(r.b.from) || String(r.b.from),
                  ),
                  React.createElement(
                    "div",
                    { className: "neo-refmig-cell neo-refmig-type" },
                    refTypeLabel(r.b.type),
                  ),
                )
              }),
              React.createElement(
                "div",
                { className: "neo-refmig-pager" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "neo-refmig-pagerbtn",
                    disabled: pageRows.every((r) => checked.has(r.b.id)),
                    onClick: () =>
                      setChecked((prev) => {
                        const n = new Set(prev)
                        pageRows.forEach((r) => n.add(r.b.id))
                        return n
                      }),
                  },
                  "本页全选",
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "neo-refmig-pagerbtn",
                    disabled: !pageRows.some((r) => checked.has(r.b.id)),
                    onClick: () =>
                      setChecked((prev) => {
                        const n = new Set(prev)
                        pageRows.forEach((r) => n.delete(r.b.id))
                        return n
                      }),
                  },
                  "本页取消",
                ),
                rows.length > PAGE_SIZE &&
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "neo-refmig-pagerbtn",
                      disabled: curPage <= 1,
                      onClick: () => setPage(curPage - 1),
                    },
                    "上一页",
                  ),
                React.createElement(
                  "span",
                  { className: "neo-refmig-pagerinfo" },
                  rows.length > PAGE_SIZE
                    ? `第 ${curPage}/${totalPages} 页 · 共 ${rows.length} 条 · 已选 ${checked.size}`
                    : `共 ${rows.length} 条 · 已选 ${checked.size}（超过 ${PAGE_SIZE} 条自动分页）`,
                ),
                rows.length > PAGE_SIZE &&
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "neo-refmig-pagerbtn",
                      disabled: curPage >= totalPages,
                      onClick: () => setPage(curPage + 1),
                    },
                    "下一页",
                  ),
              ),
            ),
      ),
      React.createElement(
        "div",
        { className: "neo-refmig-dst" },
        React.createElement(
          "div",
          { className: "neo-refmig-dst-label" },
          "迁移到目标块 ID（或选择下方候选）：",
        ),
        React.createElement("input", {
          className: "neo-refmig-input",
          placeholder: "粘贴目标块 ID，如 2508",
          value: dstId,
          onChange: (e: any) => {
            setDstId(e.target.value)
            setDstChoose("")
          },
        }),
        dstMode &&
          React.createElement(
            "div",
            { className: "neo-refmig-mode" },
            dstMode,
          ),
        React.createElement(
          "div",
          { className: "neo-refmig-modes" },
          [
            ["auto", "自动"],
            ["tag", "转成标签"],
            ["inline", "转成@引用"],
          ].map(([val, label]) =>
            React.createElement(
              "button",
              {
                key: val,
                type: "button",
                className:
                  "neo-refmig-modebtn" + (migMode === val ? " neo-refmig-modebtn-on" : ""),
                onClick: () => setMigMode(val as RefMigrateMode),
              },
              label,
            ),
          ),
        ),
        candidates.length > 0 &&
          React.createElement(
            "div",
            { className: "neo-refmig-cands" },
            candidates.map((c) =>
              React.createElement(
                "label",
                { className: "neo-refmig-cand", key: c.id },
                React.createElement("input", {
                  type: "radio",
                  name: "neo-refmig-dst",
                  checked: dstChoose === String(c.id),
                  onChange: () => {
                    setDstChoose(String(c.id))
                    setDstId("")
                  },
                }),
                React.createElement("span", { title: String(c.id) }, c.title),
              ),
            ),
          ),
      ),
      React.createElement(
        "div",
        { className: "neo-trash-foot" },
        React.createElement(
          "button",
          {
            className: "neo-refmig-go",
            disabled: busy || checked.size === 0,
            onClick: onMigrate,
          },
          busy ? (progress || "迁移中…") : `迁移选中（${checked.size}）`,
        ),
      ),
    ),
  )
}

/** 打开精细迁移引用弹窗（独立 React 根，body 挂载）。返回关闭函数。 */
export function openRefMigrateDialog(srcId: number): () => void {
  ensureGlobals()
  const host = document.createElement("div")
  host.className = "neo-refmig-host"
  document.body.appendChild(host)
  let root: any
  try {
    root = ReactDOM.createRoot(host)
  } catch {
    root = (ReactDOM as any).unstable_createRoot?.(host) ?? null
    if (!root) {
      // 极旧 React 兜底
      root = { render: (el: any) => ReactDOM.render(el, host), unmount: () => ReactDOM.unmountComponentAtNode(host) }
    }
  }
  const close = () => {
    try {
      root.unmount()
    } catch {
      ReactDOM.unmountComponentAtNode?.(host)
    }
    host.remove()
  }
  try {
    root.render(React.createElement(RefMigratePop, { srcId, onClose: close }))
  } catch (e: any) {
    host.remove()
    try {
      orca.notify?.("error", `精细迁移弹窗渲染失败：${e?.message ?? e}`)
    } catch {
      /* ignore */
    }
    console.error("[REFMIGRATE] render error", e)
  }
  return close
}

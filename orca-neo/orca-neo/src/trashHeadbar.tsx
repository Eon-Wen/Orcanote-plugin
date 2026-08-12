// 「回收站」浮层面板：由右上角三点菜单里的「回收站」条目唤起（见 trashMenuInject.ts）。
// 面板挂在 body 上的独立 React 根，定位在三点菜单正下方；点击外部 / Esc / ✕ 关闭。
// 复用 headbar.tsx 的全局 React（window.React）模式——orca-neo 的 vite 把 react 设为 external。
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
  clearAll,
  listTrash,
  purgeOne,
  restorePage,
  type TrashItem,
} from "./trash"

function fmtDate(ts: number): string {
  try {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch {
    return ""
  }
}

function remainingText(remainingMs: number): string {
  const days = remainingMs / 86400000
  if (days <= 0) return "今天过期"
  if (days < 1) return "剩不到 1 天"
  return `剩 ${Math.ceil(days)} 天`
}

/** 面板主体：居中大弹窗；点背景 / Esc / ✕ 关闭。 */
function TrashPop({ onClose }: { onClose: () => void }) {
  const [items, setItems] = React.useState<(TrashItem & { remainingMs: number })[]>([])
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(() => {
    listTrash()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  // Esc 关闭（点背景关闭由遮罩层的 onMouseDown 处理）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  async function onRestore(pageId: number) {
    setBusy(true)
    try {
      await restorePage(pageId)
      refresh()
    } catch (e: any) {
      orca.notify?.("error", `恢复失败：${e?.message ?? e}`, { title: "回收站" })
    } finally {
      setBusy(false)
    }
  }

  async function onPurge(pageId: number) {
    setBusy(true)
    try {
      await purgeOne(pageId)
      refresh()
    } catch (e: any) {
      orca.notify?.("error", `删除失败：${e?.message ?? e}`, { title: "回收站" })
    } finally {
      setBusy(false)
    }
  }

  async function onClearAll() {
    if (items.length === 0) return
    if (!window.confirm(`确定清空回收站？共 ${items.length} 项将被永久删除，不可恢复。`)) return
    setBusy(true)
    try {
      await clearAll()
      refresh()
    } catch (e: any) {
      orca.notify?.("error", `清空失败：${e?.message ?? e}`, { title: "回收站" })
    } finally {
      setBusy(false)
    }
  }

  // 排序：remainingAsc = 按剩余保留时长（即将过期在前）；deletedDesc = 按删除时间倒序（最近删除在前）
  const [sortMode, setSortMode] = React.useState<"deletedDesc" | "remainingAsc">("deletedDesc")
  const sorted = React.useMemo(() => {
    const arr = [...items]
    if (sortMode === "remainingAsc") arr.sort((a, b) => a.remainingMs - b.remainingMs)
    else arr.sort((a, b) => b.deletedAt - a.deletedAt)
    return arr
  }, [items, sortMode])

  return (
    <div className="neo-trash-backdrop" onMouseDown={onClose}>
      <div className="neo-trash-pop" onMouseDown={(e: any) => e.stopPropagation()}>
        <div className="neo-trash-head">
          <span>回收站</span>
          <div className="neo-trash-head-tools">
            <button
              className="neo-trash-sort"
              title="切换排序方式"
              onClick={() =>
                setSortMode((m) => (m === "deletedDesc" ? "remainingAsc" : "deletedDesc"))
              }
            >
              {sortMode === "deletedDesc" ? "删除时间倒序 ↓" : "剩余时长 ↑"}
            </button>
            <span className="neo-trash-close" onClick={onClose}>
              ✕
            </span>
          </div>
        </div>

      <div className="neo-trash-body">
        {sorted.length === 0 && <div className="neo-trash-empty">回收站为空</div>}
        {sorted.map((it) => (
          <div className="neo-trash-row" key={it.pageId}>
            <div className="neo-trash-meta">
              <div className="neo-trash-title" title={it.title}>
                {it.title || "(无标题)"}
              </div>
              <div className="neo-trash-sub">
                {fmtDate(it.deletedAt)} · {remainingText(it.remainingMs)}
              </div>
            </div>
            <div className="neo-trash-actions">
              <button
                className="neo-trash-act"
                disabled={busy}
                onClick={() => onRestore(it.pageId)}
              >
                恢复
              </button>
              <button
                className="neo-trash-act danger"
                disabled={busy}
                onClick={() => onPurge(it.pageId)}
              >
                彻底删除
              </button>
            </div>
          </div>
        ))}
      </div>

        <div className="neo-trash-foot">
          <button
            className="neo-trash-act danger"
            disabled={busy || items.length === 0}
            onClick={onClearAll}
          >
            清空回收站
          </button>
        </div>
      </div>
    </div>
  )
}

function TrashFloating({ onClose }: { onClose: () => void }) {
  return ReactDOM.createPortal(<TrashPop onClose={onClose} />, document.body)
}

/** 打开居中的回收站弹窗；返回关闭函数。 */
export function openTrashFloating(): () => void {
  ensureGlobals()
  const host = document.createElement("div")
  document.body.appendChild(host)
  let closed = false
  let modernRoot: any = null

  const close = () => {
    if (closed) return
    closed = true
    try {
      if (modernRoot) modernRoot.unmount()
      else ReactDOM.unmountComponentAtNode(host)
    } catch {
      /* ignore */
    }
    host.remove()
  }

  try {
    const el = React.createElement(TrashFloating, { onClose: close })
    if (typeof ReactDOM.createRoot === "function") {
      modernRoot = ReactDOM.createRoot(host)
      modernRoot.render(el)
    } else {
      ReactDOM.render(el, host)
    }
  } catch (e) {
    console.error("[TRASH] 打开回收站浮层失败：", e)
    close()
  }
  return close
}

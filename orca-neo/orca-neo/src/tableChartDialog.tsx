// 「表格转统计图」配置弹窗：左侧表单 + 右侧实时图表预览。
// 挂 body 的独立 React 根（参照 trashHeadbar.tsx）：遮罩点击 / Esc / ✕ 关闭。
// 图表配置交互移植自 famotime/siyuan-table-master：X 列下拉、Y 列多选（饼图单选）、
// 变更即刷新预览。图表为自绘 SVG（零依赖，见 tableChart.ts 说明），直接以字符串
// 写入预览容器；导出 PNG 走 SVG → canvas → toDataURL。
// 「插入到笔记」：把当前配置写进表格块 _chart 属性（内嵌渲染见 chartEmbed.ts）。
import {
  buildChartModel,
  readTableData,
  renderChartSvg,
  type ChartType,
  type ChartModel,
  type TableData,
} from "./tableChart"
import {
  insertChartBlock,
  setChartOfBlock,
  updateChartOfBlock,
  type ChartConfig,
} from "./chartBlock"

let React: any
let ReactDOM: any

function ensureGlobals() {
  if (React) return
  const g = window as unknown as { React: any; ReactDOM: any }
  React = g.React
  ReactDOM = g.ReactDOM
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "柱状图" },
  { value: "line", label: "折线图" },
  { value: "pie", label: "饼图" },
]

function ChartDialog({
  tableId,
  initial,
  onClose,
}: {
  tableId: number
  initial: ChartConfig | null
  onClose: () => void
}) {
  const [data, setData] = React.useState<TableData | null>(null)
  const [error, setError] = React.useState("")
  const [title, setTitle] = React.useState(initial?.title ?? "")
  const [type, setType] = React.useState<ChartType>(initial?.type ?? "bar")
  const [xIdx, setXIdx] = React.useState(initial?.xIdx ?? 0)
  const [yIdxs, setYIdxs] = React.useState<number[]>(initial?.yIdxs ?? [])
  const previewRef = React.useRef<HTMLDivElement | null>(null)

  // 读表格数据（挂载时一次；每次打开都反映当前表格内容）
  React.useEffect(() => {
    let alive = true
    readTableData(tableId)
      .then((d) => {
        if (!alive) return
        setData(d)
        // 无 initial（新建图表）时：默认 X=第 0 列、Y=第 1 列（与参考插件一致）
        if (!initial) {
          setYIdxs(d.headers.length > 1 ? [1] : [0])
        }
      })
      .catch((e: any) => {
        if (alive) setError(String(e?.message ?? e))
      })
    return () => {
      alive = false
    }
  }, [tableId, initial])

  // Esc 关闭
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // 图表模型：任一配置变化即重建
  const model: ChartModel | null = React.useMemo(() => {
    if (!data || yIdxs.length === 0) return null
    return buildChartModel({
      title,
      type,
      xColumnIndex: xIdx,
      yColumnIndexes: yIdxs,
      headers: data.headers,
      rows: data.rows,
    })
  }, [data, title, type, xIdx, yIdxs])

  // 实时预览：模型变化 → 重新渲染 SVG 到预览容器
  React.useEffect(() => {
    if (!model || !previewRef.current) return
    previewRef.current.innerHTML = renderChartSvg(model)
  }, [model])

  // 切到饼图时 Y 只保留一个（饼图单选）
  const changeType = (v: ChartType) => {
    setType(v)
    if (v === "pie" && yIdxs.length > 1) setYIdxs((prev) => prev.slice(0, 1))
  }

  const toggleY = (i: number) => {
    setYIdxs((prev) => {
      if (type === "pie") {
        return prev.includes(i) ? [] : [i]
      }
      return prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    })
  }

  /** SVG → canvas → PNG 下载（canvas 只在点击时创建，弹窗环境必有 DOM）。 */
  const onExport = () => {
    if (!model) return
    const svg = renderChartSvg(model)
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = 1440
        canvas.height = 840
        const ctx = canvas.getContext("2d")
        if (ctx) {
          const bg =
            getComputedStyle(document.documentElement)
              .getPropertyValue("--neo-menu-bg")
              .trim() || "#ffffff"
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const a = document.createElement("a")
          a.href = canvas.toDataURL("image/png")
          a.download = `${title.trim() || "数据图表"}.png`
          a.click()
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  /** 插入/更新到笔记：生成图片块写到表格下方（图表真块化），成功后关闭。 */
  const onInsert = async () => {
    if (yIdxs.length === 0) return
    const cfg = {
      type,
      xIdx,
      yIdxs: type === "pie" ? yIdxs.slice(0, 1) : yIdxs,
      title: title.trim(),
    }
    if (initial) {
      // 更新已有图表：删旧块 + 插新块
      await updateChartOfBlock(tableId, cfg)
    } else {
      const r = await insertChartBlock(tableId, cfg)
      if (r) {
        await setChartOfBlock(tableId, {
          ...cfg,
          chartBlockId: r.chartBlockId,
          src: r.src,
        })
      }
    }
    onClose()
  }

  return (
    <div className="neo-chart-backdrop" onMouseDown={onClose}>
      <div className="neo-chart-pop" onMouseDown={(e: any) => e.stopPropagation()}>
        <div className="neo-chart-head">
          <span>数据图表</span>
          <span className="neo-chart-close" onClick={onClose}>
            ✕
          </span>
        </div>

        {error ? (
          <div className="neo-chart-error">{error}</div>
        ) : !data ? (
          <div className="neo-chart-loading">正在读取表格数据…</div>
        ) : (
          <div className="neo-chart-body">
            <div className="neo-chart-form">
              <label className="neo-chart-field">
                <span className="neo-chart-label">图表标题</span>
                <input
                  className="neo-chart-input"
                  type="text"
                  placeholder="输入图表标题…"
                  value={title}
                  onChange={(e: any) => setTitle(e.target.value)}
                />
              </label>

              <label className="neo-chart-field">
                <span className="neo-chart-label">图表类型</span>
                <select
                  className="neo-chart-input"
                  value={type}
                  onChange={(e: any) => changeType(e.target.value as ChartType)}
                >
                  {CHART_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="neo-chart-field">
                <span className="neo-chart-label">X 轴（类目/时间）</span>
                <select
                  className="neo-chart-input"
                  value={xIdx}
                  onChange={(e: any) => setXIdx(parseInt(e.target.value, 10))}
                >
                  {data.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `列 ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              <div className="neo-chart-field">
                <span className="neo-chart-label">
                  Y 轴（数值{type === "pie" ? "，饼图单选" : "，可多选"}）
                </span>
                <div className="neo-chart-ycols">
                  {data.headers.map((h, i) => (
                    <label key={i} className="neo-chart-ycol">
                      <input type="checkbox" checked={yIdxs.includes(i)} onChange={() => toggleY(i)} />
                      <span>{h || `列 ${i + 1}`}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="neo-chart-foot">
                <button className="neo-chart-btn" onClick={onExport} disabled={yIdxs.length === 0}>
                  导出 PNG
                </button>
                <button className="neo-chart-btn primary" onClick={onInsert} disabled={yIdxs.length === 0}>
                  {initial ? "更新图表" : "插入到笔记"}
                </button>
                <button className="neo-chart-btn" onClick={onClose}>
                  关闭
                </button>
              </div>
            </div>

            <div className="neo-chart-preview">
              <div className="neo-chart-canvas" ref={previewRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 打开表格转统计图弹窗。initial 非空 = 更新已有图表（预填配置）。 */
export function openTableChartDialog(tableId: number, initial: ChartConfig | null = null): void {
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
    const el = React.createElement(ChartDialog, { tableId, initial, onClose: close })
    if (typeof ReactDOM.createRoot === "function") {
      modernRoot = ReactDOM.createRoot(host)
      modernRoot.render(el)
    } else {
      ReactDOM.render(el, host)
    }
  } catch (e) {
    console.error("[CHART] 打开数据图表弹窗失败：", e)
    close()
  }
}

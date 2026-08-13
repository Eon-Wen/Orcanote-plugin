// 内嵌图表：表格块带 _chart 属性（JSON 配置）→ 在表格块正下方渲染 SVG 图表，
// 持久化跟文档走（属性机制同列表视图的 _lv）。注入的容器节点会被 React 重渲染
// 抹掉 → body 观察器（200ms 防抖）每轮「按需补回」；写 DOM 前做 SVG hash 比较
// （MutationObserver 铁律①：值变化才写，防自触发循环）。表格数据或主题色变化 →
// 重新生成 SVG → hash 不同 → 才更新。主题/调色板切换会改 html 的 class/style
// 属性，另挂一个属性观察器触发重渲染（颜色是烘焙进 SVG 的，必须重画）。
import {
  buildChartModel,
  isTableBlock,
  readTableData,
  renderChartSvg,
  type ChartType,
} from "./tableChart"

const EMBED_PROP = "_chart"
const EMBED_CLASS = "neo-chart-embed"

export interface ChartConfig {
  type: ChartType
  xIdx: number
  yIdxs: number[]
  title: string
}

let _orca: any = null
function orca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}

/** 读某表格块的内嵌图表配置（无/损坏返回 null）。 */
export function chartOfBlock(blockId: number): ChartConfig | null {
  const b = orca().state?.blocks?.[blockId]
  const v = b?.properties?.find((p: any) => p.name === EMBED_PROP)?.value
  if (typeof v !== "string" || !v) return null
  try {
    const c = JSON.parse(v)
    if (!c || typeof c !== "object") return null
    const type: ChartType = c.type === "pie" || c.type === "line" ? c.type : "bar"
    const xIdx = Number.isInteger(c.xIdx) ? (c.xIdx as number) : 0
    const yIdxs = Array.isArray(c.yIdxs) ? (c.yIdxs as number[]).filter((n) => Number.isInteger(n)) : []
    return { type, xIdx, yIdxs, title: typeof c.title === "string" ? c.title : "" }
  } catch {
    return null
  }
}

/** 写内嵌图表配置（type: 1 = Text，value 必须字符串，SQLite bind 教训）。 */
export async function setChartOfBlock(blockId: number, config: ChartConfig): Promise<void> {
  try {
    await orca().commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [blockId],
      [{ name: EMBED_PROP, type: 1 /* Text */, value: JSON.stringify(config) }],
    )
  } catch (e) {
    console.warn("[CHART] 写 _chart 失败", e)
  }
}

/** 删除内嵌图表配置并清掉当前 DOM 里的图表容器。 */
export async function removeChartOfBlock(blockId: number): Promise<void> {
  try {
    await orca().commands.invokeEditorCommand(
      "core.editor.deleteProperties",
      null,
      [blockId],
      [EMBED_PROP],
    )
  } catch (e) {
    console.warn("[CHART] 删 _chart 失败", e)
  }
  document
    .querySelectorAll(`.orca-block[data-id="${blockId}"] + .${EMBED_CLASS}`)
    .forEach((el) => el.remove())
}

/** 简单字符串 hash（写 DOM 前的值变化判断用）。 */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${h >>> 0}_${s.length}`
}

// in-flight 去重：一个块同一时刻只读一次表（观察器可能连续触发）
const _inflight = new Set<number>()

/** 渲染某表格块的内嵌图表（确保容器存在 → 读表 → 生成 SVG → hash 判断后写入）。 */
async function renderEmbed(blockId: number): Promise<void> {
  if (_inflight.has(blockId)) return
  _inflight.add(blockId)
  try {
    const cfg = chartOfBlock(blockId)
    const tableEl = document.querySelector(`.orca-block[data-id="${blockId}"]`) as HTMLElement | null
    if (!tableEl) return

    // 容器必须紧跟表格块
    let container = tableEl.nextElementSibling as HTMLElement | null
    if (!(container instanceof HTMLElement) || !container.classList.contains(EMBED_CLASS)) {
      if (container?.classList?.contains(EMBED_CLASS)) container.remove()
      container = document.createElement("div")
      container.className = EMBED_CLASS
      tableEl.insertAdjacentElement("afterend", container)
    }

    if (!cfg || cfg.yIdxs.length === 0) {
      container.remove()
      return
    }

    try {
      const data = await readTableData(blockId)
      const model = buildChartModel({
        title: cfg.title,
        type: cfg.type,
        xColumnIndex: cfg.xIdx,
        yColumnIndexes: cfg.yIdxs,
        headers: data.headers,
        rows: data.rows,
      })
      const svg = renderChartSvg(model)
      const h = hash(svg)
      // 铁律①：hash 相同不写，防观察器自触发循环
      if (container.dataset.svgHash !== h) {
        container.dataset.svgHash = h
        container.innerHTML = svg
      }
    } catch {
      // 表格数据不足等：保留旧图/空容器，不报错
    }
  } finally {
    _inflight.delete(blockId)
  }
}

/** 扫一遍：渲染所有带 _chart 的表格块；清理孤儿容器（前一块不是表格/已无配置）。 */
function sweep(): void {
  const state = orca().state?.blocks ?? {}
  const charted = new Set<number>()
  for (const key of Object.keys(state)) {
    const id = Number(key)
    if (!Number.isFinite(id)) continue
    const b = state[key]
    const has = Array.isArray(b?.properties) && b.properties.some((p: any) => p.name === EMBED_PROP)
    if (has && isTableBlock(id)) {
      charted.add(id)
      void renderEmbed(id)
    }
  }
  document.querySelectorAll("." + EMBED_CLASS).forEach((container) => {
    const prev = container.previousElementSibling as HTMLElement | null
    const tableId = Number(prev?.getAttribute?.("data-id"))
    if (!Number.isFinite(tableId) || !charted.has(tableId)) container.remove()
  })
}

let _bodyObserver: MutationObserver | null = null
let _attrObserver: MutationObserver | null = null
let _timer: ReturnType<typeof setTimeout> | null = null

function schedule() {
  if (_timer != null) return
  _timer = setTimeout(() => {
    _timer = null
    sweep()
  }, 200) // 铁律②：body 级观察器必须防抖
}

export function installChartEmbed() {
  if (_bodyObserver) return
  _bodyObserver = new MutationObserver(() => schedule())
  _bodyObserver.observe(document.body, { childList: true, subtree: true })
  // 主题/调色板切换会改 html 的 class/style 属性 → 重画图表（SVG 颜色已烘焙）
  _attrObserver = new MutationObserver(() => schedule())
  _attrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  })
  schedule()
}

export function disposeChartEmbed() {
  _bodyObserver?.disconnect()
  _bodyObserver = null
  _attrObserver?.disconnect()
  _attrObserver = null
  if (_timer != null) {
    clearTimeout(_timer)
    _timer = null
  }
  document.querySelectorAll("." + EMBED_CLASS).forEach((el) => el.remove())
}

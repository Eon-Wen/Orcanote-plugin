// 表格转统计图核心：读虎鲸 table2 块数据 → 生成 SVG 图表。
// 虎鲸表格模型（SQLite 诊断确认）：table2 块 → 子块=行（空壳 text）→ 孙块=单元格
// （空壳 text）→ 曾孙块=单元格内容（普通富文本块）。第一行即表头（虎鲸没有
// markdown 的分隔行概念）。get-block 返回的 children 是【子块 id 数组】（非嵌套，
// 见 refMigrate.ts 用法），故按 行→格→内容 三层批量 get-blocks 读取。
// 图表渲染：自绘 SVG（零依赖）。echarts 5/6 打包进虎鲸插件都会导致整个插件
// 加载失败（2026-08-13 实测，Neo 主题整体消失），故禁用；本文件顶层只有纯函数
// 与常量定义、绝不碰 DOM（themeColors 在函数内才读运行时变量）。
// 配置逻辑移植自思源插件 famotime/siyuan-table-master（table-to-chart.ts）：
// 柱状/折线/饼、百分比列检测、数值解析。

export type ChartType = "bar" | "line" | "pie"

let _orca: any = null
function orca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}

function ib(): (msg: string, ...args: any[]) => Promise<any> {
  return orca().invokeBackend.bind(orca())
}

/** 块是否为表格块（repr type=table2）。DOM 的 data-type 对表格块不可靠（asar 里
   未见 data-type="table2"），故只认 state 里的 _repr。 */
export function isTableBlock(blockId: number): boolean {
  const b = orca().state?.blocks?.[blockId]
  const repr = b?.properties?.find((p: any) => p.name === "_repr")?.value
  return repr?.type === "table2"
}

/** 沿 state 的 parent 链向上找最近的表格块 id（右键可能落在单元格里的内容块上）。 */
export function nearestTableBlockId(blockId: number): number | null {
  let cur: any = orca().state?.blocks?.[blockId]
  let guard = 0
  while (cur && guard++ < 20) {
    const repr = cur?.properties?.find((p: any) => p.name === "_repr")?.value
    if (repr?.type === "table2") return cur.id
    if (cur.parent == null) break
    cur = orca().state?.blocks?.[cur.parent]
  }
  return null
}

export interface TableData {
  headers: string[]
  rows: string[][] // 数据行（不含表头行）
}

/** 读表格数据：表头 = 第一行；数据行 = 其余行。 */
export async function readTableData(tableId: number): Promise<TableData> {
  const table = await ib()("get-block", tableId)
  const rowIds: number[] = table?.children ?? []
  if (rowIds.length < 2) {
    throw new Error("表格数据不足：至少需要表头 + 一行数据")
  }

  // get-blocks 返回顺序不保证与入参一致，统一按 id 归位、按 rowIds 排序
  const rowBlocks = await ib()("get-blocks", rowIds)
  const rowOf = new Map<number, any>()
  for (const r of rowBlocks ?? []) rowOf.set(r.id, r)
  const rows = rowIds.map((id) => rowOf.get(id)).filter(Boolean)

  const cellIds: number[] = []
  for (const r of rows) cellIds.push(...(r?.children ?? []))
  const cellBlocks = await ib()("get-blocks", cellIds)
  const cellOf = new Map<number, any>()
  for (const c of cellBlocks ?? []) cellOf.set(c.id, c)

  const contentIds: number[] = []
  for (const c of cellBlocks ?? []) contentIds.push(...(c?.children ?? []))
  const contentBlocks = await ib()("get-blocks", contentIds)
  const textOf = new Map<number, string>()
  for (const c of contentBlocks ?? []) textOf.set(c.id, String(c?.text ?? ""))

  // 单元格文字 = 其内容子块的 text 拼接（text 自带尾换行，需 trim）
  const cellTexts = (cell: any): string =>
    (cell?.children ?? [])
      .map((id: number) => (textOf.get(id) ?? "").trim())
      .filter(Boolean)
      .join(" ")

  const rowTexts: string[][] = rows.map((r) =>
    (r?.children ?? []).map((cid: number) => cellTexts(cellOf.get(cid))),
  )

  if (rowTexts.length === 0 || rowTexts[0].length === 0) {
    throw new Error("表格为空，无法生成图表")
  }
  return { headers: rowTexts[0], rows: rowTexts.slice(1) }
}

/** 数值解析：去千分位/货币符号/%/非数字单位，失败归 0。 */
function sanitizeValue(v: string | null | undefined): number {
  if (v == null) return 0
  const s = String(v).trim()
  if (s === "" || s === "-" || s === "—") return 0
  const cleaned = s
    .replace(/,/g, "")
    .replace(/[￥¥$€£]/g, "")
    .replace(/%/g, "")
    .replace(/[^\d.\-+]/g, "")
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** 系列色与文字色：跟随 Neo 主题运行时变量，天然适配明暗模式。 */
function themeColors(): { palette: string[]; text: string } {
  const cs = getComputedStyle(document.documentElement)
  const palette: string[] = []
  for (const v of ["--neo-x-accent", "--neo-x-primary", "--neo-x-base-color"]) {
    const c = cs.getPropertyValue(v).trim()
    if (c) palette.push(c)
  }
  // 主题变量不足时补固定柔和系列色（与 confetti 的 COLORS 同款）
  for (const c of ["#FF6B6B", "#4ECDC4", "#FFE66D", "#95E1D3", "#F38181", "#AA96DA"]) {
    if (!palette.includes(c)) palette.push(c)
  }
  const text = getComputedStyle(document.body).color || "#333"
  return { palette, text }
}

// ---------------------------------------------------------------------------
// 图表数据模型与 SVG 生成
// ---------------------------------------------------------------------------

export interface ChartModel {
  title: string
  type: ChartType
  xData: string[]
  series: { name: string; percent: boolean; data: number[] }[]
  colors: string[]
  text: string
}

/** 由表格数据 + 用户配置构建图表模型（含百分比列检测，移植自参考插件）。 */
export function buildChartModel(config: {
  title: string
  type: ChartType
  xColumnIndex: number
  yColumnIndexes: number[]
  headers: string[]
  rows: string[][]
}): ChartModel {
  const { palette, text } = themeColors()
  const xData = config.rows.map((row) => row[config.xColumnIndex]?.trim() || "")

  const isPercentCol = (colIdx: number): boolean => {
    const nonMock = config.rows.filter((row) => row[colIdx] && row[colIdx].trim() !== "")
    if (nonMock.length === 0) return false
    let percentCount = 0
    for (const row of nonMock) {
      if (row[colIdx].trim().endsWith("%")) percentCount++
    }
    return percentCount / nonMock.length >= 0.5
  }

  const series = config.yColumnIndexes.map((idx) => ({
    name: config.headers[idx] || `列 ${idx + 1}`,
    percent: isPercentCol(idx),
    data: config.rows.map((row) => sanitizeValue(row[idx])),
  }))

  return { title: config.title || "数据图表", type: config.type, xData, series, colors: palette, text }
}

export function renderChartSvg(m: ChartModel): string {
  if (m.type === "pie") return renderPie(m)
  if (m.type === "line") return renderLine(m)
  return renderBar(m)
}

// 画布尺寸与留白
const VIEW_W = 720
const VIEW_H = 420
const PX = 52 // 左侧 Y 轴刻度区
const PY = 44 // 顶部（标题 + 图例行）
const PW = VIEW_W - PX - 16
const PH = VIEW_H - PY - 58 // 底部留给 X 轴标签

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function short(s: string, n = 8): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}

/** Y 轴刻度上限：向 1/2/5×10^n 取整。 */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  const f = v / base
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nf * base
}

function fmtTick(v: number, pct: boolean): string {
  if (pct) return Math.round(v) + "%"
  if (v >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + "万"
  return String(Math.round(v * 10) / 10)
}

function fmtVal(v: number, pct: boolean): string {
  if (pct) return Math.round(v) + "%"
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
}

/** 标题行 + 多系列图例行（柱状/折线共用）。 */
function renderHead(m: ChartModel, svg: string): string {
  let out = svg
  out += `<text x="${VIEW_W / 2}" y="16" text-anchor="middle" font-size="15" font-weight="600" fill="${esc(m.text)}">${esc(m.title)}</text>`
  if (m.series.length > 1) {
    let x = PX
    m.series.forEach((s, i) => {
      const c = m.colors[i % m.colors.length]
      out += `<rect x="${x}" y="25" width="10" height="10" rx="2" fill="${c}"/>`
      out += `<text x="${x + 14}" y="34" font-size="11" fill="${esc(m.text)}" opacity="0.85">${esc(short(s.name, 12))}</text>`
      x += 14 + Math.min(s.name.length, 12) * 12 + 18
    })
  }
  return out
}

/** Y 轴网格线 + 刻度（柱状/折线共用）。 */
function renderYGrid(maxV: number, pct: boolean, svg: string, text: string): string {
  let out = svg
  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i) / 4
    const y = PY + PH - (PH * i) / 4
    out += `<line x1="${PX}" y1="${y.toFixed(1)}" x2="${PX + PW}" y2="${y.toFixed(1)}" stroke="${esc(text)}" stroke-opacity="0.12"/>`
    out += `<text x="${PX - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${esc(text)}" opacity="0.75">${fmtTick(v, pct)}</text>`
  }
  return out
}

function renderBar(m: ChartModel): string {
  const allPct = m.series.every((s) => s.percent)
  const maxV = niceMax(Math.max(...m.series.flatMap((s) => s.data), 1))
  let svg = `<svg class="neo-chart-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" role="img">`
  svg = renderHead(m, svg)
  svg = renderYGrid(maxV, allPct, svg, m.text)

  const n = m.series.length
  const groupW = PW / Math.max(m.xData.length, 1)
  const barW = Math.min(28, (groupW * 0.72) / n)
  const totalW = barW * n + 2 * (n - 1)
  const showValueText = m.xData.length * n <= 24 // 柱子太多时不画值文字，防拥挤

  m.series.forEach((s, si) => {
    const c = m.colors[si % m.colors.length]
    s.data.forEach((v, xi) => {
      const h = maxV > 0 ? (Math.max(v, 0) / maxV) * PH : 0
      const x0 = PX + xi * groupW + (groupW - totalW) / 2 + si * (barW + 2)
      const y0 = PY + PH - h
      svg += `<rect class="neo-chart-bar" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 0.8).toFixed(1)}" rx="2" fill="${c}"><title>${esc(s.name)}：${fmtVal(v, s.percent)}</title></rect>`
      if (v > 0 && showValueText) {
        svg += `<text x="${(x0 + barW / 2).toFixed(1)}" y="${(y0 - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${esc(m.text)}" opacity="0.85">${fmtVal(v, s.percent)}</text>`
      }
    })
  })

  // X 轴类目标签（>12 个时隔步显示，避免重叠）
  const step = Math.ceil(m.xData.length / 12)
  m.xData.forEach((x, xi) => {
    if (xi % step !== 0 && xi !== m.xData.length - 1) return
    const cx = PX + xi * groupW + groupW / 2
    svg += `<text x="${cx.toFixed(1)}" y="${PY + PH + 16}" text-anchor="middle" font-size="11" fill="${esc(m.text)}" opacity="0.85">${esc(short(x))}</text>`
  })

  return svg + `</svg>`
}

function renderLine(m: ChartModel): string {
  const allPct = m.series.every((s) => s.percent)
  const maxV = niceMax(Math.max(...m.series.flatMap((s) => s.data), 1))
  let svg = `<svg class="neo-chart-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" role="img">`
  svg = renderHead(m, svg)
  svg = renderYGrid(maxV, allPct, svg, m.text)

  const groupW = PW / Math.max(m.xData.length - 1, 1)
  m.series.forEach((s, si) => {
    const c = m.colors[si % m.colors.length]
    const pts = s.data.map((v, xi) => {
      const x = PX + xi * groupW
      const y = PY + PH - (Math.max(v, 0) / maxV) * PH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    svg += `<polyline class="neo-chart-line" points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    s.data.forEach((v, xi) => {
      const x = PX + xi * groupW
      const y = PY + PH - (Math.max(v, 0) / maxV) * PH
      svg += `<circle class="neo-chart-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${c}"><title>${esc(m.xData[xi] || `数据 ${xi + 1}`)} · ${esc(s.name)}：${fmtVal(v, s.percent)}</title></circle>`
    })
  })

  const step = Math.ceil(m.xData.length / 12)
  m.xData.forEach((x, xi) => {
    if (xi % step !== 0 && xi !== m.xData.length - 1) return
    const cx = PX + xi * groupW
    svg += `<text x="${cx.toFixed(1)}" y="${PY + PH + 16}" text-anchor="middle" font-size="11" fill="${esc(m.text)}" opacity="0.85">${esc(short(x))}</text>`
  })

  return svg + `</svg>`
}

function renderPie(m: ChartModel): string {
  const s = m.series[0]
  if (!s) return ""
  const cx = 300
  const cy = 210
  const r = 140
  const total = s.data.reduce((a, b) => a + Math.max(b, 0), 0)

  let svg = `<svg class="neo-chart-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" role="img">`
  svg += `<text x="${VIEW_W / 2}" y="16" text-anchor="middle" font-size="15" font-weight="600" fill="${esc(m.text)}">${esc(m.title)}</text>`
  svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="11" fill="${esc(m.text)}" opacity="0.7">${esc(short(s.name, 20))}</text>`

  let angle = -Math.PI / 2
  if (total <= 0) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${esc(m.text)}" stroke-opacity="0.15"/>`
  } else {
    s.data.forEach((v, i) => {
      const frac = Math.max(v, 0) / total
      const a0 = angle
      const a1 = angle + frac * Math.PI * 2
      const large = frac > 0.5 ? 1 : 0
      const x0 = cx + r * Math.cos(a0)
      const y0 = cy + r * Math.sin(a0)
      const x1 = cx + r * Math.cos(a1)
      const y1 = cy + r * Math.sin(a1)
      const c = m.colors[i % m.colors.length]
      const name = m.xData[i] || `数据 ${i + 1}`
      svg += `<path class="neo-chart-slice" d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${c}"><title>${esc(name)}：${fmtVal(v, s.percent)}（${Math.round(frac * 100)}%）</title></path>`
      angle = a1
    })
  }

  // 右侧图例：色块 + 名称 + 百分比（最多 11 项，超出省略）
  let ly = 60
  const maxItems = 11
  const items = Math.min(s.data.length, maxItems)
  for (let i = 0; i < items; i++) {
    const c = m.colors[i % m.colors.length]
    const name = m.xData[i] || `数据 ${i + 1}`
    const frac = total > 0 ? Math.max(s.data[i], 0) / total : 0
    svg += `<rect x="470" y="${ly}" width="10" height="10" rx="2" fill="${c}"/>`
    svg += `<text x="486" y="${ly + 10}" font-size="12" fill="${esc(m.text)}">${esc(short(name, 16))} · ${Math.round(frac * 100)}%</text>`
    ly += 22
  }
  if (s.data.length > maxItems) {
    svg += `<text x="486" y="${ly + 10}" font-size="11" fill="${esc(m.text)}" opacity="0.6">… 共 ${s.data.length} 项</text>`
  }

  return svg + `</svg>`
}

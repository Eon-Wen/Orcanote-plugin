// 图表真块化：图表作为虎鲸原生「图片块」（repr type=image）插入到表格块正下方，
// 与表格同 parent、同 left 边距 → 天然同级对齐。图表文件（SVG）经
// upload-asset-binary 存入 repo 的 assets 目录（.svg 扩展名会跳过图片压缩、
// 原样落盘，app.asar 逆向确认），表格块的 _chart 属性记录图表块 id 与文件路径。
// 更新 = 删旧块 + 插新块（图片块内容无法原地改 src 之外的内容，删插最简单可靠）；
// 删除 = 删图表块 + 删 _chart。不再向文档 DOM 注入节点（旧 chartEmbed 方案废弃）。
import {
  buildChartModel,
  readTableData,
  renderChartSvg,
  type ChartType,
} from "./tableChart"

const EMBED_PROP = "_chart"

export interface ChartConfig {
  type: ChartType
  xIdx: number
  yIdxs: number[]
  title: string
  /** 图表图片块的块 id（插入后写入） */
  chartBlockId: number
  /** 图表文件在 assets 下的相对路径（如 ./neo-chart-xxx.svg） */
  src: string
}

let _orca: any = null
function orca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}

/** 读某表格块的内嵌图表配置（无/损坏/旧格式返回 null）。 */
export function chartOfBlock(blockId: number): ChartConfig | null {
  const b = orca().state?.blocks?.[blockId]
  const v = b?.properties?.find((p: any) => p.name === EMBED_PROP)?.value
  if (typeof v !== "string" || !v) return null
  try {
    const c = JSON.parse(v)
    if (!c || typeof c !== "object") return null
    if (!Number.isFinite(c.chartBlockId) || typeof c.src !== "string") return null
    const type: ChartType = c.type === "pie" || c.type === "line" ? c.type : "bar"
    const xIdx = Number.isInteger(c.xIdx) ? (c.xIdx as number) : 0
    const yIdxs = Array.isArray(c.yIdxs) ? (c.yIdxs as number[]).filter((n) => Number.isInteger(n)) : []
    return {
      type,
      xIdx,
      yIdxs,
      title: typeof c.title === "string" ? c.title : "",
      chartBlockId: c.chartBlockId as number,
      src: c.src as string,
    }
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

/** 删除图表：删图表图片块（真实删除）+ 删 _chart 属性。 */
export async function removeChartOfBlock(blockId: number): Promise<void> {
  const cfg = chartOfBlock(blockId)
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
  if (cfg) {
    try {
      await orca().invokeBackend("delete-blocks", [cfg.chartBlockId])
    } catch (e) {
      console.warn("[CHART] 删图表块失败", e)
    }
  }
}

/** 上传图表 SVG 到 repo assets（.svg 原样落盘），返回 ./neo-chart-xxx.svg。 */
async function uploadChartSvg(svg: string): Promise<string | null> {
  const name = `neo-chart-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}.svg`
  try {
    const src = await orca().invokeBackend(
      "upload-asset-binary",
      "orca-neo/chart.svg",
      svg,
      "orca-neo",
      name,
    )
    return typeof src === "string" && src.length > 0 ? src : null
  } catch (e) {
    console.warn("[CHART] 上传图表 SVG 失败", e)
    return null
  }
}

/** 生成图表 SVG → 上传 → 在表格块后插入图片块，返回新块 id（失败 null）。 */
export async function insertChartBlock(
  tableBlockId: number,
  config: { type: ChartType; xIdx: number; yIdxs: number[]; title: string },
): Promise<{ chartBlockId: number; src: string } | null> {
  const data = await readTableData(tableBlockId)
  const model = buildChartModel({
    title: config.title,
    type: config.type,
    xColumnIndex: config.xIdx,
    yColumnIndexes: config.yIdxs,
    headers: data.headers,
    rows: data.rows,
  })
  const src = await uploadChartSvg(renderChartSvg(model))
  if (!src) return null
  try {
    // insertBlock(cmd, null, 锚块对象, "after", content, repr)——锚块参数是
    // 【块对象】而非 id（asar 内部调用传的是 state.blocks 里的块对象；
    // 传 id 会创建出 parent 为空的孤儿块）
    const anchor = orca().state?.blocks?.[tableBlockId]
    if (!anchor) {
      console.warn("[CHART] 锚块不在 state 中，无法插入图表块", tableBlockId)
      return null
    }
    const newId = await orca().commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      anchor,
      "after",
      [{ t: "t", v: `image: ${src}\n\n` }],
      { type: "image", src, cap: config.title || undefined },
    )
    if (Number.isFinite(newId)) return { chartBlockId: newId as number, src }
    console.warn("[CHART] insertBlock 返回异常:", newId)
    return null
  } catch (e) {
    console.warn("[CHART] 插入图表块失败", e)
    return null
  }
}

/** 清理早期 bug 产生的孤儿图表块（parent 为空的 neo-chart 图片块，不再显示但
   残留在数据里）。幂等：删完即空。在菜单命令安装时调用一次即可。 */
export async function cleanupOrphanChartBlocks(): Promise<void> {
  const state = orca().state?.blocks ?? {}
  const orphans: number[] = []
  for (const key of Object.keys(state)) {
    const id = Number(key)
    if (!Number.isFinite(id)) continue
    const b = state[key]
    const repr = Array.isArray(b?.properties)
      ? b.properties.find((p: any) => p.name === "_repr")?.value
      : undefined
    if (
      repr?.type === "image" &&
      typeof repr.src === "string" &&
      repr.src.includes("neo-chart") &&
      b.parent == null
    ) {
      orphans.push(id)
    }
  }
  if (orphans.length > 0) {
    try {
      await orca().invokeBackend("delete-blocks", orphans)
    } catch (e) {
      console.warn("[CHART] 清理孤儿图表块失败", e)
    }
  }
}

/** 更新图表：删旧块 + 插新块 + 重写 _chart。 */
export async function updateChartOfBlock(
  tableBlockId: number,
  config: { type: ChartType; xIdx: number; yIdxs: number[]; title: string },
): Promise<void> {
  const old = chartOfBlock(tableBlockId)
  if (old) {
    try {
      await orca().invokeBackend("delete-blocks", [old.chartBlockId])
    } catch (e) {
      console.warn("[CHART] 删旧图表块失败", e)
    }
  }
  const r = await insertChartBlock(tableBlockId, config)
  if (r) {
    await setChartOfBlock(tableBlockId, { ...config, chartBlockId: r.chartBlockId, src: r.src })
  }
}

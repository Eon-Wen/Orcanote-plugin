// 列表子弹线（参考 orca-better-motion 的 scope highlight 技术路线，
// 但以 Neo 主题配色为主导）。
//
// 行为：开启「列表参考线」后——
//   1) 静态常显线直接使用虎鲸原生父子块参考线（.orca-repr-scope-line，
//      由 Orca 原生绘制），本插件【不隐藏、也不重画】它；
//   2) 仅由本模块用 JS 在【光标所在路径】上叠加一条活动高亮
//      （.neo-list-hl，--neo-accent，无辉光、非荧光），从根一路连到
//      光标所在块。
//
// 线段是绝对定位的 SVG，插入到各层 .orca-repr-children 容器内，随布局
// （滚动、重排、动画）一起移动，无需额外维护。React 重挂容器时会带走
// 我们插入的线，MutationObserver 负责补画。

const TAG = "[orca-neo]"
/** 活动高亮线段类名 */
const HL = "neo-list-hl"
/** 标记我们改过 position:relative 的容器（data-neo-scope-pos） */
const POS_ATTR = "data-neo-scope-pos"

/** 不画引导线的区域 */
const POPUP = ".orca-popup, .orca-block-preview-popup"

/** Orca DOM 关键类名（已对照真实 app 包核对） */
const CLS = {
  block: "orca-block",
  repr: "orca-repr",
  reprMain: "orca-repr-main",
  reprChildren: "orca-repr-children",
  handle: "orca-block-handle",
  editorBlocks: "orca-block-editor-blocks",
  editor: "orca-block-editor",
} as const

const SVG_NS = "http://www.w3.org/2000/svg"

let onSelectionChange: (() => void) | null = null
let onResize: (() => void) | null = null
let mo: MutationObserver | null = null
let rafPending = false

function clearLines(): void {
  document.querySelectorAll(`.${HL}`).forEach((el) => el.remove())
  // 兼容旧版本残留：早期实现会给原生参考线打 neo-list-hl-host 把它隐藏，
  // 现已改为遮盖策略，热更新后把遗留标记清掉，否则那几条线会一直不显示。
  document
    .querySelectorAll(".neo-list-hl-host")
    .forEach((el) => el.classList.remove("neo-list-hl-host"))
}

/** 功能是否开启：由 body 上的 neo-list-line 类决定（applyFeatures 负责切换） */
function getEnabled(): boolean {
  return document.body.classList.contains("neo-list-line")
}

/** 当前文本光标所在块（排除浮窗内的块） */
function cursorBlock(): HTMLElement | null {
  const node = window.getSelection()?.anchorNode ?? null
  const el = node instanceof HTMLElement ? node : node?.parentElement
  const block = el?.closest<HTMLElement>(`.${CLS.block}`) ?? null
  if (!block) return null
  if (block.closest(POPUP)) return null
  return block
}

/** 块的子弹（handle）矩形，退回取内容行矩形 */
function bulletRect(block: HTMLElement): DOMRect | null {
  const main = block.querySelector<HTMLElement>(
    `:scope > .${CLS.repr} > .${CLS.reprMain}`,
  )
  const handle = main?.querySelector<HTMLElement>(`.${CLS.handle}`)
  const target = handle ?? main
  if (!target) return null
  const r = target.getBoundingClientRect()
  return r.width < 1 || r.height < 1 ? null : r
}

/** 拥有该 children 容器的「父块」：优先 .orca-block；若是页面根编辑器
 *  （.orca-block-editor，即标题块，本身不带 .orca-block 类）则回落到它，
 *  否则在根级 closest('.orca-block') 返回 null，导致标题→首个子块缺失。 */
function owningBlock(container: HTMLElement): HTMLElement | null {
  return (
    container.closest<HTMLElement>(`.${CLS.block}`) ??
    container.closest<HTMLElement>(`.${CLS.editor}`)
  )
}

/** 块的直接 .orca-repr */
function ownRepr(block: HTMLElement): HTMLElement | null {
  return block.querySelector<HTMLElement>(`:scope > .${CLS.repr}`)
}

/** 块所属的主编辑区（面包屑/浮窗内的块不画） */
function blocksAreaOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(`.${CLS.editorBlocks}, .${CLS.editor}`)
}

/** 父块【自己那一条】原生参考线元素（.orca-repr-scope-line）。
 *  注意必须限定 owningBlock === parent：同一棵子树里每个子块都各有一条，
 *  取错会拿到子块的线（x 落在子子弹左缘），导致连线坍缩成纯竖线。 */
function ownScopeLine(parent: HTMLElement): HTMLElement | null {
  return (
    Array.from(
      parent.querySelectorAll<HTMLElement>(".orca-repr-scope-line"),
    ).find((el) => owningBlock(el) === parent) ?? null
  )
}

/** 原生参考线的描边中心 x（视口坐标）。原生结构是
 *  `.orca-repr-scope-line`（宽 5px）内的 `::before { left:2px; border-left:1px }`，
 *  故实际线心 ≈ 元素左缘 + 2.5px，而不是元素中线。 */
function nativeLineX(parent: HTMLElement): number | null {
  const el = ownScopeLine(parent)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.height < 4 || r.width < 1) return null
  if (getComputedStyle(el).display === "none") return null
  return r.left + 2.5
}

/** 画一段「父块圆点 → 子块圆点」的 L 型连线（活动高亮）：
 *  - 竖直主干 x 取【父块圆点】的中线，从父子弹正下方一直向下到子子弹中线；
 *  - 末端以四分之一圆弧右转、停在子子弹左缘前，形成经典树形的 L 连接。
 *  注意：不能用原生 scope-line 的位置作 x —— 无序列表里原生竖线恰好画在
 *  子块圆点的左缘，会使 x ≈ xEnd、横向连接段坍缩成一条纯竖线（即本 bug）。
 *  颜色由 .neo-list-hl path（见 neo-plus.css，Neo 强调色）决定。 */
function drawSegment(
  container: HTMLElement,
  parent: HTMLElement,
  child: HTMLElement,
): void {
  const p = bulletRect(parent)
  const c = bulletRect(child)
  if (!p || !c) return
  const cr = container.getBoundingClientRect()
  const yTop = p.bottom + 2 - cr.top
  const yBot = c.top + c.height / 2 - cr.top
  if (yBot - yTop < 4) return
  // 竖直主干 x：优先【对齐父块自己那条原生参考线的线心】——原生线不再隐藏，
  // 只有精确对齐才能把它完全遮住（我们 2.5px 宽 > 原生 1px）。
  // 原生线心与父子弹中线本就只差约 2.5px（handle left = indent-21 且宽约 20，
  // scope-line 线心 = indent-13.5），视觉上等价。
  // 找不到原生线（或它被 display:none，如引用块 / 表格单元格内）时，
  // 退回父子弹中线；父子弹也缺失才整段放弃。
  const bulletX = p.width >= 1 ? p.left + p.width / 2 : null
  const xEnd = c.left - 2 - cr.left
  const nativeX = nativeLineX(parent)
  // 防坍缩：原生线若不在子子弹左侧（异常布局），宁可用父子弹中线
  const useNative =
    nativeX != null &&
    nativeX - cr.left < xEnd - 4 &&
    (bulletX == null || Math.abs(nativeX - bulletX) < 12)
  const xAbs = useNative ? (nativeX as number) : bulletX
  if (xAbs == null) return
  const x = xAbs - cr.left
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative"
    container.setAttribute(POS_ATTR, "1")
  }
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("class", HL)
  const path = document.createElementNS(SVG_NS, "path")
  let d: string
  if (xEnd > x + 4) {
    const r = Math.max(0, Math.min(8, xEnd - x - 1, (yBot - yTop) / 2))
    d =
      r >= 3
        ? `M ${x} ${yTop} L ${x} ${yBot - r} Q ${x} ${yBot} ${x + r} ${yBot} L ${xEnd} ${yBot}`
        : `M ${x} ${yTop} L ${x} ${yBot} L ${xEnd} ${yBot}`
  } else {
    // 子块圆点不在父块右侧（异常布局），只画竖线以免画出怪异折线
    d = `M ${x} ${yTop} L ${x} ${yBot}`
  }
  path.setAttribute("d", d)
  svg.appendChild(path)
  container.appendChild(svg)
  // 不再隐藏原生参考线：x 已对齐其线心、描边更宽、z-index 更高，
  // 重叠段被直接遮住即可，未覆盖的下半段照常显示。
}

function isJournal(parent: HTMLElement): boolean {
  return ownRepr(parent)?.classList.contains("orca-repr-journal") ?? false
}

/** 该日记块是否「嵌在别的块内部」（而非作为页面级条目）。
 *  嵌在别的块里时是真正的嵌入式日记块，不该把它当页面根来连线；
 *  而作为页面级条目的日记块（含「日期为页面的块」那种把日期当标题渲染成
 *  普通 .orca-block 带 .orca-repr-journal 的情况）应继续向上连，
 *  使日期标题成为整页列表参考线的源头。 */
function isNestedJournal(parent: HTMLElement): boolean {
  // parent 自身就是 .orca-block；往上找最近的祖先 .orca-block，
  // 若存在则说明它嵌在别的块内部（而非页面顶层条目）。
  return !!parent.parentElement?.closest<HTMLElement>(`.${CLS.block}`)
}

function redraw(): void {
  rafPending = false
  if (!mo) return
  // 暂停 observer：本函数内的 clearLines / append svg 都是
  // 我们自己的 DOM 改动，若不暂停会立即触发重绘，形成每帧重建循环（闪烁源）。
  mo.disconnect()
  try {
    clearLines()
    if (!getEnabled()) return

    const block = cursorBlock()
    if (!block) return
    const blocksArea = blocksAreaOf(block)
    if (!blocksArea) return

    // 仅画光标所在路径（从光标块一路回溯到根）的活动高亮；
    // 静态常显线交由虎鲸原生 .orca-repr-scope-line 负责，本插件不重画。
    let child = block
    let container = child.parentElement
    while (container?.classList.contains(CLS.reprChildren)) {
      const parent = owningBlock(container)
      if (!parent || parent.closest(POPUP)) break
      // 日期块：从日历点进来时它是【页面级条目】（标题就是那个日期），此时
      // 应当从它开始向上展开，让日期标题成为整页列表参考线的源头，而不是在它
      // 下方第一个块处断开。
      // 只有真正【嵌在别的块内部】的嵌入式日记块才跳过——那种场景下它只是别
      // 的块里的一段引用，往上连到它会画出无意义的跨块连线。
      if (isJournal(parent) && isNestedJournal(parent)) break
      if (blocksAreaOf(parent) !== blocksArea) break
      drawSegment(container, parent, child)
      child = parent
      container = child.parentElement
    }
  } finally {
    observeBody()
  }
}

function observeBody(): void {
  mo?.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
    attributeOldValue: true,
  })
}

function scheduleRedraw(): void {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(redraw)
}

export function startScopeHighlight(): void {
  stopScopeHighlight()
  onSelectionChange = scheduleRedraw
  onResize = scheduleRedraw
  document.addEventListener("selectionchange", onSelectionChange)
  window.addEventListener("resize", onResize)
  // 容器被 React 重挂（折叠、缩进、编辑）会带走我们画的线——DOM 变动时补画；
  // 同时监听 body 的 class 变化以响应「列表参考线」开关切换。
  mo = new MutationObserver(() => scheduleRedraw())
  observeBody()
  scheduleRedraw()
  console.log(TAG, "列表子弹线 (scope highlight) 已注册")
}

export function stopScopeHighlight(): void {
  if (onSelectionChange) {
    document.removeEventListener("selectionchange", onSelectionChange)
    onSelectionChange = null
  }
  if (onResize) {
    window.removeEventListener("resize", onResize)
    onResize = null
  }
  mo?.disconnect()
  mo = null
  // 还原我们改过 position 的容器
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(`[${POS_ATTR}]`),
  )) {
    el.style.position = ""
    el.removeAttribute(POS_ATTR)
  }
  clearLines()
}

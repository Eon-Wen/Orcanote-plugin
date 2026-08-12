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
/** 标记焦点路径上的容器（用于隐藏其原生参考线，避免与高亮线重合） */
const HOST = "neo-list-hl-host"
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
  document
    .querySelectorAll(`.${HOST}`)
    .forEach((el) => el.classList.remove(HOST))
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

/** 该层容器原生缩进参考线的 x（找不到就退回子弹左侧固定偏移） */
function scopeLineX(
  container: HTMLElement,
  parent: HTMLElement,
  bulletX: number,
): number {
  const repr = ownRepr(parent)
  const cands = Array.from(
    (repr ?? container).querySelectorAll<HTMLElement>(".orca-repr-scope-line"),
  ).filter(
    (el) =>
      el.closest(`.${CLS.block}`) === parent ||
      el.closest(`.${CLS.editor}`) === parent,
  )
  let best: number | null = null
  let bestDist = Infinity
  for (const el of cands) {
    const r = el.getBoundingClientRect()
    if (r.height < 4) continue
    const x = r.left + r.width / 2
    if (x >= bulletX - 4) continue
    const d = Math.abs(x - (bulletX - 27))
    if (d < bestDist) {
      bestDist = d
      best = x
    }
  }
  if (best != null) return best
  return bulletX - 10
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
  // 竖直主干：父块圆点中线（经典树形 L 的竖直主干）。
  // 父子弹缺失时（极少数情况）退回原生缩进参考线，避免整段不画。
  const x =
    p.width >= 1
      ? p.left + p.width / 2 - cr.left
      : scopeLineX(container, parent, c.left + c.width / 2) - cr.left
  const xEnd = c.left - 2 - cr.left
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
  // 标记该容器处于焦点路径，隐藏其原生参考线，避免与高亮线重合
  container.classList.add(HOST)
}

function isJournal(parent: HTMLElement): boolean {
  return ownRepr(parent)?.classList.contains("orca-repr-journal") ?? false
}

function redraw(): void {
  rafPending = false
  if (!mo) return
  // 暂停 observer：本函数内的 clearLines / append svg / 加 HOST 类都是
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
      if (!parent || parent.closest(POPUP) || isJournal(parent)) break
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

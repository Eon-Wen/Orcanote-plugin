// EPUB 连续垂直滚动：把虎鲸 EPUB 阅读器从「每章一屏、翻页阅读」改为整书
// 连续垂直滚动。
//
// 逆向结论（app.asar 渲染 bundle）：
// - 虎鲸 renderTo 按容器宽度选 flow：宽度 >= 822px 用 flow:"paginated" +
//   spread:"always"（左右翻页），更窄才用 flow:"scrolled-doc"。窗口够宽时
//   EPUB 一律翻页、无法连续滚动。
// - epub.js 的 Rendition.flow("scrolled-doc") 是运行时切换 API（bundle 内
//   实现完整）：layout.flow→scrolled、axis→vertical、spread→none、滚动容器
//   overflow→auto；已渲染时会 clear 并重新 display 当前定位。虎鲸 CSS 只锁
//   .epub-container 的 overflow-x，垂直滚动不受阻。
// - 但虎鲸用 manager:"default"（每章一个 iframe），切章时（display 未渲染
//   章节 / next()/prev()/resize）一律 manager.clear() 把已渲染章节全部销毁，
//   所以即使 flow 切成 scrolled，容器里也永远只有当前章、滚到底就断
//   （eon 实测「被拆分成一个个章节」）。epub.js 的 ContinuousViewManager
//   与它的唯一本质区别就是：不清空旧视图、把章节垂直堆叠。
//
// 实现：先把 flow 切到 scrolled-doc（借原生 clear 重建一次布局），随后把
//   manager.clear() 替换成 no-op——之后章节 append 进来不再被销毁、垂直堆叠；
//   display 完成后按 section.index 重排（向前跳章时保证视觉顺序）；滚动接近
//   底部时调 rendition.next() 预渲染下一章，读者滚到底继续滚即无缝进入下一章。
//   rendition 实例存在组件闭包（useRef）里，DOM 上没有公开引用，只能从
//   .orca-epub-viewer 的 React fiber 反查（React 18：__reactFiber$ 键，函数
//   组件 fiber 的 hooks 链里 useRef.current 即 rendition）。
//
// 性能（累积章节的渲染开销）：
// - 章节视图累积后都留在 DOM，书越长参与绘制的 iframe 越多。用一个共享的
//   IntersectionObserver（root=视口、上下各 150% 视口宽裕）给每个章节视图
//   做「窗口化」：远离视口的视图 visibility:hidden（不参与绘制，但保留占位、
//   滚动高度不变），滚近时再恢复可见。浏览器原生节流、无手动 layout 计算。
//
// 自愈与防重（MutationObserver 铁律）：
// ① body 级观察器（防抖 200ms）发现新的 .orca-epub-viewer 时切换；
// ② data-neo-epub-scrolled 标记 + WeakSet 防重（flow 切换会重建 iframe、
//    观察器再触发，重复切换会导致页面跳动）；
// ③ rendition 未创建时不标记、留待下次扫描；
// ④ 关闭开关：恢复原生 clear / display，再切回 flow("paginated")（其内部
//    clear 会清掉累积视图并按当前定位重渲染，回到虎鲸原生翻页）。

import type { NeoSettings } from "./settings"

const VIEWER_SELECTOR = ".orca-epub-viewer"
const MARK = "data-neo-epub-scrolled"
const EDGE_PX = 60 // 距滚动底部多少像素内预渲染下一章
const NEXT_COOLDOWN = 800 // 两次自动预渲染的冷却毫秒数

let enabled = false
let observer: MutationObserver | null = null
let scanTimer = 0
let viewIo: IntersectionObserver | null = null // 章节视图窗口化（共享实例）
const handled = new WeakSet<object>() // 已切过 flow 的 rendition
const patches = new WeakMap<
  object,
  { origClear: () => void; origDisplay: (s: any, t: any) => any; unpatchers: (() => void)[] }
>()
const lastNextAt = new WeakMap<object, number>()

/* --------------------------------------------------------------------------
   React fiber 反查 rendition
   -------------------------------------------------------------------------- */

function getFiber(el: Element): unknown {
  const anyEl = el as unknown as Record<string, unknown>
  for (const k of Object.getOwnPropertyNames(anyEl)) {
    if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
      return anyEl[k]
    }
  }
  return null
}

function isRendition(v: unknown): v is any {
  if (!v || typeof v !== "object") return false
  const r = v as any
  return (
    typeof r.flow === "function" &&
    typeof r.display === "function" &&
    typeof r.manager === "object" &&
    r.manager !== null
  )
}

/** 沿 fiber 链向上找 EPUB 组件的 hooks，挖出 rendition 实例 */
function findRendition(el: Element): any | null {
  let fiber: any = getFiber(el)
  let depth = 0
  while (fiber && depth < 200) {
    let hook = fiber.memoizedState
    while (hook) {
      const v = hook.memoizedState
      if (v && typeof v === "object" && isRendition(v.current)) return v.current
      hook = hook.next
    }
    fiber = fiber.return
    depth += 1
  }
  return null
}

/* --------------------------------------------------------------------------
   manager 打补丁：章节不清空、垂直堆叠
   -------------------------------------------------------------------------- */

function patchManager(rend: any): void {
  const mgr = rend?.manager
  if (!mgr || mgr.name !== "default" || patches.has(mgr)) return
  const views: any = mgr.views
  if (!views || !Array.isArray(views._views)) {
    console.warn("[Neo] EPUB 连续滚动：阅读引擎结构不符，仅切换滚动方向", rend)
    return
  }

  // 按 section.index 把视图与 DOM 重排（顺序阅读时 append 天然有序，重排为 no-op）
  const reorder = () => {
    const all: any[] = views.all()
    if (all.every((v, i) => i === 0 || all[i - 1]!.section.index <= v.section.index)) {
      return // 已按章节顺序，不动（避免无谓的 DOM 移动）
    }
    const sorted = [...all].sort((a: any, b: any) => a.section.index - b.section.index)
    views._views = sorted
    views.length = sorted.length
    for (const v of sorted) views.container.appendChild(v.element)
  }

  const origClear = mgr.clear.bind(mgr)
  const origDisplay = mgr.display.bind(mgr)
  const unpatchers: (() => void)[] = []
  mgr.clear = () => {
    // no-op：已渲染章节保留、垂直堆叠（ContinuousViewManager 的精髓）
  }
  mgr.display = function (section: any, target: any) {
    const p = origDisplay(section, target)
    Promise.resolve(p).then(reorder, reorder)
    return p
  }
  unpatchers.push(() => {
    mgr.clear = origClear
    mgr.display = origDisplay
  })

  // 章节视图窗口化：新视图进容器时注册进 IntersectionObserver，
  // 远离视口的章节 visibility:hidden（不绘制、不占合成资源，滚动高度不变）。
  const io = ensureViewIo()
  const trackView = (v: any) => {
    if (v?.element instanceof HTMLElement) io.observe(v.element)
  }
  views.all().forEach(trackView)
  for (const method of ["append", "prepend", "insert"] as const) {
    const orig = views[method].bind(views)
    views[method] = function (v: any, ...rest: any[]) {
      const r = orig(v, ...rest)
      trackView(v)
      return r
    }
    unpatchers.push(() => {
      views[method] = orig
    })
  }

  patches.set(mgr, { origClear, origDisplay, unpatchers })
}

function restoreManager(rend: any): void {
  const mgr = rend?.manager
  if (!mgr) return
  const patch = patches.get(mgr)
  if (!patch) return
  patches.delete(mgr)
  for (const undo of patch.unpatchers) {
    try {
      undo()
    } catch {
      /* 恢复失败不影响整体卸载 */
    }
  }
  // 恢复视图可见性，随后 flow("paginated") 的原生 clear 会清掉累积视图
  try {
    for (const v of mgr.views.all()) {
      if (v?.element instanceof HTMLElement) {
        v.element.style.visibility = ""
        viewIo?.unobserve(v.element)
      }
    }
  } catch {
    /* 忽略 */
  }
}

/* --------------------------------------------------------------------------
   章节视图窗口化：IntersectionObserver 只保留视口附近章节可见
   -------------------------------------------------------------------------- */

function ensureViewIo(): IntersectionObserver {
  if (!viewIo) {
    viewIo = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const el = en.target as HTMLElement
          el.style.visibility = en.isIntersecting ? "" : "hidden"
        }
      },
      // root=视口：IO 会追踪所有可滚动祖先，EPUB 面板内滚动同样正确
      { root: null, rootMargin: "150% 0px 150% 0px" },
    )
  }
  return viewIo
}

function disposeViewIo(): void {
  viewIo?.disconnect()
  viewIo = null
}

/* --------------------------------------------------------------------------
   滚动接近底部：预渲染下一章（rendition.next 走 scrolled 分支会 append 新章）
   -------------------------------------------------------------------------- */

function onScrollCapture(e: Event): void {
  if (!enabled) return
  const t = e.target as HTMLElement | null
  if (!t) return
  const viewer = t.closest?.(VIEWER_SELECTOR) as HTMLElement | null
  if (!viewer || !viewer.hasAttribute(MARK)) return
  if (t.scrollTop + t.clientHeight < t.scrollHeight - EDGE_PX) return
  const rend = findRendition(viewer)
  if (!rend) return
  const now = Date.now()
  if (now - (lastNextAt.get(rend) ?? 0) < NEXT_COOLDOWN) return
  lastNextAt.set(rend, now)
  try {
    rend.next()
  } catch (err) {
    console.warn("[Neo] EPUB 连续滚动：预渲染下一章失败", err)
  }
}

/* --------------------------------------------------------------------------
   扫描与开关
   -------------------------------------------------------------------------- */

function scan(): void {
  if (!enabled) {
    document
      .querySelectorAll<HTMLElement>(`${VIEWER_SELECTOR}[${MARK}]`)
      .forEach((v) => {
        const rend = findRendition(v)
        if (rend) {
          handled.delete(rend)
          restoreManager(rend)
          try {
            // 原生 clear 清掉累积视图，display 按当前定位重渲染回分页布局
            rend.flow("paginated")
          } catch (err) {
            console.warn("[Neo] EPUB 连续滚动：恢复翻页模式失败", err)
          }
        }
        v.removeAttribute(MARK)
      })
    return
  }
  document.querySelectorAll<HTMLElement>(VIEWER_SELECTOR).forEach((v) => {
    if (v.hasAttribute(MARK)) return
    const rend = findRendition(v)
    if (!rend) return // rendition 尚未创建（EPUB 还在加载），留待下次扫描
    handled.add(rend)
    v.setAttribute(MARK, "1")
    try {
      // 先切 flow：其内部 clear 会按 scrolled 布局重建当前章（此时还没打补丁）
      rend.flow("scrolled-doc")
      patchManager(rend)
      console.info("[Neo] EPUB 连续滚动：已切换为整书连续垂直滚动")
    } catch (err) {
      console.warn("[Neo] EPUB 连续滚动：切换失败", err)
      handled.delete(rend)
      v.removeAttribute(MARK)
    }
  })
}

function scheduleScan(): void {
  if (!enabled) return
  window.clearTimeout(scanTimer)
  scanTimer = window.setTimeout(scan, 200)
}

/** apply() 的入口：开/关由 epubScroll 开关驱动 */
export function applyEpubScroll(settings: NeoSettings): void {
  const want = settings.epubScroll === true
  if (want === enabled) {
    if (want) scheduleScan()
    return
  }
  enabled = want
  if (want) {
    if (!observer) {
      observer = new MutationObserver(scheduleScan)
      observer.observe(document.body, { childList: true, subtree: true })
    }
    document.addEventListener("scroll", onScrollCapture, { capture: true, passive: true })
    scheduleScan()
  } else {
    if (observer) {
      observer.disconnect()
      observer = null
    }
    document.removeEventListener("scroll", onScrollCapture, { capture: true } as any)
    window.clearTimeout(scanTimer)
    scan()
    disposeViewIo()
  }
}

export function disposeEpubScroll(): void {
  enabled = false
  if (observer) {
    observer.disconnect()
    observer = null
  }
  document.removeEventListener("scroll", onScrollCapture, { capture: true } as any)
  window.clearTimeout(scanTimer)
  scan()
  disposeViewIo()
}

/**
 * 彩色侧栏：参考思源笔记「彩色文档树」的做法，给侧栏每个条目上色。
 *
 * 配色规则（最新）：
 *   - 顶级块（收藏 / 页面 / 标签 下的最高级别条目）按出现顺序循环使用
 *     莫兰迪色系「赤 → 橙 → 黄 → 绿 → 青 → 蓝 → 紫」，每个列表独立从赤色起算。
 *   - 顶级块展开后的子块（树状子节点）与所属顶级块同色。
 *
 * 观感（#2）：字体色 = 上述颜色，背景 = 同色磨砂半透明（backdrop-filter 营造层次）、
 * 直角框、相邻块有间距、背景从左到右渐淡。
 *
 * 日历（#3）：每月一个不同基色，日期数字沿该月做渐变；表头（年/月/Now）、星期行、
 * 以及点击年/月筛选时出现的弹窗（年/月列表）也都为彩色。
 *
 * 最顶端数据库名称（#4）：彩色，背景不变（由 neo.css 处理）。
 */

const ITEM_SELECTORS = [
  "#sidebar .orca-fav-item-item", // 收藏
  "#sidebar .orca-aliased-block-item", // 页面（别名块树，与收藏不同组件）
  "#sidebar .orca-tags-tag-item", // 标签
]

const CAL_DAY_SELECTOR = "#sidebar .orca-calendar .day" // 日历日期格

// 日历表头（年 / 月 / Now）与星期行
const CAL_HEAD_SELECTORS = [
  "#sidebar .orca-calendar .choosen-year",
  "#sidebar .orca-calendar .choosen-month",
  "#sidebar .orca-calendar .go-now",
  "#sidebar .orca-calendar .weekday",
]

// 点击年/月筛选时出现的弹窗（年列表 / 月列表）
const CAL_POP_SELECTORS = [
  "#sidebar .orca-calendar .years .year",
  "#sidebar .orca-calendar .months .month",
]

// 列表条目的最外层「包装」元素（树结构：包装内放本行 + 子包装）
const WRAPPER_SELECTORS = [
  ".orca-fav-item", // 收藏
  ".orca-aliased-block", // 页面（别名块树）
  ".orca-tags-tag", // 标签
]
const WRAPPER_COMBINED = WRAPPER_SELECTORS.join(",")
const ROW_COMBINED = ITEM_SELECTORS.join(",")

/** 莫兰迪色系：赤 → 橙 → 黄 → 绿 → 青 → 蓝 → 紫，低饱和、带灰调 */
const MORANDI = [
  "hsl(5 30% 62%)", // 赤
  "hsl(28 35% 64%)", // 橙
  "hsl(45 32% 66%)", // 黄
  "hsl(95 20% 60%)", // 绿
  "hsl(175 22% 60%)", // 青
  "hsl(215 25% 64%)", // 蓝
  "hsl(280 20% 66%)", // 紫
]
function morandi(i: number): string {
  return MORANDI[((i % MORANDI.length) + MORANDI.length) % MORANDI.length]
}

/** 向上找最近的列表包装元素 */
function closestWrapper(el: Element | null, combined: string): Element | null {
  let p: Element | null = el
  while (p) {
    if (p.matches && p.matches(combined)) return p
    p = p.parentElement
  }
  return null
}

/** 值没变就跳过写入：观察器重扫时大部分条目颜色已是最终值，
 *  重复写同名内联变量没有视觉效果，只是白做一次声明替换。 */
function setItemColor(el: HTMLElement, color: string) {
  if (el.style.getPropertyValue("--neo-item-color") !== color) {
    el.style.setProperty("--neo-item-color", color)
  }
}

/** 给侧栏每个条目上色：顶级块按列表分组循环莫兰迪色，整棵子树（行 + 背景）共享同色。 */
function paintItems(sidebar: Element) {
  const wrappers = Array.from(
    sidebar.querySelectorAll<HTMLElement>(WRAPPER_COMBINED),
  )

  // 把顶级包装按「所属列表容器」分组，每组独立从赤色开始循环
  const groups = new Map<Element, HTMLElement[]>()
  for (const w of wrappers) {
    if (closestWrapper(w.parentElement, WRAPPER_COMBINED)) continue // 子块，交给父级统一上色
    const key = w.parentElement as Element
    const arr = groups.get(key)
    if (arr) arr.push(w)
    else groups.set(key, [w])
  }

  for (const list of groups.values()) {
    list.forEach((w, i) => {
      const color = morandi(i)
      // 颜色写到顶级包装上，整棵子树（行 + 背景）共享同色
      setItemColor(w, color)
      // 顶级包装打标：本子树（顶级块 + 其下展开的所有子块）共用一个连续背景
      w.classList.add("neo-cwrap")
      // 本包装内的所有行（顶级 + 其下展开的子块）共用同一颜色
      w.querySelectorAll<HTMLElement>(ROW_COMBINED).forEach((el) => {
        setItemColor(el, color)
        el.classList.add("neo-citem")
      })
    })
  }
}

function paintCalendar(sidebar: Element) {
  // 每月一个不同基色（0~11 → 0/30/60...）
  const baseHue = (new Date().getMonth() * 30) % 360
  const headColor = `hsl(${baseHue} 70% 42%)`

  // 日期数字：每月不同基色 + 沿日期做渐变（不同月份不同渐变）
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  sidebar.querySelectorAll(CAL_DAY_SELECTOR).forEach((el) => {
    const n = parseInt((el.textContent || "").trim(), 10)
    const day = Number.isFinite(n) ? Math.min(Math.max(n, 1), daysInMonth) : 1
    const hue = (baseHue + ((day - 1) / Math.max(daysInMonth - 1, 1)) * 60) % 360
    setItemColor(el as HTMLElement, `hsl(${hue} 72% 42%)`)
    el.classList.add("neo-cday")
  })

  // 表头（年/月/Now）与星期行：用当月基色
  for (const sel of CAL_HEAD_SELECTORS) {
    sidebar.querySelectorAll(sel).forEach((el) => {
      setItemColor(el as HTMLElement, headColor)
      el.classList.add("neo-ccal")
    })
  }

  // 筛选弹窗（年列表 / 月列表）：随序号渐变，更丰富
  sidebar.querySelectorAll(CAL_POP_SELECTORS[0]).forEach((el, i) => {
    setItemColor(el as HTMLElement, `hsl(${(baseHue + i * 6) % 360} 70% 45%)`)
    el.classList.add("neo-ccal")
  })
  sidebar.querySelectorAll(CAL_POP_SELECTORS[1]).forEach((el, i) => {
    setItemColor(el as HTMLElement, `hsl(${(baseHue + i * 18) % 360} 70% 45%)`)
    el.classList.add("neo-ccal")
  })
}

function paint() {
  const sidebar = document.getElementById("sidebar")
  if (!sidebar) return
  paintItems(sidebar)
  paintCalendar(sidebar)
}

let observer: MutationObserver | null = null
let initObserver: MutationObserver | null = null
let timer = 0

// 拖拽进行中（任意从侧栏发起的拖拽，覆盖收藏/页面/标签、任何排序模式）：
// 暂停同步上色、回退 120ms 防抖调度。修复 13 把 childList 改成同步 paint 后，
// 拖拽期间的同步写 DOM 会打断拖拽；旧版防抖 paint 落在拖拽中途从不打断拖拽（历史验证）。
// drop/dragend 在观察器微任务之前同步释放，drop 后的重绘仍同步、颜色即时正确。
let dragging = false
let dragListenersInstalled = false

function onDocDragStartCapture(e: DragEvent) {
  const el = e.target as HTMLElement | null
  if (el && el.closest?.("#sidebar")) dragging = true
}

function onDocDropCapture() {
  dragging = false
}

function onDocDragEndCapture() {
  dragging = false
}

function schedulePaint() {
  clearTimeout(timer)
  timer = window.setTimeout(paint, 120)
}

/** 观察器回调分流：
 *  - 拖拽进行中：【回退防抖】。拖拽期间的同步写 DOM 会打断拖拽（见 dragging 说明）。
 *  - 结构变化（展开/折叠、新建、排序移动 → childList）：【同步】重绘。
 *    MutationObserver 回调在浏览器绘制前执行，同步上色让新出现的条目当帧即彩色，
 *    消灭「展开瞬间先无色、防抖到点再闪成彩色」的闪帧（旧版 120ms 防抖即闪帧来源）。
 *    观察器不监听 attribute，paint 只写样式/类，不会自触发成环。
 *  - 纯文字变化（重命名输入、日期格文字更新 → characterData）：不动结构、
 *    不影响列表配色，仍走 120ms 防抖低频重绘，避免每敲一键全量重绘。 */
function onSidebarMutations(list: MutationRecord[]) {
  if (dragging) {
    schedulePaint()
    return
  }
  let structural = false
  for (const m of list) {
    if (m.type === "childList") {
      structural = true
      break
    }
  }
  if (structural) paint()
  else schedulePaint()
}

function observeSidebar() {
  const sidebar = document.getElementById("sidebar")
  if (!sidebar || observer) return
  observer = new MutationObserver(onSidebarMutations)
  observer.observe(sidebar, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

export function startColorSidebar() {
  if (document.getElementById("sidebar")) {
    paint()
    observeSidebar()
  } else {
    // 侧栏可能晚于插件加载挂载，先等它出现
    initObserver = new MutationObserver(() => {
      if (document.getElementById("sidebar")) {
        initObserver?.disconnect()
        initObserver = null
        paint()
        observeSidebar()
      }
    })
    initObserver.observe(document.body, { childList: true, subtree: true })
  }
  if (!dragListenersInstalled) {
    dragListenersInstalled = true
    document.addEventListener("dragstart", onDocDragStartCapture, true)
    document.addEventListener("drop", onDocDropCapture, true)
    document.addEventListener("dragend", onDocDragEndCapture, true)
  }
}

/** 由「彩色文档树」开关驱动：开 → 上色并监听，关 → 清掉所有彩色类与内联色，
 *  页面块恢复跟随 Neo 主题配色。main.ts 的 apply() 每次设置变更都会调用它，
 *  因此菜单里勾选 / 取消勾选会即时生效。 */
export function setColorSidebar(enabled: boolean) {
  if (enabled) startColorSidebar()
  else stopColorSidebar()
}

export function stopColorSidebar() {
  observer?.disconnect()
  observer = null
  initObserver?.disconnect()
  initObserver = null
  clearTimeout(timer)
  if (dragListenersInstalled) {
    dragListenersInstalled = false
    document.removeEventListener("dragstart", onDocDragStartCapture, true)
    document.removeEventListener("drop", onDocDropCapture, true)
    document.removeEventListener("dragend", onDocDragEndCapture, true)
  }
  document.querySelectorAll(".neo-citem, .neo-cday, .neo-ccal").forEach((el) => {
    el.classList.remove("neo-citem", "neo-cday", "neo-ccal")
    el.style.removeProperty("--neo-item-color")
  })
  document.querySelectorAll(WRAPPER_COMBINED).forEach((el) => {
    el.classList.remove("neo-cwrap")
    el.style.removeProperty("--neo-item-color")
  })
}

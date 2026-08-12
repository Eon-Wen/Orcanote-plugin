/**
 * 侧栏彩色条目
 * 给「收藏 / 页面 / 标签」下每个顶层块分配一个莫兰迪色，写入 --neo-item-color；
 * 其下每个行 (.neo-citem) 继承该色作为底色，彩色只落在块自身，不合并成大背景。
 *
 * 注意：本模块只为行/块添加 .neo-citem / .neo-cwrap 类并写入 --neo-item-color 变量，
 * 真正的外观（含「不再使用从左到右由深变浅的渐变」的均匀纯色）由 neo-plus.css 定义。
 */

const WRAPPER_COMBINED =
  ".orca-fav-item, .orca-aliased-block, .orca-tags-tag"
const ROW_COMBINED =
  ".orca-fav-item-item, .orca-aliased-block-item, .orca-tags-tag-item"

/** 莫兰迪色板（低饱和、柔和） */
const MORANDI = [
  "#9fb3c8",
  "#c8a7a0",
  "#a3c2a0",
  "#c8bf9a",
  "#b0a0c8",
  "#9fc8bd",
  "#c8b39a",
  "#9fa3c8",
  "#c89ab1",
  "#9fc8a8",
  "#c89f9a",
  "#a0c0c8",
]

function morandi(i: number): string {
  return MORANDI[((i % MORANDI.length) + MORANDI.length) % MORANDI.length]!
}

function paintItems(sidebar: HTMLElement) {
  const wrappers = sidebar.querySelectorAll<HTMLElement>(WRAPPER_COMBINED)
  wrappers.forEach((wrap, idx) => {
    const color = morandi(idx)
    wrap.style.setProperty("--neo-item-color", color)
    wrap.classList.add("neo-cwrap")
    const rows = wrap.querySelectorAll<HTMLElement>(ROW_COMBINED)
    rows.forEach((row) => row.classList.add("neo-citem"))
  })
}

function paintCalendar(sidebar: HTMLElement) {
  const cal = sidebar.querySelector<HTMLElement>(".orca-calendar")
  if (cal) cal.classList.add("neo-ccal")
}

function paint(sidebar: HTMLElement) {
  paintItems(sidebar)
  paintCalendar(sidebar)
}

let observer: MutationObserver | null = null

export function startColorSidebar() {
  const sidebar = document.getElementById("sidebar")
  if (!sidebar) return
  paint(sidebar)
  observer = new MutationObserver(() => paint(sidebar))
  observer.observe(sidebar, { childList: true, subtree: true })
}

export function stopColorSidebar() {
  observer?.disconnect()
  observer = null
  document
    .querySelectorAll(".neo-citem, .neo-cwrap, .neo-ccal, .neo-cday")
    .forEach((el) => {
      el.classList.remove("neo-citem", "neo-cwrap", "neo-ccal", "neo-cday")
      ;(el as HTMLElement).style.removeProperty("--neo-item-color")
    })
}

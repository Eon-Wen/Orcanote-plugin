// 往虎鲸右上角「三点菜单」（设置/插件市场/备份/帮助那个浮层）注入「回收站」条目。
//
// 虎鲸的原生三点菜单是硬编码的 ContextMenu，插件 SDK 没有向它注册条目的 API
// （插件只有 headbar.registerHeadbarButton）。因此这里用 DOM 注入：
//  1. MutationObserver 监听 document.body，当 `.orca-headbar-menu`（三点菜单浮层）出现时，
//     把一条与原生 MenuText 同款 DOM 结构（div.orca-menu-text）的「回收站」条目追加到菜单末尾；
//  2. 原生菜单在打开后会因备份列表加载等状态更新而重渲染、可能抹掉注入的条目，
//     因此对菜单容器再挂一个 childList 观察器，被抹掉就重新补上；
//  3. 点击条目：向菜单项派发 Escape 键事件（原生 Popup 有 escapeToClose，会经 React 根容器
//     收到并关闭菜单），随后在菜单正下方打开我们的回收站浮层（openTrashFloating）。
import { openTrashFloating } from "./trashHeadbar"
import { trashCount } from "./trash"

const MENU_CLASS = "orca-headbar-menu"
const ITEM_CLASS = "neo-trash-menu-item"

let bodyObserver: MutationObserver | null = null
const menuObservers = new Map<Element, MutationObserver>()

function buildItem(menu: Element): HTMLDivElement {
  const item = document.createElement("div")
  item.className = `orca-menu-text ${ITEM_CLASS}`

  const icon = document.createElement("i")
  icon.className = "ti ti-trash orca-menu-text-icon orca-menu-text-pre"
  const text = document.createElement("div")
  text.className = "orca-menu-text-text"
  text.textContent = "回收站"

  item.appendChild(icon)
  item.appendChild(text)

  item.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    onTrashClick(menu)
  })

  // 数量角标：异步取回收站条数，追加到文字后
  trashCount()
    .then((n) => {
      if (!item.isConnected || n <= 0) return
      const badge = document.createElement("span")
      badge.className = "neo-trash-menu-count"
      badge.textContent = String(n)
      text.appendChild(document.createTextNode(" "))
      text.appendChild(badge)
    })
    .catch(() => {})

  return item
}

function injectItem(menu: Element) {
  if (!menu.isConnected) return
  if (menu.querySelector(`.${ITEM_CLASS}`)) return
  menu.appendChild(buildItem(menu))
}

function onTrashClick(menu: Element) {
  // 关闭原生菜单：对菜单内第一个菜单项派发 Escape（Popup escapeToClose 会关闭整个浮层）
  const target = menu.querySelector(".orca-menu-text") ?? menu
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  )
  // 兜底：若 Escape 没生效（部分场景），用菜单外部 mousedown 关闭
  window.setTimeout(() => {
    if (menu.isConnected) {
      document.getElementById("headbar")?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      )
    }
  }, 30)

  // 等原生菜单关闭后，打开居中的回收站弹窗
  window.setTimeout(() => {
    openTrashFloating()
  }, 60)
}

/** 对单个菜单容器挂 childList 观察器：React 重渲染抹掉注入条目时重新补上 */
function watchMenu(menu: Element) {
  if (menuObservers.has(menu)) return
  const obs = new MutationObserver(() => {
    if (!menu.isConnected) {
      obs.disconnect()
      menuObservers.delete(menu)
      return
    }
    if (!menu.querySelector(`.${ITEM_CLASS}`)) injectItem(menu)
  })
  obs.observe(menu, { childList: true })
  menuObservers.set(menu, obs)
}

export function installTrashMenuInjector() {
  if (bodyObserver) return
  bodyObserver = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue
        const menus = node.matches(`.${MENU_CLASS}`)
          ? [node]
          : Array.from(node.querySelectorAll<Element>(`.${MENU_CLASS}`))
        for (const menu of menus) {
          injectItem(menu)
          watchMenu(menu)
        }
      }
      for (const node of m.removedNodes) {
        if (!(node instanceof Element)) continue
        const obs = menuObservers.get(node)
        if (obs) {
          obs.disconnect()
          menuObservers.delete(node)
        }
      }
    }
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })
}

export function disposeTrashMenuInjector() {
  bodyObserver?.disconnect()
  bodyObserver = null
  for (const obs of menuObservers.values()) obs.disconnect()
  menuObservers.clear()
}

/**
 * 需求 19：白板背景跟随 Neo 主题色。
 *
 * 逆向结论（虎鲸 app.asar，白板内嵌 Excalidraw 0.18）：
 * - 白板画布背景不是 CSS：renderScene 把 App state 的 viewBackgroundColor 直接
 *   绘制进 canvas 像素，CSS 变量 / 背景样式无法覆盖它。
 * - Excalidraw 原生支持 viewBackgroundColor === "transparent"：渲染前置函数 rp()
 *   遇到该值会跳过背景填充，画布变透明，露出画布容器背景。
 * - 画布容器 = 白板内 `.excalidraw`（与 `.excalidraw-container` 同一节点），
 *   自身没有任何背景。
 * - 虎鲸在 UIOptions 里禁用了「更改画布背景色」动作，且 initialData 默认不含
 *   viewBackgroundColor（Excalidraw 默认 #ffffff），所以原生白板永远是白底。
 *
 * 方案：功能开启时把 viewBackgroundColor 置为 "transparent"，背景色完全交给
 * CSS——neo-plus.css 的 body.neo-whiteboard-bg 规则把 var(--neo-background)
 * 垫在画布容器上，配色 / 明暗 / 饱和度一变立即跟随，无需再碰 React 状态。
 *
 * 副作用与自愈：setState 会经 componentDidUpdate → onChange 被虎鲸持久化进
 * 白板 JSON（编辑态下才落盘），即 "transparent" 可能留在数据里。因此观察器
 * 常驻：功能关闭时，把一切「透明底」画布恢复为默认 #ffffff（含带着残留数据
 * 重新打开的白板），保证关掉功能即完全还原原生观感，无需改写数据文件。
 * 恢复时只处理值为 "transparent" 的画布（这是本功能写入的），绝不改动
 * 用户可能存在的自定义底色。
 */

let observer: MutationObserver | null = null
let debounceTimer = 0
let enabled = false

const TRANSPARENT = "transparent"
const DEFAULT_BG = "#ffffff"

interface ExcalidrawApp {
  setState(state: Record<string, unknown>): void
  state: { viewBackgroundColor?: string } | null
}

/**
 * 沿 React 18 fiber 链向上找 ExcalidrawApp 类实例。判别特征：类组件实例
 * 且 props 同时含 initialData / excalidrawAPI / onChange（全树唯一，属于
 * Excalidraw 的 App 组件；虎鲸自己的 Whiteboard 组件是函数组件，无 stateNode）。
 */
function findExcalidrawApp(host: HTMLElement): ExcalidrawApp | null {
  const fiberKey = Object.getOwnPropertyNames(host).find((k) =>
    k.startsWith("__reactFiber$"),
  )
  if (!fiberKey) return null
  let fiber = (host as any)[fiberKey]
  for (let hops = 0; fiber && hops < 80; hops++) {
    const inst = fiber.stateNode
    if (
      inst != null &&
      typeof inst.setState === "function" &&
      inst.props != null &&
      "initialData" in inst.props &&
      typeof inst.props.onChange === "function" &&
      typeof inst.props.excalidrawAPI === "function"
    ) {
      return inst as ExcalidrawApp
    }
    fiber = fiber.return
  }
  return null
}

/** 当前功能状态下这块白板的画布是否已就位 */
function isDone(app: ExcalidrawApp): boolean {
  const cur = app.state?.viewBackgroundColor
  return enabled ? cur === TRANSPARENT : cur !== TRANSPARENT
}

/** 把画布底色设置到当前功能状态要求的值 */
function setViewBackground(app: ExcalidrawApp) {
  app.setState({ viewBackgroundColor: enabled ? TRANSPARENT : DEFAULT_BG })
}

/** 幂等应用一块白板；注入后稍作校验，被异步初始化重置就补注（最多 3 次） */
function applyWhiteboard(wb: HTMLElement) {
  const root = wb.querySelector<HTMLElement>(".excalidraw")
  if (!root) return
  const app = findExcalidrawApp(root)
  if (!app) return
  if (app.state == null) return
  if (isDone(app)) return
  setViewBackground(app)
  const verify = (attempt: number) => {
    if (!wb.isConnected) return
    if (isDone(app)) return
    if (attempt >= 3) return
    setViewBackground(app)
    window.setTimeout(() => verify(attempt + 1), 500 * (attempt + 1))
  }
  window.setTimeout(() => verify(0), 400)
}

function scan() {
  for (const wb of document.querySelectorAll<HTMLElement>(".orca-whiteboard")) {
    applyWhiteboard(wb)
  }
}

/** 观察器常驻（开时注入透明、关时兜底恢复白色），保证开关随时生效且可自愈 */
function ensureObserver() {
  if (observer) return
  // 只监听 childList（自己只调 setState，不写 DOM attribute），防抖后再扫描
  observer = new MutationObserver(() => {
    window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(scan, 200)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

export function enableWhiteboardBg() {
  enabled = true
  ensureObserver()
  scan()
}

export function disableWhiteboardBg() {
  enabled = false
  ensureObserver()
  // 立即恢复当前打开的白板为默认白底
  scan()
}

/** 插件卸载时的完整拆除（含观察器） */
export function disposeWhiteboardBg() {
  enabled = false
  observer?.disconnect()
  observer = null
  window.clearTimeout(debounceTimer)
  debounceTimer = 0
}

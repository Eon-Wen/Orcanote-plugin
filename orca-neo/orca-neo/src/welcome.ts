/**
 * 首次启用 Neo 主题的欢迎庆祝（复用写作达成时的那场彩带，见 confetti.ts）。
 *
 * 判断「Neo 生效」的依据：虎鲸把当前选中主题的 CSS 以
 *   <link rel="stylesheet" data-role="theme" href="file://…/plugins/<主题>/dist/<css>">
 * 注入 <head>，切主题即换掉这个 link（app.asar 逆向确认）。因此只看这个 link
 * 是否指向本插件的 neo.css——不推导设置项、不依赖明暗模式，看到什么就是什么。
 *
 * 播放规则（eon 需求）：
 *  - 第一次下载 Neo 并把它设为主题 → 放一次；
 *  - 插件更新后第一次使用 Neo → 再放一次（标记键带版本号，新版本 = 新键）；
 *  - Neo ↔ 其他主题来回切换 → 不重放（标记已持久化在插件数据里）。
 *
 * 性能：
 *  - 触发源是两个零成本事件订阅（settings 的 Valtio 通知 + 系统明暗 mql），
 *    每次触发只做一次 querySelector，无观察器、无轮询；
 *  - 插件数据只在真正放动画的那次各读写一次，其余时刻仅内存短路（celebrated）；
 *  - 动画本体复用 confetti 的优化实现（纸屑上限、结束移除 canvas）。
 *  - 尊重「庆祝动画」开关：关闭时不放（与写作达成一致），且先落标记，
 *    以后打开开关也不会补放旧欢迎。
 */
import { fireworks } from "./confetti"

const PLUGIN_NAME = "orca-neo"
const THEME_CSS = "neo.css"
/** 稍等主题切换完成渲染后再放动画 */
const DELAY_MS = 900

declare const __NEO_VERSION__: string

/** 本次会话已放过（内存短路，避免每次设置变更都去打后端） */
let celebrated = false
let unsubscribe: (() => void) | null = null
let mql: MediaQueryList | null = null
let onMqlChange: (() => void) | null = null

/** Neo 主题的 CSS 是否真实挂载中 */
function isNeoCssActive(): boolean {
  const link = document.querySelector<HTMLLinkElement>('link[data-role="theme"]')
  return (
    link != null &&
    (link.href ?? "").replace(/\\/g, "/").includes(`/plugins/${PLUGIN_NAME}/dist/${THEME_CSS}`)
  )
}

/** 标记键带版本号：升级插件后新键即「没放过」，欢迎动画重新放一次 */
function markKey(): string {
  return `neo-welcome:${orca.state.repo}:${__NEO_VERSION__}`
}

async function tryCelebrate(): Promise<void> {
  if (celebrated || !isNeoCssActive()) return
  celebrated = true
  try {
    const done = await orca.invokeBackend("get-plugin-data", PLUGIN_NAME, markKey())
    if (done != null) return
    // 先记录再放动画：开关关闭时也记录，避免以后打开开关被补放
    await orca.invokeBackend("set-plugin-data", PLUGIN_NAME, markKey(), String(Date.now()))
  } catch (e) {
    console.warn("[Neo] 欢迎动画标记读写失败：", e)
    return
  }
  const settings = (orca as any).state?.plugins?.[PLUGIN_NAME]?.settings as
    | Record<string, unknown>
    | undefined
  if (settings?.confettiEnabled === false) return
  window.setTimeout(() => fireworks(), DELAY_MS)
}

/** 安装欢迎庆祝监听：设置变化（含切主题）与系统明暗切换时检查一次 */
export function installWelcome(): void {
  if (unsubscribe) return
  unsubscribe = window.Valtio.subscribe(orca.state.settings, () => void tryCelebrate())
  mql = window.matchMedia("(prefers-color-scheme: dark)")
  onMqlChange = () => {
    // 系统明暗切换后，虎鲸的重新注入发生在 React effect 里，稍晚一步再查
    window.setTimeout(() => void tryCelebrate(), 250)
  }
  mql.addEventListener("change", onMqlChange)
  void tryCelebrate()
}

export function disposeWelcome(): void {
  unsubscribe?.()
  unsubscribe = null
  if (mql && onMqlChange) {
    mql.removeEventListener("change", onMqlChange)
  }
  mql = null
  onMqlChange = null
}

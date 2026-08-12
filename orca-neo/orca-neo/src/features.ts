import { PALETTE_MAP, PALETTES, type PaletteScheme } from "./palettes"
import { FEATURES, type NeoSettings } from "./settings"

const ROOT = document.documentElement

/** 插件写入的 CSS 变量前缀，卸载时按这个清理 */
const VAR_PREFIX = "--neo-"
const OWNED_VARS = [
  "--neo-base-color",
  "--neo-saturation",
  "--neo-x-primary",
  "--neo-x-accent",
  "--neo-x-background",
  "--neo-x-surface",
  "--neo-x-on-background",
  "--neo-x-on-surface",
  "--neo-texture-opacity",
  "--neo-bg-image",
  "--neo-bg-veil",
]

/** 「跟随时间」模式下各时段对应的预设配色 */
const TIME_PALETTES: { until: number; id: string }[] = [
  { until: 5, id: "midnight" },
  { until: 9, id: "sakura" },
  { until: 12, id: "aerisland" },
  { until: 17, id: "ocean" },
  { until: 20, id: "dusk" },
  { until: 24, id: "starry" },
]

let randomPaletteId: string | null = null

function pickTimePalette(): string {
  const h = new Date().getHours()
  return TIME_PALETTES.find((t) => h < t.until)?.id ?? "default"
}

function pickRandomPalette(): string {
  if (randomPaletteId == null) {
    randomPaletteId = PALETTES[Math.floor(Math.random() * PALETTES.length)]!.id
  }
  return randomPaletteId
}

function isDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** 解析出当前该使用的配色方案 id（把 followTime / random 归一化成具体 id） */
export function resolvePaletteId(settings: NeoSettings): string {
  switch (settings.palette) {
    case "followTime":
      return pickTimePalette()
    case "random":
      return pickRandomPalette()
    default:
      return settings.palette
  }
}

function applyScheme(scheme: PaletteScheme | undefined) {
  const map: [keyof PaletteScheme, string][] = [
    ["primary", "--neo-x-primary"],
    ["accent", "--neo-x-accent"],
    ["background", "--neo-x-background"],
    ["surface", "--neo-x-surface"],
    ["onBackground", "--neo-x-on-background"],
    ["onSurface", "--neo-x-on-surface"],
  ]
  for (const [field, cssVar] of map) {
    const value = scheme?.[field]
    if (value) ROOT.style.setProperty(cssVar, value)
    else ROOT.style.removeProperty(cssVar)
  }
}

/** 应用配色：写 --neo-base-color 与各 --neo-x-* 覆盖变量 */
export function applyPalette(settings: NeoSettings) {
  const dark = isDark()

  if (settings.palette === "custom") {
    ROOT.style.setProperty("--neo-base-color", settings.customColor || "#6a85e3")
    applyScheme(undefined)
  } else {
    const palette = PALETTE_MAP[resolvePaletteId(settings)]
    // 有些配色只提供了单一模式（如纯暗色的 abyss），缺失时回落到另一模式
    let scheme: PaletteScheme | undefined
    if (dark) {
      scheme = (settings.invertDark && palette?.darkInvert
        ? { ...palette.dark, ...palette.darkInvert }
        : palette?.dark) ?? palette?.light
    } else {
      scheme = palette?.light ?? palette?.dark
    }

    if (scheme?.base) ROOT.style.setProperty("--neo-base-color", scheme.base)
    else ROOT.style.removeProperty("--neo-base-color")
    applyScheme(scheme)
  }

  const saturation = Number(settings.saturation)
  ROOT.style.setProperty(
    "--neo-saturation",
    String(Number.isFinite(saturation) ? saturation : 1),
  )
}

/** 应用功能开关：切换 body 上的 neo-* 类 */
export function applyFeatures(settings: NeoSettings) {
  const body = document.body
  for (const f of FEATURES) {
    body.classList.toggle(f.className, settings[f.key] === true)
  }

  // 纹理：先在 body 上切换 neo-texture，再叠加具体纹理类 neo-texture-<id>
  // （每个纹理图由 textures.css 按类名提供 background-image）
  const texId = (settings.texture ?? "none") as string
  const texClass = texId !== "none" ? `neo-texture-${texId}` : ""
  const texOpacity = Number(settings.textureOpacity)
  const hasTexture = texClass !== "" && Number.isFinite(texOpacity) && texOpacity > 0
  // 清掉上一次可能残留的具体纹理类，避免叠加
  for (const cls of Array.from(body.classList)) {
    if (cls.startsWith("neo-texture-")) body.classList.remove(cls)
  }
  body.classList.toggle("neo-texture", hasTexture)
  if (hasTexture && texClass) {
    body.classList.add(texClass)
    ROOT.style.setProperty("--neo-texture-opacity", String(texOpacity))
  } else {
    ROOT.style.removeProperty("--neo-texture-opacity")
  }

  const bg = (settings.backgroundImage ?? "").trim()
  body.classList.toggle("neo-custom-bg", bg !== "")
  if (bg) {
    ROOT.style.setProperty("--neo-bg-image", `url("${bg.replace(/"/g, '\\"')}")`)
    ROOT.style.setProperty("--neo-bg-veil", String(settings.backgroundVeil ?? 0.86))
  } else {
    ROOT.style.removeProperty("--neo-bg-image")
    ROOT.style.removeProperty("--neo-bg-veil")
  }
}

/* --------------------------------------------------------------------------
   平滑光标
   -------------------------------------------------------------------------- */
class SmoothCaret {
  private el: HTMLDivElement | null = null
  private raf = 0
  private hideTimer = 0
  private movingTimer = 0
  private readonly onEvent = () => this.schedule()

  enable() {
    if (this.el) return
    const el = document.createElement("div")
    el.className = "neo-caret"
    document.body.appendChild(el)
    this.el = el

    document.addEventListener("selectionchange", this.onEvent)
    document.addEventListener("scroll", this.onEvent, true)
    window.addEventListener("resize", this.onEvent)
    this.schedule()
  }

  disable() {
    document.removeEventListener("selectionchange", this.onEvent)
    document.removeEventListener("scroll", this.onEvent, true)
    window.removeEventListener("resize", this.onEvent)
    cancelAnimationFrame(this.raf)
    clearTimeout(this.hideTimer)
    clearTimeout(this.movingTimer)
    this.el?.remove()
    this.el = null
  }

  private schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.update())
  }

  private update() {
    const el = this.el
    if (!el) return

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      el.classList.remove("neo-caret-visible")
      return
    }

    const range = sel.getRangeAt(0)
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !active.isContentEditable) {
      el.classList.remove("neo-caret-visible")
      return
    }

    let rect = range.getClientRects()[0]
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      // 空行时 range 没有可用矩形，退回到所在元素的位置
      const probe = range.startContainer
      const host =
        probe.nodeType === Node.ELEMENT_NODE
          ? (probe as HTMLElement)
          : probe.parentElement
      rect = host?.getBoundingClientRect() as DOMRect
    }
    if (!rect) {
      el.classList.remove("neo-caret-visible")
      return
    }

    const height = rect.height || parseFloat(getComputedStyle(active).lineHeight) || 18
    el.style.left = `${rect.left}px`
    el.style.top = `${rect.top}px`
    el.style.height = `${height}px`
    el.classList.add("neo-caret-visible", "neo-caret-moving")

    clearTimeout(this.movingTimer)
    this.movingTimer = window.setTimeout(
      () => el.classList.remove("neo-caret-moving"),
      140,
    )
  }
}

export const smoothCaret = new SmoothCaret()

/* --------------------------------------------------------------------------
   跟随时间 / 系统暗色变化的自动重算
   -------------------------------------------------------------------------- */
export class AutoRefresher {
  private timer = 0
  private mql: MediaQueryList | null = null
  private readonly onChange = () => this.callback?.()
  private callback: (() => void) | null = null

  start(callback: () => void, needsClock: boolean) {
    this.stop()
    this.callback = callback

    this.mql = window.matchMedia("(prefers-color-scheme: dark)")
    this.mql.addEventListener("change", this.onChange)

    if (needsClock) {
      // 每分钟检查一次时段是否跨越了边界
      this.timer = window.setInterval(this.onChange, 60_000)
    }
  }

  stop() {
    this.mql?.removeEventListener("change", this.onChange)
    this.mql = null
    clearInterval(this.timer)
    this.timer = 0
    this.callback = null
  }
}

/** 卸载时清理插件写入的所有 body class 与 CSS 变量 */
export function cleanupDom() {
  const body = document.body
  for (const f of FEATURES) body.classList.remove(f.className)
  body.classList.remove("neo-texture", "neo-custom-bg")
  for (const v of OWNED_VARS) ROOT.style.removeProperty(v)
  // 兜底：清掉任何遗留的 --neo-* 内联变量
  for (const name of Array.from(ROOT.style)) {
    if (name.startsWith(VAR_PREFIX)) ROOT.style.removeProperty(name)
  }
}

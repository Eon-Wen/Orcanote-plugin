import { PALETTE_MAP, PALETTES, type PaletteScheme } from "./palettes"
import { FEATURES, paletteAvailableInMode, type NeoSettings } from "./settings"
import { ENTER_WAV, KEY_WAV } from "./sounds"

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

/** 当前模式下可用的预设配色（含该模式色值的方案） */
function palettesInMode(dark: boolean): typeof PALETTES {
  return PALETTES.filter((p) => paletteAvailableInMode(p, dark))
}

function pickTimePalette(): string {
  const dark = isDark()
  const h = new Date().getHours()
  // 优先取当前时段、且当前模式可用的配色；否则退到本模式下第一个时段配色
  const inMode = TIME_PALETTES.filter((t) => paletteAvailableInMode(PALETTE_MAP[t.id]!, dark))
  if (inMode.length === 0) return "default"
  return inMode.find((t) => h < t.until)?.id ?? inMode[inMode.length - 1]!.id
}

function pickRandomPalette(): string {
  if (randomPaletteId == null) {
    const pool = palettesInMode(isDark())
    const src = pool.length > 0 ? pool : PALETTES
    randomPaletteId = src[Math.floor(Math.random() * src.length)]!.id
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

  // 纹理：先在 body 上切换 neo-texture，再叠加具体纹理类 neo-texture-<id>。
  // 每种纹理的基础强度(--neo-texture-base)/混合(--neo-texture-blend)等由
  // textures.css 按 body.neo-texture-<id> 提供；最终不透明度 = base × --neo-texture-opacity（乘数）。
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
    // 自定义图纹理：复用“自定义背景图”设置里的图片，避免与背景功能互相干扰
    if (texId === "customimage") {
      const img = (settings.backgroundImage ?? "").trim()
      ROOT.style.setProperty(
        "--neo-customimage-url",
        img ? `url("${img.replace(/"/g, '\\"')}")` : "none",
      )
    } else {
      ROOT.style.removeProperty("--neo-customimage-url")
    }
  } else {
    ROOT.style.removeProperty("--neo-texture-opacity")
    ROOT.style.removeProperty("--neo-customimage-url")
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

/* --------------------------------------------------------------------------
   沉浸模式 —— 忠实移植思源 Neo「沉浸模式」的核心效果：
   当前编辑的块（光标所在块）顶部到下方渲染一条跟随光标的柔和强调色高亮带，
   块上下自然淡出，形成“聚焦当前行”的沉浸感；同时隐藏顶栏工具与块侧边按钮，
   鼠标移入时才显现。

   实现：JS 监听光标变化 / 滚动 / 窗口缩放，把光标所在 .orca-block 的视口中心 Y
   与半高写入遮罩元素的 --neo-iveil-y / --neo-iveil-h；CSS 用这两条变量画一条
   强调色渐变带。坐标用视口坐标，遮罩 position:fixed 全屏铺开，故与滚动天然对齐。
   -------------------------------------------------------------------------- */
class Immersive {
  private veil: HTMLDivElement | null = null
  private raf = 0
  private readonly onEvent = () => this.schedule()

  enable() {
    if (this.veil) return
    const veil = document.createElement("div")
    veil.className = "neo-immersive-veil"
    document.body.appendChild(veil)
    this.veil = veil

    document.addEventListener("selectionchange", this.onEvent)
    window.addEventListener("scroll", this.onEvent, true)
    window.addEventListener("resize", this.onEvent)
    this.update()
  }

  disable() {
    document.removeEventListener("selectionchange", this.onEvent)
    window.removeEventListener("scroll", this.onEvent, true)
    window.removeEventListener("resize", this.onEvent)
    cancelAnimationFrame(this.raf)
    this.veil?.remove()
    this.veil = null
  }

  private schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.update())
  }

  private update() {
    const veil = this.veil
    if (!veil) return

    const sel = window.getSelection()
    const active = document.activeElement
    if (
      !sel ||
      sel.rangeCount === 0 ||
      !(active instanceof HTMLElement) ||
      !active.isContentEditable
    ) {
      veil.style.opacity = "0"
      return
    }

    // 高亮区 = 光标所在的「当前行」。用 range 的行矩形，而不是整块 rect，
    // 这样父块本身即使包含子块，光带也只照在光标这一行、不会连着子块一起亮。
    const range = sel.getRangeAt(0)
    let rect = range.getClientRects()[0]
    if (!rect || (rect.height === 0 && rect.width === 0)) {
      // 空行 / 取不到矩形时，退到光标所在块自身的首行内容
      const node: Node | null =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement
      const block =
        (node as HTMLElement | null)?.closest?.(".orca-block") ??
        (active.closest(".orca-block") as HTMLElement | null) ??
        active
      const host =
        (block?.querySelector(".orca-repr-main") as HTMLElement | null) ??
        block ??
        active
      rect = host.getBoundingClientRect()
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      veil.style.opacity = "0"
      return
    }

    // 把光带裁剪到编辑器区域（#main），不照到顶栏 / 侧栏等 UI 部分
    const region =
      document.getElementById("main") ??
      document.querySelector(".orca-panels-container")
    let clip = ""
    if (region) {
      const r = region.getBoundingClientRect()
      clip = `inset(${r.top}px 0px ${window.innerHeight - r.bottom}px ${r.left}px)`
    }
    veil.style.clipPath = clip || "none"

    const y = rect.top + rect.height / 2
    const h = rect.height / 2
    veil.style.opacity = "1"
    veil.style.setProperty("--neo-iveil-y", `${y}px`)
    veil.style.setProperty("--neo-iveil-h", `${h}px`)
  }
}

export const immersive = new Immersive()

/* --------------------------------------------------------------------------
   打字机模式 —— 输入时把光标所在行始终垂直居中于编辑器视口（思源 Neo 同款
   “打字机”效果）。实现：监听 selectionchange / keyup / 编辑器内点击，取光标
   所在行的视口矩形，计算其相对滚动容器的偏移，把滚动容器 scrollTop 调到让
   该行落在容器正中。坐标用视口坐标，与滚动天然对齐。
   -------------------------------------------------------------------------- */
class Typewriter {
  private raf = 0
  private readonly onEvent = () => this.schedule()

  enable() {
    if (this.raf) return
    document.addEventListener("selectionchange", this.onEvent)
    window.addEventListener("keyup", this.onEvent)
    // 点击 / 触控定位光标时也居中
    document.addEventListener("mouseup", this.onEvent)
    this.schedule()
  }

  disable() {
    cancelAnimationFrame(this.raf)
    document.removeEventListener("selectionchange", this.onEvent)
    window.removeEventListener("keyup", this.onEvent)
    document.removeEventListener("mouseup", this.onEvent)
    this.raf = 0
  }

  private schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.center())
  }

  private center() {
    const sel = window.getSelection()
    const active = document.activeElement
    if (
      !sel ||
      sel.rangeCount === 0 ||
      !(active instanceof HTMLElement) ||
      !active.isContentEditable
    ) {
      return
    }

    const range = sel.getRangeAt(0)
    let rect = range.getClientRects()[0]
    if (!rect || (rect.height === 0 && rect.width === 0)) {
      const node: Node | null =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement
      const block =
        (node as HTMLElement | null)?.closest?.(".orca-block") ??
        (active.closest(".orca-block") as HTMLElement | null) ??
        active
      rect = block.getBoundingClientRect()
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) return

    const scroller = this.getScrollParent(active as HTMLElement)
    const cRect = scroller.getBoundingClientRect()
    // 当前行中心相对容器中心的偏移；scrollTop 加上该偏移即把行移到正中
    const delta = rect.top + rect.height / 2 - (cRect.top + cRect.height / 2)
    scroller.scrollTop += delta
  }

  /** 向上找到真正会滚动的祖先容器 */
  private getScrollParent(el: HTMLElement): HTMLElement {
    let node: HTMLElement | null = el
    while (node && node !== document.body) {
      const cs = getComputedStyle(node)
      const scrollable =
        cs.overflowY === "auto" ||
        cs.overflowY === "scroll" ||
        cs.overflowY === "overlay"
      if (scrollable && node.scrollHeight > node.clientHeight + 1) return node
      node = node.parentElement
    }
    return (
      (document.querySelector(".orca-block-editor") as HTMLElement | null) ??
      (document.getElementById("main") as HTMLElement | null) ??
      el
    )
  }
}

export const typewriter = new Typewriter()

/* --------------------------------------------------------------------------
   打字音 —— 敲击键盘时播放打字机音效。素材取自 GitHub 项目 fgheng/keysound
   （MIT 许可）的 typewriter-key.wav / typewriter-enter.wav，以 base64 data URI
   内联在 src/sounds.ts 中（完全离线，无需 file:// 加载）。

   实现：监听 keydown，仅在编辑器（contenteditable）聚焦时发声；Enter 用
   “回车”音、其余按键用“按键”音，并随机微调音高让连续敲击更自然。
   关键修正：①用内联 data URI，绕开 webview 对 file:// 媒体的跨域 / 加载限制；
   ②每次 new 出的 Audio 放进 pool 持有引用，避免被 GC 回收导致播放被掐断
   （播放结束后从 pool 移除）。每次独立播放，天然支持多键叠音（混音）。
   -------------------------------------------------------------------------- */
class TypeSound {
  private readonly onKey = (e: KeyboardEvent) => this.play(e)
  /** 持有正在播放的 Audio 引用，防止被垃圾回收中断播放 */
  private pool: Audio[] = []

  enable() {
    document.addEventListener("keydown", this.onKey, true)
  }

  disable() {
    document.removeEventListener("keydown", this.onKey, true)
    this.pool = []
  }

  private play(e: KeyboardEvent) {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !active.isContentEditable) {
      return
    }
    // 组合键（Ctrl/Cmd/Alt）多为快捷键，不发声
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const url = e.key === "Enter" ? ENTER_WAV : KEY_WAV
    const audio = new Audio(url)
    audio.volume = 0.45
    audio.playbackRate = 0.95 + Math.random() * 0.1 // 0.95 ~ 1.05 随机音高
    this.pool.push(audio)
    audio.addEventListener("ended", () => {
      audio.removeAttribute("src")
      const i = this.pool.indexOf(audio)
      if (i >= 0) this.pool.splice(i, 1)
    })
    // 播放失败（极少见）静默忽略
    audio.play().catch(() => {})
  }
}

export const typeSound = new TypeSound()

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

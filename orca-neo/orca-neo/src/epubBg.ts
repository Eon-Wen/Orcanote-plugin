// EPUB 书页背景跟随主题 + 自定义背景图。
//
// 逆向结论（app.asar 渲染 bundle）：
// - EPUB 用 epub.js 渲染，manager:"default" 会把每章 HTML 写进同源 iframe
//   （iframe.sandbox="allow-same-origin"，allowScriptedContent 为 false），
//   主文档的 CSS / CSS 变量进不了 iframe，所以必须用 JS 把颜色/图片写进每个
//   iframe 的 <head>。
// - 虎鲸原生的 EPUB 明暗主题也是这么做的：themes.register("dark"/"light",
//   {"body.dark":{background,color,...}}) + themes.select()，epub.js 把规则写进
//   固定 id 的 <style>（epubjs-inserted-css-light/dark），渲染时还会按
//   hooks.content 重新 apply（老虎默认对每个 EPUB select("light")，
//   其 #fdfdfd 背景会盖掉本插件注入）。
// - 翻章时 epub.js 复用 iframe 用 document.write 重写文档，注入的 <style>
//   会被抹掉，需要观察器补回。
//
// 自愈机制（MutationObserver 铁律：写之前先判断值是否变化）：
// ① body 级观察器（防抖 200ms）发现新的 .orca-epub-viewer iframe 时注入；
// ② 每个已注入文档再挂一个观察器：只观察 <html> 与 <head> 的 childList
//   （整文档重写 = html 子节点全换；主题 style 插队 = head 追加），
//   不订阅 subtree——章节文档加载时节点海量变化，subtree 观察是事件风暴；
// ③ 注入后把本插件 style 移到 head 末尾（epub.js 的主题 style 后插者赢）；
// ④ 双保险：背景/文字色用内联 important 直接钉在 html/body 上，内联
//    important 权重高于任何样式表，顺序斗争输了也不丢效果。
//
// 性能：style 内容按主题快照缓存（书有几十章、每章一份注入，避免每次
// 拼字符串）；内联钉值时先比较现有值，相同就不再写（避免无谓 style 重算）。
//
// 颜色：有自定义背景图（设置 epubBgImage）时图片 cover 铺满书页、主题底色
// 兜底；否则纯主题底色（--neo-background，含 oklch，Chromium iframe 内同样
// 支持）。暗色模式下正文强制用 --neo-on-background（否则黑字落在深色纸上
// 不可读）。

import type { NeoSettings } from "./settings"

const STYLE_ID = "neo-epub-theme"

let enabled = false
let bodyObserver: MutationObserver | null = null
let scanTimer = 0
const docObservers = new Map<Document, MutationObserver>()
const docTimers = new Map<Document, number>()
const observedHeads = new WeakSet<Element>()

interface Theme {
  bg: string
  image: string
  text: string
  link: string
}

let current: Theme = { bg: "", image: "", text: "", link: "" }

function isDark(): boolean {
  return document.body.classList.contains("neo-scheme-dark")
}

/** 读插件在主文档定义的 CSS 变量（未设置时返回空串） */
function cssVar(name: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    ""
  )
}

function compute(settings: NeoSettings): Theme {
  const dark = isDark()
  const bg = cssVar("--neo-background") || (dark ? "#1e1e24" : "#ffffff")
  const rawImage = String(settings.epubBgImage ?? "").trim()
  const image = rawImage ? `url("${rawImage.replace(/"/g, '\\"')}")` : ""
  let text = ""
  let link = ""
  if (dark) {
    // 与虎鲸原生 EPUB 暗色主题同思路：正文统一变浅，链接用主题色
    text = cssVar("--neo-on-background") || "#e8e8e8"
    link = cssVar("--neo-primary") || "#6ea8fe"
  }
  return { bg, image, text, link }
}

function buildCssRaw(t: Theme): string {
  let css = `html, body { background-color: ${t.bg} !important;`
  if (t.image) {
    css += ` background-image: ${t.image} !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important;`
  }
  css += " }"
  if (t.text) {
    css += ` body { color: ${t.text} !important; }`
    css += ` body :is(p, span, div, h1, h2, h3, h4, h5, h6, li, td, th, dd, dt, blockquote) { color: ${t.text} !important; }`
  }
  if (t.link) css += ` body a { color: ${t.link} !important; }`
  return css
}

/** buildCss 结果按主题快照缓存（几十章 × 每章一份注入，省重复拼串） */
let cachedThemeKey = ""
let cachedCss = ""

function buildCss(t: Theme): string {
  const key = t.bg + "\u0001" + t.image + "\u0001" + t.text + "\u0001" + t.link
  if (key !== cachedThemeKey) {
    cachedThemeKey = key
    cachedCss = buildCssRaw(t)
  }
  return cachedCss
}

/** 值不同才写内联 important（避免重复写入触发 style 重算） */
function setPropIfChanged(el: HTMLElement, prop: string, value: string) {
  if (
    el.style.getPropertyValue(prop) !== value ||
    el.style.getPropertyPriority(prop) !== "important"
  ) {
    el.style.setProperty(prop, value, "important")
  }
}

/** 把背景（色/图）以内联 important 钉在元素上（防样式表插队） */
function pinInline(el: HTMLElement) {
  setPropIfChanged(el, "background-color", current.bg)
  el.style.removeProperty("background-image")
  el.style.removeProperty("background-size")
  el.style.removeProperty("background-position")
  el.style.removeProperty("background-repeat")
  if (current.image) {
    setPropIfChanged(el, "background-image", current.image)
    setPropIfChanged(el, "background-size", "cover")
    setPropIfChanged(el, "background-position", "center")
    setPropIfChanged(el, "background-repeat", "no-repeat")
  }
}

function inject(doc: Document) {
  const head = doc.head ?? doc.documentElement
  if (!head) return
  // head 出现后补观察它：epub.js 应用主题会往 head 追加 style（后插者赢），
  // 需要捕捉插队并夺回末尾位置
  const obs = docObservers.get(doc)
  if (obs && doc.head && !observedHeads.has(doc.head)) {
    obs.observe(doc.head, { childList: true })
    observedHeads.add(doc.head)
  }
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement("style")
    style.id = STYLE_ID
    head.appendChild(style)
  }
  const css = buildCss(current)
  if (style.textContent !== css) style.textContent = css
  // 保持本插件 style 是 head 里最后一个 <style>：epub.js 每次应用主题都会
  // 追加自己的 style，同样 !important 时后插者赢，必须把它压回去。
  const tail = head.querySelector("style:last-of-type")
  if (tail !== style && enabled) head.appendChild(style)
  // 双保险：内联 important 直接钉在 html/body 上，权重高于任何样式表
  if (enabled) {
    pinInline(doc.documentElement)
    if (doc.body) {
      pinInline(doc.body)
      if (current.text) {
        setPropIfChanged(doc.body, "color", current.text)
        setPropIfChanged(doc.body, "-webkit-text-fill-color", current.text)
      } else {
        doc.body.style.removeProperty("color")
        doc.body.style.removeProperty("-webkit-text-fill-color")
      }
    }
  }
}

/** 注入是否完好：style 存在、内容最新、且仍是最后一个 <style> */
function injectedIntact(doc: Document): boolean {
  const head = doc.head ?? doc.documentElement
  if (!head) return false
  const style = doc.getElementById(STYLE_ID)
  if (!style || style.tagName !== "STYLE") return false
  if (style.textContent !== buildCss(current)) return false
  return head.querySelector("style:last-of-type") === style
}

function watchDoc(doc: Document) {
  if (docObservers.has(doc)) return
  const obs = new MutationObserver(() => {
    if (!enabled) return
    // 50ms 防抖：整文档重写是一次性 mutation 突发，合并成一次注入
    window.clearTimeout(docTimers.get(doc))
    docTimers.set(
      doc,
      window.setTimeout(() => {
        docTimers.delete(doc)
        if (!enabled) return
        if (injectedIntact(doc)) return
        inject(doc)
      }, 50),
    )
  })
  // 只观察 <html> 与 <head> 的 childList，不订阅 subtree：
  // 整文档重写 = html 子节点全换；主题 style 插队 = head 追加。
  // 章节文档加载时节点海量变化，subtree 观察是事件风暴（卡顿元凶之一）。
  obs.observe(doc.documentElement, { childList: true })
  if (doc.head) {
    obs.observe(doc.head, { childList: true })
    observedHeads.add(doc.head)
  }
  docObservers.set(doc, obs)
}

function scan() {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>(
    ".orca-epub-viewer iframe, .orca-repr-epub-container iframe",
  )) {
    let doc: Document | null = null
    try {
      doc = frame.contentDocument
    } catch {
      continue // 非本插件能访问的 iframe（理论上不会出现）
    }
    if (!doc?.documentElement) continue
    watchDoc(doc)
    inject(doc)
  }
}

function ensureBodyObserver() {
  if (bodyObserver) return
  bodyObserver = new MutationObserver(() => {
    window.clearTimeout(scanTimer)
    scanTimer = window.setTimeout(scan, 200)
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })
}

/** apply() 的入口：开/关由 epubBg 开关驱动，开启时同步刷新颜色与背景图 */
export function applyEpubBg(settings: NeoSettings) {
  const want = settings.epubBg === true
  if (want) {
    enabled = true
    current = compute(settings)
    ensureBodyObserver()
    scan()
  } else if (enabled) {
    enabled = false
    window.clearTimeout(scanTimer)
    scanTimer = 0
    bodyObserver?.disconnect()
    bodyObserver = null
    for (const [, t] of docTimers) window.clearTimeout(t)
    docTimers.clear()
    for (const [doc, obs] of docObservers) {
      obs.disconnect()
      doc.getElementById(STYLE_ID)?.remove()
    }
    docObservers.clear()
  }
}

export function disposeEpubBg() {
  applyEpubBg({ epubBg: false, epubBgImage: "" } as NeoSettings)
}

// 写作进度统计（元·主·Express 子标签）
//
// 行为：当一个块被打上「元·主·Express」（可配置）标签的**子标签**时，在该标签右侧
// 注入一个圆点；点击圆点弹出统计面板，展示该块**所有后代子块**的：
//   字数 / 字符数(计空格) / 字符数(不计空格) / 非中文单词数 /
//   中文字符数 / 标点符号数 / 子块数量
// 以及在该子标签上设定的「目标字数」，并用圆环显示
//   (中文字符数 + 非中文单词数) / 目标字数 的完成度。
//
// 数据来源（均已对照 app.asar 校验）：
//   - 块的标签：block.properties 里 name==="_tags" 的 value 是 ref id 数组，
//     再到 block.refs 里按 id 取到 tag ref（ref.type === 2 / RefType.Property）。
//   - 标签层级：子标签块的 `_is` 属性（TextChoices/multi）存父标签别名；
//     后端 `get-children-tags` 可直接列出某标签的子标签。
//   - 完成度达 100%（紫色）时触发全屏彩带庆祝（见 src/confetti.ts）。

import { fireworks } from "./confetti"
//   - 子树文本：后端 `get-block-tree` 一次返回整棵子树的块数组，块的纯文本在
//     block.text（尾部会带 "#标签" 文本，需按原生 removeTrailingTags 剔除）。
//   - 目标字数：优先取该块 tag ref 的 data（本块填写值），
//     回退取标签块自身同名属性（该标签的默认值）。

const DOT = "neo-wc-dot"
const POPUP = "neo-wc-popup"

interface TagRefData {
  name: string
  value: unknown
  type?: number
}

interface TagRef {
  id: number
  from: number
  to: number
  type: number
  alias?: string
  data?: TagRefData[]
}

interface BlockProp {
  name: string
  value: unknown
  type?: number
}

interface OrcaBlock {
  id: number
  text?: string | null
  children?: number[]
  aliases?: string[]
  properties?: BlockProp[]
  refs?: TagRef[]
}

interface Stats {
  words: number
  charsWithSpaces: number
  charsNoSpaces: number
  nonChineseWords: number
  chinese: number
  punct: number
  blocks: number
}

let enabled = false
let parentTag = "元·主·Express"
let targetProp = "目标字数"
let deadlineProp = "截止日期"

/** 完成度 → 圆环/小环配色（0~25 红、26~50 黄、51~75 蓝、76~99 绿、100 紫） */
function ringColor(pct: number): string {
  if (pct >= 1) return "purple"
  if (pct >= 0.76) return "green"
  if (pct >= 0.51) return "blue"
  if (pct >= 0.26) return "yellow"
  return "red"
}

let mo: MutationObserver | null = null
let rafPending = false
let popup: HTMLElement | null = null

/** 目标标签的全部后代标签名（小写） */
let childTags = new Set<string>()
let childTagsLoading: Promise<void> | null = null

// ---------------------------------------------------------------------------
// 标签层级
// ---------------------------------------------------------------------------

const backend = (msg: string, ...args: unknown[]): Promise<any> =>
  (orca as any).invokeBackend(msg, ...args)

/** 拉取「目标标签」的所有后代标签名。层级通常只有 1–2 层，这里最多展开 4 层。 */
async function loadChildTags(): Promise<void> {
  const out = new Set<string>()
  try {
    const root = await backend("get-blockid-by-alias", parentTag)
    const rootId = root?.id
    if (rootId != null) {
      let frontier: number[] = [rootId]
      for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
        const next: number[] = []
        for (const id of frontier) {
          const kids = (await backend("get-children-tags", id)) ?? []
          for (const k of kids) {
            const name = typeof k === "string" ? k : k?.name
            if (!name) continue
            const low = String(name).toLowerCase()
            if (out.has(low)) continue
            out.add(low)
            let kid = typeof k === "object" ? k?.id : null
            if (kid == null) kid = (await backend("get-blockid-by-alias", name))?.id
            if (kid != null) next.push(kid)
          }
        }
        frontier = next
      }
    }
  } catch {
    /* 后端不可用时保持空集合，不注入圆点 */
  }
  childTags = out
}

/** 确保标签集合已就绪（并发去重） */
function ensureChildTags(): Promise<void> {
  if (childTagsLoading == null) {
    childTagsLoading = loadChildTags().finally(() => {
      childTagsLoading = null
    })
  }
  return childTagsLoading
}

// ---------------------------------------------------------------------------
// 文本统计
// ---------------------------------------------------------------------------

/** 与原生 removeTrailingTags 同源：剔除文本尾部的 "#标签" 串 */
const TRAILING_TAGS = / (?:#([^,#]|(?<! )#)+(?:,\s*)?)+$/

/** CJK 统一表意文字（含扩展 A/B 与兼容区） */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu
/** 非中文单词：以字母/数字开头的连续片段 */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu
/** 标点（Unicode 标点类，已含中文全角标点） */
const PUNCT = /\p{P}/gu

function emptyStats(): Stats {
  return {
    words: 0,
    charsWithSpaces: 0,
    charsNoSpaces: 0,
    nonChineseWords: 0,
    chinese: 0,
    punct: 0,
    blocks: 0,
  }
}

/** 逐块累加（而非拼接后统一算），避免人为分隔符污染字符数 */
function accumulate(acc: Stats, raw: string): void {
  const text = raw.replace(TRAILING_TAGS, "")
  if (!text) return
  acc.charsWithSpaces += Array.from(text).length
  acc.charsNoSpaces += Array.from(text.replace(/\s/gu, "")).length
  acc.chinese += text.match(CJK)?.length ?? 0
  // 中文先替换为空格，避免 \p{L} 把汉字也算成单词
  acc.nonChineseWords += text.replace(CJK, " ").match(WORD)?.length ?? 0
  acc.punct += text.match(PUNCT)?.length ?? 0
}

/**
 * 统计 blockId 的**所有后代块**（不含自身）。
 * 注：后端 get-block-tree 返回的是「根块之外的全部后代块」扁平数组（根块本身被
 * 排除），所以直接遍历数组累加即可，不必再按 children 递归；兼容起见遇到根块跳过。
 */
async function computeStats(blockId: number): Promise<Stats> {
  const acc = emptyStats()
  const tree: OrcaBlock[] = (await backend("get-block-tree", blockId)) ?? []
  for (const b of tree) {
    if (Number(b.id) === blockId) continue
    acc.blocks++
    accumulate(acc, b.text ?? "")
  }

  acc.words = acc.chinese + acc.nonChineseWords
  return acc
}

// ---------------------------------------------------------------------------
// 目标字数
// ---------------------------------------------------------------------------

const norm = (s: string): string => s.trim().toLowerCase()

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string") {
    // 允许 "5万" / "5,000" / "3000字" 这类写法
    const t = v.replace(/[,，\s]/g, "")
    const wan = /^([\d.]+)\s*[万萬]/.exec(t)
    if (wan) return Math.round(parseFloat(wan[1]) * 10000)
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 从 DOM 上的 .orca-tag 反查它对应的 tag ref */
function refForTagEl(block: OrcaBlock, tagEl: HTMLElement): TagRef | null {
  const ids = (block.properties?.find((p) => p.name === "_tags")?.value ??
    []) as number[]
  const refs = ids
    .map((id) => block.refs?.find((r) => r.id === id))
    .filter((r): r is TagRef => r != null)
  if (refs.length === 0) return null

  const name = norm(tagEl.dataset.name ?? "")
  const byAlias = refs.find((r) => norm(r.alias ?? "") === name)
  if (byAlias != null) return byAlias

  // 别名对不上时（例如 ref 未带 alias）退回 DOM 次序：
  // .orca-tags 的子元素顺序与 _tags 数组一致（原生 Sortable 就按它排序）
  const sibs = Array.from(
    tagEl.parentElement?.querySelectorAll<HTMLElement>(":scope > .orca-tag") ?? [],
  )
  const idx = sibs.indexOf(tagEl)
  return idx >= 0 ? (refs[idx] ?? null) : null
}

/** 目标字数：本块填写值优先，其次标签自身的默认值 */
async function readTarget(ref: TagRef | null): Promise<number | null> {
  if (ref == null) return null

  const own = ref.data?.find((d) => norm(d.name) === norm(targetProp))
  const v = toNumber(own?.value)
  if (v != null) return v

  let tagBlock: OrcaBlock | undefined = (orca as any).state?.blocks?.[ref.to]
  if (tagBlock == null) {
    try {
      tagBlock = await backend("get-block", ref.to)
    } catch {
      tagBlock = undefined
    }
  }
  const p = tagBlock?.properties?.find((x) => norm(x.name) === norm(targetProp))
  return toNumber(p?.value)
}

/**
 * 解析「截止日期」属性值为 Date。Orca 的「时间日期」属性（PropType.DateTime）经
 * DatePicker 提交后落库，存储格式并不固定，这里尽量兼容各种常见写法：
 *   - 数字时间戳（秒 <1e12 自动×1000 / 毫秒）
 *   - ISO 串（含 T / Z / 时区偏移）
 *   - "YYYY-MM-DD HH:mm:ss"（空格分隔，非标准 ISO，new Date 解析不了）
 *   - "YYYY/MM/DD ..."（斜杠分隔，V8 可解析）
 *   - 紧凑串 yyyyMMddHHmmss / yyyyMMdd（Siyuan/Orca 常见）
 *   - Date 实例 / 包在 {value|v|d} 里的对象
 */
function toDate(v: unknown): Date | null {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    const inner = o.value ?? o.v ?? o.d ?? o.date
    if (inner != null && inner !== v) return toDate(inner)
    return null
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null
    const ms = v < 1e12 ? v * 1000 : v // 秒 / 毫秒
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === "string") {
    const s = v.trim()
    if (!s) return null
    // 纯数字：8/14 位视为紧凑日期 yyyyMMdd / yyyyMMddHHmmss，其余按时间戳（秒/毫秒）
    if (/^\d+$/.test(s)) {
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(s)
      if (m && (s.length === 8 || s.length === 14)) {
        const d4 = new Date(
          +m[1],
          +m[2] - 1,
          +m[3],
          +(m[4] ?? "0"),
          +(m[5] ?? "0"),
          +(m[6] ?? "0"),
        )
        if (!Number.isNaN(d4.getTime())) return d4
      }
      const n = Number(s)
      const ms = n < 1e12 ? n * 1000 : n
      const d3 = new Date(ms)
      if (!Number.isNaN(d3.getTime())) return d3
    }
    // 标准可解析（ISO / 含 T / Z）
    const direct = new Date(s)
    if (!Number.isNaN(direct.getTime())) return direct
    // "YYYY-MM-DD HH:mm:ss" 把首空格换成 T
    const withT = s.replace(" ", "T")
    const d2 = new Date(withT)
    if (!Number.isNaN(d2.getTime())) return d2
    return null
  }
  return null
}

/**
 * 截止日期：依次尝试三处来源——
 *   ① 本块标签实例上填写的值（ref.data）
 *   ② 内容块自身属性
 *   ③ 标签块自身的默认值（tagBlock.properties）
 * 这样无论用户把「截止日期」填在标签实例、内容块还是标签定义上都读得到。
 */
async function readDeadline(
  ref: TagRef | null,
  block: OrcaBlock | undefined,
): Promise<Date | null> {
  if (ref == null && block == null) return null

  const own = ref?.data?.find((d) => norm(d.name) === norm(deadlineProp))
  const dv = toDate(own?.value)
  if (dv != null) return dv

  const bp = block?.properties?.find((x) => norm(x.name) === norm(deadlineProp))
  const bv = toDate(bp?.value)
  if (bv != null) return bv

  let tagBlock: OrcaBlock | undefined = (orca as any).state?.blocks?.[ref?.to as number]
  if (tagBlock == null && ref != null) {
    try {
      tagBlock = (await backend("get-block", ref.to)) as OrcaBlock | undefined
    } catch {
      tagBlock = undefined
    }
  }
  const p = tagBlock?.properties?.find((x) => norm(x.name) === norm(deadlineProp))
  return toDate(p?.value)
}

/** 距截止日期天数（今天 0 点 vs 截止日 0 点，向上取整到整天） */
function daysUntil(deadline: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dl = new Date(deadline)
  dl.setHours(0, 0, 0, 0)
  return Math.round((dl.getTime() - today.getTime()) / 86400000)
}

// ---------------------------------------------------------------------------
// 圆点注入
// ---------------------------------------------------------------------------

function scan(): void {
  if (!enabled) return

  // 先只做只读比对，收集待办；无事可做就不动 observer（打字时每帧都会走到这里）
  const add: { tag: HTMLElement; dot: HTMLElement }[] = []
  const drop: Element[] = []
  for (const tag of document.querySelectorAll<HTMLElement>(
    ".orca-tags > .orca-tag",
  )) {
    const want = childTags.has(norm(tag.dataset.name ?? ""))
    const next = tag.nextElementSibling
    const has = next?.classList.contains(DOT) === true
    if (want && !has) {
      const dot = document.createElement("span")
      dot.className = DOT
      dot.contentEditable = "false"
      dot.title = "写作进度"
      dot.innerHTML = miniRing(0, "gray")
      add.push({ tag, dot })
    } else if (!want && has && next != null) {
      drop.push(next)
    }
  }
  if (add.length === 0 && drop.length === 0) return

  // 自身的 DOM 写入会再次触发 observer，先摘掉监听避免自激
  mo?.disconnect()
  try {
    for (const el of drop) el.remove()
    for (const { tag, dot } of add) {
      tag.insertAdjacentElement("afterend", dot)
    }
  } finally {
    observe()
  }

  // 给新出现的环异步计算完成度并上色（仅新增时触发，不影响打字性能）
  for (const { tag, dot } of add) void colorize(dot, tag)
}

/**
 * 计算某块的完成度百分比并为小环上色（红色→紫色）。仅在环首次出现 / 弹层关闭后调用，
 * 因此不会在每次 DOM 变更时都触发重量级统计。
 */
async function colorize(dot: HTMLElement, tag: HTMLElement): Promise<void> {
  const blockEl = dot.closest<HTMLElement>(".orca-block[data-id]")
  const blockId = Number(blockEl?.dataset.id)
  if (!Number.isFinite(blockId) || !dot.isConnected) return
  try {
    const block: OrcaBlock | undefined =
      (orca as any).state?.blocks?.[blockId] ??
      (await backend("get-block", blockId))
    const ref = block != null ? refForTagEl(block, tag) : null
    const [stats, target] = await Promise.all([
      computeStats(blockId),
      readTarget(ref),
    ])
    if (!dot.isConnected) return
    const pct = target != null && target > 0 ? stats.words / target : 0
    dot.innerHTML = miniRing(pct, target != null && target > 0 ? ringColor(pct) : "gray")
    celebrateIfComplete(dot, pct)
  } catch {
    /* 统计失败时保留中性灰环 */
  }
}

function schedule(): void {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    scan()
  })
}

function observe(): void {
  if (!enabled || mo == null) return
  mo.observe(document.body, { childList: true, subtree: true })
}

// ---------------------------------------------------------------------------
// 统计面板
// ---------------------------------------------------------------------------

function closePopup(): void {
  popup?.remove()
  popup = null
  document.removeEventListener("mousedown", onDocDown, true)
  document.removeEventListener("keydown", onKeyDown, true)
  window.removeEventListener("resize", closePopup)
}

function onDocDown(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (t?.closest(`.${POPUP}`) != null || t?.classList.contains(DOT) === true) return
  closePopup()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") closePopup()
}

const fmt = (n: number): string => new Intl.NumberFormat().format(n)
const fmtDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`

function ring(pct: number, color: string = ringColor(pct)): string {
  const r = 28
  const c = 2 * Math.PI * r
  const dash = (Math.min(pct, 1) * c).toFixed(2)
  return `
    <svg class="neo-wc-ring" viewBox="0 0 64 64">
      <circle class="neo-wc-ring-bg" cx="32" cy="32" r="${r}" />
      <circle class="neo-wc-ring-fg ring-${color}" cx="32" cy="32" r="${r}"
              stroke-dasharray="${dash} ${(c - +dash).toFixed(2)}" />
    </svg>`
}

/** 标签旁的小圆环：外圈灰色底，前景弧按完成度上色（灰色=未知） */
function miniRing(pct: number, color: string): string {
  const r = 8.5
  const c = 2 * Math.PI * r
  const dash = (Math.min(pct, 1) * c).toFixed(2)
  return `
    <svg class="neo-wc-mini" viewBox="0 0 22 22">
      <circle class="neo-wc-mini-bg" cx="11" cy="11" r="${r}" />
      <circle class="neo-wc-mini-fg ring-${color}" cx="11" cy="11" r="${r}"
              stroke-dasharray="${dash} ${(c - +dash).toFixed(2)}" />
    </svg>`
}

function rows(s: Stats): string {
  const items: [string, number][] = [
    ["字数", s.words],
    ["字符数（计空格）", s.charsWithSpaces],
    ["字符数（不计空格）", s.charsNoSpaces],
    ["非中文单词数", s.nonChineseWords],
    ["中文字符数", s.chinese],
    ["标点符号数", s.punct],
    ["子块数量", s.blocks],
  ]
  return items
    .map(
      ([k, v]) =>
        `<div class="neo-wc-row"><span>${k}</span><b>${fmt(v)}</b></div>`,
    )
    .join("")
}

function render(
  s: Stats,
  target: number | null,
  deadline: Date | null,
): string {
  const done = s.words
  const pct = target != null && target > 0 ? done / target : 0
  const color = target != null && target > 0 ? ringColor(pct) : "gray"
  const pctText =
    target != null && target > 0 ? `${Math.round(pct * 100)}%` : "—"

  const head =
    target != null && target > 0
      ? `<div class="neo-wc-goal">
           <div class="neo-wc-goal-num">${fmt(done)} <i>/ ${fmt(target)}</i></div>
           <div class="neo-wc-goal-label">目标字数完成度</div>
         </div>`
      : `<div class="neo-wc-goal">
           <div class="neo-wc-goal-num">${fmt(done)}</div>
           <div class="neo-wc-goal-label">未设定「${targetProp}」</div>
         </div>`

  let deadlineHtml = ""
  if (deadline != null) {
    const d = daysUntil(deadline)
    const overdue = d < 0
    const daysText = overdue
      ? `已逾期 ${fmt(Math.abs(d))} 天`
      : `还剩 ${fmt(d)} 天`
    deadlineHtml = `
      <div class="neo-wc-deadline">
        <div class="neo-wc-row">
          <span>截止日期</span><b>${fmtDate(deadline)}</b>
        </div>
        <div class="neo-wc-row">
          <span>距截止</span><b class="neo-wc-days${overdue ? " is-overdue" : ""}">${daysText}</b>
        </div>
      </div>`
  } else {
    deadlineHtml = `
      <div class="neo-wc-deadline">
        <div class="neo-wc-row">
          <span>截止日期</span><b>未设定「${deadlineProp}」</b>
        </div>
      </div>`
  }

  return `
    <div class="neo-wc-head">
      <div class="neo-wc-ring-wrap">
        ${ring(pct)}
        <span class="neo-wc-pct ring-${color}">${pctText}</span>
      </div>
      ${head}
    </div>
    <div class="neo-wc-body">${rows(s)}${deadlineHtml}</div>`
}

function place(dot: HTMLElement): void {
  if (popup == null) return
  const r = dot.getBoundingClientRect()
  const pr = popup.getBoundingClientRect()
  const gap = 8
  let left = r.left + r.width / 2 - pr.width / 2
  left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8))
  let top = r.bottom + gap
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - gap
  popup.style.left = `${Math.round(left)}px`
  popup.style.top = `${Math.round(Math.max(8, top))}px`
}

/** 当完成度达到 100%（紫色）时触发全屏彩带；用 data-celebrated 防止同一环重复庆祝 */
function celebrateIfComplete(dot: HTMLElement, pct: number): void {
  if (pct < 1) {
    dot.dataset.celebrated = "" // 未达 100% 时清掉标记，下次达标可再庆祝
    return
  }
  if (dot.dataset.celebrated === "1") return
  dot.dataset.celebrated = "1"
  fireworks()
}

async function openPopup(dot: HTMLElement): Promise<void> {
  closePopup()

  const tag = dot.previousElementSibling as HTMLElement | null
  const blockEl = dot.closest<HTMLElement>(".orca-block[data-id]")
  const blockId = Number(blockEl?.dataset.id)
  if (!Number.isFinite(blockId)) return

  popup = document.createElement("div")
  popup.className = POPUP
  popup.innerHTML = `<div class="neo-wc-loading">统计中…</div>`
  document.body.appendChild(popup)
  place(dot)

  document.addEventListener("mousedown", onDocDown, true)
  document.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("resize", closePopup)

  try {
    const block: OrcaBlock | undefined =
      (orca as any).state?.blocks?.[blockId] ??
      (await backend("get-block", blockId))
    const ref = block != null && tag != null ? refForTagEl(block, tag) : null
    const [stats, target, deadline] = await Promise.all([
      computeStats(blockId),
      readTarget(ref),
      readDeadline(ref, block),
    ])
    if (popup == null) return
    popup.innerHTML = render(stats, target, deadline)
    // 弹层关闭/重算后，把标签旁小环也刷新成最新颜色
    const pct = target != null && target > 0 ? stats.words / target : 0
    dot.innerHTML = miniRing(pct, ringColor(pct))
    celebrateIfComplete(dot, pct)
    place(dot)
  } catch {
    if (popup != null) popup.innerHTML = `<div class="neo-wc-loading">统计失败</div>`
  }
}

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  const dot = t?.closest<HTMLElement>(`.${DOT}`)
  if (dot == null) return
  // 圆点在编辑器内，必须拦住冒泡，否则会触发块聚焦/标签跳转
  e.preventDefault()
  e.stopPropagation()
  if (popup != null) {
    closePopup()
    return
  }
  void openPopup(dot)
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

export function enableWordCount(
  tagName: string,
  propName: string,
  deadlineName: string,
): void {
  const changed =
    tagName !== parentTag || propName !== targetProp || deadlineName !== deadlineProp
  parentTag = tagName?.trim() || "元·主·Express"
  targetProp = propName?.trim() || "目标字数"
  deadlineProp = deadlineName?.trim() || "截止日期"

  if (enabled && !changed) return
  if (enabled && changed) {
    // 父标签变了，集合作废后重扫
    childTags = new Set()
  }

  enabled = true
  if (mo == null) {
    mo = new MutationObserver(schedule)
  }
  observe()
  document.addEventListener("click", onClick, true)

  void ensureChildTags().then(() => {
    if (enabled) scan()
  })
}

export function disableWordCount(): void {
  if (!enabled) return
  enabled = false
  mo?.disconnect()
  mo = null
  document.removeEventListener("click", onClick, true)
  closePopup()
  document.querySelectorAll(`.${DOT}`).forEach((el) => el.remove())
  childTags = new Set()
}

/** 供外部（如设置变更）主动刷新标签集合 */
export function refreshWordCountTags(): void {
  if (!enabled) return
  void ensureChildTags().then(() => {
    if (enabled) scan()
  })
}

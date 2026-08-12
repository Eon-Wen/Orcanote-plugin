// 精细迁移引用（反链面板 v1）
// 思路：复用虎鲸已有的单条引用原语，而不是它「一次性迁移全部」的 migrateReferencesAndAliases。
//   - core.editor.createRef(from, to, type, alias?)  → APIMsgs.CreateRef
//   - core.editor.deleteRef({ refId })               → APIMsgs.DeleteRef（undo 用 mr 字段重插）
// 对每一条被选中的反链：先在目标块上重建一条同类型引用，再删掉指向原块的那条，
// 即实现「只迁移我勾选的引用」，且保留块内其它引用不变。
//
// 关键数据（app.asar 逆向）：
//   get-block 返回的 backRefs 是数组，每项 { id, from, to, type, alias }，
//   其中 id = BlockRef 行 id（即 deleteRef 要的 refId），from = 引用方块，
//   to = 被引用块（= 当前块），type 见 RefType（1 Inline / 2 Property / 3 RefData / 4 Media）。

const REFTYPE_LABEL: Record<number, string> = {
  1: "正文引用",
  2: "标签",
  3: "引用数据",
  4: "媒体引用",
}

let _orca: any = null
function ensureOrca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}
function ib(): (msg: string, ...args: any[]) => Promise<any> {
  const o = ensureOrca()
  return o.invokeBackend.bind(o)
}

export interface Backlink {
  id: number // BlockRef 行 id（refId）
  from: number // 引用方块 id
  to: number // 被引用块 id
  type: number // RefType
  alias?: string
}

export function refTypeLabel(t: number): string {
  return REFTYPE_LABEL[t] ?? `类型${t}`
}

/** 取某块的当前反链列表（指向它的所有引用）。 */
export async function getBacklinks(blockId: number): Promise<Backlink[]> {
  const blk = await ib()("get-block", blockId)
  const refs: any[] = blk?.backRefs ?? []
  return refs.map((r) => ({
    id: r.id,
    from: r.from,
    to: r.to ?? blockId,
    type: r.type,
    alias: r.alias,
  }))
}

/** 批量取块标题（一次 IPC 拿多块，避免列表逐条 get-block）。 */
export async function getBlockTitles(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!ids.length) return out
  try {
    const blocks: any[] = await ib()("get-blocks", ids)
    for (const b of blocks ?? []) {
      const t = (b?.aliases?.[0] ?? b?.text ?? "").trim()
      out.set(b.id, t || String(b.id))
    }
  } catch {
    // 批量失败退回逐条（量小可接受）
    for (const id of ids) {
      out.set(id, await blockTitle(id))
    }
  }
  return out
}

/** 当前编辑器里的块面板 id（反链面板默认展示的就是它）。
 *  注意：orca.state.panels 不是平铺数组，而是一棵嵌套布局树：
 *  容器节点 {direction, children:[...]}，叶子节点 {id, view, viewArgs}（isViewPanel=children==null）。
 *  orca.state.activePanel 是面板 id（字符串），不是面板对象。 */
export function currentEditorBlockId(): number | null {
  try {
    const o = ensureOrca()
    const root = o?.state?.panels
    if (!root) return null
    const activeId = o?.state?.activePanel
    const findById = (node: any): any | null => {
      if (node == null) return null
      if (node.id === activeId) return node
      if (node.children == null) return null
      for (const c of node.children) {
        const r = findById(c)
        if (r) return r
      }
      return null
    }
    const walkBlock = (node: any): number | null => {
      if (node == null) return null
      if (node.children == null) {
        if (node.view === "block" && node.viewArgs?.blockId != null) {
          return Number(node.viewArgs.blockId)
        }
        return null
      }
      for (const c of node.children) {
        const r = walkBlock(c)
        if (r != null) return r
      }
      return null
    }
    // 1) 活动面板若是块视图
    if (activeId != null) {
      const p = findById(root)
      if (p?.view === "block" && p.viewArgs?.blockId != null) {
        return Number(p.viewArgs.blockId)
      }
    }
    // 2) 任一打开的块视图
    return walkBlock(root)
  } catch (e) {
    console.warn("[REFMIGRATE] currentEditorBlockId 异常", e)
    return null
  }
}

/** 块标题：优先别名，其次正文首行。 */
export async function blockTitle(blockId: number): Promise<string> {
  try {
    const b = await ib()("get-block", blockId)
    const t = (b?.aliases?.[0] ?? b?.text ?? "").trim()
    return t || String(blockId)
  } catch {
    return String(blockId)
  }
}

/** 目标块是否存在（迁移前校验）。 */
export async function blockExists(blockId: number): Promise<boolean> {
  try {
    const b = await ib()("get-block", blockId)
    return !!b
  } catch {
    return false
  }
}

/** 候选目标：当前块所在文档树下的页面（有别名者），用于弹窗里快速点选。 */
export async function candidateTargets(
  blockId: number,
  limit = 40,
): Promise<{ id: number; title: string }[]> {
  const out: { id: number; title: string }[] = []
  const seen = new Set<number>()
  const walk = async (id: number, depth: number) => {
    if (depth > 3) return
    let b: any
    try {
      b = await ib()("get-block", id)
    } catch {
      return
    }
    if (b?.aliases?.length && !seen.has(b.id)) {
      seen.add(b.id)
      const title = (b.aliases[0] ?? b.text ?? "").trim() || String(b.id)
      out.push({ id: b.id, title })
    }
    for (const c of b?.children ?? []) await walk(c, depth + 1)
  }
  await walk(blockId, 0)
  return out.filter((t) => t.id !== blockId).slice(0, limit)
}

/** RefType（app.asar 逆向）：1 正文 / 2 属性(标签) / 3 引用数据 / 4 媒体。 */
export const REFTYPE = { Inline: 1, Property: 2, RefData: 3, Media: 4 } as const
/** PropType.BlockRefs = 2（setProperties 时 _tags 属性的 type）。 */
const PROPTYPE_BLOCKREFS = 2

/** 读块的 _tags 值（refId 数组）。 */
async function readTags(blockId: number): Promise<any[]> {
  const blk = await ib()("get-block", blockId)
  const v = blk?.properties?.find((p: any) => p.name === "_tags")?.value
  return Array.isArray(v) ? v : []
}

/** 兜底：若 _tags 里还残留某 refId（悬空），把它剥掉——悬空 refId 会让标签选择菜单
 *  `yu.map` 崩溃（GetAliasedForCombos 拿到坏 id 返回非数组）。 */
async function stripDanglingTag(blockId: number, refId: number): Promise<boolean> {
  const arr = await readTags(blockId)
  if (!arr.includes(refId)) return false
  const next = arr.filter((v) => v !== refId)
  await ensureOrca().commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [blockId],
    [{ name: "_tags", type: PROPTYPE_BLOCKREFS, value: next }],
  )
  return true
}

/** 修复某块的悬空 _tags（refId 在 refs 里已不存在）。返回清理条数。
 *  用于修复历史 bug 产生的坏数据，避免打开标签选择菜单时 yu.map 崩溃。 */
export async function repairBlockTags(blockId: number): Promise<number> {
  try {
    const blk = await ib()("get-block", blockId)
    const tags = Array.isArray(blk?.properties?.find((p: any) => p.name === "_tags")?.value)
      ? blk.properties.find((p: any) => p.name === "_tags").value
      : []
    if (!tags.length) return 0
    const refIds = new Set((blk?.refs ?? []).map((r: any) => r.id))
    const dangling = tags.filter((v: any) => !refIds.has(v))
    if (!dangling.length) return 0
    const next = tags.filter((v: any) => refIds.has(v))
    await ensureOrca().commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [blockId],
      [{ name: "_tags", type: PROPTYPE_BLOCKREFS, value: next }],
    )
    console.warn("[REFMIGRATE] 修复悬空标签", { block: blockId, removed: dangling })
    return dangling.length
  } catch (e) {
    console.warn("[REFMIGRATE] 修复悬空标签失败", e)
    return 0
  }
}

let _lastGlobalRepair = 0
let _repairIncomplete = false

/** 全局扫描修复所有块的悬空 _tags。
 *  用 get-all-blocks 枚举全库块，检查 _tags 里每个 refId 是否在块 refs 中，悬空者剥掉。
 *  ⚠️ setProperties 是「编辑器命令」，直接 invokeCommand 会报 No command named，
 *  必须走 invokeEditorCommand（依赖活动编辑器面板）；无编辑器时静默 no-op，靠重试兜底。
 *  返回：修复块数；-1 = 扫描失败；0 = 没有坏块。
 *  悬空 refId 会让标签菜单 GetAliasedForCombos 的 SQL 抛错 → worker 把错误对象 postMessage
 *  回来 → 菜单拿到错误对象渲染 yu.map 崩溃，所以这个修复是「防崩溃」性质的。 */
export async function repairAllDanglingTags(force = false): Promise<number> {
  const now = Date.now()
  if (!force && now - _lastGlobalRepair < 30000) return 0
  _lastGlobalRepair = now
  _repairIncomplete = false
  try {
    const blocks: any[] = await ib()("get-all-blocks")
    if (!Array.isArray(blocks)) {
      console.warn("[REFMIGRATE] 全局扫描：get-all-blocks 未返回数组", blocks)
      _lastGlobalRepair = 0 // 失败不记账，允许重试
      return -1
    }
    const broken: { id: number; next: any[] }[] = []
    for (const blk of blocks) {
      const tags = Array.isArray(blk?.properties?.find((p: any) => p.name === "_tags")?.value)
        ? blk.properties.find((p: any) => p.name === "_tags").value
        : []
      if (!tags.length) continue
      const refIds = new Set((blk?.refs ?? []).map((r: any) => r.id))
      if (tags.every((v: any) => refIds.has(v))) continue
      broken.push({ id: blk.id, next: tags.filter((v: any) => refIds.has(v)) })
    }
    if (!broken.length) return 0
    let fixed = 0
    for (const b of broken) {
      try {
        await ensureOrca().commands.invokeEditorCommand(
          "core.editor.setProperties",
          null,
          [b.id],
          [{ name: "_tags", type: PROPTYPE_BLOCKREFS, value: b.next }],
        )
        // 读回验证（invokeEditorCommand 无编辑器时静默 no-op，返回 undefined 不可靠）
        const after = await ib()("get-block", b.id)
        const afterTags = Array.isArray(after?.properties?.find((p: any) => p.name === "_tags")?.value)
          ? after.properties.find((p: any) => p.name === "_tags").value
          : []
        const afterRefIds = new Set((after?.refs ?? []).map((r: any) => r.id))
        if (afterTags.every((v: any) => afterRefIds.has(v))) {
          fixed++
          console.warn("[REFMIGRATE] 修复悬空标签", { block: b.id })
        } else {
          _repairIncomplete = true
          console.warn("[REFMIGRATE] 悬空标签未修复（可能无编辑器面板），将重试", b.id)
        }
      } catch (e) {
        _repairIncomplete = true
        console.warn("[REFMIGRATE] 修复悬空标签失败", b.id, e)
      }
    }
    if (_repairIncomplete) _lastGlobalRepair = 0 // 有没修成的，允许立即重试
    if (fixed > 0) {
      try {
        ensureOrca().notify?.("info", `[Neo] 已自动修复 ${fixed} 个块的悬空标签`)
      } catch {
        /* ignore */
      }
    }
    return fixed
  } catch (e) {
    console.warn("[REFMIGRATE] 全局悬空标签扫描失败", e)
    _lastGlobalRepair = 0
    return -1
  }
}

/** 是否还有没修完的坏块（供调用方决定是否重试）。 */
export function repairIncomplete(): boolean {
  return _repairIncomplete
}

/** 判断目标块是不是「标签」。
 *  依据：有别的块用 Property 类引用指向它（有人拿它当标签），或它自带 _show/_icon 属性
 *  （createTag 会给标签块写 _show JSON / _icon）。 */
export async function isTagBlock(blockId: number): Promise<boolean> {
  try {
    const blk = await ib()("get-block", blockId)
    if (blk?.backRefs?.some((r: any) => r.type === REFTYPE.Property)) return true
    return (blk?.properties ?? []).some((p: any) => p.name === "_show" || p.name === "_icon")
  } catch {
    return false
  }
}

/** 解析 createRef 的新 refId（invokeEditorCommand 解包后返回数字，兼容 {ret} 对象）。 */
async function resolveNewRefId(
  created: any,
  fromId: number,
  dstId: number,
  type: number,
  excludeId: number,
): Promise<number | null> {
  let id: any = typeof created === "number" ? created : created?.ret
  if (typeof id !== "number" || Number.isNaN(id)) {
    const blk = await ib()("get-block", fromId)
    id = blk?.refs?.find((r: any) => r.type === type && r.to === dstId && r.id !== excludeId)?.id
  }
  return typeof id === "number" && !Number.isNaN(id) ? id : null
}

/** 迁移方式：auto=自动判定（标签↔页面），tag=强制转成标签，inline=强制转成 @引用。 */
export type RefMigrateMode = "auto" | "tag" | "inline"

/** 逐条迁移选中的反链到目标块。返回成功/失败数。
 *  规则：
 *  - 目标是「标签」→ 被迁移块的引用变成标签（Property 引用 + _tags 外显）；
 *  - 目标不是标签（页面/普通块）→ 变成 @ 内联引用（内容锚点 {t:"r",v:refId} 外显）。
 *  ⚠️ 新建未使用的标签在数据上与页面无法区分（标签=有别名+被 Property 引用指向的块），
 *  自动判定有盲区，因此允许调用方显式指定 mode 覆盖。
 *  标签类引用（type=Property）：块上的标签 chip 由「BlockRef 行 + _tags 属性里的 refId」
 *  共同决定（insertTag=createRef 后把新 refId 塞进 _tags；removeTag=从 _tags 移除）。
 *  注意：新 refId 解析失败时绝不删旧引用，否则 _tags 里留下悬空 refId 会弄崩标签菜单。 */
export async function transferRefs(
  srcId: number,
  selected: Backlink[],
  dstId: number,
  mode: RefMigrateMode = "auto",
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; fail: number }> {
  const o = ensureOrca()
  const dstIsTag = mode === "tag" ? true : mode === "inline" ? false : await isTagBlock(dstId)
  const dstBlk = await ib()("get-block", dstId)
  const dstName: string | undefined = dstBlk?.aliases?.[0]
  const total = selected.length
  let ok = 0
  let fail = 0
  let done = 0

  const processOne = async (b: Backlink) => {
    try {
      if (dstIsTag) {
        // ── 目标是个标签：转成标签引用 ──
        const created = await o.commands.invokeEditorCommand(
          "core.editor.createRef",
          null,
          b.from,
          dstId,
          REFTYPE.Property,
          dstName,
        )
        const newRefId = await resolveNewRefId(created, b.from, dstId, REFTYPE.Property, b.id)
        if (newRefId == null) {
          console.warn("[REFMIGRATE] 新 refId 解析失败，跳过该条（保留原引用）", { created, b })
          fail++
          return
        }
        // _tags：旧 refId → 新 refId（原位替换；源非标签引用时直接追加）
        const arr = await readTags(b.from)
        let next = arr.includes(b.id) ? arr.map((v) => (v === b.id ? newRefId : v)) : arr
        if (!next.includes(newRefId)) next = [...next, newRefId]
        await o.commands.invokeEditorCommand(
          "core.editor.setProperties",
          null,
          [b.from],
          [{ name: "_tags", type: PROPTYPE_BLOCKREFS, value: next }],
        )
        // 源是内联引用时，移除内容里的旧锚点（否则残留 @旧块）
        if (b.type === REFTYPE.Inline) {
          await removeInlineAnchor(b.from, b.id)
        }
      } else {
        // ── 目标不是标签：转成 @ 内联引用 ──
        const created = await o.commands.invokeEditorCommand(
          "core.editor.createRef",
          null,
          b.from,
          dstId,
          REFTYPE.Inline,
          null,
        )
        const newRefId = await resolveNewRefId(created, b.from, dstId, REFTYPE.Inline, b.id)
        if (newRefId == null) {
          console.warn("[REFMIGRATE] 新 refId 解析失败，跳过该条（保留原引用）", { created, b })
          fail++
          return
        }
        // 内容改写：旧锚点（v===b.id 或 to===srcId）换成新锚点；找不到就追加到末尾
        const blk = await ib()("get-block", b.from)
        const content: any[] = Array.isArray(blk?.content) ? blk.content : []
        let replaced = false
        const nextContent = content.map((seg: any) => {
          if (seg?.t === "r" && (seg.v === b.id || seg.to === srcId)) {
            replaced = true
            const ns: any = { t: "r", v: newRefId }
            if (seg.a != null) ns.a = seg.a
            return ns
          }
          return seg
        })
        if (!replaced) nextContent.push({ t: "r", v: newRefId })
        await o.commands.invokeEditorCommand(
          "core.editor.setBlocksContent",
          null,
          [{ id: b.from, content: nextContent }],
        )
        // 源是标签引用时：剥掉 _tags 里的旧 refId（setProperties 对账会顺带删旧 Property 引用行）
        if (b.type === REFTYPE.Property) {
          await stripDanglingTag(b.from, b.id)
        }
      }
      // 删掉指向原块的那条（对账可能已删；对不存在的 ref 是 no-op）
      await o.commands.invokeEditorCommand(
        "core.editor.deleteRef",
        { id: b.id, from: b.from, to: srcId, type: b.type, alias: b.alias },
        { refId: b.id },
      )
      // 安全网：若 _tags 仍残留旧 refId（悬空），剥掉
      if (b.type === REFTYPE.Property) {
        const stripped = await stripDanglingTag(b.from, b.id)
        if (stripped) {
          console.warn("[REFMIGRATE] 发现并清理悬空 _tags refId", { block: b.from, refId: b.id })
        }
      }
      ok++
    } catch (e) {
      console.warn("[REFMIGRATE] 迁移单条失败", b, e)
      fail++
    }
  }

  // 分批执行（每批 50 条），批间让出事件循环，UI 保持响应
  const CHUNK = 50
  for (let i = 0; i < selected.length; i += CHUNK) {
    const chunk = selected.slice(i, i + CHUNK)
    for (const b of chunk) {
      await processOne(b)
      done++
    }
    onProgress?.(done, total)
    await new Promise((r) => setTimeout(r, 0))
  }
  return { ok, fail }
}

/** 移除块内容里指向某 refId 的内联锚点段（{t:"r", v:refId}）。 */
async function removeInlineAnchor(blockId: number, refId: number): Promise<void> {
  const blk = await ib()("get-block", blockId)
  const content: any[] = Array.isArray(blk?.content) ? blk.content : []
  const next = content.filter((seg: any) => !(seg?.t === "r" && seg.v === refId))
  if (next.length !== content.length) {
    await ensureOrca().commands.invokeEditorCommand(
      "core.editor.setBlocksContent",
      null,
      [{ id: blockId, content: next }],
    )
  }
}

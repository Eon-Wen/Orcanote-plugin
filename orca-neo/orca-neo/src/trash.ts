/**
 * 回收站核心逻辑（路线 C：真删除 + 私有快照）
 *
 * 原理（已据 app.asar 源码 + DevTools 实跑双重确认）：
 *  - 虎鲸删除页面的真实入口是 `orca.invokeBackend("delete-blocks", blockIds)`（blockIds 为块 id 数组）。
 *    命令层 `core.editor.deleteBlocks` 截不到，只能从 `invokeBackend` 这一层包装拦截。
 *  - 搜索基于 SQLite 全文索引 BlockFTS；真删除后原块从索引消失 → 普通搜索搜不到。
 *  - 删除前先递归 `get-block` 抓整页子树快照（get-block 返回的 children 只是 id，需逐层再取），
 *    存进插件私有目录文件（set-plugin-file，无大小限制），索引（set-plugin-data）记一笔；
 *    再放行真删。恢复时用 `create-block` 逐级重建。
 *
 * 拦截粒度：只拦「顶层页面」（被删块 parent 为 null）删除；子块删除直接放行真删，不进回收站。
 * 数据安全：快照没存好就**不放行删除**（fail-closed）——宁可这次删不掉，也不丢数据。
 */

import { chartBlockIdsOf } from "./chartBlock"

const PLUGIN_NAME = "orca-neo"

/** 拦截器保存的原始 invokeBackend；所有内部后端调用都走它，彻底绕开包装、无递归。 */
let _origInvokeBackend: ((msg: string, ...args: any[]) => Promise<any>) | null = null
let _timer: ReturnType<typeof setInterval> | null = null

/** 返回可安全调用后端的函数：优先用原始引用，未安装拦截器时退回全局。 */
function backend(): (msg: string, ...args: any[]) => Promise<any> {
  if (_origInvokeBackend) return _origInvokeBackend
  return (orca as any).invokeBackend.bind(orca)
}

export interface TrashItem {
  pageId: number
  fileName: string
  deletedAt: number
  originalParent: any
  originalLeft: any
  title: string
}

// ---------------------------------------------------------------------------
// 设置读取（实时，跟随用户在设置面板/顶栏菜单的改动）
// ---------------------------------------------------------------------------

function getSettings(): Record<string, any> {
  const raw = (orca.state.plugins as any)?.[PLUGIN_NAME]?.settings
  return raw ?? {}
}

function trashEnabled(): boolean {
  return getSettings().trashEnabled !== false // 默认开
}

function retentionDays(): number {
  const d = Number(getSettings().trashRetentionDays)
  return Number.isFinite(d) && d > 0 ? d : 30
}

// ---------------------------------------------------------------------------
// 拦截器安装 / 卸载
// ---------------------------------------------------------------------------

export function installTrashInterceptor() {
  if (_origInvokeBackend) return
  _origInvokeBackend = (orca as any).invokeBackend.bind(orca)
  ;(orca as any).invokeBackend = async (msg: string, ...args: any[]) => {
    if (msg !== "delete-blocks") return _origInvokeBackend!(msg, ...args)
    try {
      return await interceptDelete(args)
    } catch (e: any) {
      // fail-closed：拦截器异常（含快照失败）一律不放行删除，保数据
      console.error("[TRASH] 拦截异常，已取消删除以保数据：", e)
      try {
        orca.notify?.(
          "error",
          `回收站：删除已被拦截（${e?.message ?? e}），页面未删除以保数据。可重试或检查存储。`,
          { title: "回收站" },
        )
      } catch {
        /* ignore */
      }
      return [] // 返回“空结果”，避免调用方崩；原块仍在
    }
  }
}

export function uninstallTrashInterceptor() {
  if (_origInvokeBackend) {
    ;(orca as any).invokeBackend = _origInvokeBackend
    _origInvokeBackend = null
  }
  stopRetentionTimer()
}

// ---------------------------------------------------------------------------
// 删除拦截：图表联动 → 顶层页面快照进回收站 → 放行真删 → 渲染层同步
// ---------------------------------------------------------------------------

/** 把已真删的图表块从渲染层 state 移除（连同其在 state 中的子块），并按原生
 *  deleteBlocks 命令同款语义广播给其它窗口。app 的命令层只清理它自己传入的 id，
 *  不会清理我们追加的图表块；BroadcastChannel 又不会回显给发送窗口，
 *  所以本地窗口靠这里删 state 驱动 React 立即消失，跨窗口一致性靠广播。 */
function dropBlocksFromState(ids: number[]) {
  if (ids.length === 0) return
  const blocks = orca.state.blocks as Record<string | number, any>
  const walk = (id: number) => {
    const b = blocks[id]
    if (b == null) return
    if (Array.isArray(b.children)) {
      for (const c of b.children) {
        if (typeof c === "number") walk(c)
      }
    }
    blocks[id] = void 0
  }
  const dropped: number[] = []
  for (const id of ids) {
    const b = blocks[id]
    // 有反链的块后端不真删（只摘 parent），state 由后端返回的更新块写回 → 跳过
    if (b != null && (b.backRefs?.length ?? 0) === 0) {
      dropped.push(id)
      walk(id)
    }
  }
  if (dropped.length > 0) {
    try {
      orca.broadcasts?.broadcast("orca.delete-blocks", dropped)
    } catch (e) {
      console.warn("[TRASH] 广播图表块删除失败：", e)
    }
  }
}

async function interceptDelete(args: any[]): Promise<any> {
  const ib = backend()
  const blockIds: number[] = Array.isArray(args[0]) ? args[0] : []
  const repoId = orca.state.repo

  // 表格删除联动（与回收站开关无关，属数据一致性）：图表块是表格的兄弟块，
  // 原生删除只删表格子树 → 把 _chart 指向的图表块 id 并入删除清单一并真删
  let chartIds: number[] = []
  if (blockIds.length > 0) {
    try {
      chartIds = chartBlockIdsOf(blockIds).filter((id) => !blockIds.includes(id))
    } catch (e) {
      console.warn("[TRASH] 收集关联图表块失败，本次删除不联动：", e)
    }
  }
  const deleteArgs: any[] =
    chartIds.length > 0 ? [[...blockIds, ...chartIds], ...args.slice(1)] : args

  if (!trashEnabled()) {
    const res = await ib("delete-blocks", ...deleteArgs)
    dropBlocksFromState(chartIds)
    return res
  }

  // 1) 先对所有顶层页面抓快照存回收站（任一失败则整体抛错 → 不放行删除）。
  //    快照只用原始 ids——图表块是图片块，不可能进回收站。
  for (const id of blockIds) {
    let blk: any = null
    try {
      blk = await ib("get-block", id)
    } catch {
      blk = null
    }
    const isTopLevel =
      blk && (blk.parent == null || blk.parent === undefined || blk.parent === "")
    if (isTopLevel) {
      await trashPage(ib, repoId, id, blk)
    }
  }

  // 2) 快照全部成功后，才真正删除（含追加的图表块；原块从 FTS 移除 → 搜不到）
  const res = await ib("delete-blocks", ...deleteArgs)
  dropBlocksFromState(chartIds)
  return res
}

/**
 * 递归抓取整页子树。
 * 真实 get-block(id) 返回：{ id, text, parent, left, children:[子块id...],
 *   properties:[{name:"_repr",value:{type:...}}, ...], ... }
 * —— children 只是 id 数组，要拿子块内容得逐层再 get-block。这里把整棵拍成嵌套结构：
 *   { id, text, properties, kids: [嵌套节点...] }
 */
async function fetchFullTree(
  ib: (msg: string, ...args: any[]) => Promise<any>,
  id: number,
  seen: Set<number> = new Set(),
  depth = 0,
): Promise<any> {
  if (seen.has(id) || depth > 500) return null
  seen.add(id)
  let blk: any = null
  try {
    blk = await ib("get-block", id)
  } catch {
    blk = null
  }
  if (!blk) return null
  const childIds: number[] = Array.isArray(blk.children) ? blk.children : []
  const kids: any[] = []
  for (const cid of childIds) {
    if (typeof cid === "number") {
      const k = await fetchFullTree(ib, cid, seen, depth + 1)
      if (k) kids.push(k)
    }
  }
  return {
    id: blk.id,
    text: typeof blk.text === "string" ? blk.text : "",
    aliases: Array.isArray(blk.aliases) ? (blk.aliases as any[]) : [],
    properties: Array.isArray(blk.properties) ? blk.properties : [],
    kids,
  }
}

async function trashPage(
  ib: (msg: string, ...args: any[]) => Promise<any>,
  repoId: string,
  id: number,
  blk: any,
) {
  // get-block 只返回「根块 + children 的 id 数组」，并不含子块内容。
  // 故递归 get-block/get-block-tree 把整页子树抓成嵌套结构（每个节点含 text / properties._repr / kids）。
  const fullTree = await fetchFullTree(ib, id)
  const rootForTitle = fullTree ?? blk
  const snapshot = {
    pageId: id,
    deletedAt: Date.now(),
    originalParent: blk?.parent ?? null,
    originalLeft: blk?.left ?? null,
    tree: fullTree,
  }
  const fileName = `trash/${repoId}/${id}.json`
  // set-plugin-file(name, fileName, content[, encoding?])；写插件私有目录，无大小限制
  await ib("set-plugin-file", PLUGIN_NAME, fileName, JSON.stringify(snapshot))

  const index = await readIndex(ib, repoId)
  const item: TrashItem = {
    pageId: id,
    fileName,
    deletedAt: snapshot.deletedAt,
    originalParent: snapshot.originalParent,
    originalLeft: snapshot.originalLeft,
    title: deriveTitle(rootForTitle),
  }
  const filtered = index.filter((i) => i.pageId !== id)
  filtered.push(item)
  await writeIndex(ib, repoId, filtered)

  try {
    orca.notify?.("success", `已移入回收站：${item.title}`, { title: "回收站" })
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// 索引（set-plugin-data，小值 JSON）
// ---------------------------------------------------------------------------

function indexKey(repoId: string) {
  return `trash-index:${repoId}`
}

async function readIndex(
  ib: (msg: string, ...args: any[]) => Promise<any>,
  repoId: string,
): Promise<TrashItem[]> {
  try {
    const v = await ib("get-plugin-data", PLUGIN_NAME, indexKey(repoId))
    // set-plugin-data 走 SQLite，只能绑基本类型；索引以 JSON 字符串存储
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? (parsed as TrashItem[]) : []
      } catch {
        return []
      }
    }
    return Array.isArray(v) ? (v as TrashItem[]) : []
  } catch {
    return []
  }
}

async function writeIndex(
  ib: (msg: string, ...args: any[]) => Promise<any>,
  repoId: string,
  items: TrashItem[],
) {
  // 必须为字符串（SQLite 不能绑数组/对象）
  await ib("set-plugin-data", PLUGIN_NAME, indexKey(repoId), JSON.stringify(items))
}

/** 供 UI 列出回收项（带剩余保留期毫秒数） */
export async function listTrash(): Promise<(TrashItem & { remainingMs: number })[]> {
  const ib = backend()
  const repoId = orca.state.repo
  const items = await readIndex(ib, repoId)
  const ms = retentionDays() * 86400000
  const now = Date.now()
  return items.map((i) => ({
    ...i,
    remainingMs: Math.max(0, i.deletedAt + ms - now),
  }))
}

export function trashCount(): Promise<number> {
  return listTrash().then((l) => l.length).catch(() => 0)
}

// ---------------------------------------------------------------------------
// 恢复：读快照 → create-block 逐级重建回原父级/原 leftId
// ---------------------------------------------------------------------------

export async function restorePage(pageId: number): Promise<void> {
  const ib = backend()
  const repoId = orca.state.repo
  const fileName = `trash/${repoId}/${pageId}.json`
  const raw = await ib("get-plugin-file", PLUGIN_NAME, fileName)
  const snap = JSON.parse(raw)
  await recreateTree(ib, snap.tree, snap.originalParent ?? null, snap.originalLeft ?? null)
  // 从回收站移除
  try {
    await ib("remove-plugin-file", PLUGIN_NAME, fileName)
  } catch {
    /* ignore */
  }
  const index = await readIndex(ib, repoId)
  await writeIndex(
    ib,
    repoId,
    index.filter((i) => i.pageId !== pageId),
  )
  try {
    orca.notify?.("success", `已恢复：${snap?.tree ? deriveTitle(snap.tree) : pageId}`, {
      title: "回收站",
    })
  } catch {
    /* ignore */
  }
}

async function recreateTree(
  ib: (msg: string, ...args: any[]) => Promise<any>,
  node: any,
  parentId: any,
  leftId: any,
): Promise<any> {
  if (node == null) return null
  const { repr, content } = nodeToReprContent(node)
  const text = typeof node?.text === "string" ? node.text : ""
  let created: any
  try {
    // create-block(parentId, leftId, created, modified, repr, content, text)
    //  —— created/modified 传 null 由后端取当前时间；content 必须非空（否则后端走无 text 分支，text 列丢空）；
    //     text 为第 7 参（正文纯文本列），与 content 一并写入。
    created = await ib("create-block", parentId, leftId, null, null, repr, content, text)
  } catch (e) {
    // 顶层页面若 parent=null 不被接受，回退到“挂到仓库根”
    if (parentId == null) {
      created = await ib("create-block", undefined, leftId, null, null, repr, content, text)
    } else {
      throw e
    }
  }
  const newId = extractId(created)
  // 页面身份恢复：虎鲸侧栏页面列表 = 「有 BlockAlias 别名 + _hide=1 属性」的块（getPagesSt SQL）。
  // create-alias(name, blockId, flag, pos) 传 flag=true 时后端自动给块写 _hide=1 —— 与 createAliasedBlock 建页一致。
  if (parentId == null && newId != null) {
    const aliasName =
      (Array.isArray(node?.aliases) && node.aliases.length > 0 && node.aliases[0]) ||
      (typeof node?.text === "string" ? node.text.trim() : "")
    if (aliasName && !String(aliasName).startsWith("_")) {
      try {
        await ib("create-alias", aliasName, newId, true, null)
      } catch (e) {
        // 别名重名（用户已重建同名页面）等异常：内容已恢复，仅不显示在侧栏，不抛错
        console.warn("[TRASH] 恢复页面别名失败：", e)
      }
    }
  }
  const children = node.kids ?? []
  let prevLeft: any = null
  for (const child of children) {
    const cid = await recreateTree(ib, child, newId, prevLeft)
    if (cid != null) prevLeft = cid
  }
  return newId
}

function extractId(created: any): any {
  if (created == null) return null
  if (Array.isArray(created)) {
    const first = created[0]
    if (first && typeof first === "object") return first.id ?? first
    return first
  }
  if (typeof created === "object") return created.id ?? created
  return created
}

/** 把快照节点转成 create-block 需要的 (repr, content)。
 *  真实 get-block 结构：repr 在 properties 里 name==="_repr" 的 value（如 {type:"text"}）；
 *  正文在 text 字段。renderer 的 text 是由 content 经 blockConvert("plain") 反推的（带尾随 \n），
 *  故 content 段必须**去掉尾随换行**（否则段内 \n 渲染成空行 → 块间距被拉大）；text 列原样保留。 */
function nodeToReprContent(node: any): { repr: any; content: any } {
  const reprProp = Array.isArray(node?.properties)
    ? node.properties.find((p: any) => p && p.name === "_repr")
    : null
  const repr = reprProp && reprProp.value ? reprProp.value : { type: "text" }
  const text = typeof node?.text === "string" ? node.text : ""
  const seg = text.replace(/\n+$/, "")
  const content = seg ? [{ t: "t", v: seg }] : []
  return { repr, content }
}

// ---------------------------------------------------------------------------
// 彻底删除 / 清空 / 过期清理
// ---------------------------------------------------------------------------

export async function purgeOne(pageId: number): Promise<void> {
  const ib = backend()
  const repoId = orca.state.repo
  const fileName = `trash/${repoId}/${pageId}.json`
  try {
    await ib("remove-plugin-file", PLUGIN_NAME, fileName)
  } catch {
    /* ignore */
  }
  const index = await readIndex(ib, repoId)
  await writeIndex(
    ib,
    repoId,
    index.filter((i) => i.pageId !== pageId),
  )
}

export async function clearAll(): Promise<void> {
  const ib = backend()
  const repoId = orca.state.repo
  const index = await readIndex(ib, repoId)
  for (const i of index) {
    try {
      await ib("remove-plugin-file", PLUGIN_NAME, i.fileName)
    } catch {
      /* ignore */
    }
  }
  await writeIndex(ib, repoId, [])
}

export async function purgeExpired(): Promise<void> {
  const ib = backend()
  const repoId = orca.state.repo
  const ms = retentionDays() * 86400000
  const now = Date.now()
  const index = await readIndex(ib, repoId)
  const keep: TrashItem[] = []
  for (const i of index) {
    if (now - i.deletedAt > ms) {
      try {
        await ib("remove-plugin-file", PLUGIN_NAME, i.fileName)
      } catch {
        /* ignore */
      }
    } else {
      keep.push(i)
    }
  }
  if (keep.length !== index.length) await writeIndex(ib, repoId, keep)
}

// ---------------------------------------------------------------------------
// 保留期轮询（兜底：虎鲸常开但很久不删东西时也能清理）
// ---------------------------------------------------------------------------

export function startRetentionTimer() {
  stopRetentionTimer()
  _timer = setInterval(() => {
    purgeExpired().catch(() => {})
  }, 30 * 60 * 1000)
}

export function stopRetentionTimer() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}

// ---------------------------------------------------------------------------
// 标题提取（快照形状未知时尽量取首段文本）
// ---------------------------------------------------------------------------

function deriveTitle(tree: any): string {
  if (!tree) return "(无标题)"
  const t = firstText(tree)
  return t ? t.slice(0, 80) : "(无标题)"
}

function firstText(node: any): string {
  if (!node) return ""
  // get-block 返回的是富文本 content（[{t:"t",v:"..."}] 等段）；优先取纯文本段
  if (Array.isArray(node.content)) {
    for (const seg of node.content) {
      if (seg && typeof seg.v === "string" && seg.t === "t" && seg.v.trim()) {
        return seg.v.trim()
      }
    }
  }
  if (typeof node.text === "string" && node.text.trim()) return node.text.trim()
  if (Array.isArray(node.kids)) {
    for (const c of node.kids) {
      const t = firstText(c)
      if (t) return t
    }
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      const t = firstText(c)
      if (t) return t
    }
  }
  return ""
}

/** 初始化：安装拦截器 + 启动保留期检查 + 启动轮询 */
export async function initTrash(): Promise<void> {
  installTrashInterceptor()
  startRetentionTimer()
  await purgeExpired().catch(() => {})
}

/** 卸载：还原 invokeBackend + 清轮询 */
export function disposeTrash(): void {
  uninstallTrashInterceptor()
}

// 把「精细迁移引用」按钮注入反链面板工具条。
// 重要教训：.orca-query-result-list-toolbar-backrefs 是「Backlink chain mode」开关本身
// （Checkbox），不是工具条容器——把按钮塞进它会点一下开一下开关。
// 正确容器是 .orca-query-result-list-toolbar（Sort/Group 按钮和该开关的父容器）。
// 点击统一走 document 级 mousedown 委托（捕获阶段），与按钮实例无关（React 重渲染会换掉按钮）。
import { currentEditorBlockId } from "./refMigrate"
import { openRefMigrateDialog } from "./refMigrateDialog"

let _orca: any = null
function orca(): any {
  if (!_orca) _orca = (window as unknown as { orca: any }).orca
  return _orca
}

const TOOLBAR_SEL = ".orca-query-result-list-toolbar"
const BACKREFS_CHECKBOX_SEL = ".orca-query-result-list-toolbar-backrefs"
const BTN_CLASS = "neo-refmig-btn"

function sourceBlockId(toolbar: HTMLElement | null): number | null {
  // 1) 反链面板内联在块下方：向上找最近的块元素。
  //    虎鲸块元素是 .orca-block[data-id]，编辑器容器是 [data-block-id]
  //    （renderer 里虎鲸自己读 dataset.blockId || dataset.id）。
  let el: HTMLElement | null = toolbar
  while (el) {
    const id = el.getAttribute?.("data-id") ?? el.getAttribute?.("data-block-id")
    if (id && /^\d+$/.test(id)) return Number(id)
    el = el.parentElement
  }
  // 2) 侧栏反链面板：当前编辑器块面板
  return currentEditorBlockId()
}

function buildButton(): HTMLElement {
  const btn = document.createElement("button")
  btn.className = "neo-refmig-btn " + BTN_CLASS
  btn.type = "button"
  btn.textContent = "精细迁移引用"
  return btn
}

/** 只在「含 Backlink chain mode 开关」的工具条（即反链列表）里注入，避免污染其它查询结果列表。 */
function injectInto(toolbar: HTMLElement) {
  if (!toolbar.querySelector(BACKREFS_CHECKBOX_SEL)) return
  if (toolbar.querySelector("." + BTN_CLASS)) return
  toolbar.appendChild(buildButton())
}

function watchToolbar(toolbar: HTMLElement) {
  const mo = new MutationObserver(() => injectInto(toolbar))
  mo.observe(toolbar, { childList: true })
  ;(toolbar as any).__neoRefMigWatch = mo
}

let _bodyObserver: MutationObserver | null = null
let _mousedownDelegate: ((e: MouseEvent) => void) | null = null
let _clickDelegate: ((e: MouseEvent) => void) | null = null

function onBodyChange() {
  document.querySelectorAll(TOOLBAR_SEL).forEach((t) => {
    const el = t as HTMLElement
    injectInto(el)
    if (!(el as any).__neoRefMigWatch) watchToolbar(el)
  })
}

/** document 级 mousedown 委托：按下即开弹窗（先于任何 React 重渲染）。 */
function onDocMouseDown(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  const btn = t?.closest?.("." + BTN_CLASS) as HTMLElement | null
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  const toolbar = btn.closest(TOOLBAR_SEL) as HTMLElement | null
  const id = sourceBlockId(toolbar)
  if (id == null) {
    console.warn("[REFMIGRATE] 无法确定当前块")
    window.alert("[精细迁移引用] 无法确定当前块")
    return
  }
  console.log("[REFMIGRATE] 打开迁移弹窗，来源块", id)
  try {
    openRefMigrateDialog(id)
  } catch (err: any) {
    console.error("[REFMIGRATE] open error", err)
    window.alert(`[精细迁移引用] 打开失败：${err?.message ?? err}`)
  }
}

/** document 级 click 委托（捕获）：拦掉按钮上冒泡的 click，防止误触开关/其它工具条按钮。 */
function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (!t?.closest?.("." + BTN_CLASS)) return
  e.preventDefault()
  e.stopPropagation()
}

export function installRefMigrateInjector() {
  if (_bodyObserver) return
  onBodyChange()
  _bodyObserver = new MutationObserver(onBodyChange)
  _bodyObserver.observe(document.body, { childList: true, subtree: true })
  _mousedownDelegate = onDocMouseDown
  _clickDelegate = onDocClick
  document.addEventListener("mousedown", _mousedownDelegate, true)
  document.addEventListener("click", _clickDelegate, true)
}

export function disposeRefMigrateInjector() {
  _bodyObserver?.disconnect()
  _bodyObserver = null
  if (_mousedownDelegate) {
    document.removeEventListener("mousedown", _mousedownDelegate, true)
    _mousedownDelegate = null
  }
  if (_clickDelegate) {
    document.removeEventListener("click", _clickDelegate, true)
    _clickDelegate = null
  }
  document.querySelectorAll("." + BTN_CLASS).forEach((b) => b.remove())
  document.querySelectorAll(TOOLBAR_SEL).forEach((t) => {
    const mo = (t as any).__neoRefMigWatch as MutationObserver | undefined
    mo?.disconnect()
    delete (t as any).__neoRefMigWatch
  })
}

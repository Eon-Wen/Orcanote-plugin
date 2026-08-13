// 块菜单命令注册：把「列表视图」「数据图表」挂进虎鲸原生的块右键菜单
// 「插件命令」子菜单（ti-plug 分组，虎鲸原生渲染插件的 registerBlockMenuCommand）。
// render(blockId, ctxId, close) 按块类型过滤——列表类块显示「列表视图」、表格块显示
// 「数据图表」，其它块返回 null（不显示）。条目点击后在子菜单内手风琴式展开细分
// 功能（自绘条目 + stopPropagation，与旧 listViewMenu 注入同思路）。
// 注意：虎鲸重载插件时若上次 unload 没跑（如插件崩溃），同 id 命令会残留，
// 重复注册抛 AlreadyRegistered → 注册前先 unregister 防御。
import {
  applyZoomLive,
  isListBlock,
  isTopLevelList,
  setListView,
  setListViewZoom,
  toggleFullscreen,
  viewOfBlock,
  zoomOfBlock,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./listView"
import { isTableBlock, nearestTableBlockId } from "./tableChart"
import { openTableChartDialog } from "./tableChartDialog"
import { chartOfBlock, cleanupOrphanChartBlocks, removeChartOfBlock } from "./chartBlock"

let React: any = null
function getReact(): any {
  if (!React) React = (window as unknown as { React: any }).React
  return React
}

/** 自绘菜单细分条目（结构与虎鲸原生 orca-menu-text 一致）。 */
function SubItem(props: {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
}): any {
  const React_ = getReact()
  return React_.createElement(
    "div",
    {
      className: "orca-menu-text neo-cmd-subitem" + (props.danger ? " neo-cmd-danger" : ""),
      onMouseDown: (e: MouseEvent) => e.stopPropagation(),
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        props.onClick()
      },
    },
    React_.createElement("i", { className: `${props.icon} orca-menu-text-icon orca-menu-text-pre` }),
    React_.createElement("div", { className: "orca-menu-text-text" }, props.label),
  )
}

/** 菜单内嵌缩放条（React 版，逻辑同 listViewMenu 的 buildZoomRow）。 */
function ZoomRow(props: { blockId: number }): any {
  const React_ = getReact()
  const [zoom, setZoom] = React_.useState(() => Math.round(zoomOfBlock(props.blockId) * 100))

  const onNumChange = (e: any) => {
    const v = parseFloat(e.target.value)
    if (!Number.isFinite(v) || v <= 0) {
      setZoom(Math.round(zoomOfBlock(props.blockId) * 100))
      return
    }
    void setListViewZoom(props.blockId, v / 100).then(() =>
      setZoom(Math.round(zoomOfBlock(props.blockId) * 100)),
    )
  }
  const onRangeInput = (e: any) => {
    const v = parseFloat(e.target.value)
    if (Number.isFinite(v) && v > 0) {
      applyZoomLive(props.blockId, v / 100)
      setZoom(Math.round(v))
    }
  }
  const onRangeChange = (e: any) => {
    const v = parseFloat(e.target.value)
    if (Number.isFinite(v) && v > 0) void setListViewZoom(props.blockId, v / 100)
  }

  return React_.createElement(
    "div",
    {
      className: "orca-menu-text neo-cmd-zoomrow",
      onMouseDown: (e: MouseEvent) => e.stopPropagation(),
      onClick: (e: MouseEvent) => e.stopPropagation(),
    },
    React_.createElement("input", {
      className: "neo-cmd-zb-num",
      type: "number",
      min: Math.round(ZOOM_MIN * 100),
      max: Math.round(ZOOM_MAX * 100),
      step: 5,
      value: zoom,
      title: "缩放百分比",
      onChange: onNumChange,
    }),
    React_.createElement("input", {
      className: "neo-cmd-zb-range",
      type: "range",
      min: Math.round(ZOOM_MIN * 100),
      max: Math.round(ZOOM_MAX * 100),
      step: 5,
      value: zoom,
      title: "拖动缩放",
      onInput: onRangeInput,
      onChange: onRangeChange,
    }),
  )
}

/** 列表视图命令组：点击头展开细分（转为表格 / 缩放条+全屏+转回列表）。 */
function ListCmdGroup(props: { blockId: number; close: () => void }): any {
  const React_ = getReact()
  const [open, setOpen] = React_.useState(false)
  const isTable = viewOfBlock(props.blockId) === "table"
  const canConvert = !isTable && isTopLevelList(props.blockId)

  const head = React_.createElement(
    "div",
    {
      className: "orca-menu-text neo-cmd-item" + (open ? " neo-cmd-open" : ""),
      onMouseDown: (e: MouseEvent) => e.stopPropagation(),
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        setOpen(!open)
      },
    },
    React_.createElement("i", {
      className: `ti ti-${isTable ? "table" : "list"} orca-menu-text-icon orca-menu-text-pre`,
    }),
    React_.createElement("div", { className: "orca-menu-text-text" }, isTable ? "列表视图（表格中）" : "列表视图"),
    React_.createElement("i", { className: `ti ti-chevron-${open ? "down" : "right"} neo-cmd-arrow` }),
  )

  if (!open) return head

  const subs: any[] = []
  if (isTable) {
    subs.push(
      React_.createElement(ZoomRow, { key: "zoom", blockId: props.blockId }),
      React_.createElement(SubItem, {
        key: "fs",
        icon: "ti ti-arrows-maximize",
        label: "全屏查看（Esc 退出，自动收起侧栏）",
        onClick: () => {
          props.close()
          toggleFullscreen(props.blockId)
        },
      }),
      React_.createElement(SubItem, {
        key: "back",
        icon: "ti ti-list",
        label: "转回列表",
        onClick: () => {
          props.close()
          void setListView(props.blockId, "")
        },
      }),
    )
  } else if (canConvert) {
    subs.push(
      React_.createElement(SubItem, {
        key: "totable",
        icon: "ti ti-table",
        label: "转为表格",
        onClick: () => {
          props.close()
          void setListView(props.blockId, "table")
        },
      }),
    )
  }

  if (subs.length === 0) return head
  return React_.createElement(
    "div",
    { className: "neo-cmd-wrap" },
    head,
    React_.createElement("div", { className: "neo-cmd-sub" }, subs),
  )
}

/** 数据图表命令组：点击头展开细分（新建/更新/删除图表）。 */
function ChartCmdGroup(props: { tableId: number; close: () => void }): any {
  const React_ = getReact()
  const [open, setOpen] = React_.useState(false)
  const existing = chartOfBlock(props.tableId)

  const head = React_.createElement(
    "div",
    {
      className: "orca-menu-text neo-cmd-item" + (open ? " neo-cmd-open" : ""),
      onMouseDown: (e: MouseEvent) => e.stopPropagation(),
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        setOpen(!open)
      },
    },
    React_.createElement("i", { className: "ti ti-chart-bar orca-menu-text-icon orca-menu-text-pre" }),
    React_.createElement("div", { className: "orca-menu-text-text" }, "数据图表"),
    React_.createElement("i", { className: `ti ti-chevron-${open ? "down" : "right"} neo-cmd-arrow` }),
  )

  if (!open) return head

  const subs: any[] = existing
    ? [
        React_.createElement(SubItem, {
          key: "update",
          icon: "ti ti-chart-bar",
          label: "更新图表…",
          onClick: () => {
            props.close()
            openTableChartDialog(props.tableId, existing)
          },
        }),
        React_.createElement(SubItem, {
          key: "remove",
          icon: "ti ti-trash",
          label: "删除图表",
          danger: true,
          onClick: () => {
            props.close()
            void removeChartOfBlock(props.tableId)
          },
        }),
      ]
    : [
        React_.createElement(SubItem, {
          key: "new",
          icon: "ti ti-chart-bar",
          label: "数据图表…",
          onClick: () => {
            props.close()
            openTableChartDialog(props.tableId)
          },
        }),
      ]

  return React_.createElement(
    "div",
    { className: "neo-cmd-wrap" },
    head,
    React_.createElement("div", { className: "neo-cmd-sub" }, subs),
  )
}

const CMD_LIST = "orca-neo.blockcmd.listview"
const CMD_CHART = "orca-neo.blockcmd.chart"

/** 实时读插件设置（render 在菜单打开时被虎鲸调用，必须现场判断开关）。 */
function settingsOn(): { list: boolean; chart: boolean } {
  const s = (window as unknown as { orca: any }).orca?.state?.plugins?.["orca-neo"]?.settings
  return { list: s?.listViewEnabled === true, chart: s?.chartEnabled === true }
}

export function installBlockMenuCommands() {
  const bmc = (window as unknown as { orca: any }).orca?.blockMenuCommands
  if (!bmc) {
    console.warn("[NEO] 虎鲸无 blockMenuCommands API，块菜单命令不可用")
    return
  }
  // 防御：重载时旧命令可能残留（插件崩溃时 unload 没跑），先清再注册
  try {
    bmc.unregisterBlockMenuCommand(CMD_LIST)
  } catch { /* ignore */ }
  try {
    bmc.unregisterBlockMenuCommand(CMD_CHART)
  } catch { /* ignore */ }

  try {
    bmc.registerBlockMenuCommand(CMD_LIST, {
      worksOnMultipleBlocks: false,
      render: (blockId: number, _ctxId: number, close: () => void) => {
        if (!settingsOn().list || !isListBlock(blockId)) return null
        return getReact().createElement(ListCmdGroup, { blockId, close })
      },
    })
  } catch (e) {
    console.warn("[NEO] 注册列表视图块菜单命令失败", e)
  }
  try {
    bmc.registerBlockMenuCommand(CMD_CHART, {
      worksOnMultipleBlocks: false,
      render: (blockId: number, _ctxId: number, close: () => void) => {
        if (!settingsOn().chart) return null
        const tableId = isTableBlock(blockId) ? blockId : nearestTableBlockId(blockId)
        if (tableId == null) return null
        return getReact().createElement(ChartCmdGroup, { tableId, close })
      },
    })
  } catch (e) {
    console.warn("[NEO] 注册数据图表块菜单命令失败", e)
  }

  // 一次性清理早期 bug 产生的孤儿图表块（幂等，删完即空）
  void cleanupOrphanChartBlocks()
}

export function disposeBlockMenuCommands() {
  const bmc = (window as unknown as { orca: any }).orca?.blockMenuCommands
  if (!bmc) return
  try {
    bmc.unregisterBlockMenuCommand(CMD_LIST)
  } catch { /* ignore */ }
  try {
    bmc.unregisterBlockMenuCommand(CMD_CHART)
  } catch { /* ignore */ }
}

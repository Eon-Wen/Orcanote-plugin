import { PALETTES, type Palette } from "./palettes"
import type { SettingsSchema } from "./orca"

/** 一个功能开关的元信息：设置项 key ↔ body class */
export interface FeatureToggle {
  key: string
  className: string
  label: string
  description: string
  defaultValue: boolean
}

export const FEATURES: FeatureToggle[] = [
  {
    key: "frostedglass",
    className: "neo-frostedglass",
    label: "毛玻璃",
    description: "菜单、弹层、模态与悬浮面包屑改为半透明并模糊背景（侧栏不受影响）。",
    defaultValue: true,
  },
  {
    key: "colorfulHeading",
    className: "neo-colorful-heading",
    label: "彩色标题",
    description: "H1–H4 标题按色相依次旋转，层级一眼可辨。",
    defaultValue: false,
  },
  {
    key: "colorfulList",
    className: "neo-colorful-list",
    label: "彩色列表",
    description: "无序列表的 bullet 与有序列表序号按层级变换颜色。",
    defaultValue: false,
  },
  {
    key: "colorfulDocTree",
    className: "neo-colorful-doctree",
    label: "彩色文档树",
    description:
      "参考思源「彩色文档树」：侧栏的页面 / 收藏 / 标签与日历改用莫兰迪色系并带渐变背景，每个列表独立循环色相、子树同色。关闭后页面块恢复跟随 Neo 主题配色。",
    defaultValue: false,
  },
  {
    key: "listLine",
    className: "neo-list-line",
    label: "列表参考线",
    description: "显示缩进层级竖线，悬停时高亮当前层级。",
    defaultValue: true,
  },
  {
    key: "immersive",
    className: "neo-immersive",
    label: "沉浸模式",
    description: "当前编辑块渲染一条跟随光标的强调色高亮带（聚焦当前行），并隐藏顶栏工具与块侧边按钮。",
    defaultValue: false,
  },
  {
    key: "typewriter",
    className: "neo-typewriter",
    label: "打字机模式",
    description: "输入时当前行始终保持在编辑器垂直居中，像打字机一样。",
    defaultValue: false,
  },
  {
    key: "typeSound",
    className: "neo-type-sound",
    label: "打字音",
    description: "敲击键盘时播放打字机音效（取自 keysound 项目，MIT 许可）。",
    defaultValue: false,
  },
  {
    key: "browserTabs",
    className: "neo-browser-tabs",
    label: "缓存编辑器页签",
    description:
      "把 Ctrl+Tab 的缓存编辑器列表变成常驻页签条：点击切换、可重排序，拖到面板边缘即可分栏。默认横排在编辑器顶部，可用「垂直页签」改为竖排。",
    defaultValue: true,
  },
  {
    key: "ide",
    className: "neo-ide",
    label: "IDE 风格",
    description: "收紧行高与间距，数字等宽，提高信息密度。",
    defaultValue: false,
  },
  {
    key: "sidebarMute",
    className: "neo-sidebar-mute",
    label: "侧栏静音",
    description: "侧栏降低饱和度，鼠标移入时恢复。",
    defaultValue: false,
  },
  {
    key: "fusion",
    className: "neo-fusion",
    label: "超级融合",
    description: "顶栏、侧栏与正文共用同一底色，去除所有分隔线。",
    defaultValue: false,
  },
  {
    key: "wordCount",
    className: "neo-word-count",
    label: "写作进度统计",
    description:
      "块被打上「写作标签」的子标签时，在标签旁显示一个小圆环（按完成度着色）；点击查看该块所有子块的字数统计、目标完成度圆环与截止日期信息。",
    defaultValue: true,
  },
  {
    key: "confettiEnabled",
    className: "neo-confetti",
    label: "庆祝动画",
    description:
      "写作目标达成时播放全屏彩带庆祝动画。关闭后不再播放（达成记录仍会保存，重新打开也不会补放旧目标的动画）。",
    defaultValue: true,
  },
  {
    key: "verticalTabs",
    className: "neo-vertical-tabs",
    label: "垂直页签",
    description:
      "缓存编辑器页签改为竖排在编辑器左侧（思源 Neo 同款），拖动右边缘可调宽、双击复位。需先开启「缓存编辑器页签」。",
    defaultValue: false,
  },
  {
    key: "pluginDrawer",
    className: "neo-plugin-drawer",
    label: "插件图标抽屉",
    description:
      "把顶栏越积越多的图标（插件与原生按钮）折叠收纳进一个抽屉按钮：悬停图标点右上角 ▾ 收纳，抽屉里点击图标仍可正常使用，也可随时「取出」放回顶栏原位。收纳状态跨仓库记住。左侧侧栏开关/前进后退不参与。",
    defaultValue: true,
  },
]

/** 始终可用的非预设项（不随明暗模式变化） */
const PALETTE_SPECIALS = [
  { label: "自定义主题色", value: "custom" },
  { label: "跟随时间", value: "followTime" },
  { label: "每次启动随机", value: "random" },
]

/** 某配色在给定明暗模式下是否可用（含对应模式的色值） */
export function paletteAvailableInMode(p: Palette, dark: boolean): boolean {
  return dark ? Boolean(p.dark) : Boolean(p.light)
}

/** 按虎鲸当前明暗模式构建配色下拉项：
 *  - 浅色模式仅列含 light 的方案，深色模式仅列含 dark 的方案；
 *  - 「自定义 / 跟随时间 / 每次启动随机」始终可用。 */
export function buildPaletteChoices(dark: boolean): { label: string; value: string }[] {
  return [
    ...PALETTE_SPECIALS,
    ...PALETTES.filter((p) => paletteAvailableInMode(p, dark)).map((p) => ({
      label: p.label,
      value: p.id,
    })),
  ]
}

export const SETTINGS_SCHEMA: SettingsSchema = {
  palette: {
    type: "singleChoice",
    label: "配色方案",
    description:
      "内置 30 套 Neo 预设配色。浅色模式下只列出浅色配色，深色模式下只列出" +
      "深色配色；选择「自定义主题色」时使用下方的主题色；" +
      "「跟随时间」按晨/昼/暮/夜自动切换；「每次启动随机」每次打开随机挑选一套。",
    defaultValue: "default",
    choices: buildPaletteChoices(false),
  },
  customColor: {
    type: "color",
    label: "自定义主题色",
    description:
      "仅在配色方案为「自定义主题色」时生效。其余所有颜色都会由这一个基色在 OKLCH 空间派生。",
    defaultValue: "#6a85e3",
  },
  saturation: {
    type: "number",
    label: "饱和度",
    description: "调节背景与表面的着色强度。1 为标准，0 接近中性灰，2 为浓郁。",
    defaultValue: 1,
  },
  invertDark: {
    type: "boolean",
    label: "暗色反转",
    description: "暗色模式下交换背景色与表面色，得到更深邃的观感。",
    defaultValue: false,
  },
  texture: {
    type: "singleChoice",
    label: "纹理",
    description:
      "忠实移植自思源 Neo-Plus 的全套纹理（共 13 种），由「纹理强度」调节浓淡。纹理以全屏浮层 + 混合模式铺满整窗背景，明暗模式各自调校、均清晰可见。选「无」关闭。",
    defaultValue: "none",
    choices: [
      { label: "无", value: "none" },
      { label: "新闻纸", value: "newsprint" },
      { label: "压纹纸", value: "embossedpaper" },
      { label: "噪点", value: "noise" },
      { label: "亚克力", value: "acrylic" },
      { label: "棋盘格", value: "checkerboard" },
      { label: "网格", value: "grid" },
      { label: "十字点", value: "crossdot" },
      { label: "木纹", value: "wood" },
      { label: "迷彩", value: "camouflage" },
      { label: "颗粒", value: "granule" },
      { label: "羽丝", value: "feathery" },
      { label: "绒面", value: "velvet" },
      { label: "自定义图", value: "customimage" },
    ],
  },
  ...Object.fromEntries(
    FEATURES.map((f) => [
      f.key,
      {
        type: "boolean" as const,
        label: f.label,
        description: f.description,
        defaultValue: f.defaultValue,
      },
    ]),
  ),
  trashEnabled: {
    type: "boolean",
    label: "回收站",
    description:
      "开启后，删除页面会自动存入回收站（普通搜索搜不到），可在顶栏「回收站」入口恢复或彻底删除。关闭则删除直接真删、不进回收站。",
    defaultValue: true,
  },
  trashRetentionDays: {
    type: "number",
    label: "回收站保留天数",
    description:
      "回收站中的页面超过该天数自动清除（原块已真删，仅清快照）。默认 30 天。设很大值近似为永久保留，仍可用「清空回收站」手动清除。",
    defaultValue: 30,
  },
  refMigrateEnabled: {
    type: "boolean",
    label: "精细迁移引用",
    description:
      "在反链面板工具条加「精细迁移引用」入口：弹窗列出引用当前块的全部条目，可勾选批量迁移到自选目标（目标为标签则转成标签，为页面/块则转成 @引用）。关闭后入口按钮隐藏、相关命令失效。",
    defaultValue: true,
  },
  pageSortModePages: {
    type: "singleChoice",
    label: "页面排序方式",
    description:
      "侧边栏「页面」列表的排序方式（展示层排序，不改数据库；与标签列表互不影响）。「手动拖拽」模式下拖动条目调整顺序，自动保存、重启保留；切到其他排序再切回手动时恢复上次的手动顺序。",
    defaultValue: "default",
    choices: [
      { label: "默认（拼音/层级）", value: "default" },
      { label: "创建时间 ↑（正序）", value: "created" },
      { label: "创建时间 ↓（倒序）", value: "createdDesc" },
      { label: "修改时间 ↑（正序）", value: "modified" },
      { label: "修改时间 ↓（倒序）", value: "modifiedDesc" },
      { label: "手动拖拽", value: "manual" },
    ],
  },
  pageSortModeTags: {
    type: "singleChoice",
    label: "标签排序方式",
    description:
      "侧边栏「标签」列表的排序方式（展示层排序，不改数据库；与页面列表互不影响）。「手动拖拽」模式下拖动条目调整顺序，自动保存、重启保留；切到其他排序再切回手动时恢复上次的手动顺序。",
    defaultValue: "default",
    choices: [
      { label: "默认（拼音/层级）", value: "default" },
      { label: "创建时间 ↑（正序）", value: "created" },
      { label: "创建时间 ↓（倒序）", value: "createdDesc" },
      { label: "修改时间 ↑（正序）", value: "modified" },
      { label: "修改时间 ↓（倒序）", value: "modifiedDesc" },
      { label: "手动拖拽", value: "manual" },
    ],
  },
  pageSortEnabled: {
    type: "boolean",
    label: "页面排序功能",
    description:
      "在侧边栏「页面/标签」列表顶部显示排序下拉（默认拼音 / 创建时间 / 修改时间 / 手动拖拽）。关闭后下拉隐藏、排序恢复原生顺序。",
    defaultValue: true,
  },
  pageBatchEnabled: {
    type: "boolean",
    label: "页面多选批量包含",
    description:
      "按住 Cmd/Ctrl 点击侧边栏页面/标签/收藏条目可多选，通过操作条批量改变「包含于」页面或移到顶层。关闭后多选与操作条不再出现。",
    defaultValue: true,
  },
  listViewEnabled: {
    type: "boolean",
    label: "列表视图",
    description:
      "右键列表块 → 菜单「插件命令」→「列表视图」，可把顶层无序/有序/任务列表切换为表格视图（纯展示层转换，数据不动，随时切回列表），支持缩放、全屏。",
    defaultValue: true,
  },
  chartEnabled: {
    type: "boolean",
    label: "表格转统计图",
    description:
      "右键表格块或点块手柄菜单出现「数据图表」，可把表格数据生成柱状图/折线图/饼图：弹窗实时预览、可导出 PNG，也可插入笔记（图表内嵌在表格下方、跟随文档、表格数据变化自动更新）。",
    defaultValue: true,
  },
  textureOpacity: {
    type: "number",
    label: "纹理强度（乘数）",
    description:
      "对当前纹理基础强度的最终乘数，0 为关闭。1 表示采用思源 Neo 的原版强度；可大于 1 加强、小于 1 减弱。各纹理明暗模式下有各自独立的基础强度。",
    defaultValue: 1,
  },
  taskShape: {
    type: "singleChoice",
    label: "任务勾选形状",
    description:
      "任务列表勾选标记的形状。「默认」使用虎鲸原生形状，其余为 Neo 提供的常规形状。无论哪种形状，颜色都跟随主题：未完成为主题中性色、已完成为主题色。",
    defaultValue: "default",
    choices: [
      { label: "默认（原生）", value: "default" },
      { label: "圆形", value: "circle" },
      { label: "圆角方形", value: "roundedsquare" },
      { label: "菱形", value: "diamond" },
      { label: "星形", value: "star" },
    ],
  },
  wordCountTag: {
    type: "string",
    label: "写作标签",
    description:
      "写作进度统计的父标签名。只有打上它的**子标签**的块才会出现统计圆点（父标签本身不显示）。",
    defaultValue: "元·主·Express",
  },
  wordCountTargetProp: {
    type: "string",
    label: "目标字数属性名",
    description:
      "在写作子标签上设定目标字数所用的属性名。优先读该块标签上填写的值，未填则回退到标签自身的默认值。",
    defaultValue: "目标字数",
  },
  wordCountDeadlineProp: {
    type: "string",
    label: "截止日期属性名",
    description:
      "在写作子标签上设定截止日期所用的属性名。弹层会显示该日期，并自动算出「距截止还有多少天」。支持时间戳、ISO 与 YYYY-MM-DD 等写法。",
    defaultValue: "截止日期",
  },
  backgroundImage: {
    type: "string",
    label: "自定义背景图",
    description:
      "填入图片 URL 或本地文件路径（file:// 开头）。留空表示不使用背景图。",
    defaultValue: "",
  },
  backgroundVeil: {
    type: "number",
    label: "背景图蒙版浓度",
    description: "背景图之上的底色遮罩不透明度，0–1。数值越小背景图越清晰。",
    defaultValue: 0.86,
  },
}

/** 任务勾选形状中「非原生」的选项（对应 body.neo-task-shape-<id> 类的 mask 形状） */
export const TASK_MASK_SHAPES = ["circle", "roundedsquare", "diamond", "star"] as const

export interface NeoSettings {
  palette: string
  customColor: string
  saturation: number
  invertDark: boolean
  texture: string
  textureOpacity: number
  taskShape: string
  backgroundImage: string
  backgroundVeil: number
  [key: string]: unknown
}

export function withDefaults(raw: Record<string, unknown> | undefined): NeoSettings {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(SETTINGS_SCHEMA)) {
    out[key] = raw?.[key] ?? item.defaultValue
  }
  return out as NeoSettings
}

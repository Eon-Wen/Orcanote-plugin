import { PALETTES } from "./palettes"
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
    description: "侧栏、顶栏、菜单与弹层改为半透明并模糊背景。",
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
    key: "colorfulSelection",
    className: "neo-colorful-selection",
    label: "彩色选区",
    description: "选中文本使用强调色高亮。",
    defaultValue: true,
  },
  {
    key: "listLine",
    className: "neo-list-line",
    label: "列表参考线",
    description: "显示缩进层级竖线，悬停时高亮当前层级。",
    defaultValue: true,
  },
  {
    key: "focusBlock",
    className: "neo-focus-block",
    label: "聚焦块指示",
    description: "正在编辑的块显示淡色底纹与左侧指示条。",
    defaultValue: false,
  },
  {
    key: "immersive",
    className: "neo-immersive",
    label: "沉浸模式",
    description: "隐藏顶栏工具与块侧边按钮，鼠标移入时才显示。",
    defaultValue: false,
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
    key: "cardList",
    className: "neo-card-list",
    label: "卡片搜索列表",
    description: "搜索结果、查询结果与反链以卡片形式呈现。",
    defaultValue: true,
  },
  {
    key: "verticalTabs",
    className: "neo-vertical-tabs",
    label: "垂直页签",
    description: "面板内的查询页签改为纵向排布。",
    defaultValue: false,
  },
  {
    key: "scrollFade",
    className: "neo-scroll-fade",
    label: "卷轴效果",
    description: "正文顶部与底部渐隐，模拟纸卷。",
    defaultValue: false,
  },
  {
    key: "smoothCaret",
    className: "neo-smooth-caret",
    label: "平滑光标",
    description: "文本光标以缓动动画在字符间移动。",
    defaultValue: false,
  },
  {
    key: "highContrast",
    className: "neo-high-contrast",
    label: "高对比",
    description: "提升正文与背景的明度差，改善弱光环境可读性。",
    defaultValue: false,
  },
  {
    key: "noAnimation",
    className: "neo-no-animation",
    label: "关闭动画",
    description: "移除全部过渡与动画，追求极致响应速度。",
    defaultValue: false,
  },
]

export const PALETTE_CHOICES = [
  { label: "自定义主题色", value: "custom" },
  { label: "跟随时间", value: "followTime" },
  { label: "每次启动随机", value: "random" },
  ...PALETTES.map((p) => ({ label: p.label, value: p.id })),
]

export const SETTINGS_SCHEMA: SettingsSchema = {
  palette: {
    type: "singleChoice",
    label: "配色方案",
    description:
      "内置 30 套 Neo 预设配色。选择「自定义主题色」时使用下方的主题色；" +
      "「跟随时间」按晨/昼/暮/夜自动切换；「每次启动随机」每次打开随机挑选一套。",
    defaultValue: "default",
    choices: PALETTE_CHOICES,
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
      "移植自 Neo-Plus 的纹理背景。选「无」关闭；其余为 Neo-Plus 原版纹理（颗粒 / 噪点 / 压纹纸 / 羽丝 / 迷彩 / 木纹 / 绒面），由「纹理强度」调节浓淡。纹理以叠加混合(overlay)方式铺满背景，明暗模式均可见。",
    defaultValue: "none",
    choices: [
      { label: "无", value: "none" },
      { label: "颗粒", value: "granule" },
      { label: "噪点", value: "noise" },
      { label: "压纹纸", value: "embossedpaper" },
      { label: "羽丝", value: "feathery" },
      { label: "迷彩", value: "camouflage" },
      { label: "木纹", value: "wood" },
      { label: "绒面", value: "velvet" },
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
  textureOpacity: {
    type: "number",
    label: "纹理强度",
    description:
      "编辑器画布上纹理的浓淡，0 为关闭。建议 0.15–0.5：数值越大颗粒/纹路越明显。各纹理自带不同的原始强度（如噪点很淡、压纹纸/木纹较强）。",
    defaultValue: 0.3,
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

export interface NeoSettings {
  palette: string
  customColor: string
  saturation: number
  invertDark: boolean
  texture: string
  textureOpacity: number
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

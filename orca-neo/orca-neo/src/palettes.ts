/* 30 套 Neo 预设配色。
 * 数据来源：SiYuan Neo-Plus 插件 styles/palette/*.scss，经脚本批量提取。
 * 注：default 一项在原插件中是对 --neo-default-* 变量的引用，这里已展开为具体色值。 */

export interface PaletteScheme {
  base?: string
  primary?: string
  accent?: string
  background?: string
  surface?: string
  onBackground?: string
  onSurface?: string
}

export interface Palette {
  id: string
  label: string
  light?: PaletteScheme
  dark?: PaletteScheme
  darkInvert?: PaletteScheme
}

export const PALETTES: Palette[] = [
  {
    id: "default",
    label: "默认 Default",
    light: {"base": "#6a85e3", "primary": "#6a85e3", "accent": "#6a85e3", "background": "#ffffff", "surface": "#f1f2ff", "onBackground": "#181051", "onSurface": "#6b668d"},
    dark: {"base": "#7d86eb", "primary": "#7b7be5", "accent": "#8f8fff", "background": "#282c34", "surface": "#1e2227", "onBackground": "#e1e4ec", "onSurface": "#bfbec8"},
    darkInvert: {"background": "#1e2227", "surface": "#282c34", "onBackground": "#e7eaef", "onSurface": "#b1afb8"},
  },
  {
    id: "classic",
    label: "经典 Classic",
    light: {"base": "#548aee", "primary": "#548aee", "accent": "#548aee", "background": "#feffff", "surface": "#f2f2f1", "onBackground": "#3b3b3b", "onSurface": "#3b3b3bc2"},
    dark: {"base": "#3a6ab5", "primary": "#548be2", "accent": "#609eff", "background": "#161616", "surface": "#2b2b2b", "onBackground": "#e6e6e6", "onSurface": "#e1e1e1bd"},
    darkInvert: {"background": "#2b2b2b", "surface": "#161616", "onBackground": "#ebebeb", "onSurface": "#e8e8e8bd"},
  },
  {
    id: "amber",
    label: "琥珀 Amber",
    light: {"base": "#eecb9e", "primary": "#b79d7b", "accent": "#c58635", "background": "#f8f5f1", "surface": "#f2ece3", "onBackground": "#654f2f", "onSurface": "#7b5c30"},
    dark: {"base": "#d5ab7c", "primary": "#c19a6e", "accent": "#d5ab7c", "background": "#221e1e", "surface": "#423939", "onBackground": "#f4e6d2", "onSurface": "#9d8b8b"},
    darkInvert: {"background": "#423939", "surface": "#221e1e", "onBackground": "#ffefd9", "onSurface": "#cabdb2"},
  },
  {
    id: "firefly",
    label: "流萤 Firefly",
    dark: {"base": "#cef698", "primary": "#89a861", "accent": "#cef698", "background": "#19192e", "surface": "#212037", "onBackground": "#e0ead3", "onSurface": "#e0ead3d0"},
    darkInvert: {"background": "#212037", "surface": "#19192e"},
  },
  {
    id: "dusk",
    label: "黄昏 Dusk",
    light: {"base": "#c9917c", "primary": "#c9917c", "accent": "#c9917c", "background": "#fff3e5", "surface": "#f8e5d3", "onBackground": "#575279", "onSurface": "#908d9f"},
  },
  {
    id: "gingko",
    label: "银杏 Gingko",
    light: {"base": "#d55a5a", "primary": "#d55a5a", "accent": "#d55a5a", "background": "#fff5cc", "surface": "#fae9b3", "onBackground": "#4a2e1f", "onSurface": "#7c7065"},
  },
  {
    id: "lavender",
    label: "薰衣草 Lavender",
    light: {"base": "#a095bd", "primary": "#a095bd", "accent": "#6364dd", "background": "#faf4ed", "surface": "#f2e9e1", "onBackground": "#575279", "onSurface": "#797593"},
    dark: {"base": "#ebc3bc", "primary": "#bc847b", "accent": "#ebc3bc", "background": "#151320", "surface": "#1f1d2e", "onBackground": "#e0def4", "onSurface": "#8d89a6"},
    darkInvert: {"background": "#1f1d2e", "surface": "#151320"},
  },
  {
    id: "midnight",
    label: "午夜 Midnight",
    dark: {"base": "#4875b3", "primary": "#6aa3f3", "accent": "#6aa3f3", "background": "#17181c", "surface": "#07080c", "onBackground": "#fbfdff", "onSurface": "#acadb3"},
    darkInvert: {"background": "#07080c", "surface": "#17181c"},
  },
  {
    id: "ocean",
    label: "海洋 Ocean",
    dark: {"base": "#b8e53f", "primary": "#8eb22d", "accent": "#b8e53f", "background": "#1e253b", "surface": "#11172c", "onBackground": "#ebebeb", "onSurface": "#919fb1"},
    darkInvert: {"background": "#11172c", "surface": "#1e253b"},
  },
  {
    id: "opalite",
    label: "蛋白石 Opalite",
    light: {"base": "#b8d2e8", "primary": "#5e7cc6", "accent": "#5e7cc6", "background": "#f9f7e4", "surface": "#f0efd0", "onBackground": "#336260", "onSurface": "#6c8687"},
  },
  {
    id: "oxygen",
    label: "氧气 Oxygen",
    dark: {"base": "#efa685", "primary": "#c5866a", "accent": "#efa685", "background": "#272e33", "surface": "#364852", "onBackground": "#e2dac5", "onSurface": "#d3cab4"},
    darkInvert: {"background": "#364852", "surface": "#272e33", "onBackground": "#f8efda", "onSurface": "#ccc4b3"},
  },
  {
    id: "sakura",
    label: "樱花 Sakura",
    light: {"base": "#ffcaca", "primary": "#e68e94", "accent": "#c28181", "background": "#fffaf4", "surface": "#ffede7", "onBackground": "#56487c", "onSurface": "#7c758d"},
  },
  {
    id: "twilight",
    label: "暮光 Twilight",
    dark: {"base": "#b7c9ff", "primary": "#8297d6", "accent": "#7295ff", "background": "#1e2030", "surface": "#24273a", "onBackground": "#c5cff5", "onSurface": "#8f97b7"},
    darkInvert: {"background": "#24273a", "surface": "#1e2030", "onBackground": "#dae2ff", "onSurface": "#aab2d3"},
  },
  {
    id: "wilderness",
    label: "旷野 Wilderness",
    light: {"base": "#beea9d", "primary": "#74b49a", "accent": "#008e9e", "background": "#fdf6e3", "surface": "#eaedc8", "onBackground": "#46687c", "onSurface": "#6f8892"},
    dark: {"base": "#d8ed8d", "primary": "#a4b664", "accent": "#62e9b6", "background": "#19393a", "surface": "#214b4c", "onBackground": "#dee2b9", "onSurface": "#8c9d80"},
    darkInvert: {"background": "#214b4c", "surface": "#19393a", "onBackground": "#eef2cb", "onSurface": "#bdcdb1"},
  },
  {
    id: "everbliss",
    label: "长乐 Everbliss",
    light: {"base": "#de6358", "primary": "#f06255", "accent": "#f06255", "background": "#fefaf0", "surface": "#f4ebd2", "onBackground": "#4d3d5f", "onSurface": "#4d3d5fa2"},
    dark: {"base": "#c5594a", "primary": "#d55f4f", "accent": "#ff816f", "background": "#17151c", "surface": "#2d2935", "onBackground": "#e3c9b0", "onSurface": "#e3c9b0a2"},
    darkInvert: {"background": "#2d2935", "surface": "#17151c", "onBackground": "#efd8c2", "onSurface": "#f2e2d3a2"},
  },
  {
    id: "aerisland",
    label: "空岛 Aerisland",
    light: {"base": "#a7e1da", "primary": "#4fbdb0", "accent": "#2ea5a2", "background": "#f7fcf5", "surface": "#e5efdf", "onBackground": "#0c544c", "onSurface": "#09423ba2"},
    dark: {"base": "#3c8681", "primary": "#44a197", "accent": "#5ecfc2", "background": "#12161f", "surface": "#252b3b", "onBackground": "#c6c9b3", "onSurface": "#c6c9b3a2"},
    darkInvert: {"background": "#252b3b", "surface": "#12161f", "onBackground": "#dee1c9", "onSurface": "#e5e8d0a2"},
  },
  {
    id: "zerith",
    label: "泽瑞 Zerith",
    light: {"base": "#d6eb53", "primary": "#8bc600", "accent": "#73a400", "background": "#f7fbfb", "surface": "#e5edec", "onBackground": "#265970", "onSurface": "#265970a2"},
    dark: {"base": "#b4cb26", "primary": "#91a30b", "accent": "#dbf611", "background": "#0d1721", "surface": "#1c2d3c", "onBackground": "#bfd1cc", "onSurface": "#bfd1cca2"},
    darkInvert: {"background": "#1c2d3c", "surface": "#0d1720", "onBackground": "#d0e3de", "onSurface": "#cde0dba2"},
  },
  {
    id: "stellula",
    label: "小星 Stellula",
    light: {"base": "#97dbde", "primary": "#48b2ba", "accent": "#3ea2a9", "background": "#fff8f2", "surface": "#e0ece8", "onBackground": "#424074", "onSurface": "#373379a2"},
    dark: {"base": "#3c7e83", "primary": "#fc8b60", "accent": "#fc8b60", "background": "#232227", "surface": "#313842", "onBackground": "#e6cfbc", "onSurface": "#e6cfbca2"},
    darkInvert: {"background": "#313842", "surface": "#232227", "onBackground": "#f1dfd0", "onSurface": "#f1dfd1a2"},
  },
  {
    id: "vael",
    label: "维尔 Vael",
    light: {"base": "#aacde1", "primary": "#5591b2", "accent": "#31a7df", "background": "#fff9ef", "surface": "#f7eddc", "onBackground": "#2a556d", "onSurface": "#2a556db3"},
    dark: {"base": "#4f8873", "primary": "#7ec2a6", "accent": "#7ec2a6", "background": "#1b2328", "surface": "#29353c", "onBackground": "#bfd3ca", "onSurface": "#bfd3cab3"},
    darkInvert: {"background": "#29353c", "surface": "#1b2328", "onBackground": "#d2e6dd", "onSurface": "#cfe4dbb3"},
  },
  {
    id: "meridian",
    label: "子午 Meridian",
    light: {"base": "#010101", "primary": "#010101", "accent": "#0050ff", "background": "#fefefe", "surface": "#ededed", "onBackground": "#010101", "onSurface": "#01010194"},
    dark: {"base": "#fefefe", "primary": "#919191", "accent": "#4fff2d", "background": "#010101", "surface": "#232323", "onBackground": "#fefefe", "onSurface": "#fefefe92"},
    darkInvert: {"background": "#010101", "surface": "#232323"},
  },
  {
    id: "savor",
    label: "回味 Savor",
    light: {"base": "#ee705b", "primary": "#ee705b", "accent": "#ee705b", "background": "#ffffff", "surface": "#f4f4f3", "onBackground": "#37352f", "onSurface": "#81868a"},
    dark: {"base": "#ce5f4d", "primary": "#ff7d68", "accent": "#ff7d68", "background": "#2f3437", "surface": "#202528", "onBackground": "#ebebeb", "onSurface": "#81868a"},
    darkInvert: {"background": "#202528", "surface": "#2f3437"},
  },
  {
    id: "sugar",
    label: "砂糖 Sugar",
    light: {"base": "#ea566b", "primary": "#ea566b", "accent": "#ea566b", "background": "#f9f8f5", "surface": "#f3ede8", "onBackground": "#37352f", "onSurface": "#8a8682"},
  },
  {
    id: "salt",
    label: "盐粒 Salt",
    light: {"base": "#007a95", "primary": "#252830", "accent": "#007a95", "background": "#eaf2f2", "surface": "#d7e0df", "onBackground": "#252931", "onSurface": "#5a5355"},
  },
  {
    id: "starry",
    label: "星空 Starry",
    dark: {"base": "#707299", "primary": "#aeb1ea", "accent": "#aeb1ea", "background": "#3a3845", "surface": "#2f2e38", "onBackground": "#ffe8d9", "onSurface": "#d8c0ae"},
    darkInvert: {"background": "#2f2e38", "surface": "#3a3845"},
  },
  {
    id: "tundra",
    label: "苔原 Tundra",
    light: {"base": "#2aa198", "primary": "#2aa198", "accent": "#2aa198", "background": "#fdf6e3", "surface": "#eee8d5", "onBackground": "#43555c", "onSurface": "#5b7179"},
  },
  {
    id: "abyss",
    label: "深渊 Abyss",
    dark: {"base": "#28ece9", "primary": "#18bbb8", "accent": "#28ece9", "background": "#001e26", "surface": "#032731", "onBackground": "#d4eff1", "onSurface": "#a1bcbe"},
    darkInvert: {"background": "#032731", "surface": "#001e26"},
  },
  {
    id: "violet",
    label: "紫罗兰 Violet",
    light: {"base": "#ad7a97", "primary": "#ad7a97", "accent": "#c35794", "background": "#f8f6ff", "surface": "#efebff", "onBackground": "#160045", "onSurface": "#5b4785"},
  },
  {
    id: "titaniumspace",
    label: "钛空 Titanium",
    light: {"base": "#7287fd", "primary": "#5e73e9", "accent": "#5e73e9", "background": "#eef1f5", "surface": "#dce0e8", "onBackground": "#4c4f69", "onSurface": "#6c6f85"},
    dark: {"base": "#90b1ff", "primary": "#90b1ff", "accent": "#90b1ff", "background": "#262c37", "surface": "#3a4353", "onBackground": "#eceff4", "onSurface": "#eceff49e"},
    darkInvert: {"background": "#3a4353", "surface": "#262c37"},
  },
  {
    id: "songyan",
    label: "松岩 Songyan",
    dark: {"base": "#fff29d", "primary": "#a89e60", "accent": "#fff29d", "background": "#2b383a", "surface": "#364548", "onBackground": "#fff8dd", "onSurface": "#fff9debc"},
    darkInvert: {"background": "#364548", "surface": "#2b383a", "onBackground": "#fffbea", "onSurface": "#fffbe8bc"},
  },
  {
    id: "lakeside",
    label: "湖畔 Lakeside",
    light: {"base": "#bde0e7", "primary": "#56bacb", "accent": "#47a0af", "background": "#fefbf6", "surface": "#e2eff2", "onBackground": "#27535a", "onSurface": "#27535aa6"},
    dark: {"base": "#3c897c", "primary": "#43a594", "accent": "#84eedc", "background": "#0e0f1d", "surface": "#131826", "onBackground": "#d0ecf7", "onSurface": "#c4e0ebab"},
    darkInvert: {"background": "#131826", "surface": "#0e0f1d", "onBackground": "#d9f4ff", "onSurface": "#d3edf7ac"},
  },
]

export const PALETTE_MAP: Record<string, Palette> = Object.fromEntries(
  PALETTES.map((p) => [p.id, p]),
)
